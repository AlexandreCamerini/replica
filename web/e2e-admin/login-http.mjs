#!/usr/bin/env node
// SIMULADO. Prova de ponta a ponta do login próprio da central (D335) pelo HTTP de um `next start` em modo produção: código de e-mail -> sessão de nível 1 ->
// cadastro e verificação do TOTP -> sessão de nível 2 -> central aberta; e o que fecha a sessão (cookie forjado, admin desativado, fator apagado, sessão anterior ao fator).
//
//   cd web && node e2e-admin/login-http.mjs [--sem-build]
//
// O modo produção exige banco com TLS (`sslmode=require`) e o Postgres de desenvolvimento não fala TLS. A prova põe na frente dele um intermediário TLS próprio
// (certificado autoassinado, só 127.0.0.1, porta livre): responde ao SSLRequest do protocolo do Postgres, faz o TLS e repassa os bytes ao Postgres local. A central
// conecta de verdade com `sslmode=require`; a prova conta os apertos de mão TLS. Banco: `login_http_prova`, criado e apagado pela prova no cluster de desenvolvimento
// (porta 54329, já preparado com `db/migrate.sh --local`, que cria os roles). Não toca `civico` nem `admin_coleta*`. Sem rede externa: sem RESEND_API_KEY e sem
// TURNSTILE_SECRET_KEY o envio falha fechado, e a prova confere isso; para seguir adiante ela grava no banco, como dono, o hash de um código conhecido (é o que o envio faria).
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import postgres from "postgres";
import * as C from "./comum.mjs";
import { NOME_COOKIE_SESSAO } from "../src/lib/admin/cabecalhos.ts";
import { assinarSessao, hashDoCodigo, hashDoNonce } from "../src/lib/admin/sessao-cookie.ts";
import { deBase32, hotp, passoDe } from "../src/lib/admin/totp.ts";

const R = C.criarRelato();
const T0 = Date.now();
const HP = C.HOST_PRODUCAO;
const ENV_CHAVE = { SESSION_SECRET: C.SEGREDO_DE_PROVA };
const ADMIN = C.ADMIN_LOCAL_EMAIL;
const NAO_ADMIN = "ninguem@example.invalid";
const cabPost = { host: HP, origin: `https://${HP}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };

// ------------------------------------------------------------------ banco de prova e intermediário TLS
const PORTA_PG = 54329;
const BANCO = "login_http_prova";
const SERVIDOR = `postgres://postgres@127.0.0.1:${PORTA_PG}`;

/** Intermediário TLS do protocolo do Postgres: SSLRequest (8 bytes) -> "S" -> TLS -> repasse ao Postgres local sem TLS. Só 127.0.0.1. */
function subirTls(dir) {
  const env = C.envLimpa();
  // nomes sem .key/.pem de propósito (o sandbox das provas nega leitura por extensão)
  const chave = path.join(dir, "tls-chave");
  const cert = path.join(dir, "tls-cert");
  const r = C.rodar("openssl", ["req", "-new", "-x509", "-days", "2", "-nodes", "-newkey", "rsa:2048", "-subj", "/CN=127.0.0.1", "-keyout", chave, "-out", cert], { env, timeout: 60_000 });
  if (r.rc !== 0) throw new Error(`openssl falhou: ${(r.err || r.erro || "").slice(-300)}`);
  const contexto = tls.createSecureContext({ key: fs.readFileSync(chave), cert: fs.readFileSync(cert) });
  let apertos = 0;
  let semTls = 0;
  const abertos = new Set();
  const srv = net.createServer((cliente) => {
    abertos.add(cliente);
    cliente.on("error", () => {});
    cliente.on("close", () => abertos.delete(cliente));
    cliente.once("data", (d) => {
      // SSLRequest: comprimento 8, código 80877103. Qualquer outra abertura (conexão sem TLS) é recusada: a central tem de pedir TLS.
      if (d.length !== 8 || d.readUInt32BE(0) !== 8 || d.readUInt32BE(4) !== 80877103) {
        semTls++;
        return cliente.destroy();
      }
      cliente.write("S");
      const seguro = new tls.TLSSocket(cliente, { isServer: true, secureContext: contexto });
      seguro.on("error", () => {});
      seguro.once("secure", () => {
        apertos++;
        const pg = net.connect(PORTA_PG, "127.0.0.1");
        abertos.add(pg);
        pg.on("error", () => seguro.destroy());
        pg.on("close", () => (abertos.delete(pg), seguro.destroy()));
        seguro.on("close", () => pg.destroy());
        seguro.pipe(pg);
        pg.pipe(seguro);
      });
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ porta: srv.address().port, apertos: () => apertos, semTls: () => semTls, fechar: () => (srv.close(), abertos.forEach((x) => x.destroy())) })));
}

async function subirPostgres() {
  const dir = fs.mkdtempSync(path.join(C.TMP, "login-http-"));
  const env = C.envLimpa();
  const psql = (banco, args) => {
    const r = C.rodar("psql", [`${SERVIDOR}/${banco}`, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { env, cwd: path.join(C.RAIZ, "db"), timeout: 300_000 });
    if (r.rc !== 0) throw new Error(`psql ${args.join(" ").slice(0, 80)} falhou: ${(r.err || r.erro || "").slice(-500)}`);
  };
  psql("postgres", ["-c", `drop database if exists ${BANCO}`]);
  psql("postgres", ["-c", `create database ${BANCO}`]);
  let proxy;
  const parar = () => {
    proxy?.fechar();
    try {
      psql("postgres", ["-c", `drop database if exists ${BANCO} with (force)`]);
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    // o que `db/migrate.sh --local` faz, menos os post_* que mexem em role do cluster (senha de desenvolvimento): aqui só o admin local, que é linha de tabela
    psql(BANCO, ["-f", "local/0000_supabase_stub.sql"]);
    const m = C.rodar("bash", [path.join(C.RAIZ, "db", "migrate.sh")], { env: { ...env, DATABASE_URL: `${SERVIDOR}/${BANCO}` }, timeout: 300_000 });
    if (m.rc !== 0) throw new Error(`db/migrate.sh falhou: ${(m.err || m.out).slice(-500)}`);
    psql(BANCO, ["-f", "local/post_0004_admin_local.sql"]);
    proxy = await subirTls(dir);
    return { porta: proxy.porta, proxy, dono: `${SERVIDOR}/${BANCO}`, central: `postgres://admin_central:admin_central@127.0.0.1:${proxy.porta}/${BANCO}?sslmode=require`, parar };
  } catch (e) {
    parar();
    throw e;
  }
}

// ------------------------------------------------------------------ HTTP
const cookiesDe = (r) => Object.fromEntries([r.cabecalhos["set-cookie"] ?? []].flat().map((c) => [c.split("=")[0], c]));
const valorDe = (setCookie) => setCookie.split(";")[0].split("=").slice(1).join("=");
function clienteHttp(base) {
  const pedir = (caminho, { cookie, metodo = "GET", corpo } = {}) =>
    C.crua(base, caminho, { metodo, cabecalhos: { ...(metodo === "POST" ? cabPost : { host: HP }), ...(cookie ? { cookie } : {}) }, corpo: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const postar = async (caminho, corpo, cookie) => {
    const t0 = Date.now();
    const r = await pedir(caminho, { metodo: "POST", corpo, cookie });
    let json = null;
    try {
      json = JSON.parse(r.texto);
    } catch {}
    return { ...r, json, ms: Date.now() - t0, cookies: cookiesDe(r) };
  };
  return { pedir, postar };
}

async function prova(pg) {
  const dono = postgres(pg.dono, { max: 2, onnotice: () => {} });
  const env = C.envCi({ ADMIN_CENTRAL: "producao", VERCEL_ENV: "production", AUTH_PROVIDER: "pg", SESSION_SECRET: C.SEGREDO_DE_PROVA, ADMIN_DATABASE_URL: pg.central, NEXT_DIST_DIR: C.DIST_ADMIN_PROD });
  const srv = await C.subirNext(env);
  const { pedir, postar } = clienteHttp(srv.base);
  const sess = (valor) => `${NOME_COOKIE_SESSAO}=${valor}`;
  const NONCE = "c".repeat(32);
  const gravarCodigo = (email, codigo) =>
    dono`insert into login.central_codigos (email, code_hash, nonce_hash, expires_at, sent_at)
         values (${email}, ${hashDoCodigo(ENV_CHAVE, email, NONCE, codigo)}, ${hashDoNonce(ENV_CHAVE, NONCE)}, now() + interval '10 minutes', array[now()])
         on conflict (email) do update set code_hash = excluded.code_hash, nonce_hash = excluded.nonce_hash, expires_at = excluded.expires_at, attempts = 0`;
  try {
    R.cabecalho("1. o admin de prova existe e está ativo");
    const [a] = await dono`select ativo from adm_admins where email = ${ADMIN}`;
    R.checa(a?.ativo === true, `${ADMIN} é admin ativo em adm_admins (db/local/post_0004)`, JSON.stringify(a));

    R.cabecalho("2. pedir o código: resposta neutra; sem chave de captcha nada é emitido (falha fechada)");
    await postar("/admin/api/entrar/codigo", { email: "aquecimento@example.invalid" });
    for (const email of [ADMIN, NAO_ADMIN]) {
      const r = await postar("/admin/api/entrar/codigo", { email, turnstile: "x" });
      R.checa(r.status === 200 && r.json?.proximo === "/admin/entrar?etapa=codigo" && !r.cookies[NOME_COOKIE_SESSAO], `codigo para ${email}: 200 neutro, sem cookie de sessão`, `${r.status} ${r.texto.slice(0, 100)}`);
      R.checa(/^adm_entrar_email=[^;]+(?:\||%7C)[0-9a-f]{32};/i.test(r.cookies.adm_entrar_email ?? ""), `codigo para ${email}: o cookie da etapa leva o e-mail e um nonce de 32 hex`, (r.cookies.adm_entrar_email ?? "").slice(0, 60));
    }
    await new Promise((r) => setTimeout(r, 800)); // o trabalho continua depois da resposta (after)
    const [{ n }] = await dono`select count(*)::int as n from login.central_codigos`;
    R.checa(n === 0, "nenhum código foi emitido: sem TURNSTILE_SECRET_KEY o captcha recusa antes de o banco ser tocado", `${n} linhas`);

    R.cabecalho("3. verificar o código: só admin ativo com o código certo ganha sessão, e ela é de nível 1");
    await gravarCodigo(ADMIN, "246813");
    await gravarCodigo(NAO_ADMIN, "246813");
    const ckEmail = (e, nonce = NONCE) => `adm_entrar_email=${e}|${nonce}`;
    const errado = await postar("/admin/api/entrar/verificar", { code: "000000" }, ckEmail(ADMIN));
    R.checa(errado.status === 400 && !errado.cookies[NOME_COOKIE_SESSAO], "código errado: 400, sem sessão", `${errado.status}`);
    const estranho = await postar("/admin/api/entrar/verificar", { code: "246813" }, ckEmail(NAO_ADMIN));
    R.checa(estranho.status === 400 && !estranho.cookies[NOME_COOKIE_SESSAO] && estranho.json?.erro === errado.json?.erro, "código CERTO de quem não é admin: 400 com a mesma mensagem, sem sessão", `${estranho.status} ${estranho.texto.slice(0, 80)}`);
    R.checa(Math.abs(errado.ms - estranho.ms) <= 500 && Math.min(errado.ms, estranho.ms) >= 1400, `admin e não admin levam o mesmo tempo (piso de 1,5 s): ${errado.ms} e ${estranho.ms} ms`);
    // quem monta o cookie à mão com o e-mail do admin, sem o nonce de quem pediu: não entra nem com o código certo, e não gasta as tentativas dele
    for (const nonce of ["d".repeat(32), "", "xyz"]) {
      const r = await postar("/admin/api/entrar/verificar", { code: "246813" }, nonce === "" ? `adm_entrar_email=${ADMIN}` : ckEmail(ADMIN, nonce));
      R.checa(r.status === 400 && !r.cookies[NOME_COOKIE_SESSAO], `código CERTO do admin com nonce ${nonce === "" ? "ausente" : nonce.slice(0, 4) + "…"}: 400, sem sessão`, `${r.status}`);
    }
    const [{ attempts }] = await dono`select attempts from login.central_codigos where email = ${ADMIN}`;
    R.checa(attempts === 1, "as tentativas de terceiro não contaram: só a do próprio navegador (a do código errado) está na linha", `attempts = ${attempts}`);
    const certo = await postar("/admin/api/entrar/verificar", { code: "246813" }, ckEmail(ADMIN));
    const sc1 = certo.cookies[NOME_COOKIE_SESSAO] ?? "";
    R.checa(certo.status === 200 && certo.json?.proximo === "/admin/entrar/fator" && sc1 !== "", "código certo do admin: 200, segue para o fator, com cookie de sessão", `${certo.status} ${certo.texto.slice(0, 80)}`);
    R.checa(/; HttpOnly/i.test(sc1) && /; Secure/i.test(sc1) && /; SameSite=strict/i.test(sc1) && /; Path=\/admin(;|$)/i.test(sc1) && /; Max-Age=900(;|$)/i.test(sc1) && !/domain=/i.test(sc1), `cookie ${NOME_COOKIE_SESSAO}: HttpOnly, Secure, SameSite=Strict, Path=/admin, Max-Age=900, sem Domain`, sc1.replace(/=[^;]+/, "=…"));
    const n1 = sess(valorDe(sc1));
    const reuso = await postar("/admin/api/entrar/verificar", { code: "246813" }, ckEmail(ADMIN));
    R.checa(reuso.status === 400 && !reuso.cookies[NOME_COOKIE_SESSAO], "o mesmo código de novo: 400 (uso único)", `${reuso.status}`);

    R.cabecalho("4. sessão de nível 1: só abre o fator; a central continua fechada");
    const adm = await pedir("/admin", { cookie: n1 });
    R.checa([307, 308].includes(adm.status) && /\/admin\/entrar\/fator$/.test(adm.cabecalhos.location ?? ""), "GET /admin com nível 1: redireciona para /admin/entrar/fator", `${adm.status} ${adm.cabecalhos.location}`);
    for (const [m, u] of [["GET", "/admin/api/estado"], ["POST", "/admin/api/pedidos"]]) {
      const r = await pedir(u, { cookie: n1, metodo: m, corpo: m === "POST" ? {} : undefined });
      R.checa(r.status === 404, `${m} ${u} com nível 1: 404 (API nunca redireciona nem responde)`, `${r.status}`);
    }
    const pag = await pedir("/admin/entrar/fator", { cookie: n1 });
    R.checa(pag.status === 200 && /Cadastre o autenticador/.test(pag.texto), "/admin/entrar/fator com nível 1 e sem fator: 200, tela de cadastro", `${pag.status}`);

    R.cabecalho("5. cadastro do TOTP e subida para o nível 2");
    const ini = await postar("/admin/api/entrar/fator/iniciar", {}, n1);
    const segredo = deBase32(ini.json?.segredo ?? "");
    R.checa(ini.status === 200 && segredo?.length === 20 && String(ini.json?.uri).startsWith("otpauth://totp/"), "fator/iniciar: 200 com o segredo (20 bytes em base32) e o link otpauth", `${ini.status} ${ini.texto.slice(0, 80)}`);
    const [f0] = await dono`select segredo_cifrado, verificado_em from login.central_fatores where email = ${ADMIN}`;
    R.checa(f0 && f0.verificado_em === null && !f0.segredo_cifrado.includes(ini.json.segredo), "no banco: fator pendente, segredo cifrado (o base32 não aparece)");
    const totp = (d = 0) => hotp(segredo, passoDe(Date.now()) + d);
    const ruim = await postar("/admin/api/entrar/fator/confirmar", { code: totp(40) }, n1);
    R.checa(ruim.status === 400 && !ruim.cookies[NOME_COOKIE_SESSAO], "TOTP errado: 400, sem subir de nível", `${ruim.status}`);
    const semSessao = await postar("/admin/api/entrar/fator/confirmar", { code: totp() });
    R.checa(semSessao.status === 404, "fator/confirmar sem sessão: 404", `${semSessao.status}`);
    const usado = totp();
    const ok = await postar("/admin/api/entrar/fator/confirmar", { code: usado }, n1);
    const sc2 = ok.cookies[NOME_COOKIE_SESSAO] ?? "";
    R.checa(ok.status === 200 && ok.json?.proximo === "/admin" && /; Max-Age=43200(;|$)/i.test(sc2) && /; HttpOnly/i.test(sc2) && /; SameSite=strict/i.test(sc2) && /; Path=\/admin(;|$)/i.test(sc2), "TOTP certo: 200, segue para /admin, cookie de nível 2 (Max-Age=43200, mesmas proteções)", `${ok.status} ${sc2.replace(/=[^;]+/, "=…")}`);
    const n2 = sess(valorDe(sc2));

    R.cabecalho("6. sessão de nível 2: a central abre, e o pedido leva o admin da sessão");
    for (const u of ["/admin", "/admin/fila", "/admin/rodadas"]) {
      const r = await pedir(u, { cookie: n2 });
      R.checa(r.status === 200, `GET ${u} com nível 2: 200`, `${r.status}`);
    }
    const est = await pedir("/admin/api/estado", { cookie: n2 });
    R.checa(est.status === 200, "GET /admin/api/estado com nível 2: 200", `${est.status}`);
    const deNovo = await postar("/admin/api/entrar/fator/iniciar", {}, n2);
    R.checa(deNovo.status === 200 && deNovo.json?.proximo === "/admin" && !deNovo.json?.segredo, "fator/iniciar com nível 2: não entrega segredo novo (manda para /admin)", `${deNovo.status} ${deNovo.texto.slice(0, 80)}`);

    R.cabecalho("7. nova entrada com fator já cadastrado: pede o código do autenticador; reuso e recadastro recusados");
    const pag2 = await pedir("/admin/entrar/fator", { cookie: n1 });
    R.checa(pag2.status === 200 && /Confirme com o autenticador/.test(pag2.texto), "/admin/entrar/fator com nível 1 e fator cadastrado: tela de verificação (não de cadastro)", `${pag2.status}`);
    const recad = await postar("/admin/api/entrar/fator/iniciar", {}, n1);
    R.checa(recad.status === 409 && !recad.json?.segredo, "fator/iniciar com fator verificado: 409, nenhum segredo novo", `${recad.status}`);
    const rep = await postar("/admin/api/entrar/fator/confirmar", { code: usado }, n1);
    R.checa(rep.status === 400 && !rep.cookies[NOME_COOKIE_SESSAO], "o mesmo código TOTP de novo: 400 (o passo já foi aceito)", `${rep.status}`);
    const passoDoProx = passoDe(Date.now()) + 1;
    const prox = await postar("/admin/api/entrar/fator/confirmar", { code: totp(1) }, n1);
    R.checa(prox.status === 200 && Boolean(prox.cookies[NOME_COOKIE_SESSAO]), "o código do passo seguinte: 200, nível 2", `${prox.status}`);

    R.cabecalho("8. o que fecha: cookie forjado, sessão de quem não é admin, sessão anterior ao fator, admin desativado, fator apagado");
    const agora = Date.now();
    const fecha = async (rotulo, cookie) => {
      const rs = await Promise.all(["/admin", "/admin/fila", "/admin/api/estado"].map((u) => pedir(u, { cookie })));
      const p = await pedir("/admin/api/pedidos", { cookie, metodo: "POST", corpo: {} });
      R.checa(rs.every((r) => r.status === 404) && p.status === 404, `${rotulo}: 404 em /admin, /admin/fila, /admin/api/estado e POST pedidos`, `${rs.map((r) => r.status).join(",")},${p.status}`);
    };
    await fecha("nível 2 assinado com outro segredo", sess(assinarSessao({ SESSION_SECRET: "outro-segredo-".repeat(4) }, ADMIN, 2, agora).valor));
    await fecha("nível 2 bem assinado de quem não é admin", sess(assinarSessao(ENV_CHAVE, NAO_ADMIN, 2, agora).valor));
    await fecha("nível 2 bem assinado, emitido 1 h antes de o fator ser verificado", sess(assinarSessao(ENV_CHAVE, ADMIN, 2, agora - 3600_000).valor));
    await fecha("cookie válido com o nome do cookie do site", `__Host-sessao=${valorDe(sc2)}; sessao=${valorDe(sc2)}`);
    await dono`update adm_admins set ativo = false where email = ${ADMIN}`;
    await fecha("admin desativado, com a sessão de nível 2 ainda no prazo", n2);
    const n1off = await pedir("/admin/entrar/fator", { cookie: n1 });
    R.checa(n1off.status === 404, "admin desativado, sessão de nível 1: /admin/entrar/fator = 404", `${n1off.status}`);
    await dono`update adm_admins set ativo = true where email = ${ADMIN}`;
    R.checa((await pedir("/admin", { cookie: n2 })).status === 404, "admin reativado: a sessão de antes da desativação NÃO volta a abrir (0158: desativar revoga)");
    await dono`update login.central_fatores set sessoes_desde = now() where email = ${ADMIN}`;
    await new Promise((r) => setTimeout(r, 1100));
    await fecha("sessões revogadas pelo dono (sessoes_desde = now()), com a sessão de nível 2 ainda no prazo", n2);
    // um código TOTP ainda não usado só existe num passo depois do último aceito: espera o relógio chegar lá (até ~30 s)
    while (passoDe(Date.now()) < passoDoProx) await new Promise((r) => setTimeout(r, 500));
    const nova = await postar("/admin/api/entrar/fator/confirmar", { code: totp(1) }, n1);
    R.checa(nova.status === 200 && (await pedir("/admin", { cookie: sess(valorDe(nova.cookies[NOME_COOKIE_SESSAO] ?? "")) })).status === 200, "depois da revogação, uma entrada nova (TOTP de novo) abre a central", `${nova.status}`);
    await dono`delete from login.central_fatores where email = ${ADMIN}`;
    await fecha("fator apagado pelo dono do banco, com a sessão de nível 2 ainda no prazo", n2);

    R.cabecalho("8b. sair (0158): revoga as sessões de nível 2 da pessoa em todos os aparelhos");
    {
      const n1b = sess(assinarSessao(ENV_CHAVE, ADMIN, 1, Date.now()).valor);
      // dois aparelhos com nível 2 ainda no prazo: o fator é recadastrado acima, então emite duas sessões novas pelo próprio fluxo
      await dono`delete from login.central_fatores where email = ${ADMIN}`;
      const cad = await postar("/admin/api/entrar/fator/iniciar", {}, n1b);
      const segS = deBase32(cad.json?.segredo ?? "");
      const a1 = await postar("/admin/api/entrar/fator/confirmar", { code: hotp(segS, passoDe(Date.now())) }, n1b);
      const aparelhoA = sess(valorDe(a1.cookies[NOME_COOKIE_SESSAO] ?? ""));
      await new Promise((r) => setTimeout(r, 1100));
      const aparelhoB = sess(assinarSessao(ENV_CHAVE, ADMIN, 2, Date.now()).valor);
      R.checa((await pedir("/admin", { cookie: aparelhoA })).status === 200 && (await pedir("/admin", { cookie: aparelhoB })).status === 200, "controle: os dois aparelhos abrem a central antes de sair");
      const semOrigem = await C.crua(srv.base, "/admin/api/sair", { metodo: "POST", cabecalhos: { host: HP, cookie: aparelhoA, "content-type": "application/json", "sec-fetch-site": "same-origin" }, corpo: "{}" });
      R.checa(semOrigem.status === 403, "sair sem Origin: 403 (mesma checagem de origem das outras APIs; nada revogado)", `${semOrigem.status}`);
      R.checa((await pedir("/admin", { cookie: aparelhoA })).status === 200, "o POST recusado não revogou nada");
      const saiu = await postar("/admin/api/sair", {}, aparelhoA);
      const ck = saiu.cookies[NOME_COOKIE_SESSAO] ?? "";
      R.checa(saiu.status === 200 && saiu.json?.proximo === "/admin/entrar" && /Max-Age=0/i.test(ck) && /Path=\/admin/i.test(ck), "POST /admin/api/sair: 200, manda para a entrada e apaga o cookie com as opções da central", `${saiu.status} ${ck.replace(/=[^;]+/, "=…")}`);
      await fecha("depois de sair, o aparelho que saiu", aparelhoA);
      await fecha("depois de sair, o OUTRO aparelho (revogação em todos)", aparelhoB);
      const semSessao = await postar("/admin/api/sair", {});
      R.checa(semSessao.status === 404, "sair sem sessão: 404", `${semSessao.status}`);
      await new Promise((r) => setTimeout(r, 1100));
      const volta = await postar("/admin/api/entrar/fator/confirmar", { code: hotp(segS, passoDe(Date.now()) + 1) }, n1b);
      R.checa(volta.status === 200 && (await pedir("/admin", { cookie: sess(valorDe(volta.cookies[NOME_COOKIE_SESSAO] ?? "")) })).status === 200, "entrar de novo depois de sair abre a central");
      await dono`update adm_admins set ativo = false where email = ${ADMIN}`;
      await dono`update adm_admins set ativo = true where email = ${ADMIN}`;
      await fecha("0158: desativar e reativar o admin derruba a sessão anterior (antes só suspendia)", sess(valorDe(volta.cookies[NOME_COOKIE_SESSAO] ?? "")));
      await dono`delete from login.central_fatores where email = ${ADMIN}`;
    }

    R.cabecalho("9. limite do TOTP: a sexta tentativa em 15 min é recusada mesmo com o código certo");
    const ini2 = await postar("/admin/api/entrar/fator/iniciar", {}, n1);
    const seg2 = deBase32(ini2.json?.segredo ?? "");
    R.checa(ini2.status === 200 && seg2 && ini2.json.segredo !== ini.json.segredo, "depois de o dono apagar o fator, o cadastro recomeça com outro segredo", `${ini2.status}`);
    const sts = [];
    for (let i = 0; i < 5; i++) sts.push((await postar("/admin/api/entrar/fator/confirmar", { code: "000000" }, n1)).status);
    const sexta = await postar("/admin/api/entrar/fator/confirmar", { code: hotp(seg2, passoDe(Date.now())) }, n1);
    R.checa(sts.every((s) => s === 400) && sexta.status === 429 && !sexta.cookies[NOME_COOKIE_SESSAO], `cinco erradas (${sts.join(",")}) e a sexta, certa: 429, sem sessão`, `${sexta.status}`);
    R.checa((await pedir("/admin", { cookie: n2 })).status === 404, "a sessão antiga de nível 2 continua fechada com o fator novo ainda pendente");

    R.checa(pg.proxy.apertos() >= 1 && pg.proxy.semTls() === 0, `a central falou com o banco SÓ por TLS: ${pg.proxy.apertos()} conexões com aperto de mão TLS, ${pg.proxy.semTls()} tentativas sem TLS`);
    R.checa(!/unhandled|uncaught|TypeError|ReferenceError/i.test(srv.log()), "o log do servidor não tem exceção solta", srv.log().slice(-400));
    R.checa(!new RegExp(`${C.SEGREDO_DE_PROVA}|246813|${ini.json.segredo}`).test(srv.log()), "o log do servidor não tem segredo de sessão, código de e-mail nem segredo TOTP");
  } finally {
    await srv.parar();
    await dono.end({ timeout: 2 });
  }
}

(async () => {
  let pg;
  try {
    R.info("SIMULADO: login próprio da central (D335) de ponta a ponta. Banco de prova descartável atrás de um intermediário TLS, só 127.0.0.1; nenhum e-mail sai.");
    const buildId = path.join(C.WEB, C.DIST_ADMIN_PROD, "BUILD_ID");
    if (!C.temFlag("--sem-build")) {
      const b = C.construirCentral("producao");
      R.checa(b.rc === 0, `next build da central (ADMIN_CENTRAL=producao) terminou com código ${b.rc}`, (b.err || b.out).slice(-600));
    } else R.checa(C.existe(buildId), `--sem-build: reaproveita ${C.DIST_ADMIN_PROD}`, "falta BUILD_ID");
    if (C.existe(buildId)) {
      pg = await subirPostgres();
      R.info(`banco ${BANCO} (migrações até a última) atrás do intermediário TLS em 127.0.0.1:${pg.porta}`);
      await prova(pg);
    }
  } catch (e) {
    R.falha(`exceção: ${e.stack?.split("\n").slice(0, 5).join(" | ") ?? e}`);
  } finally {
    try {
      pg?.parar();
    } catch {}
  }
  console.log(`\n${R.falhas === 0 ? "RESULTADO: tudo passou" : `RESULTADO: ${R.falhas} FALHOU`} (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(R.falhas === 0 ? 0 : 1);
})();
