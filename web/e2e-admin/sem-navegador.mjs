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
const OPERADOR = "Operador de Ensaio (SIMULADO)";

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
        const naoUsados = new Set([...src.matchAll(/export function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(\) \{\s*const negado = exigirAdminApi\(\);\s*if \(negado\) return negado;\s*return new Response\(null, \{ status: 405 \}\);/g)].map((m) => m[1]));
        const metodos = api ? [...src.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]).filter((m) => !naoUsados.has(m)) : ["GET"];
        rotas.push({ arquivo: path.relative(C.WEB, p), seg, api, metodos, foraDoGrupo: !dentro });
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

// ================================================================== o modo completo

async function completo() {
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
  if (R.falhas) return;

  // ---- banco
  R.cabecalho("banco");
  const nMig = C.recriarC7();
  R.ok(`banco ${C.BANCO_C7} recriado, ${nMig} migrações aplicadas (db/migrate.sh --local), semente e base mínima carregadas (base.sql, admin_base.sql)`);
  R.checa(C.sql(C.BANCO_C7, "select current_database() || '|' || (select count(*) from adm_rodadas) || '|' || (select count(*) from adm_pedidos)") === `${C.BANCO_C7}|0|0`, "banco vazio de rodadas e pedidos");
  R.checa(C.sql(C.BANCO_C7, "select rolcanlogin from pg_roles where rolname = 'admin_central'") === "t", "o role admin_central tem login (post_0003, só local)");

  await criterio15(rotas, extras);

  // ---- central ligada
  const central = await C.subirNext(C.envCentral(C.BANCO_C7));
  const base = central.base;
  let centralAtiva = central;
  try {
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

    // ---- erro de leitura: ADMIN_DATABASE_URL local numa porta fechada
    R.cabecalho("estado de erro de leitura (ADMIN_DATABASE_URL apontando para porta local fechada)");
    const ruim = await C.subirNext(C.envCi({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: "postgres://admin_central:admin_central@127.0.0.1:1/admin_coleta_c7" }));
    centralAtiva = ruim;
    try {
      for (const p of ["/admin", `/admin/uf/${casas.AM[1]}`, "/admin/registros?uf=13", "/admin/fila", "/admin/rodadas"]) await espera(R, ruim.base, p, ["erro_leitura"], "banco inalcançável", { naoDeve: ["vazio", "rodada_concluida"] });
      const e = await C.http(ruim.base, "/admin/api/estado");
      R.checa(e.status === 503 && !/postgres|ECONNREFUSED|admin_central/i.test(e.texto), "GET /admin/api/estado: 503 sem detalhe técnico no corpo", `status ${e.status} ${e.texto.slice(0, 160)}`);
      const e2 = await C.http(ruim.base, "/admin/api/pedidos", { metodo: "POST", corpo });
      R.checa(e2.status === 503, "POST /admin/api/pedidos: 503 (não finge que gravou)", `status ${e2.status} ${e2.texto.slice(0, 120)}`);
    } finally {
      await ruim.parar();
      centralAtiva = null;
    }

    // ---- controle positivo do 15: as mesmas rotas, com a central ligada, NÃO dão 404
    R.cabecalho("controle positivo do critério 15 (central ligada: as mesmas rotas existem no build)");
    const ligada = await C.subirNext(C.envCentral(C.BANCO_C7));
    centralAtiva = ligada;
    const ex = { classe: "vinculo_sapl", chave: casas.AM[0], rodada: rod.v2, id: rod.v2, uf: casas.AM[1] };
    const a = await varrer(ligada.base, dentro, ex);
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
    const dec = await C.http(srv.base, "/admin/api/decisoes", { metodo: "POST", corpo: { pendencia_id: pend, acao: "aprovar", por: OPERADOR, justificativa: just, aplicar: false } });
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
