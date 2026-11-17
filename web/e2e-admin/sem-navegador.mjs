#!/usr/bin/env node
// SIMULADO. Provas da central de coleta SEM navegador (decisão AC-05: o Playwright não abre no sandbox), pelo HTTP de um `next start` local.
// Critérios 15, 19, 20, 22, 23 (a parte dinâmica está em sem-rede-externa.mjs), 24 e os estados de tela; mais o modo --fluxo (primeira rodada, passos 6 a 9, pela API).
//
//   cd web && node e2e-admin/sem-navegador.mjs [--sem-build]
//   cd web && node e2e-admin/sem-navegador.mjs [--sem-build] --fluxo --banco admin_coleta_c7|admin_coleta_r1
//
// Banco: o modo completo APAGA e RECRIA `admin_coleta_c7` (só ele) a cada execução; as rodadas são SIMULADAS (CLI real sobre respostas fabricadas de etl/tests/fixtures/sapl_ale).
// O `--fluxo` NÃO recria nada: opera no banco dado. Nada aqui toca `civico` nem `admin_coleta`. Sem rede externa, sem chamada a modelo.
import fs from "node:fs";
import path from "node:path";
import * as C from "./comum.mjs";

const R = C.criarRelato();
const T0 = Date.now();
const UUID0 = "00000000-0000-4000-8000-000000000000";
const OPERADOR = C.ADMIN_LOCAL_NOME; // "Operador local": o nome do admin local em adm_admins (db/local/post_0004); o `por` do corpo é ignorado (AC-23)

// ================================================================== rotas (do sistema de arquivos)

function descobrirRotas() {
  const app = path.join(C.WEB, "src", "app");
  const rotas = [];
  const extras = [];
  (function anda(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) anda(p);
      else if (e.name === "page.tsx" || e.name === "route.ts") {
        const rel = path.relative(app, d).split(path.sep);
        const dentro = rel[0] === "(admin)";
        const seg = rel.filter((s) => !/^\(.*\)$/.test(s));
        if (!dentro && seg[0] !== "admin") continue;
        const api = e.name === "route.ts";
        const src = fs.readFileSync(p, "utf8");
        // método "não usado": stub que responde 404 com a central fechada e 405 aberta (não conta como exportado no controle positivo)
        const naoUsados = new Set([...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\) \{\s*const negado = (?:await )?exigirAdminApi\(\);\s*if \(negado\) return negado;\s*return new Response\(null, \{ status: 405 \}\);/g)].map((m) => m[1]));
        const metodos = api ? [...src.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]).filter((m) => !naoUsados.has(m)) : ["GET"];
        // /admin/entrar e /admin/entrar/fator só existem no modo produção (AC-23): no modo local respondem 404 por desenho
        rotas.push({ arquivo: path.relative(C.WEB, p), seg, api, metodos, foraDoGrupo: !dentro, soProducao: seg[0] === "admin" && (seg[1] === "entrar" || (seg[1] === "api" && seg[2] === "entrar")) });
      } else if (/^(loading|template|default|error|not-found)\.tsx$/.test(e.name) && path.relative(app, d).split(path.sep)[0] === "(admin)") extras.push(path.relative(C.WEB, p));
    }
  })(app);
  return { rotas, extras };
}
const urlDe = (r, ex) => "/" + r.seg.map((s) => { const m = s.match(/^\[(.+)\]$/); return m ? ex[m[1]] ?? "x" : s; }).join("/");

async function varrer(base, rotas, ex, esperado) {
  // esperado: "404" (central fechada) ou "aberta" (controle positivo)
  const achados = [];
  for (const r of rotas) {
    const u = urlDe(r, ex);
    for (const m of r.api ? ["GET", "POST"] : ["GET"]) {
      const exportado = r.metodos.includes(m);
      const res = await C.http(base, u, { metodo: m, corpo: {} });
      achados.push({ u, m, exportado, status: res.status, api: r.api });
    }
  }
  return achados;
}


// Requisição crua por node:http (o fetch do Node recusa TRACE e não deixa trocar o Host): só o status. A versão completa (cabeçalhos, corpo) está em comum.mjs. Só 127.0.0.1.
const crua = async (base, caminho, o = {}) => (await C.crua(base, caminho, o)).status;
const METODOS_ESTRANHOS = ["OPTIONS", "PUT", "DELETE", "HEAD"];
// TRACE vai à parte: o adaptador de middleware do Next 15.5.28 (nodejs e edge) monta um `Request` com o método e o `Request` do Node recusa TRACE ("'TRACE' HTTP method is unsupported"),
// então o 500 sai ANTES da função do middleware e não há como responder 404 por ali. Ver o relatório da C11.

async function varrerCrua(base, rotas, ex, { host } = {}) {
  const achados = [];
  for (const r of rotas) {
    const u = urlDe(r, ex);
    const h = host ? { host } : {};
    const casos = [["GET+RSC", "GET", { RSC: "1", ...h }], ["GET+RSC+prefetch", "GET", { RSC: "1", "Next-Router-Prefetch": "1", "Next-Router-State-Tree": "%5B%22%22%5D", ...h }], ...METODOS_ESTRANHOS.map((m) => [m, m, h])];
    if (host) casos.length = 0, casos.push(["GET", "GET", h]);
    for (const [rotulo, metodo, cab] of casos) {
      const url = rotulo.startsWith("GET+RSC") ? `${u}?_rsc=abc` : u;
      achados.push({ rotulo, u, status: await crua(base, url, { metodo, cabecalhos: cab }) });
    }
  }
  return achados;
}

async function criterio15(rotas, extras) {
  R.cabecalho("critério 15: central fechada responde 404 em toda rota (sem a variável; com VERCEL; com VERCEL_ENV)");
  const dentro = rotas.filter((r) => !r.foraDoGrupo);
  R.info(`rotas achadas em web/src/app/(admin): ${dentro.length} (${dentro.filter((r) => !r.api).length} páginas, ${dentro.filter((r) => r.api).length} de API); métodos exportados: ${dentro.filter((r) => r.api).map((r) => `${urlDe(r, {})} [${r.metodos.join(",")}]`).join(" ")}`);
  R.checa(rotas.filter((r) => r.foraDoGrupo).length === 0, "nenhuma rota /admin fora do grupo (admin)", rotas.filter((r) => r.foraDoGrupo).map((r) => r.arquivo).join(", "));
  R.checa(extras.length === 0, "o grupo (admin) não tem loading.tsx, template, default, error ou not-found (o 404 não pode sair depois de um stream iniciado)", extras.join(", "));
  const ex = { classe: "vinculo_sapl", chave: "1", rodada: UUID0, id: UUID0, uf: "35" };
  const modos = [
    ["(a) sem ADMIN_CENTRAL", {}],
    ["(b) ADMIN_CENTRAL=1 e VERCEL=1", { ADMIN_CENTRAL: "1", VERCEL: "1" }],
    ["(c) ADMIN_CENTRAL=1 e VERCEL_ENV=preview", { ADMIN_CENTRAL: "1", VERCEL_ENV: "preview" }],
  ];
  for (const [nome, extra] of modos) {
    // ADMIN_DATABASE_URL local válido em todos: o 404 tem de vir da regra que se prova, não da ausência do banco
    const srv = await C.subirNext(C.envCi({ ADMIN_DATABASE_URL: C.urlCentral(C.BANCO_C7), ...extra }));
    try {
      const a = await varrer(srv.base, dentro, ex);
      const ruins = a.filter((x) => x.exportado && x.status !== 404);
      R.checa(ruins.length === 0, `${nome}: ${a.filter((x) => x.exportado).length} requisições (páginas GET, API nos métodos exportados) todas com status 404`, ruins.map((x) => `${x.m} ${x.u} -> ${x.status}`).join("; "));
      const nao = a.filter((x) => !x.exportado && x.status !== 404);
      R.checa(nao.length === 0, `${nome}: métodos que a rota não usa também respondem 404 (a rota não se revela por um 405)`, nao.map((x) => `${x.m} ${x.u} -> ${x.status}`).join("; "));
      const trace = [];
      for (const r of dentro) trace.push({ u: urlDe(r, ex), status: await crua(srv.base, urlDe(r, ex), { metodo: "TRACE" }) });
      const traceFora = trace.filter((x) => x.status !== 404);
      const limite = srv.log().includes("'TRACE' HTTP method is unsupported");
      R.checa(traceFora.length === 0 || (limite && traceFora.every((x) => x.status === 500)), `${nome}: TRACE nas ${trace.length} rotas: 404 ou, no limite conhecido do Next (log "'TRACE' HTTP method is unsupported"), 500 genérico sem corpo da central`, traceFora.map((x) => `${x.u} -> ${x.status}`).join("; "));
      if (traceFora.length > 0) R.aviso(`EXCEÇÃO ao critério 15 (aprovada pelo dono, AC-22): ${nome}: TRACE -> ${traceFora.length} de ${trace.length} rotas com 500 em vez de 404 (limite do Next 15.5; sem dado)`);
      else R.info(`${nome}: TRACE -> 404 em todas`);
      const cru = await varrerCrua(srv.base, dentro, ex);
      const ruinsCru = cru.filter((x) => x.status !== 404);
      R.checa(ruinsCru.length === 0, `${nome}: ${cru.length} requisições extras (RSC e RSC+prefetch nas páginas; ${METODOS_ESTRANHOS.join(", ")} em toda rota, páginas e API) todas com status 404`, ruinsCru.map((x) => `${x.rotulo} ${x.u} -> ${x.status}`).join("; "));
      const h404 = await C.http(srv.base, "/admin/fila");
      const pr404 = problemasDeSeguranca(h404.cabecalhos, { turnstile: false });
      R.checa(h404.status === 404 && pr404.length === 0, `${nome}: o 404 da central fechada leva os três cabeçalhos (CSP com frame-ancestors 'none', X-Frame-Options DENY, Referrer-Policy same-origin)`, `status ${h404.status}; ${pr404.join("; ")}`);
      if (nome.startsWith("(a)")) {
        const h = await C.http(srv.base, "/");
        R.checa(h.status === 200, "(a) o site público (/) continua 200", `status ${h.status}`);
        const outras = await Promise.all(["/admin", "/admin/", "/admin?rodada=x", "/admin/api/estado/"].map((p) => C.http(srv.base, p, { seguir: true })));
        R.checa(outras.every((x) => x.status === 404), "(a) variações de caminho (/admin/, ?rodada=, barra final, seguindo o 308 do Next) também 404", outras.map((x) => x.status).join(","));
      }
    } finally {
      await srv.parar();
    }
  }
}

// G1-4: com a central LIGADA, Host que não é local = 404 (DNS rebinding); com o Host local a mesma rota responde (controle positivo).
async function criterio15Host(rotas) {
  R.cabecalho("critério 15 (G1-4): central ligada, Host fora de localhost/127.0.0.1/[::1] responde 404 em páginas e GET de API");
  const dentro = rotas.filter((r) => !r.foraDoGrupo);
  const ex = { classe: "vinculo_sapl", chave: "1", rodada: UUID0, id: UUID0, uf: "35" };
  const srv = await C.subirNext(C.envCentral(C.BANCO_C7));
  try {
    for (const host of ["evil.example.com", "rebind.attacker.test:80", "localhost.evil.example.com", "127.0.0.1.evil.example.com"]) {
      const a = await varrerCrua(srv.base, dentro, ex, { host });
      const ruins = a.filter((x) => x.status !== 404);
      R.checa(ruins.length === 0, `Host: ${host}: ${a.length} GET (todas as páginas e todas as rotas de API) com status 404`, ruins.map((x) => `${x.u} -> ${x.status}`).join("; "));
    }
    const ok = await C.http(srv.base, "/admin/api/estado");
    const okPag = await C.http(srv.base, "/admin/fila");
    R.checa(ok.status === 200 && okPag.status === 200, "controle positivo: com o Host local (127.0.0.1) a API de estado e a página da fila respondem 200", `estado ${ok.status}, fila ${okPag.status}`);
    const lh = await crua(srv.base, "/admin/api/estado", { cabecalhos: { host: "localhost:3000" } });
    const v6 = await crua(srv.base, "/admin/api/estado", { cabecalhos: { host: "[::1]:3000" } });
    R.checa(lh === 200 && v6 === 200, "controle positivo: Host localhost:porta e [::1]:porta também respondem 200", `localhost ${lh}, [::1] ${v6}`);
  } finally {
    await srv.parar();
  }
}

// ================================================================== retrato das tabelas (critério 22)

const FORA_DO_RETRATO = ["adm_pareceres", "adm_pedidos", "adm_pedidos_decisao"];
function retrato() {
  const tabs = C.sqlLinhas(C.BANCO_C7, "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").map((l) => l[0]).filter((t) => !FORA_DO_RETRATO.includes(t));
  const sqlTudo = tabs.map((t) => `select '${t}', count(*), md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from (select to_jsonb(t) as x from public."${t}" t) s`).join(" union all ");
  const m = {};
  for (const l of C.sqlLinhas(C.BANCO_C7, sqlTudo)) m[l[0]] = `${l[1]}|${l[2]}`;
  return m;
}

// ================================================================== estados de tela

const get = async (base, p) => {
  const r = await C.http(base, p);
  return { ...r, estados: C.estadosDoHtml(r.texto) };
};
async function espera(R_, base, p, esperados, rotulo, { naoDeve = [] } = {}) {
  const r = await get(base, p);
  const falta = esperados.filter((e) => !r.estados.includes(e));
  const indevido = naoDeve.filter((e) => r.estados.includes(e));
  R_.checa(r.status === 200 && falta.length === 0 && indevido.length === 0, `estado ${esperados.join("+")} :: ${rotulo} (GET ${p})`, `status ${r.status}, data-estado achados: [${r.estados.join(", ")}]${indevido.length ? `, NÃO devia ter: ${indevido}` : ""}`);
  return r;
}

// ================================================================== critério 19

function achatarTotais(no, prefixo = "", saida = {}) {
  for (const [k, v] of Object.entries(no ?? {})) {
    if (k === "rodada" || k === "itens" || v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if ("valor" in v && "ids" in v) saida[caminho] = v;
    achatarTotais(Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "valor" && kk !== "de" && kk !== "ids")), caminho, saida);
    if (!("valor" in v && "ids" in v)) continue;
  }
  return saida;
}
function diffs(a, b, p = "", out = []) {
  if (C.canonico(a) === C.canonico(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], `${p}.${k}`, out);
  } else out.push(`${p}: CLI=${JSON.stringify(a)?.slice(0, 120)} API=${JSON.stringify(b)?.slice(0, 120)}`);
  return out;
}
const formatarDe = (valor, de) => (valor === null || valor === undefined ? "não medido" : de === null || de === undefined ? `${valor} (denominador não conhecido)` : `${valor} de ${de}`);

async function criterio19(base, rod, rotulo) {
  const cli = C.cli(C.BANCO_C7, ["admin", "relatorio", rod, "--json"]);
  const api = await C.http(base, `/admin/api/relatorio/${rod}`);
  if (!R.checa(cli.rc === 0 && cli.json && api.status === 200 && api.json, `19 [${rotulo}] relatório obtido pela CLI e pela API`, `cli rc ${cli.rc}, api ${api.status}`)) return;
  for (const painel of ["coleta", "revisao"]) {
    const a = achatarTotais(cli.json[painel]);
    const b = achatarTotais(api.json[painel]);
    const d = diffs(cli.json[painel], api.json[painel]);
    const chaves = Object.keys(a);
    // `valor`, `de` e `ids` campo a campo, na ordem em que cada lado traz
    const campo = chaves.filter((k) => b[k] && a[k].valor === b[k].valor && a[k].de === b[k].de && C.canonico(a[k].ids) === C.canonico(b[k].ids)).length;
    R.checa(d.length === 0 && chaves.length > 0 && C.canonico(Object.keys(a)) === C.canonico(Object.keys(b)), `19 [${rotulo}] painel ${painel}: JSON da API igual ao da CLI (${chaves.length} totais; valor, de e ids iguais em ${campo})`, d.slice(0, 4).join(" | "));
  }
  R.checa(cli.json.simulado === api.json.simulado && cli.json.rodada?.id === api.json.rodada?.id, `19 [${rotulo}] marca simulado e id da rodada iguais`, `${cli.json.simulado} / ${api.json.simulado}`);
  // o HTML da tela traz os números escritos
  const pag = await C.http(base, `/admin?rodada=${rod}`);
  const html = C.totaisDoHtml(pag.texto);
  for (const [painel, id] of [["coleta", "adm-coleta"], ["revisao", "adm-revisao"]]) {
    const esperado = achatarTotais(cli.json[painel]);
    const tela = html[id] ?? {};
    const faltando = [];
    const errados = [];
    for (const [k, v] of Object.entries(esperado)) {
      if (!tela[k]) faltando.push(k);
      else if (tela[k].texto !== formatarDe(v.valor, v.de) || tela[k].nIds !== (v.ids?.length ?? 0)) errados.push(`${k}: tela "${tela[k].texto}" (${tela[k].nIds} ids) x CLI "${formatarDe(v.valor, v.de)}" (${v.ids?.length ?? 0} ids)`);
    }
    const sobrando = Object.keys(tela).filter((k) => !(k in esperado));
    R.checa(pag.status === 200 && Object.keys(esperado).length > 0 && faltando.length === 0 && errados.length === 0 && sobrando.length === 0,
      `19 [${rotulo}] HTML de /admin?rodada= painel ${painel}: ${Object.keys(tela).length} totais escritos "V de D" e "Ver registros (n)", iguais aos da CLI`,
      `status ${pag.status}; faltam ${faltando.slice(0, 4)}; errados ${errados.slice(0, 3)}; sobram ${sobrando.slice(0, 4)}`);
  }
}

// ================================================================== critério 24

function rscDe(html) {
  let s = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { s += JSON.parse(m[1]); } catch {}
  }
  return s;
}
function contagensDoRsc(rsc) {
  const i = rsc.indexOf('"contagens":');
  if (i < 0) return null;
  let j = rsc.indexOf("[", i), n = 0, k = j;
  for (; k < rsc.length; k++) { if (rsc[k] === "[") n++; else if (rsc[k] === "]" && --n === 0) break; }
  try { return JSON.parse(rsc.slice(j, k + 1)); } catch { return null; }
}

async function criterio24(base, ufCodigo) {
  R.cabecalho("critério 24: mapa sem <circle>, território com nome e contagem em texto (parcial sem navegador: ver a nota)");
  const fonteAdmin = [];
  for (const d of ["src/components/admin", "src/lib/admin", "src/app/(admin)"]) (function anda(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) anda(p); else if (/\.(tsx?|css)$/.test(e.name)) fonteAdmin.push([p, fs.readFileSync(p, "utf8")]); } })(path.join(C.WEB, d));
  fonteAdmin.push([path.join(C.WEB, "src/styles/admin.css"), fs.readFileSync(path.join(C.WEB, "src/styles/admin.css"), "utf8")]);
  const comCirculo = fonteAdmin.filter(([, t]) => /<circle|["'`]circle["'`]|cluster/i.test(t)).map(([p]) => path.relative(C.WEB, p));
  R.checa(comCirculo.length === 0, "24 fonte da central (tsx, ts, css): nenhum <circle>, tipo \"circle\" nem elemento de cluster", comCirculo.join(", "));
  const mapaSrc = fs.readFileSync(path.join(C.WEB, "src/components/admin/mapa-admin.tsx"), "utf8");
  R.checa(/aria-label=\{texto\}/.test(mapaSrc) && /<title>\{texto\}<\/title>/.test(mapaSrc) && /const texto = rotulo\(nome, c\)/.test(mapaSrc) && /\$\{nome\}: \$\{formatarContagem/.test(mapaSrc),
    "24 fonte do mapa: cada território é um link com aria-label e <title> \"<nome>: <contagem>\" (nome da malha + formatarContagem)");

  for (const [rotulo, p] of [["/admin", "/admin"], [`/admin/uf/${ufCodigo}`, `/admin/uf/${ufCodigo}`]]) {
    const r = await C.http(base, p);
    const h = r.texto;
    R.checa(r.status === 200 && !/<circle/i.test(h) && !/cluster/i.test(h), `24 HTML de ${rotulo}: nenhum <circle> e nenhum elemento de cluster`, `status ${r.status}`);
    const rsc = rscDe(h);
    let cont = null;
    if (p === "/admin") {
      const m = rsc.match(/"porUf":(\{[^}]*\})/);
      if (m) cont = Object.entries(JSON.parse(m[1]));
    } else cont = contagensDoRsc(rsc);
    const texto = C.semComentarios(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    R.checa(Array.isArray(cont) && (p !== "/admin" || cont.length > 0), `24 ${rotulo}: as contagens por território chegam no payload da página (${cont?.length ?? "ausente"} territórios${p === "/admin" ? ", de porUf" : ", de contagens dos municípios"})`);
    R.checa(/sem território no mapa: \d+/.test(texto) && (p === "/admin" ? /fichas no total/.test(texto) : /da UF, sem município: \d+/.test(texto) && /Neste estado: \d+/.test(texto)), `24 ${rotulo}: as contagens de fora do mapa estão escritas em texto no HTML (sem território no mapa${p === "/admin" ? ", fichas no total" : ", da UF sem município, neste estado"})`);
    if (!Array.isArray(cont)) continue;
    const malhaUrl = p === "/admin" ? "/geo/br.json" : `/geo/uf/${ufCodigo}.json`;
    const malha = await C.http(base, malhaUrl);
    const itens = malha.json?.items ?? [];
    const semNome = itens.filter((i) => typeof i.name !== "string" || i.name.trim() === "");
    const porIbge = new Map(itens.map((i) => [i.ibge, i]));
    const semMalha = cont.filter(([ibge]) => !porIbge.has(ibge));
    const nUf = (n) => (n === 1 ? "ficha" : "fichas");
    R.checa(malha.status === 200 && itens.length > 0 && semNome.length === 0 && semMalha.length === 0 && !/circle/i.test(malha.texto),
      `24 ${rotulo}: a malha local ${malhaUrl} traz ${itens.length} territórios, todos com nome (sem <circle>); todo território com contagem tem forma e nome na malha`, `status ${malha.status}; sem nome ${semNome.length}; contagem sem forma ${semMalha.map((c) => c[0])}`);
    const ex = cont.slice(0, 4).map(([ibge, n]) => `"${porIbge.get(ibge)?.uf ? porIbge.get(ibge).uf + ": " : ""}${porIbge.get(ibge)?.name}: ${Array.isArray(n) ? n : n} ${nUf(n)}"`);
    R.info(`rótulos que o componente monta (nome da malha + contagem do payload; contagem escrita por formatarContagem): ${ex.join("; ") || "(nenhum município com ficha nesta UF)"}`);
    // chunks de JS da página: o código do mapa não desenha círculo
    const srcs = [...h.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]);
    let chunkMapa = 0, comCirc = [];
    for (const s of new Set(srcs)) {
      const c = await C.http(base, s);
      if (c.texto.includes("admin-mapa__t")) { chunkMapa++; if (/["']circle["']|cluster/i.test(c.texto)) comCirc.push(s); }
    }
    R.checa(chunkMapa > 0 && comCirc.length === 0, `24 ${rotulo}: ${chunkMapa} chunk(s) de JS com o código do mapa, nenhum com tipo "circle" ou cluster`, comCirc.join(", "));
  }
  R.aviso("24 limite: o mapa é componente de cliente (a malha /geo/*.json é buscada num useEffect), então o HTML do servidor não traz os <path> dos territórios com aria-label. Provado sem navegador: sem circle/cluster no HTML, nos chunks, no fonte e na malha; contagens no payload e em texto no HTML; nome de cada território na malha; regra do rótulo no fonte. NÃO provado: o rótulo renderizado de cada território no DOM (precisa de navegador).");
}

// ================================================================== F3-T5: cabeçalhos, modo produção simulado, CSRF estrito, identidade, ritmo

const hdr = (h, n) => (typeof h.get === "function" ? h.get(n) : h[n.toLowerCase()]) ?? null;
/** Os três cabeçalhos de segurança da central (AC-23), conferidos em resposta REAL. Devolve a lista de problemas (vazia = ok). `turnstile`: true = a CSP cita challenges.cloudflare.com (modo produção). */
function problemasDeSeguranca(h, { turnstile } = {}) {
  const p = [];
  const csp = hdr(h, "content-security-policy");
  if (!csp || !/(^|;\s*)frame-ancestors 'none'(;|$)/.test(csp)) p.push(`CSP sem frame-ancestors 'none' (${csp ?? "ausente"})`);
  if (csp && turnstile !== undefined) {
    const tem = csp.includes("challenges.cloudflare.com");
    if (tem !== turnstile) p.push(`CSP ${tem ? "cita" : "não cita"} challenges.cloudflare.com, esperado ${turnstile ? "citar" : "não citar"}`);
    const fora = (csp.match(/(?:^|[\s;])(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?=[\s;]|$)/gi) ?? []).map((x) => x.trim().replace(/^[;\s]+/, "")).filter((x) => x !== "challenges.cloudflare.com");
    if (fora.length) p.push(`CSP cita host fora da lista: ${fora.join(", ")}`);
  }
  if (hdr(h, "x-frame-options") !== "DENY") p.push(`X-Frame-Options = ${hdr(h, "x-frame-options")}`);
  if (hdr(h, "referrer-policy") !== "same-origin") p.push(`Referrer-Policy = ${hdr(h, "referrer-policy")}`);
  return p;
}
const semSeguranca = (h) => ["content-security-policy", "x-frame-options", "referrer-policy"].filter((n) => hdr(h, n) !== null);

// (c) cabeçalhos: `fetch` com redirect "manual" e leitura dos headers (o equivalente a `curl -I`), em página, rota de API e no 404 da central; AUSENTES no site público.
async function cabecalhosLocal(base) {
  R.cabecalho("cabeçalhos de segurança em resposta real (fetch, redirect manual): página, API, 404 da central; ausentes no site público");
  for (const [rotulo, caminho, esperado] of [["página /admin/fila", "/admin/fila", 200], ["API /admin/api/estado", "/admin/api/estado", 200], ["404 da central (rota inexistente)", "/admin/nao-existe", 404]]) {
    const r = await C.http(base, caminho);
    const pr = problemasDeSeguranca(r.cabecalhos, { turnstile: false });
    R.checa(r.status === esperado && pr.length === 0, `${rotulo}: ${r.status}, CSP com frame-ancestors 'none' (sem Turnstile no modo local), X-Frame-Options DENY, Referrer-Policy same-origin`, `status ${r.status}; ${pr.join("; ")}`);
  }
  const pub = await C.http(base, "/");
  R.checa(pub.status === 200 && semSeguranca(pub.cabecalhos).length === 0, "site público (/): sem Content-Security-Policy, X-Frame-Options nem Referrer-Policy (só a central os leva)", `status ${pub.status}; presentes: ${semSeguranca(pub.cabecalhos)}`);
  const geo = await C.http(base, "/geo/br.json");
  R.checa(geo.status === 200 && semSeguranca(geo.cabecalhos).length === 0, "malha pública (/geo/br.json): sem os três cabeçalhos", `status ${geo.status}; presentes: ${semSeguranca(geo.cabecalhos)}`);
}

// (a) CSRF estrito: POST sem Origin, sem Sec-Fetch-Site ou com Sec-Fetch-Site que não é same-origin = 403, e nada é gravado.
async function csrfEstrito(base, corpo, corpoDecisao) {
  R.cabecalho("CSRF estrito (AC-23): POST sem Origin, sem Sec-Fetch-Site ou cross-site = 403, sem gravar");
  const n = () => C.sql(C.BANCO_C7, "select (select count(*) from adm_pedidos) || '|' || (select count(*) from adm_pedidos_decisao)");
  const antes = n();
  const casos = [
    ["sem Origin", { origin: null }],
    ["sem Sec-Fetch-Site", { "sec-fetch-site": null }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site: none", { "sec-fetch-site": "none" }],
    ["sem Origin nem Sec-Fetch-Site", { origin: null, "sec-fetch-site": null }],
    ["Origin de outra origem (evil.example)", { origin: "http://evil.example" }],
    ["Origin do mesmo host com outra porta", { origin: "http://127.0.0.1:1" }],
    ["Origin: null", { origin: "null" }],
    ["content-type text/plain (POST simples, sem preflight)", { "content-type": "text/plain" }],
  ];
  for (const [rotulo, cab] of casos) {
    for (const [rota, c] of [["/admin/api/pedidos", corpo], ["/admin/api/decisoes", corpoDecisao]]) {
      const r = await C.http(base, rota, { metodo: "POST", corpo: c, cabecalhos: cab });
      R.checa(r.status === 403, `POST ${rota} ${rotulo}: 403`, `status ${r.status} ${r.texto.slice(0, 100)}`);
    }
  }
  R.checa(n() === antes, `nenhuma linha gravada em adm_pedidos nem em adm_pedidos_decisao pelos ${casos.length * 2} POST recusados (${antes})`, `${antes} -> ${n()}`);
}

// ---- modo produção simulado (AC-23): `next start` com as variáveis do projeto admin; Supabase FALSO numa porta local fechada; sem sessão.
const HP = C.HOST_PRODUCAO;
const cabPost = { host: HP, origin: `https://${HP}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };

async function varreduraCompleta(base, rotas, ex, host, { exceto = [], excetoPost = [] } = {}) {
  // páginas: GET, RSC, RSC+prefetch, HEAD, OPTIONS, PUT, DELETE, PATCH, POST; API: GET, POST (JSON com Origin e Sec-Fetch-Site certos), PUT, DELETE, PATCH, OPTIONS, HEAD
  const achados = [];
  for (const r of rotas) {
    const u = urlDe(r, ex);
    if (exceto.includes(u)) continue;
    const h = { host };
    const casos = [["GET", "GET", h], ["GET+RSC", "GET", { RSC: "1", ...h }], ["GET+RSC+prefetch", "GET", { RSC: "1", "Next-Router-Prefetch": "1", "Next-Router-State-Tree": "%5B%22%22%5D", ...h }],
      ["HEAD", "HEAD", h], ["OPTIONS", "OPTIONS", h], ["PUT", "PUT", h], ["DELETE", "DELETE", h], ["PATCH", "PATCH", h],
      ["POST", "POST", { ...cabPost, host }], ["POST text/plain", "POST", { ...h, origin: `https://${host}`, "sec-fetch-site": "same-origin", "content-type": "text/plain" }]];
    for (const [rotulo, metodo, cab] of casos) {
      if (metodo === "POST" && excetoPost.includes(u)) continue; // F3-C1: as APIs de pedir e verificar código passam o POST sem sessão ao handler (JSON: 200/400; text/plain: 403 da origem): provadas em entradaPorApi
      const url = rotulo.startsWith("GET+RSC") ? `${u}?_rsc=abc` : u;
      const x = await C.crua(base, url, { metodo, cabecalhos: cab, corpo: metodo === "POST" ? "{}" : undefined });
      achados.push({ rotulo, u, status: x.status, cabecalhos: x.cabecalhos, tamanho: x.texto.length });
    }
  }
  return achados;
}

async function criterio15Producao(rotas) {
  R.cabecalho("critério 15 (modo produção, simulado): central fechada para quem não passa pela guarda, em toda rota e método");
  const dentro = rotas.filter((r) => !r.foraDoGrupo);
  const ex = { classe: "vinculo_sapl", chave: "1", rodada: UUID0, id: UUID0, uf: "35" };
  const env = await C.envProducao(C.BANCO_C7);
  R.info(`variáveis: ADMIN_CENTRAL=producao VERCEL_ENV=production AUTH_PROVIDER=supabase NEXT_PUBLIC_SUPABASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL} (porta local FECHADA) NEXT_PUBLIC_SUPABASE_ANON_KEY=x ADMIN_DATABASE_URL=...@127.0.0.1:54329/${C.BANCO_C7}?sslmode=require`);
  const srv = await C.subirNext(env);
  try {
    // 1. Host da central, sem cookie: 404 em toda rota e método; a única exceção é /admin/entrar (a página de e-mail e código)
    const a = await varreduraCompleta(srv.base, dentro, ex, HP, { exceto: ["/admin/entrar"], excetoPost: ["/admin/api/entrar/codigo", "/admin/api/entrar/verificar"] });
    const ruins = a.filter((x) => x.status !== 404);
    R.checa(ruins.length === 0, `Host ${HP}, sem cookie: ${a.length} requisições (${dentro.length - 1} rotas fora /admin/entrar; GET, RSC, RSC+prefetch, HEAD, OPTIONS, PUT, DELETE, PATCH, POST JSON e POST text/plain) todas 404`, ruins.slice(0, 6).map((x) => `${x.rotulo} ${x.u} -> ${x.status}`).join("; "));
    const semCorpo = a.filter((x) => x.rotulo !== "HEAD" && x.tamanho > 0);
    R.checa(semCorpo.length === 0, "o 404 da guarda não tem corpo (nada a revelar)", semCorpo.slice(0, 4).map((x) => `${x.rotulo} ${x.u} ${x.tamanho} B`).join("; "));
    const turnstileEm = (u) => u === "/admin/entrar" || u.startsWith("/admin/entrar/"); // A5: o Turnstile só nas páginas de entrada
    const semCab = a.filter((x) => problemasDeSeguranca(x.cabecalhos, { turnstile: turnstileEm(x.u) }).length > 0);
    R.checa(semCab.length === 0, "todo 404 da guarda, em qualquer método, leva os três cabeçalhos de segurança (CSP com frame-ancestors 'none', challenges.cloudflare.com como único host e só em /admin/entrar e /admin/entrar/fator, X-Frame-Options, Referrer-Policy)", semCab.slice(0, 4).map((x) => `${x.rotulo} ${x.u}: ${problemasDeSeguranca(x.cabecalhos, { turnstile: turnstileEm(x.u) }).join("/")}`).join("; "));
    // TRACE: limite do Next (500 antes do middleware); a exceção do AC-22 foi aprovada para a central LOCAL; para a internet, é a decisão 5 da seção 7 da reavaliação
    const trace = [];
    for (const r of dentro) trace.push({ u: urlDe(r, ex), status: await crua(srv.base, urlDe(r, ex), { metodo: "TRACE", cabecalhos: { host: HP } }) });
    const traceFora = trace.filter((x) => x.status !== 404);
    const limite = srv.log().includes("'TRACE' HTTP method is unsupported");
    R.checa(traceFora.length === 0 || (limite && traceFora.every((x) => x.status === 500)), `TRACE nas ${trace.length} rotas: 404 ou, no limite conhecido do Next (log "'TRACE' HTTP method is unsupported"), 500 genérico sem corpo da central`, traceFora.map((x) => `${x.u} -> ${x.status}`).join("; "));
    if (traceFora.length > 0) R.aviso(`EXCEÇÃO ao critério 15 (aprovada pelo dono no AC-22 para a central LOCAL; para a internet é a decisão 5 da seção 7 de reavaliacao-central-e-dominio.md, ainda aberta): TRACE -> ${traceFora.length} de ${trace.length} rotas com 500 em vez de 404 (limite do Next 15.5; sem dado)`);
    else R.info("TRACE -> 404 em todas");

    // 2. /admin/entrar com sessão ausente: a única exceção. O que o código diz (middleware.ts: ehEntradaSemSessao; entrar/page.tsx: exigirEntrada + resolverOperador): 200 com o formulário de e-mail.
    const e = await C.crua(srv.base, "/admin/entrar", { cabecalhos: { host: HP } });
    R.checa(e.status === 200 && /Entrar na central/.test(e.texto), "/admin/entrar (Host certo, sem cookie): 200 com o formulário de e-mail (a exceção que o middleware abre)", `status ${e.status}`);
    R.checa(problemasDeSeguranca(e.cabecalhos, { turnstile: true }).length === 0, "/admin/entrar leva os cabeçalhos: CSP cita challenges.cloudflare.com (Turnstile só aqui) e nenhum outro host", problemasDeSeguranca(e.cabecalhos, { turnstile: true }).join("; "));
    const e2 = await C.crua(srv.base, "/admin/entrar?etapa=codigo", { cabecalhos: { host: HP } });
    R.checa(e2.status === 200 && /Confira seu e-mail/.test(e2.texto), "/admin/entrar?etapa=codigo (Host certo, sem cookie): 200 com o formulário do código", `status ${e2.status}`);
    const f = await C.crua(srv.base, "/admin/entrar/fator", { cabecalhos: { host: HP } });
    R.checa(f.status === 404, "/admin/entrar/fator sem sessão: 404 (o cadastro do fator exige sessão de admin com aal1)", `status ${f.status}`);
    const outros = [];
    for (const [m, c] of [["HEAD", {}], ["OPTIONS", {}], ["PUT", {}], ["DELETE", {}], ["PATCH", {}], ["POST", cabPost], ["POST text/plain", { host: HP, origin: `https://${HP}`, "sec-fetch-site": "same-origin", "content-type": "text/plain" }]]) {
      const x = await C.crua(srv.base, "/admin/entrar", { metodo: m.split(" ")[0], cabecalhos: { host: HP, ...c }, corpo: m.startsWith("POST") ? "{}" : undefined });
      outros.push(`${m} ${x.status}`);
    }
    R.info(`/admin/entrar, outros métodos sem sessão (o Next trata o POST sem o cabeçalho Next-Action): ${outros.join(", ")}`);
    R.checa(!outros.some((o) => /\s5\d\d$/.test(o)), "/admin/entrar nunca responde 5xx a método estranho", outros.join(", "));
    const barra = await C.crua(srv.base, "/admin/entrar/", { cabecalhos: { host: HP } });
    R.info(`/admin/entrar/ (barra final): ${barra.status}`);

    // 3. Host que não é o da central: 404 em toda rota (inclusive /admin/entrar), mesmo com o ambiente certo
    for (const host of [`localhost:${srv.porta}`, `127.0.0.1:${srv.porta}`, `[::1]:${srv.porta}`, "replica-x.vercel.app", "replica-virid-sigma.vercel.app", `${HP}.evil.example`, `evil-${HP}`, `${HP}:8443`, "evil.example"]) {
      const g = await varrerCrua(srv.base, dentro, ex, { host });
      const ruim = g.filter((x) => x.status !== 404);
      R.checa(ruim.length === 0, `Host ${host}: ${g.length} GET (todas as rotas, /admin/entrar incluída) com 404`, ruim.slice(0, 4).map((x) => `${x.u} -> ${x.status}`).join("; "));
    }
    for (const host of [HP.toUpperCase(), `${HP}:443`]) {
      const ok = await C.crua(srv.base, "/admin/entrar", { cabecalhos: { host } });
      R.checa(ok.status === 200, `controle positivo: Host ${host} também abre /admin/entrar (200)`, `status ${ok.status}`);
    }
    // X-Forwarded-Host e afins não trocam o Host
    for (const cab of [{ "x-forwarded-host": HP }, { forwarded: `host=${HP}` }, { "x-original-host": HP }]) {
      const x = await C.crua(srv.base, "/admin/entrar", { cabecalhos: { host: "evil.example", ...cab } });
      R.checa(x.status === 404, `Host evil.example com ${Object.keys(cab)[0]}: ${HP}: 404 (cabeçalho de proxy não vale)`, `status ${x.status}`);
    }
    await a1PublicoFechado(srv);
  } finally {
    await srv.parar();
  }
  await a1ActionsPublicas();
  await entradaPorApi();

  // 4. cada variável da trava, uma por vez: Host certo e a página de entrada fechada também
  const variantes = [
    ["VERCEL_ENV=preview", {}, (e) => ({ ...e, VERCEL_ENV: "preview" })],
    ["VERCEL_ENV=development", {}, (e) => ({ ...e, VERCEL_ENV: "development" })],
    ["VERCEL_ENV ausente", {}, (e) => { const n = { ...e }; delete n.VERCEL_ENV; return n; }],
    ["AUTH_PROVIDER=dev", {}, (e) => ({ ...e, AUTH_PROVIDER: "dev" })],
    ["ADMIN_DATABASE_URL sem sslmode", {}, (e) => ({ ...e, ADMIN_DATABASE_URL: e.ADMIN_DATABASE_URL.replace("?sslmode=require", "") })],
    ["ADMIN_DATABASE_URL com sslmode=disable", {}, (e) => ({ ...e, ADMIN_DATABASE_URL: e.ADMIN_DATABASE_URL.replace("sslmode=require", "sslmode=disable") })],
    ["ADMIN_DATABASE_URL ausente", {}, (e) => { const n = { ...e }; delete n.ADMIN_DATABASE_URL; return n; }],
    ["ADMIN_CENTRAL=Producao (valor que não é exato)", {}, (e) => ({ ...e, ADMIN_CENTRAL: "Producao" })],
  ];
  for (const [nome, , muda] of variantes) {
    const s2 = await C.subirNext(muda(await C.envProducao(C.BANCO_C7)));
    try {
      const a2 = await varreduraCompleta(s2.base, dentro, ex, HP);
      const ruim = a2.filter((x) => x.status !== 404);
      R.checa(ruim.length === 0, `${nome}: Host ${HP}, ${a2.length} requisições (todas as rotas, /admin/entrar incluída, todos os métodos) com 404`, ruim.slice(0, 4).map((x) => `${x.rotulo} ${x.u} -> ${x.status}`).join("; "));
    } finally {
      await s2.parar();
    }
  }
}

// ================================================================== F3-C1: o projeto admin não serve o site; nenhuma server action na central; entrada por API

const lerJson = (arq) => JSON.parse(fs.readFileSync(arq, "utf8"));

/** Build do projeto admin (ADMIN_CENTRAL=producao, pasta própria) e comparação com o build do site: o das actions públicas tem de ser o mesmo; as actions da central não existem em nenhum. */
function construirAdminProducao(t) {
  R.cabecalho("F3-C1: build do projeto admin (ADMIN_CENTRAL=producao, pasta .next-admin-prod) e comparação com o build do site");
  const dist = path.join(C.WEB, C.DIST_ADMIN_PROD);
  const bid = path.join(dist, "BUILD_ID");
  if (C.temFlag("--sem-build") && C.existe(bid)) R.ok(`--sem-build: reaproveita ${C.DIST_ADMIN_PROD}`);
  else {
    const b = C.rodar(process.execPath, [path.join(C.WEB, "node_modules/next/dist/bin/next"), "build"], { cwd: C.WEB, env: C.envCi({ ADMIN_CENTRAL: "producao", NEXT_DIST_DIR: C.DIST_ADMIN_PROD }), timeout: 580_000 });
    R.checa(b.rc === 0 && /Compiled successfully/.test(b.out), `next build do projeto admin (ADMIN_CENTRAL=producao) terminou com código ${b.rc} em ${t()}`, b.out.slice(-600));
  }
  if (!C.existe(bid)) return;
  const site = lerJson(path.join(C.WEB, ".next/server/server-reference-manifest.json")).node;
  const adm = lerJson(path.join(dist, "server/server-reference-manifest.json")).node;
  // os ids mudam a cada build (salt por build): compara-se arquivo, nome exportado e workers (rota e camada) de cada action
  const norm = (m) => Object.values(m).map((v) => JSON.stringify([v.filename, v.exportedName, Object.keys(v.workers ?? {}).sort().map((w) => [w, v.workers[w]?.layer])])).sort();
  R.checa(JSON.stringify(norm(site)) === JSON.stringify(norm(adm)), `as server actions do build do site e do projeto admin são as mesmas (${Object.keys(site).length}: arquivo, nome e workers; os ids mudam por build)`, `site ${Object.keys(site).length}, admin ${Object.keys(adm).length}`);
  const daCentral = [...Object.values(site), ...Object.values(adm)].filter((v) => /lib\/admin|app\/\(admin\)|components\/admin/.test(v.filename ?? ""));
  R.checa(daCentral.length === 0, "nenhuma server action da central em nenhum dos dois builds (as de entrada.ts viraram rotas de API)", daCentral.map((v) => `${v.filename}:${v.exportedName}`).join(", "));
  const rs = lerJson(path.join(C.WEB, ".next/routes-manifest.json"));
  const ra = lerJson(path.join(dist, "routes-manifest.json"));
  R.checa((rs.rewrites?.beforeFiles ?? []).length === 0 && (rs.headers ?? []).length === 0, "o build do SITE não tem rewrite nem cabeçalho de configuração (build idêntico ao de antes)", JSON.stringify({ rw: rs.rewrites, h: rs.headers }).slice(0, 200));
  R.checa((ra.rewrites?.beforeFiles ?? []).length === 1 && (ra.headers ?? []).length === 1, "o build do projeto admin tem 1 rewrite beforeFiles e 1 regra de cabeçalhos", JSON.stringify({ rw: ra.rewrites, h: ra.headers }).slice(0, 300));
}

async function a1PublicoFechado(srv) {
  R.cabecalho("F3-C1 (A1, A9, A13): o projeto admin (Host da central) não serve o site público; todo 404 e todo 308 levam os cabeçalhos");
  const h = { host: HP };
  const fora = ["/", "/entrar", "/api/me", "/pessoas", "/conta", "/api/places", "/api/qualquer", "/_next/data/x/y.json", "/p/x/opengraph-image", "/proposta/x/opengraph-image", "/robots.txt", "/rota-que-nao-existe", "/v2/x", "/votacoes", "/_next/admin-central-fora-do-escopo", "/ADMIN", "/aDmin", "/Admin/fila", "/ADMIN/api/estado", "/_NEXT/STATIC/x", "/_Next/static/chunks/x.js", "/GEO/br.json", "/Geo/uf/35.json", "/FAVICON.ICO"];
  const rs = [];
  for (const u of fora) rs.push([u, await C.crua(srv.base, u, { cabecalhos: h })]);
  R.checa(rs.every(([, r]) => r.status === 404), `${fora.length} caminhos do site público (/, /entrar, /api/me, /pessoas, /conta, /api/places, imagens OG, /v2, ...) respondem 404`, rs.filter(([, r]) => r.status !== 404).map(([u, r]) => `${u} -> ${r.status}`).join("; "));
  const semCab = rs.filter(([, r]) => problemasDeSeguranca(r.cabecalhos).length > 0);
  R.checa(semCab.length === 0, "todo 404 do projeto admin fora de /admin leva X-Frame-Options DENY, Referrer-Policy same-origin e CSP com frame-ancestors 'none'", semCab.map(([u, r]) => `${u}: ${problemasDeSeguranca(r.cabecalhos).join("/")}`).join("; "));
  const publico = rs.filter(([, r]) => /<(html|nav|header|main|footer)\b|segue o voto|quem·representa/i.test(r.texto));
  R.checa(publico.length === 0, "o corpo do 404 não renderiza página pública (sem html, nav, header, main nem marca do site)", publico.map(([u]) => u).join(", "));
  R.info(`corpo do 404 fora da central: ${JSON.stringify(rs[0][1].texto.slice(0, 80))} (${rs[0][1].texto.length} B)`);
  const post = await C.crua(srv.base, "/", { metodo: "POST", cabecalhos: { ...cabPost, "next-action": "60416afe3fe7", "content-type": "text/plain;charset=UTF-8" }, corpo: "[]" });
  R.checa(post.status === 404 && problemasDeSeguranca(post.cabecalhos).length === 0, "POST / com Next-Action: 404 (e com os cabeçalhos)", `status ${post.status}`);
  for (const u of ["/geo/br.json", "/geo/uf/35.json", "/favicon.ico"]) {
    const r = await C.crua(srv.base, u, { cabecalhos: h });
    R.checa(r.status === 200, `${u} (malha e favicon que a central usa) continua 200`, `status ${r.status}`);
  }
  for (const u of ["/geo/nao-existe.json", "/geo/uf/99.json", "/geo/", "/_next/static/nao-existe.js"]) {
    const r = await C.crua(srv.base, u, { cabecalhos: h });
    R.checa(r.status === 404 && r.texto.length < 64 && !/<html/i.test(r.texto) && problemasDeSeguranca(r.cabecalhos).length === 0, `${u}: 404 curto (${r.texto.length} B), sem página pública, com os cabeçalhos`, `status ${r.status} ${r.texto.length} B ${JSON.stringify(r.texto.slice(0, 40))}`);
  }
  for (const u of ["/admin/fila/", "/admin/entrar/", "/admin/"]) {
    const r = await C.crua(srv.base, u, { cabecalhos: h });
    const pr = problemasDeSeguranca(r.cabecalhos);
    R.checa((u === "/admin/entrar/" ? [200, 404] : [404]).includes(r.status) && pr.length === 0, `${u} (barra final, sem sessão): ${r.status} do middleware (a entrada, sem barra, é 200), sem o 308 que saía antes dos cabeçalhos (skipTrailingSlashRedirect), com X-Frame-Options DENY, Referrer-Policy e CSP com frame-ancestors 'none'`, `status ${r.status}; ${pr.join("; ")}`);
  }
  const d404 = await C.crua(srv.base, "/rota-que-nao-existe", { cabecalhos: h });
  R.checa(d404.texto.length < 64 && !/<html/i.test(d404.texto), `o corpo do 404 fora da central é o do servidor de estáticos (${d404.texto.length} B), não uma página`, JSON.stringify(d404.texto.slice(0, 80)));
  // o 404 da central e o do projeto levam a MESMA política efetiva (a do middleware é a completa; a do config só soma frame-ancestors 'none')
  const c404 = await C.crua(srv.base, "/admin/fila", { cabecalhos: h });
  R.info(`CSP do 404 de /admin/fila: ${c404.cabecalhos["content-security-policy"]}`);
}

/** Nenhuma server action roda sob /admin (o id da action vale em qualquer caminho): o id de CADA action pública do build, POST em páginas da central e fora dela = 404 e nenhuma ida ao Supabase. */
async function a1ActionsPublicas() {
  R.cabecalho("F3-C1 (A13): nenhuma server action roda na central: o id de cada action pública do build, em /, /admin, /admin/fila e /admin/entrar (JSON text/plain e multipart), responde 404 sem efeito");
  const ids = Object.keys(lerJson(path.join(C.WEB, C.DIST_ADMIN_PROD, "server/server-reference-manifest.json")).node);
  R.checa(ids.length >= 10, `o manifesto do build admin lista ${ids.length} actions públicas (as do site)`, String(ids.length));
  const falso = await C.supabaseFalso("drop");
  const srv = await C.subirNext(await C.envProducao(C.BANCO_C7, { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${falso.porta}` }));
  // centenas de conexões curtas em sequência esgotam portas efêmeras no macOS (EADDRNOTAVAIL): repete com pausa
  const C_crua = async (...a) => {
    for (let i = 0; ; i++) {
      try {
        return await C.crua(...a);
      } catch (e) {
        if (i >= 6 || !/EADDRNOTAVAIL|EMFILE|ECONNRESET/.test(String(e))) throw e;
        await C.esperar(1500);
      }
    }
  };
  try {
    const ruins = [];
    let n = 0;
    for (const id of ids) {
      for (const u of ["/", "/admin", "/admin/fila", "/admin/entrar"]) {
        for (const tipo of ["text/plain;charset=UTF-8", "multipart/form-data; boundary=x"]) {
          const r = await C_crua(srv.base, u, { metodo: "POST", cabecalhos: { ...cabPost, "next-action": id, "content-type": tipo }, corpo: "[]" });
          n++;
          if (r.status !== 404) ruins.push(`${u} ${tipo} ${id.slice(0, 8)} -> ${r.status}`);
        }
      }
      // envio sem JavaScript: o id vai no corpo do formulário, sem cabeçalho Next-Action
      const f = await C_crua(srv.base, "/admin/entrar", { metodo: "POST", cabecalhos: { host: HP, origin: `https://${HP}`, "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=x" }, corpo: `--x\r\nContent-Disposition: form-data; name="$ACTION_ID_${id}"\r\n\r\n\r\n--x--\r\n` });
      n++;
      if (f.status !== 404) ruins.push(`/admin/entrar MPA ${id.slice(0, 8)} -> ${f.status}`);
    }
    R.checa(ruins.length === 0, `${n} POST (${ids.length} ids x páginas x tipos de corpo, mais o envio de formulário sem JavaScript) todos 404`, ruins.slice(0, 6).join("; "));
    // caminhos que o projeto admin serve de arquivo (malhas, favicon, estáticos) e um /geo inexistente: com Next-Action, nunca devolvem resultado de action nem falam com o Supabase
    const estaticos = [];
    for (const u of ["/geo/br.json", "/geo/uf/35.json", "/geo/nao-existe.json", "/favicon.ico", "/_next/static/x.js"]) {
      for (const id of ids.slice(0, 3)) {
        const r = await C_crua(srv.base, u, { metodo: "POST", cabecalhos: { ...cabPost, "next-action": id, "content-type": "text/plain;charset=UTF-8" }, corpo: "[]" });
        if (/text\/x-component/.test(String(r.cabecalhos["content-type"])) || r.cabecalhos["x-action-redirect"]) estaticos.push(`${u} ${id.slice(0, 8)} -> ${r.status} ${r.cabecalhos["content-type"]}`);
      }
    }
    R.checa(estaticos.length === 0, "POST com Next-Action em /geo/*, /favicon.ico e /_next/static/*: nenhuma resposta de action (nem text/x-component nem redirecionamento de action)", estaticos.join("; "));
    R.checa(falso.conexoes() === 0, "nenhuma action executou: zero conexões ao Supabase (sendCode, verifyCode e demais teriam falado com ele)", `${falso.conexoes()} conexões`);
    R.checa(!/\[admin\] entrada|Server Action|unhandled|uncaught/i.test(srv.log()), "o log do servidor não registra execução de action nem exceção", srv.log().slice(-300));
    const outras = await Promise.all(["/_next/data/x.json", "/api/me", "/api/qualquer", "/p/x/opengraph-image", "/rota-que-nao-existe"].map((u) => C.crua(srv.base, u, { cabecalhos: { host: HP } })));
    R.checa(outras.every((x) => x.status === 404), "GET /_next/data/x.json, /api/me, /api/qualquer, uma imagem OG pública e uma rota inexistente: 404", outras.map((x) => x.status).join(","));
  } finally {
    await srv.parar();
    falso.fechar();
  }
  // controle positivo da sonda: no build do SITE (sem rewrite nem middleware sobre o caminho) o mesmo POST com um id de action pública chega à action (status que não é 404)
  const site = await C.subirNext(C.envCi());
  try {
    const sendCode = Object.entries(lerJson(path.join(C.WEB, ".next/server/server-reference-manifest.json")).node).find(([, v]) => v.exportedName === "sendCode")?.[0];
    const r = await C.crua(site.base, "/entrar", { metodo: "POST", cabecalhos: { host: `127.0.0.1:${site.porta}`, origin: site.base, "next-action": sendCode, "content-type": "text/plain;charset=UTF-8" }, corpo: "[]" });
    R.checa(sendCode && r.status !== 404, "controle positivo: no build do site, POST /entrar com o id de sendCode alcança a action (status que não é 404): a sonda é capaz de executar uma action", `status ${r.status}`);
  } finally {
    await site.parar();
  }
}

/** A entrada pela API (sem server action): tempo igual, recusas de origem, cookie de e-mail, métodos. O Supabase é falso (conexão derrubada), então o envio de código nunca chega a sair. */
async function entradaPorApi() {
  R.cabecalho("F3-C1 (A3): entrada da central por rotas de API (JSON, mesma origem), mesma resposta e mesmo tempo para qualquer e-mail");
  const falso = await C.supabaseFalso("drop");
  const srv = await C.subirNext(await C.envProducao(C.BANCO_C7, { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${falso.porta}` }));
  const postar = async (u, corpo, extra = {}) => {
    const t0 = Date.now();
    const r = await C.crua(srv.base, u, { metodo: "POST", cabecalhos: { ...cabPost, ...extra }, corpo: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
    return { ...r, ms: Date.now() - t0, json: (() => { try { return JSON.parse(r.texto); } catch { return null; } })() };
  };
  try {
    await postar("/admin/api/entrar/codigo", { email: "aquecimento@example.invalid" }); // a primeira chamada compila a rota (frio): fora da medida
    const casos = [["e-mail de admin ativo (operador local)", C.ADMIN_LOCAL_EMAIL], ["e-mail que não é admin", "ninguem@example.invalid"], ["outro e-mail que não é admin", "outra.pessoa@example.invalid"]];
    const medidas = [];
    for (const [rotulo, email] of casos) {
      const r = await postar("/admin/api/entrar/codigo", { email, turnstile: "x" });
      medidas.push(r.ms);
      R.checa(r.status === 200 && r.json?.proximo === "/admin/entrar?etapa=codigo", `codigo, ${rotulo}: 200 com a mesma resposta (proximo = etapa do código)`, `status ${r.status} ${r.texto.slice(0, 120)}`);
      const ck = [r.cabecalhos["set-cookie"]].flat().join(" ");
      R.checa(/adm_entrar_email=/.test(ck) && /HttpOnly/i.test(ck) && /SameSite=strict/i.test(ck) && /Path=\/admin/i.test(ck) && /Secure/i.test(ck), `codigo, ${rotulo}: cookie adm_entrar_email HttpOnly, Secure, SameSite=Strict, Path=/admin`, ck.slice(0, 200));
      R.checa(problemasDeSeguranca(r.cabecalhos, { turnstile: false }).length === 0, `codigo, ${rotulo}: resposta da API leva os três cabeçalhos, sem Turnstile na CSP`, problemasDeSeguranca(r.cabecalhos, { turnstile: false }).join("; "));
    }
    const inv = await postar("/admin/api/entrar/codigo", { email: "isto-nao-e-email" });
    medidas.push(inv.ms);
    R.checa(inv.status === 400, "codigo com e-mail malformado: 400", `status ${inv.status}`);
    R.checa(Math.min(...medidas) >= 1400 && Math.max(...medidas) - Math.min(...medidas) <= 500, `o tempo de resposta de codigo é o mesmo para admin, não admin e e-mail inválido: piso de 1,5 s (medidas ${medidas.join(", ")} ms)`, medidas.join(", "));
    const v1 = await postar("/admin/api/entrar/verificar", { code: "123456" });
    const v2 = await postar("/admin/api/entrar/verificar", { code: "123456" }, { cookie: `adm_entrar_email=${C.ADMIN_LOCAL_EMAIL}` });
    const v3 = await postar("/admin/api/entrar/verificar", { code: "123456" }, { cookie: "adm_entrar_email=ninguem@example.invalid" });
    R.checa([v1, v2, v3].every((v) => v.status === 400 && v.json?.erro), "verificar: sem cookie, com admin e com não admin respondem 400 com erro neutro, nunca sessão", [v1, v2, v3].map((v) => `${v.status} ${v.texto.slice(0, 60)}`).join(" | "));
    R.checa(Math.min(v1.ms, v2.ms, v3.ms) >= 1400 && Math.abs(v2.ms - v3.ms) <= 500, `verificar com admin e com não admin leva o mesmo tempo (piso de 1,5 s): ${v1.ms}, ${v2.ms}, ${v3.ms} ms`);
    R.checa(v2.json?.erro === v3.json?.erro, "verificar: a mensagem para admin e para não admin é a mesma");
    // recusas
    const semOrigem = await C.crua(srv.base, "/admin/api/entrar/codigo", { metodo: "POST", cabecalhos: { host: HP, "content-type": "application/json", "sec-fetch-site": "same-origin" }, corpo: JSON.stringify({ email: "a@b.co" }) });
    R.checa(semOrigem.status === 403, "codigo sem Origin: 403", `status ${semOrigem.status}`);
    const txt = await postar("/admin/api/entrar/codigo", "{}", { "content-type": "text/plain" });
    R.checa(txt.status === 403, "codigo com text/plain (POST simples): 403", `status ${txt.status}`);
    const cross = await postar("/admin/api/entrar/codigo", { email: "a@b.co" }, { "sec-fetch-site": "cross-site" });
    R.checa(cross.status === 403, "codigo com Sec-Fetch-Site cross-site: 403", `status ${cross.status}`);
    for (const m of ["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
      const r = await C.crua(srv.base, "/admin/api/entrar/codigo", { metodo: m, cabecalhos: { host: HP } });
      R.checa(r.status === 404, `${m} /admin/api/entrar/codigo sem sessão: 404`, `status ${r.status}`);
    }
    for (const u of ["/admin/api/entrar/fator/iniciar", "/admin/api/entrar/fator/confirmar"]) {
      const r = await postar(u, { code: "123456" });
      R.checa(r.status === 404, `${u} sem sessão: 404 (as de fator exigem sessão aal1)`, `status ${r.status}`);
    }
    const pag = await C.crua(srv.base, "/admin/entrar", { cabecalhos: { host: HP } });
    R.checa(pag.status === 200 && !/\$ACTION|name="\$/.test(pag.texto), "a página /admin/entrar continua 200 e o formulário não leva campo de server action ($ACTION_*)", `status ${pag.status}`);
    R.checa(falso.conexoes() <= 3, `o Supabase falso recebeu ${falso.conexoes()} conexões (o envio de código só sai para admin ativo, e a conexão cai: nada é enviado)`);
  } finally {
    await srv.parar();
    falso.fechar();
  }
}


// Provedor de autenticação fora do ar, com um cookie de sessão que obriga a falar com ele: 404 e o servidor continua de pé.
// ACHADO: com o provedor fora do ar, cada requisição com cookie de sessão espera o backoff do supabase-js (~25 s, 8 conexões) antes do 404 (o middleware não tem prazo). As requisições vão
// em paralelo e os dois modos de falha também, para a prova não gastar minutos; o tempo medido vai no relato como AVISO (defeito da central, não da prova).
async function provedorForaDoAr(rotas) {
  R.cabecalho("modo produção simulado: provedor de autenticação fora do ar (conexão derrubada; resposta 500) com cookie de sessão presente");
  void rotas;
  const um = async (modo) => {
    const falso = await C.supabaseFalso(modo);
    const env = await C.envProducao(C.BANCO_C7, { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${falso.porta}` });
    const srv = await C.subirNext(env);
    const saida = { modo };
    try {
      const sessao = { access_token: "a.b.c", token_type: "bearer", expires_in: 1, expires_at: 1, refresh_token: "r", user: { id: "00000000-0000-4000-8000-000000000001", email: "alguem@example.invalid" } };
      const valor = `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}`;
      // A10: o cookie do SITE (nome sb-<ref>-auth-token) não é lido pela central: nem chega a falar com o provedor
      const velho = await C.crua(srv.base, "/admin/fila", { cabecalhos: { host: HP, cookie: `sb-127-auth-token=${valor}` } });
      saida.velho = [velho.status, falso.conexoes()];
      const cookie = `sb-admin-central-auth-token=${valor}`; // nome próprio da central (NOME_COOKIE_SESSAO)
      const cab = { host: HP, cookie };
      const t0 = Date.now();
      const caminhos = ["/admin", "/admin/fila", "/admin/api/estado", "/admin/entrar/fator", "/admin/rodadas"];
      const [rs, post, ent] = await Promise.all([
        Promise.all(caminhos.map(async (c) => [c, (await C.crua(srv.base, c, { cabecalhos: cab })).status])),
        C.crua(srv.base, "/admin/api/pedidos", { metodo: "POST", cabecalhos: { ...cabPost, cookie }, corpo: "{}" }),
        C.crua(srv.base, "/admin/entrar", { cabecalhos: cab }),
      ]);
      saida.seg = (Date.now() - t0) / 1000;
      saida.rs = rs;
      saida.post = post.status;
      saida.ent = ent.status;
      saida.conexoes = falso.conexoes();
      const vivo = await C.crua(srv.base, "/admin/fila", { cabecalhos: { host: HP } });
      const pub = await C.http(srv.base, "/");
      saida.vivo = [vivo.status, pub.status];
      saida.log = srv.log();
    } finally {
      await srv.parar();
      falso.fechar();
    }
    return saida;
  };
  for (const x of await Promise.all(["drop", "http500"].map(um))) {
    const m = x.modo;
    R.checa(x.rs.every(([, st]) => st === 404) && x.post === 404, `[${m}] com cookie de sessão e o Supabase fora do ar: ${x.rs.map(([c, st]) => `${c} ${st}`).join(", ")}, POST pedidos ${x.post} (tudo 404)`);
    R.checa(x.ent === 200, `[${m}] /admin/entrar com o provedor fora do ar: 200 (renderiza o formulário; quem não passa pelo provedor não entra, mas a página abre)`, `status ${x.ent}`);
    R.checa(x.velho[0] === 404 && x.velho[1] === 0, `[${m}] A10: cookie com o nome do SITE (sb-127-auth-token) na central: 404 e ZERO conexões ao provedor (a central só lê o cookie de nome próprio)`, `status ${x.velho[0]}, conexões ${x.velho[1]}`);
    R.checa(x.conexoes >= 1, `[${m}] o servidor TENTOU falar com o Supabase falso (${x.conexoes} conexões): a prova não passou por um caminho que nem tenta`);
    R.checa(x.vivo[0] === 404 && x.vivo[1] === 404 && !/unhandled|uncaught|TypeError/i.test(x.log), `[${m}] depois de ${x.conexoes} conexões ao provedor falso o servidor continua de pé (404 na central e / também 404 no projeto admin) e o log não tem exceção solta`, `central ${x.vivo[0]}, / ${x.vivo[1]}; log: ${x.log.slice(-300)}`);
    R.checa(x.seg <= 12, `[${m}] com o provedor fora do ar o 404 sai no prazo (comPrazo, 4 s por chamada ao Auth; /admin/entrar faz até duas): o conjunto em paralelo levou ${x.seg.toFixed(1)} s (antes do prazo: ~25 s por requisição e ~51 s em /admin/entrar)`, `${x.seg.toFixed(1)} s`);
  }
}

// (b) `por` do corpo ignorado e (e) admin desativado: o servidor confere a identidade antes de gravar.
async function identidade(base, pendAM) {
  R.cabecalho("identidade (AC-23): `por` do corpo ignorado; o pedido leva o admin da sessão (local: ADMIN_LOCAL_EMAIL)");
  const forjado = "Fulano Forjado (SIMULADO)";
  const antes = C.sql(C.BANCO_C7, "select count(*) from adm_pedidos_decisao");
  const just = "ensaio SIMULADO: `por` forjado no corpo; não aplicar";
  const d = await C.http(base, "/admin/api/decisoes", { metodo: "POST", corpo: { pendencia_id: pendAM, acao: "aprovar", por: forjado, justificativa: just, aplicar: false } });
  R.checa(d.status === 200 && d.json?.novo === true, `POST decisão com por="${forjado}" no corpo: 200, novo (id ${d.json?.id})`, `${d.status} ${d.texto.slice(0, 200)}`);
  const l = C.sqlLinhas(C.BANCO_C7, `select por_nome, por_email, por_user_id is null, acao, aplicar, status from adm_pedidos_decisao where id = '${d.json?.id}'`)[0] ?? [];
  R.checa(l[0] === C.ADMIN_LOCAL_NOME && l[1] === C.ADMIN_LOCAL_EMAIL, `o pedido de decisão gravado tem por_nome = '${C.ADMIN_LOCAL_NOME}' e por_email = ${C.ADMIN_LOCAL_EMAIL} (o admin local), não o do corpo`, JSON.stringify(l));
  R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos_decisao where por_nome ilike '%forjado%' or por_email ilike '%forjado%'") === "0", "nenhuma linha em adm_pedidos_decisao carrega o `por` forjado");
  R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos_decisao") === String(Number(antes) + 1), "exatamente um pedido de decisão novo");
  const pe = C.sql(C.BANCO_C7, "select count(*) from adm_pedidos where por_email is distinct from '" + C.ADMIN_LOCAL_EMAIL + "' and criado_em > now() - interval '1 hour' and por_email is not null");
  R.checa(pe === "0", "todo pedido gravado pela central (adm_pedidos) tem por_email do admin local", `${pe} com outro e-mail`);
  const ex = C.esvaziarFila(C.BANCO_C7);
  R.checa(ex.vazia && ex.feitos.some((f) => f.status === "concluido") && ex.feitos.every((f) => f.status === "concluido"), `o executor consome o pedido (${ex.feitos.map((f) => `${f.tipo}:${f.status}${f.erro ? " erro=" + f.erro : ""}`).join(", ")})`);
  const dec = C.sqlLinhas(C.BANCO_C7, `select decidido_por_tipo, decidido_por_nome, aplicada, justificativa from adm_decisoes where pendencia_id = '${pendAM}'`);
  R.checa(dec.length === 1 && dec[0][0] === "pessoa" && dec[0][1] === C.ADMIN_LOCAL_NOME && dec[0][2] === "f", `adm_decisoes: pessoa|${C.ADMIN_LOCAL_NOME}|aplicada=false (não o nome do corpo)`, JSON.stringify(dec));
}

async function adminDesativado(base) {
  R.cabecalho("gatilho de identidade pela API: admin desativado (banco de ensaio, role dono) = nada é gravado");
  const n = () => C.sql(C.BANCO_C7, "select (select count(*) from adm_pedidos) || '|' || (select count(*) from adm_pedidos_decisao)");
  const corpo = { tipo: "parecer", parametros: { rodada_id: "dddddddd-0000-4000-8000-00000000000d" } };
  const antes = n();
  C.sql(C.BANCO_C7, `update adm_admins set ativo = false where email = '${C.ADMIN_LOCAL_EMAIL}'`);
  try {
    R.checa(C.sql(C.BANCO_C7, `select ativo from adm_admins where email = '${C.ADMIN_LOCAL_EMAIL}'`) === "f", "admin local desativado no banco de ensaio");
    const r = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo });
    // O que o código faz: exigirAdminApi() -> resolverOperador() -> adminAtivo() filtra por ativo = true: sem admin ativo, 404 ANTES de qualquer gravação. O gatilho do banco (42501 -> 403) é a segunda barreira.
    R.checa(r.status === 404 && r.texto === "", "POST pedidos com o admin desativado: 404 (a guarda não acha admin ativo; o código nunca chega ao gatilho)", `status ${r.status} ${r.texto.slice(0, 100)}`);
    const r2 = await C.http(base, "/admin/api/decisoes", { metodo: "POST", corpo: { pendencia_id: "dddddddd-0000-4000-8000-00000000000e", acao: "aprovar", justificativa: "x" } });
    R.checa(r2.status === 404, "POST decisões com o admin desativado: 404", `status ${r2.status}`);
    const g = await Promise.all(["/admin", "/admin/fila", "/admin/api/estado"].map((p) => C.http(base, p)));
    R.checa(g.every((x) => x.status === 404), "GET /admin, /admin/fila e /admin/api/estado com o admin desativado: 404", g.map((x) => x.status).join(","));
    R.checa(n() === antes, "nenhuma linha gravada em adm_pedidos nem em adm_pedidos_decisao", `${antes} -> ${n()}`);
    // segunda barreira, direto no banco, com o role da central: o gatilho recusa o e-mail de admin inativo
    const ins = C.rodar("psql", [C.urlCentral(C.BANCO_C7), "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", `insert into adm_pedidos (tipo, parametros, chave_idem, por_user_id, por_email) values ('parecer', '{"rodada_id":"dddddddd-0000-4000-8000-00000000000d"}'::jsonb, 'dddd-inativo', null, '${C.ADMIN_LOCAL_EMAIL}')`]);
    R.checa(ins.rc !== 0 && /inativo/.test(ins.err) && n() === antes, "o gatilho adm_pedido_identidade recusa o INSERT do role admin_central para admin inativo (42501, 'está inativo'): a segunda barreira", `rc ${ins.rc} ${ins.err.slice(0, 160)}`);
  } finally {
    C.sql(C.BANCO_C7, `update adm_admins set ativo = true where email = '${C.ADMIN_LOCAL_EMAIL}'`);
  }
  R.checa(C.sql(C.BANCO_C7, `select ativo from adm_admins where email = '${C.ADMIN_LOCAL_EMAIL}'`) === "t", "admin local reativado");
  const ok = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo });
  R.checa(ok.status === 200 && ok.json?.novo === true, "reativado, o mesmo POST grava (200, novo): controle positivo", `status ${ok.status} ${ok.texto.slice(0, 100)}`);
  C.sql(C.BANCO_C7, `delete from adm_pedidos where id = '${ok.json?.id}'`);
}

// (f) ritmo: 21 pedidos distintos em menos de 60 s; o 21º responde 429 com Retry-After.
async function ritmo(base) {
  R.cabecalho("rate limit (AC-23): 21 pedidos distintos em menos de 60 s -> o 21º responde 429 com Retry-After");
  const recentes = () => Number(C.sql(C.BANCO_C7, `select count(*) from adm_pedidos where por_email = '${C.ADMIN_LOCAL_EMAIL}' and criado_em > clock_timestamp() - interval '60 seconds'`));
  const t0 = Date.now();
  while (recentes() > 0 && Date.now() - t0 < 70_000) await C.esperar(2000); // janela limpa: os pedidos de antes saem dos 60 s
  R.checa(recentes() === 0, `janela de 60 s limpa antes de começar (esperou ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const ini = Date.now();
  const rs = [];
  for (let i = 1; i <= 21; i++) {
    const id = `eeeeeeee-0000-4000-8000-${String(i).padStart(12, "0")}`;
    rs.push(await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "parecer", parametros: { rodada_id: id } } }));
  }
  const seg = (Date.now() - ini) / 1000;
  const aceitos = rs.filter((r) => r.status === 200 && r.json?.novo === true).length;
  R.checa(seg < 60, `os 21 POST levaram ${seg.toFixed(1)} s (menos de 60)`);
  R.checa(aceitos === 20 && rs.slice(0, 20).every((r) => r.status === 200), `os 20 primeiros foram aceitos (200, novo)`, rs.map((r) => r.status).join(","));
  const u = rs[20];
  R.checa(u.status === 429 && u.cabecalhos.get("retry-after") === "60", `o 21º responde 429 com Retry-After: ${u.cabecalhos.get("retry-after")}`, `status ${u.status} ${u.texto.slice(0, 120)}; retry-after ${u.cabecalhos.get("retry-after")}`);
  R.checa(!/postgres|admin_central|trigger|gatilho|54000/i.test(u.texto), "o corpo do 429 não vaza detalhe do banco", u.texto.slice(0, 160));
  R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos where parametros->>'rodada_id' like 'eeeeeeee-%'") === "20", "no banco, 20 pedidos (o 21º não foi gravado)");
  C.sql(C.BANCO_C7, "delete from adm_pedidos where parametros->>'rodada_id' like 'eeeeeeee-%'"); // limpeza no banco de ensaio: pareceres de rodada inexistente não podem ir ao executor
  R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos where status in ('na_fila','em_execucao')") === "0", "fila sem pedido ativo depois da limpeza");
}

// ================================================================== o modo completo

async function completo() {
  // o build com distDir próprio acrescenta `<distDir>/types/**` ao include do tsconfig: quem roda a prova não herda o arquivo alterado
  const TSCONFIG = path.join(C.WEB, "tsconfig.json");
  const tsconfigOriginal = fs.readFileSync(TSCONFIG, "utf8");
  const restauraTsconfig = () => { if (fs.readFileSync(TSCONFIG, "utf8") !== tsconfigOriginal) fs.writeFileSync(TSCONFIG, tsconfigOriginal); };
  process.on("exit", restauraTsconfig);
  const t = (s) => `${((Date.now() - T0) / 1000).toFixed(0)} s`;
  R.info(`SIMULADO: prova da central sem navegador. Banco ${C.BANCO_C7} (recriado). Rodadas SIMULADAS (CLI real sobre respostas fabricadas). Nada foi lido de fonte real.`);
  const { rotas, extras } = descobrirRotas();
  const dentro = rotas.filter((r) => !r.foraDoGrupo);

  // ---- build
  R.cabecalho("build");
  const buildId = path.join(C.WEB, ".next", "BUILD_ID");
  if (C.temFlag("--sem-build")) {
    R.checa(C.existe(buildId), "--sem-build: reaproveita o .next existente", "não há .next/BUILD_ID: rode sem --sem-build");
  } else {
    const b = C.rodar(process.execPath, [path.join(C.WEB, "node_modules/next/dist/bin/next"), "build"], { cwd: C.WEB, env: C.envCi(), timeout: 480_000 });
    R.checa(b.rc === 0 && /Compiled successfully/.test(b.out), `next build (fonte demo, sem ADMIN_*, sem banco) terminou com código ${b.rc} em ${t()}`, b.out.slice(-600) + b.err.replace(/ERROR: failed to copy trust settings.*\n/g, "").slice(-400));
    const faltam = dentro.filter((r) => !b.out.includes("/" + r.seg.join("/") + " "));
    R.checa(faltam.length === 0, "todas as rotas da central aparecem na tabela de rotas do build", faltam.map((r) => r.arquivo).join(", "));
  }
  restauraTsconfig();
  construirAdminProducao(t);
  restauraTsconfig();
  if (R.falhas) return;

  // ---- banco
  R.cabecalho("banco");
  const nMig = C.recriarC7();
  R.ok(`banco ${C.BANCO_C7} recriado, ${nMig} migrações aplicadas (db/migrate.sh --local), semente e base mínima carregadas (base.sql, admin_base.sql)`);
  R.checa(C.sql(C.BANCO_C7, "select current_database() || '|' || (select count(*) from adm_rodadas) || '|' || (select count(*) from adm_pedidos)") === `${C.BANCO_C7}|0|0`, "banco vazio de rodadas e pedidos");
  R.checa(C.sql(C.BANCO_C7, "select rolcanlogin from pg_roles where rolname = 'admin_central'") === "t", "o role admin_central tem login (post_0003, só local)");

  await criterio15(rotas, extras);
  await criterio15Host(rotas);
  await criterio15Producao(rotas);
  await provedorForaDoAr(rotas);

  // ---- central ligada
  const central = await C.subirNext(C.envCentral(C.BANCO_C7));
  const base = central.base;
  let centralAtiva = central;
  try {
    await cabecalhosLocal(base);
    R.cabecalho("estados de tela com o banco vazio (antes de qualquer rodada)");
    const h0 = await espera(R, base, "/admin", ["vazio", "carregando"], "nenhuma rodada: bloco vazio; região viva marcada como carregando no HTML inicial");
    R.checa(/aria-busy="true"/.test(h0.texto) && /data-regiao="viva"/.test(h0.texto), "carregando: a região viva sai no HTML inicial com data-regiao=viva e aria-busy=true");
    await espera(R, base, "/admin/uf/35", ["territorio_sem_ficha"], "UF sem nenhuma ficha");
    await espera(R, base, "/admin/registros?uf=35", ["territorio_sem_ficha"], "registros de UF sem ficha");
    await espera(R, base, "/admin/registros?uf=35&municipio=3550308", ["territorio_sem_ficha"], "registros de município sem ficha");
    for (const p of ["/admin/fila", "/admin/rodadas"]) {
      const r = await C.http(base, p);
      R.checa(r.status === 200, `página ${p} com banco vazio responde 200`, `status ${r.status}`);
    }
    const rel0 = await C.http(base, `/admin/api/relatorio/${UUID0}`);
    R.checa(rel0.status === 404 && rel0.json?.erro, "relatório de rodada inexistente: 404 com JSON de erro (não é o 404 da guarda)", `status ${rel0.status}`);

    // ---- rodadas simuladas
    R.cabecalho("rodadas simuladas (cenário v1; cenário v2 com releitura forçada de robots.txt e /api/)");
    const rod = C.prepararRodadas();
    R.ok(`rodada v1 ${rod.v1} e rodada v2 ${rod.v2} (${rod.nForcadas} URLs com releitura forçada) concluídas em ${t()}`);
    R.checa(C.sql(C.BANCO_C7, `select string_agg(status, ',' order by status) from adm_rodadas`) === "concluida,concluida", "as duas rodadas terminaram concluida");
    const pend = C.sqlLinhas(C.BANCO_C7, "select id, registro_chave, campo from adm_pendencias where status = 'aberta' order by registro_chave");
    R.checa(pend.length >= 2, `a v2 gerou pendências abertas (${pend.length}: ${pend.map((p) => `${p[2]}@casa ${p[1]}`).join(", ")})`);
    const casas = Object.fromEntries(C.sqlLinhas(C.BANCO_C7, "select p.uf, h.id || ',' || p.ibge_code from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf'").map((l) => [l[0], l[1].split(",")]));
    const pendDe = (uf) => (C.sqlLinhas(C.BANCO_C7, `select id from adm_pendencias where status = 'aberta' and classe = 'vinculo_sapl' and campo = 'status' and registro_chave = '${casas[uf][0]}'`)[0] ?? [])[0];
    const PEND_AM = pendDe("AM"), PEND_PB = pendDe("PB");
    R.checa(PEND_AM && PEND_PB, `pendências de status de AM (${PEND_AM}) e de PB (${PEND_PB}) abertas`);

    // ---- 19
    R.cabecalho("critério 19: números do painel da central = relatório da CLI (mesma rodada)");
    await criterio19(base, rod.v2, "v2");
    await criterio19(base, rod.v1, "v1");

    // ---- estados com rodada
    R.cabecalho("estados de tela com rodadas");
    await espera(R, base, `/admin?rodada=${rod.v2}`, ["rodada_concluida", "executor_ok", "carregando"], "rodada v2 concluída", { naoDeve: ["vazio", "erro_leitura"] });
    await espera(R, base, `/admin/uf/${casas.AM[1]}?rodada=${rod.v2}`, ["carregando"], "UF com fichas (não é território sem ficha)", { naoDeve: ["territorio_sem_ficha"] });
    await espera(R, base, "/admin/uf/35", ["territorio_sem_ficha"], "UF sem ficha continua vazia com banco populado");
    await espera(R, base, `/admin/ficha/vinculo_sapl/${casas.RO[0]}`, ["ficha_sem_evidencia"], "ficha sem proposta (RO não mudou entre v1 e v2)");
    await espera(R, base, `/admin/ficha/vinculo_sapl/${casas.AM[0]}`, [], "ficha com proposta (URL, trecho e hash): NÃO é ficha_sem_evidencia", { naoDeve: ["ficha_sem_evidencia"] });
    const fichaApi = await C.http(base, `/admin/api/ficha/vinculo_sapl/${casas.AM[0]}`);
    R.checa(fichaApi.status === 200 && fichaApi.json, "API da ficha de AM responde 200 com JSON", `status ${fichaApi.status}`);

    // ---- 24
    await criterio24(base, casas.AM[1]);

    // ---- 20
    R.cabecalho("critério 20: dois cliques em 'Recoletar fichas pendentes' = um pedido só");
    const corpo = { tipo: "recoleta", parametros: { classe: "vinculo_sapl", territorio: { ibge: casas.AM[1], nivel: "uf" } } };
    await csrfEstrito(base, corpo, { pendencia_id: PEND_AM, acao: "aprovar", justificativa: "ensaio SIMULADO: não deve ser gravado", aplicar: false });
    R.cabecalho("critério 20 (continuação)");
    R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos") === "0", "antes: nenhum pedido no banco");
    const p1 = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo });
    const p2 = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo });
    const [p3, p4] = await Promise.all([1, 2].map(() => C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo })));
    R.checa(p1.status === 200 && p1.json?.novo === true && typeof p1.json?.id === "string", `1º POST: 200, novo=true, id ${p1.json?.id}`, `status ${p1.status} ${p1.texto.slice(0, 160)}`);
    R.checa(p2.status === 200 && p2.json?.id === p1.json?.id && p2.json?.novo === false, "2º POST igual: mesmo id e novo=false", `${p2.texto.slice(0, 160)}`);
    R.checa([p3, p4].every((x) => x.json?.id === p1.json?.id && x.json?.novo === false), "mais dois POST simultâneos: mesmo id e novo=false");
    R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos where tipo = 'recoleta' and status in ('na_fila','em_execucao')") === "1" && C.sql(C.BANCO_C7, "select count(*) from adm_pedidos") === "1", "select count(*) em adm_pedidos = 1 pedido (ativo, na_fila) para a chave");
    const chaveEsperada = C.sha256(C.canonico({ tipo: "recoleta", parametros: corpo.parametros }));
    const chaveDb = C.sql(C.BANCO_C7, `select chave_idem from adm_pedidos where id = '${p1.json?.id}'`);
    R.checa(chaveDb === chaveEsperada, "chave_idem gravada pela central = sha256 do JSON canônico {tipo, parametros} (calculado aqui, de forma independente)", `${chaveDb} x ${chaveEsperada}`);
    const pc = C.cli(C.BANCO_C7, ["admin", "pedido", "recoleta", "--classe", "vinculo_sapl", "--ibge", casas.AM[1], "--nivel", "uf", "--json"]);
    R.checa(pc.json?.pedido_id === p1.json?.id && pc.json?.novo === false && pc.json?.chave_idem === chaveDb, "o mesmo pedido feito pela CLI (admin pedido recoleta) devolve o MESMO id, novo=false e a mesma chave_idem (AC-20)", `rc ${pc.rc} ${JSON.stringify(pc.json)?.slice(0, 200)} ${pc.err.slice(-200)}`);
    R.checa(C.sql(C.BANCO_C7, "select count(*) from adm_pedidos") === "1", "depois da CLI: continua 1 pedido");
    // o estado `pedido_existente` só aparece no DOM depois do clique (resultado-pedido.tsx): provado pela API (novo:false) e pela regra pura
    R.aviso("20/estado pedido_existente: o <p data-estado=\"pedido_existente\"> só é renderizado no navegador depois do clique (componente de cliente). Provado aqui: a resposta da API que o dispara (novo:false) e a regra estadoDoPedido(false) lida no fonte.");
    const est = fs.readFileSync(path.join(C.WEB, "src/lib/admin/estado-tela.ts"), "utf8");
    R.checa(/estadoDoPedido = \(novo: boolean\)[^=]*=> \(novo \? "pedido_novo" : "pedido_existente"\)/.test(est), "regra estadoDoPedido: novo=false -> pedido_existente (fonte)");
    R.checa(C.sql(C.BANCO_C7, `select jsonb_typeof(parametros) from adm_pedidos where id = '${p1.json?.id}'`) === "object", "o pedido gravado pela central tem `parametros` jsonb do tipo object (como o da CLI)", `jsonb_typeof = ${C.sql(C.BANCO_C7, `select jsonb_typeof(parametros) from adm_pedidos where id = '${p1.json?.id}'`)}`);
    // o pedido tem de ser consumido ANTES do retrato do critério 22 (a recoleta roda uma rodada e mexe em sapl_*, adm_vinculos, data_coverage)
    let dren = C.esvaziarFila(C.BANCO_C7);
    const okApi = dren.vazia && dren.feitos.length === 1 && dren.feitos[0].tipo === "recoleta" && dren.feitos[0].status === "concluido";
    R.checa(okApi, `o executor consome o pedido de recoleta gravado pela central (${dren.feitos.map((f) => `${f.tipo}:${f.status}${f.erro ? " erro=" + f.erro : ""}`).join(", ")}) e a fila esvazia`);
    if (!okApi) {
      R.aviso("DEFEITO (ver FALHOU acima): o pedido da central não é executável. Para seguir provando o resto, repito o pedido de recoleta pela CLI (parâmetros jsonb corretos) e o executor o consome.");
      const cl = C.cli(C.BANCO_C7, ["admin", "pedido", "recoleta", "--classe", "vinculo_sapl", "--ibge", casas.AM[1], "--nivel", "uf", "--json"]);
      R.checa(cl.json?.novo === true, "pedido de recoleta pela CLI entra como novo (o da central já terminou como falhou)", JSON.stringify(cl.json));
      dren = C.esvaziarFila(C.BANCO_C7);
      R.checa(dren.vazia && dren.feitos.length === 1 && dren.feitos[0].status === "concluido", `o executor consome o pedido da CLI (${dren.feitos.map((f) => `${f.tipo}:${f.status}${f.erro ? " erro=" + f.erro : ""}`).join(", ")})`);
    }
    const relRecoleta = dren.feitos[0]?.rodada_id;
    R.checa(!!relRecoleta, `a recoleta abriu a rodada ${relRecoleta}`);

    // ---- 22
    R.cabecalho("critério 22: pedido de parecer com as duas chaves desligadas não altera nenhuma tabela de domínio");
    const pendAbertas = C.sqlLinhas(C.BANCO_C7, "select id from adm_pendencias where status = 'aberta' and classe = 'vinculo_sapl' and campo = 'status' order by registro_chave");
    R.checa(pendAbertas.length >= 1, `há pendência aberta para pedir parecer (${pendAbertas.length})`);
    const pendParecer = pendAbertas[0][0];
    const ensaio22 = async (rotulo, criar) => {
      const antes = retrato();
      const contAntes = C.sql(C.BANCO_C7, "select (select count(*) from adm_decisoes) || '|' || (select count(*) from adm_overrides) || '|' || (select count(*) from corrections) || '|' || (select count(*) from adm_pareceres)");
      R.info(`[${rotulo}] retrato antes: ${Object.keys(antes).length} tabelas (todas do schema public menos ${FORA_DO_RETRATO.join(", ")}); decisões|overrides|corrections|pareceres = ${contAntes}`);
      const novos = await criar();
      R.checa(novos, `[${rotulo}] pedidos de parecer de uma pendência e de uma rodada gravados na fila`);
      const d2 = C.esvaziarFila(C.BANCO_C7);
      const ok = d2.vazia && d2.feitos.length === 2 && d2.feitos.every((f) => f.tipo === "parecer" && f.status === "concluido");
      R.checa(ok, `[${rotulo}] o executor (--uma-vez, até esvaziar) processou ${d2.feitos.length} pedidos: ${d2.feitos.map((f) => `${f.tipo}:${f.status}${f.erro ? " erro=" + f.erro : ""}`).join(", ")}`);
      const depois = retrato();
      const mudou = Object.keys({ ...antes, ...depois }).filter((k) => antes[k] !== depois[k]);
      R.checa(mudou.length === 0, `[${rotulo}] retrato depois idêntico em ${Object.keys(depois).length} tabelas (contagem e md5 do conteúdo ordenado)`, `mudaram: ${mudou.map((k) => `${k} ${antes[k]} -> ${depois[k]}`).join("; ")}`);
      const contDepois = C.sql(C.BANCO_C7, "select (select count(*) from adm_decisoes) || '|' || (select count(*) from adm_overrides) || '|' || (select count(*) from corrections) || '|' || (select count(*) from adm_pareceres)");
      const [dA, oA, cA, pA] = contAntes.split("|").map(Number), [dD, oD, cD, pD] = contDepois.split("|").map(Number);
      R.checa(dD === dA && oD === oA && cD === cA, `[${rotulo}] nenhuma decisão, override ou correction nova (${contAntes} -> ${contDepois})`);
      const bom = R.checa(pD > pA && C.sql(C.BANCO_C7, "select count(*) from adm_pareceres where simulado is not true") === "0", `[${rotulo}] adm_pareceres ganhou ${pD - pA} linha(s) e todas têm simulado = true`);
      return bom && ok;
    };
    const viaApi = await ensaio22("pedido gravado pela central", async () => {
      const pa = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "parecer", parametros: { pendencia_id: pendParecer } } });
      const pb = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "parecer", parametros: { rodada_id: rod.v2 } } });
      return pa.json?.novo === true && pb.json?.novo === true;
    });
    if (!viaApi) {
      R.aviso("DEFEITO (ver FALHOU acima): os pedidos da central não executam, então o retrato acima é vazio de significado. Repito o critério 22 com pedidos criados pela CLI (admin pedido parecer), que o executor consome de fato.");
      await ensaio22("pedido criado pela CLI", async () => {
        const a = C.cli(C.BANCO_C7, ["admin", "pedido", "parecer", "--pendencia", pendParecer, "--json"]);
        const b = C.cli(C.BANCO_C7, ["admin", "pedido", "parecer", "--rodada", rod.v2, "--json"]);
        return a.json?.novo === true && b.json?.novo === true;
      });
    }

    // ---- identidade: `por` ignorado (decide a pendência de AM, sem aplicar; o executor consome)
    await identidade(base, PEND_AM);

    // ---- estados que mexem em rodadas e pedidos (por último)
    R.cabecalho("estados de tela montados pelos mecanismos existentes");
    const ab = C.simulado(C.BANCO_C7, "v2", ["admin", "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "PB", "--json"]);
    const rAberta = ab.json?.rodada_id;
    R.checa(ab.rc === 0 && rAberta && C.sql(C.BANCO_C7, `select status from adm_rodadas where id = '${rAberta}'`) === "aberta", `rodada aberta e não executada (admin rodada abrir sem --executar): ${rAberta}`, ab.err.slice(-300));
    await espera(R, base, `/admin?rodada=${rAberta}`, ["rodada_em_andamento"], "rodada aberta (em andamento), totais parciais");
    const ab2 = C.simulado(C.BANCO_C7, "v2", ["admin", "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "AM", "--json"]);
    const rInt = ab2.json?.rodada_id;
    let montou = false;
    if (rInt) {
      try {
        C.sql(C.BANCO_C7, `update adm_rodadas set status = 'em_andamento' where id = '${rInt}'`); // executor "morto": a rodada ficou em_andamento sem trava
        const rec = C.cli(C.BANCO_C7, ["admin", "rodada", "recuperar", rInt, "--json"]);
        montou = rec.rc === 0 && C.sql(C.BANCO_C7, `select status from adm_rodadas where id = '${rInt}'`) === "interrompida";
        R.checa(montou, `rodada interrompida montada por \`admin rodada recuperar\` (em_andamento sem trava -> interrompida): ${rInt}`, `rc ${rec.rc} ${rec.err.slice(-300)}`);
      } catch (e) { R.falha(`montar rodada interrompida: ${e.message.split("\n")[0]}`); }
    } else R.falha("abrir a rodada a interromper");
    if (montou) await espera(R, base, `/admin?rodada=${rInt}`, ["rodada_interrompida"], "rodada interrompida (pede Repetir)");
    const lista = await get(base, "/admin/rodadas");
    R.checa(["rodada_concluida", "rodada_em_andamento", "rodada_interrompida"].every((e) => lista.estados.includes(e)), "lista de rodadas mostra os três estados de rodada em cada item", `achados: [${lista.estados.join(", ")}]`);
    // executor parado: pedido na fila há mais de 60 s
    const pp = await C.http(base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "parecer", parametros: { pendencia_id: PEND_PB ?? pendParecer } } });
    let velho = false;
    try {
      C.sql(C.BANCO_C7, `update adm_pedidos set criado_em = now() - interval '5 minutes' where id = '${pp.json?.id}'`);
      velho = true;
    } catch (e) {
      R.aviso(`não deu para retroagir criado_em (${e.message.split("\n")[0]}); espero 65 s`);
      await C.esperar(65_000);
      velho = true;
    }
    R.checa(pp.json?.novo === true && velho, `pedido de parecer na fila com mais de 60 s (retroagido no banco ${C.BANCO_C7}): ${pp.json?.id}`);
    const par = await espera(R, base, `/admin?rodada=${rod.v2}`, ["executor_parado"], "executor parado com pedido velho na fila", { naoDeve: ["executor_ok"] });
    R.checa(/Executor parado/.test(par.texto) && /Tempo de espera/.test(C.semComentarios(par.texto)), "o bloco diz que o executor está parado e o tempo de espera");
    const apiEstado = await C.http(base, "/admin/api/estado");
    R.checa(apiEstado.status === 200 && apiEstado.json?.executor?.parado === true, "GET /admin/api/estado: executor.parado = true", `status ${apiEstado.status}`);
    const d3 = C.esvaziarFila(C.BANCO_C7);
    R.checa(d3.vazia, `o executor consome o pedido velho e a fila esvazia (${d3.feitos.map((f) => `${f.tipo}:${f.status}`).join(",")})`);
    await espera(R, base, `/admin?rodada=${rod.v2}`, ["executor_ok"], "executor volta a em dia depois de consumir a fila", { naoDeve: ["executor_parado"] });
    await centralAtiva.parar();
    centralAtiva = null;

    // ---- erro de leitura. No modo local a identidade (adm_admins) vem do banco: com o banco INALCANÇÁVEL a guarda não acha admin e responde 404 (fecha), então o estado erro_leitura
    // só ocorre com o banco de pé e a LEITURA falhando. Aqui: o role admin_central perde o `select` de toda tabela menos adm_admins e fica read-only (o POST falha ao gravar). Restaurado no finally.
    R.cabecalho("estado de erro de leitura (banco de pé, identidade ok, leitura negada: admin_central sem select fora de adm_admins e read-only)");
    const grantsTab = C.sqlLinhas(C.BANCO_C7, "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where n.nspname = 'public' and c.relkind = 'r' and a.grantee = 'admin_central'::regrole and a.privilege_type = 'SELECT' and c.relname <> 'adm_admins' order by 1").map((l) => l[0]);
    R.checa(grantsTab.length > 5, `o admin_central tem select em ${grantsTab.length} tabelas além de adm_admins (será revogado e devolvido)`);
    const ruim = await (async () => {
      try {
        C.sql(C.BANCO_C7, grantsTab.map((t) => `revoke select on public."${t}" from admin_central`).join("; ") + "; alter role admin_central set default_transaction_read_only = on");
        return await C.subirNext(C.envCentral(C.BANCO_C7));
      } catch (e) {
        C.sql(C.BANCO_C7, grantsTab.map((t) => `grant select on public."${t}" to admin_central`).join("; ") + "; alter role admin_central reset default_transaction_read_only");
        throw e;
      }
    })();
    centralAtiva = ruim;
    try {
      for (const p of ["/admin", `/admin/uf/${casas.AM[1]}`, "/admin/registros?uf=13", "/admin/fila", "/admin/rodadas"]) await espera(R, ruim.base, p, ["erro_leitura"], "leitura negada pelo banco", { naoDeve: ["vazio", "rodada_concluida"] });
      const e = await C.http(ruim.base, "/admin/api/estado");
      R.checa(e.status === 503 && !/postgres|ECONNREFUSED|admin_central|permission/i.test(e.texto), "GET /admin/api/estado: 503 sem detalhe técnico no corpo", `status ${e.status} ${e.texto.slice(0, 160)}`);
      const nPed = C.sql(C.BANCO_C7, "select count(*) from adm_pedidos");
      const e2 = await C.http(ruim.base, "/admin/api/pedidos", { metodo: "POST", corpo });
      R.checa(e2.status === 503 && C.sql(C.BANCO_C7, "select count(*) from adm_pedidos") === nPed, "POST /admin/api/pedidos: 503 (não finge que gravou) e nada gravado", `status ${e2.status} ${e2.texto.slice(0, 120)}`);
    } finally {
      await ruim.parar();
      centralAtiva = null;
      C.sql(C.BANCO_C7, grantsTab.map((t) => `grant select on public."${t}" to admin_central`).join("; ") + "; alter role admin_central reset default_transaction_read_only");
    }
    const aposGrants = C.sqlLinhas(C.BANCO_C7, "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where n.nspname = 'public' and c.relkind = 'r' and a.grantee = 'admin_central'::regrole and a.privilege_type = 'SELECT' and c.relname <> 'adm_admins' order by 1").map((l) => l[0]);
    R.checa(C.canonico(aposGrants) === C.canonico(grantsTab) && C.sql(C.BANCO_C7, "select count(*) from pg_db_role_setting where setrole = 'admin_central'::regrole") === "0", "grants do admin_central devolvidos como estavam (mesmas tabelas) e a configuração read-only removida");
    // banco INALCANÇÁVEL (porta local fechada), MODO LOCAL: a identidade não se resolve por falha de banco; a API diz 503 "Não foi possível ler o banco" (a tela mostra falha de banco, não
    // "sessão expirou") e a página sai com erro do servidor (500), nunca 200 nem 404 (AC-27). No modo produção a mesma falha fecha com 404 (não se sabe se quem pede é admin).
    const fora = await C.subirNext(C.envCentral(C.BANCO_C7, { ADMIN_DATABASE_URL: "postgres://admin_central:admin_central@127.0.0.1:1/admin_coleta_c7" }));
    try {
      const st = await Promise.all(["/admin", "/admin/fila", "/admin/api/estado"].map((p) => C.http(fora.base, p)));
      R.checa(st[0].status === 500 && st[1].status === 500 && st[2].status === 503 && /Não foi possível ler o banco/.test(st[2].texto), "banco inalcançável (porta fechada), modo local: páginas 500 e API 503 com \"Não foi possível ler o banco\" (nunca 404 \"sessão expirou\" nem 200)", st.map((x) => x.status).join(","));
      R.checa((await C.http(fora.base, "/")).status === 200, "o site público continua 200 com o banco da central fora do ar");
    } finally {
      await fora.parar();
    }

    // ---- controle positivo do 15: as mesmas rotas, com a central ligada, NÃO dão 404
    R.cabecalho("controle positivo do critério 15 (central ligada: as mesmas rotas existem no build)");
    const ligada = await C.subirNext(C.envCentral(C.BANCO_C7));
    centralAtiva = ligada;
    const ex = { classe: "vinculo_sapl", chave: casas.AM[0], rodada: rod.v2, id: rod.v2, uf: casas.AM[1] };
    const a = await varrer(ligada.base, dentro.filter((r) => !r.soProducao), ex);
    const entrada404 = await Promise.all(dentro.filter((r) => r.soProducao).map(async (r) => [urlDe(r, ex), (await C.http(ligada.base, urlDe(r, ex))).status]));
    R.checa(entrada404.length === 6 && entrada404.every(([, st]) => st === 404), `as páginas e as quatro APIs de entrada (${entrada404.map(([u]) => u).join(", ")}) respondem 404 no modo local (só existem no modo produção)`, entrada404.join(" "));
    const postEntrada = await Promise.all(dentro.filter((r) => r.soProducao && r.api).map(async (r) => [urlDe(r, ex), (await C.http(ligada.base, urlDe(r, ex), { metodo: "POST", corpo: { email: "a@b.co", code: "123456" } })).status]));
    R.checa(postEntrada.length === 4 && postEntrada.every(([, st]) => st === 404), "POST nas quatro APIs de entrada no modo local: 404 (exigirEntradaApi: só modo produção)", postEntrada.join(" "));
    const nao200 = a.filter((x) => x.m === "GET" && x.exportado && x.status !== 200);
    const post404 = a.filter((x) => x.m === "POST" && x.exportado && x.status === 404);
    R.checa(nao200.length === 0 && post404.length === 0, `${a.filter((x) => x.exportado).length} requisições (GET: 200; POST sem corpo válido: 400/403, nunca 404): todas as rotas respondem de fato com a central ligada`, [...nao200, ...post404].map((x) => `${x.m} ${x.u} -> ${x.status}`).join("; "));
    R.checa(a.filter((x) => x.m === "POST" && x.exportado).every((x) => [400, 403].includes(x.status)), "POST com corpo vazio é recusado (400 validação ou 403 origem), não aceito", a.filter((x) => x.m === "POST").map((x) => `${x.u} ${x.status}`).join(" "));
    for (const pg of ["/admin/fila", "/admin?visao=revisao", `/admin?visao=revisao&rodada=${rod.v2}`]) {
      const r = await get(ligada.base, pg);
      R.checa(r.status === 200 && !r.estados.includes("erro_leitura"), `com pendências abertas, a página ${pg} lê o banco sem cair em erro_leitura`, `status ${r.status}, data-estado [${r.estados.join(", ")}]`);
    }
    const post403 = await C.http(ligada.base, "/admin/api/pedidos", { metodo: "POST", corpo, cabecalhos: { origin: "http://evil.example" } });
    R.checa(post403.status === 403, "POST com Origin de outro host: 403 (recusarOrigemExterna)", `status ${post403.status}`);
    await adminDesativado(ligada.base);
    await ritmo(ligada.base);
    await ligada.parar();
    centralAtiva = null;
  } finally {
    if (centralAtiva) await centralAtiva.parar();
  }
  // deixa o banco sem pedido ativo (o --fluxo parte de uma fila vazia)
  const fim = C.esvaziarFila(C.BANCO_C7);
  R.info(`fila ao final: ${fim.vazia ? "vazia" : "NÃO esvaziou"}`);
}

// ================================================================== --fluxo

async function fluxo(banco) {
  R.info(`SIMULADO: fluxo da primeira rodada (passos 6 a 9) pela API da central, banco ${banco}. Executor da CLI sobre respostas fabricadas (cenário v2). Nada é aplicado às tabelas de domínio.`);
  R.checa(C.sql(banco, "select current_database()") === banco, `o banco conectado é ${banco}`);
  const fila0 = C.sql(banco, "select count(*) from adm_pedidos where status in ('na_fila','em_execucao')");
  R.checa(fila0 === "0", "fila de pedidos sem pedido ativo no começo", `há ${fila0} pedido(s) ativo(s): rode o executor (admin executor --uma-vez) ou recrie o banco`);
  if (R.falhas) return;
  const srv = await C.subirNext(C.envCentral(banco));
  try {
    const exec1 = (rotulo) => {
      const d = C.esvaziarFila(banco);
      R.checa(d.vazia && d.feitos.length >= 1 && d.feitos.every((f) => f.status === "concluido"), `executor (--uma-vez até esvaziar): ${d.feitos.map((f) => `${f.tipo}:${f.status}${f.erro ? " erro=" + f.erro : ""}`).join(", ") || "nada na fila"} [${rotulo}]`);
      return d;
    };
    // 1. pendência pelo mapa
    R.cabecalho("passo 1: pendência de coleta pelo mapa");
    const est = await C.http(srv.base, "/admin/api/estado");
    R.checa(est.status === 200 && est.json?.mapa, `GET /admin/api/estado: mapa com ${est.json?.mapa?.total} fichas; por UF (ibge): ${JSON.stringify(est.json?.mapa?.porUf)}`);
    const fila = await C.http(srv.base, "/admin/api/fila?classe=vinculo_sapl&limite=100");
    R.checa(fila.status === 200 && Array.isArray(fila.json), `GET /admin/api/fila?classe=vinculo_sapl responde 200 com a lista (${fila.json?.length ?? "sem lista"})`, `status ${fila.status} ${fila.texto.slice(0, 120)}`);
    const lerFila = async () => {
      const r = await C.http(srv.base, "/admin/api/fila?classe=vinculo_sapl&limite=100");
      if (r.status === 200 && Array.isArray(r.json)) return r.json;
      R.aviso(`a API da fila não respondeu (status ${r.status}); uso \`admin fila --json\` da CLI para seguir`);
      return C.cli(banco, ["admin", "fila", "--classe", "vinculo_sapl", "--json"]).json ?? [];
    };
    const itens = await lerFila();
    const mun = itens.find((p) => p.territorio?.nivel === "municipio");
    const alvo = mun ?? itens.find((p) => p.territorio);
    R.checa(!!alvo, `pendência escolhida: ${alvo ? `${alvo.rotulo} (${alvo.campo}, id ${alvo.id}, território ${alvo.territorio.nivel} ${alvo.territorio.ibge ?? alvo.territorio.ibge_code})` : "nenhuma"}`);
    if (!alvo) return;
    if (!mun) R.aviso("PREMISSA: a fixture sapl_ale só tem casas de UF (Assembleias); não há pendência de município na fila. Uso o território de UF da pendência. O município fabricado (1190099) não tem casa SAPL nem pendência.");
    const terr = { ibge: alvo.territorio.ibge ?? alvo.territorio.ibge_code, nivel: alvo.territorio.nivel };
    // /admin/api/estado só conta por UF: para pendência de município, mede a UF que o contém. A contagem do PRÓPRIO município no mapa da UF é
    // desenhada no navegador (malha buscada no cliente) e só o Playwright a prova (AC-05).
    const ufDoTerr = String(terr.ibge).slice(0, 2);
    const mapaVe = est.json?.mapa?.porUf?.[ufDoTerr];
    R.checa(typeof mapaVe === "number" && mapaVe >= 1, `o mapa do país conta ${mapaVe} ficha(s) na UF ${ufDoTerr} do território ${terr.nivel} ${terr.ibge}`);
    if (terr.nivel === "municipio") R.aviso(`contagem do município ${terr.ibge} no mapa da UF: não medida sem navegador (só o Playwright prova)`);

    // 2. recoleta
    R.cabecalho("passo 2: recoleta das fichas pendentes do território");
    const rec = await C.http(srv.base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "recoleta", parametros: { classe: alvo.classe, territorio: terr } } });
    R.checa(rec.status === 200 && rec.json?.novo === true, `POST recoleta ${alvo.classe} ${terr.nivel} ${terr.ibge}: id ${rec.json?.id}`, `${rec.status} ${rec.texto.slice(0, 160)}`);
    const d1 = exec1("recoleta");
    R.checa(!!d1.feitos[0]?.rodada_id, `a recoleta abriu e executou a rodada ${d1.feitos[0]?.rodada_id}`);
    const alvo2 = (await lerFila()).find((p) => p.registro_chave === alvo.registro_chave && p.campo === alvo.campo);
    R.checa(!!alvo2, `a pendência do mesmo registro e campo continua na fila depois da recoleta (id ${alvo2?.id}${alvo2?.id === alvo.id ? ", o mesmo" : ", MUDOU: " + alvo.id + " -> " + alvo2?.id})`);
    if (!alvo2) return;
    const pend = alvo2.id;

    // 3. parecer
    R.cabecalho("passo 3: parecer de ensaio da pendência");
    const nPar0 = Number(C.sql(banco, `select count(*) from adm_pareceres where pendencia_id = '${pend}'`));
    const par = await C.http(srv.base, "/admin/api/pedidos", { metodo: "POST", corpo: { tipo: "parecer", parametros: { pendencia_id: pend } } });
    R.checa(par.status === 200 && par.json?.novo === true, `POST parecer: id ${par.json?.id}`, `${par.status} ${par.texto.slice(0, 160)}`);
    exec1("parecer");
    R.checa(Number(C.sql(banco, `select count(*) from adm_pareceres where pendencia_id = '${pend}'`)) === nPar0 + 1 && C.sql(banco, `select bool_and(simulado) from adm_pareceres where pendencia_id = '${pend}'`) === "t", "o parecer foi gravado em adm_pareceres com simulado = true");

    // 4. decisão (aprovar, sem aplicar)
    R.cabecalho("passo 4: pedido de decisão (aprovar, sem aplicar)");
    const just = "conferi a evidência da proposta (resposta fabricada, ensaio SIMULADO); não aplicar";
    const nDec0 = C.sql(banco, "select count(*) from adm_decisoes");
    const nOvr0 = C.sql(banco, "select count(*) from adm_overrides");
    const nCor0 = C.sql(banco, "select count(*) from corrections");
    const dec = await C.http(srv.base, "/admin/api/decisoes", { metodo: "POST", corpo: { pendencia_id: pend, acao: "aprovar", justificativa: just, aplicar: false } });
    R.checa(dec.status === 200 && dec.json?.novo === true, `POST decisão: id do pedido ${dec.json?.id}`, `${dec.status} ${dec.texto.slice(0, 200)}`);
    R.checa(C.sql(banco, "select count(*) from adm_decisoes") === nDec0, "antes do executor não existe decisão: a central só gravou o PEDIDO (AC-19)");
    exec1("decisão");

    // 5. confere pela CLI e pelo SQL
    R.cabecalho("passo 5: a decisão lida pela CLI é a que a API pediu, como pessoa");
    const cl = C.cli(banco, ["admin", "pendencia", pend, "--json"]);
    const decs = cl.json?.decisoes ?? [];
    const d = decs[decs.length - 1];
    R.checa(cl.rc === 0 && decs.length === 1 && d, `admin pendencia ${pend} --json traz exatamente 1 decisão`, `rc ${cl.rc}, ${decs.length} decisões: ${JSON.stringify(cl.json)?.slice(0, 300)}`);
    const por = d?.decidido_por_tipo ?? d?.por_tipo ?? d?.por?.tipo;
    const nome = d?.decidido_por_nome ?? d?.por_nome ?? d?.por?.nome;
    R.checa(d?.acao === "aprovar" && por === "pessoa" && nome === OPERADOR && d?.aplicada === false && (d?.justificativa ?? just) === just, `CLI: acao=${d?.acao}, por tipo=${por}, nome="${nome}", aplicada=${d?.aplicada}`, JSON.stringify(d)?.slice(0, 300));
    const l = C.sqlLinhas(banco, `select acao, decidido_por_tipo, decidido_por_nome, aplicada, justificativa from adm_decisoes where pendencia_id = '${pend}'`);
    R.checa(l.length === 1 && l[0].join("|") === `aprovar|pessoa|${OPERADOR}|f|${just}`, "SQL em adm_decisoes: aprovar|pessoa|nome|aplicada=false|justificativa, exatamente como pedido pela API", JSON.stringify(l));
    R.checa(C.sql(banco, "select count(*) from adm_decisoes where decidido_por_tipo = 'agentes'") === "0", "nenhuma decisão de agentes");
    const fl = C.cli(banco, ["admin", "fila", "--json"]);
    const aindaNaFila = (fl.json ?? []).some((p) => p.id === pend);
    R.info(`admin fila: a pendência ${aindaNaFila ? "AINDA está" : "não está mais"} na fila aberta (status no banco: ${C.sql(banco, `select status from adm_pendencias where id = '${pend}'`)})`);
    R.checa(C.sql(banco, "select count(*) from adm_pedidos where status in ('na_fila','em_execucao')") === "0" && C.sql(banco, "select count(*) from adm_pedidos_decisao where status in ('na_fila','em_execucao')") === "0", "fila de pedidos vazia no fim");
    R.checa(C.sql(banco, "select count(*) from adm_overrides") === nOvr0 && C.sql(banco, "select count(*) from corrections") === nCor0, `sem aplicação: adm_overrides (${nOvr0}) e corrections (${nCor0}) não mudaram`);
  } finally {
    await srv.parar();
  }
}

// ================================================================== main

function gravarResumo() {
  const arq = path.join(C.EVID, "central-sem-navegador.txt");
  const cab = [
    "SIMULADO. Provas da central de coleta SEM navegador (C7), pelo HTTP de um `next start` local. Rodadas SIMULADAS: CLI real sobre respostas fabricadas (etl/tests/fixtures/sapl_ale).",
    `Gerado por: node web/e2e-admin/sem-navegador.mjs ${process.argv.slice(2).join(" ")}  em ${new Date().toISOString()}  (banco ${C.BANCO_C7}, recriado)`,
    "Nenhum número daqui foi lido de fonte real. O Playwright não roda neste ambiente (AC-05): critérios 21 e 26 NÃO são cobertos por este arquivo.",
    "",
  ];
  const rodape = ["", `resultado: ${R.falhas === 0 ? "tudo passou" : `${R.falhas} verificação(ões) FALHOU`}  (${((Date.now() - T0) / 1000).toFixed(0)} s)`];
  fs.mkdirSync(C.EVID, { recursive: true });
  fs.writeFileSync(arq, [...cab, ...R.linhas, ...rodape].join("\n") + "\n");
  console.log(`\nresumo gravado em ${path.relative(C.RAIZ, arq)}`);
}

(async () => {
  try {
    if (C.temFlag("--fluxo")) {
      const banco = C.valorFlag("--banco");
      if (!banco || !["admin_coleta_r1", "admin_coleta_c7"].includes(banco)) {
        console.error("--fluxo exige --banco admin_coleta_r1 ou --banco admin_coleta_c7");
        process.exit(2);
      }
      await fluxo(banco);
    } else {
      await completo();
      gravarResumo();
    }
  } catch (e) {
    R.falha(`exceção: ${e.stack?.split("\n").slice(0, 4).join(" | ") ?? e}`);
  }
  console.log(`\n${R.falhas === 0 ? "RESULTADO: tudo passou" : `RESULTADO: ${R.falhas} FALHOU`} (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(R.falhas === 0 ? 0 : 1);
})();
