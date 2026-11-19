#!/usr/bin/env node
// SIMULADO (banco de ensaio). Critério 23 (AC-23: hosts permitidos): modo local, nenhum host externo; modo produção, só a própria origem, challenges.cloudflare.com (Turnstile, na entrada)
// e, do lado do servidor, o e-mail do código de entrada (Resend) e a conferência do Turnstile (D335). Sem navegador: varredura estática do fonte e,
// com a central ligada num `next start` local, do HTML de cada página e de TODO recurso que ele referencia (js e css de /_next/static, mais os
// chunks que o app-build-manifest lista para as páginas da central), à procura de host externo usado como recurso.
//
//   cd web && node e2e-admin/sem-rede-externa.mjs [--sem-build]
//
// Banco: reaproveita `admin_coleta_c7` se ele já tem rodadas simuladas (feitas por sem-navegador.mjs); senão o recria e prepara. Só localhost.
import fs from "node:fs";
import path from "node:path";
import * as C from "./comum.mjs";

const R = C.criarRelato();
const T0 = Date.now();

// ================================================================== 1. varredura estática do fonte

// Inclui o que a central usa na ENTRADA (AC-23): components/admin-entrada, o widget Turnstile (components/account/turnstile.tsx, o mesmo do site) e o middleware.
const DIRS = ["src/app/(admin)", "src/lib/admin", "src/components/admin", "src/components/admin-entrada"];
const ARQS = ["src/styles/admin.css", "src/middleware.admin.ts", "src/app/layout.admin.tsx", "src/app/not-found.admin.tsx", "src/components/account/turnstile.tsx"];
// Hosts externos aceitos no FONTE (critério 23, AC-23; D335): o Turnstile da Cloudflare (a CSP o cita; o widget o carrega; o servidor confere o token) e a API de e-mail do Resend,
// esta só em lib/admin/provedores.ts, chamada só pelo servidor. A central não usa o Supabase. A própria origem da central (admin.segueovoto.com.br) é constante de guarda, não é requisição.
const HOST_TURNSTILE = "challenges.cloudflare.com";
const ARQS_COM_TURNSTILE = ["src/lib/admin/cabecalhos.ts", "src/components/account/turnstile.tsx", "src/lib/admin/provedores.ts"];
const SAIDA = "src/lib/admin/provedores.ts";
const URLS_DA_SAIDA = ["https://api.resend.com/emails", `https://${HOST_TURNSTILE}/turnstile/v0/siteverify`];
const HOSTS_PROPRIOS = /^(?:admin\.)?segueovoto\.com\.br$/;
function arquivos() {
  const lista = [];
  for (const d of DIRS) (function anda(x) { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) anda(p); else lista.push(p); } })(path.join(C.WEB, d));
  for (const a of ARQS) lista.push(path.join(C.WEB, a));
  return lista;
}
const rel = (p) => path.relative(C.WEB, p);

function estatica() {
  R.cabecalho("1. varredura estática do fonte (src/app/(admin), src/lib/admin, src/components/admin, src/styles/admin.css)");
  const lista = arquivos();
  R.info(`${lista.length} arquivos varridos`);
  const achados = [];
  const regras = [
    ["URL absoluta (http, https, ws, wss)", /\b(?:https?|wss?):\/\/[^\s"'`)<>]*/g],
    ["URL relativa ao protocolo (//host)", /(?:["'`(=]\s*)\/\/[a-z0-9-]+\.[a-z]{2,}[^\s"'`)]*/gi],
    ["<script src", /<script[^>]*\bsrc\s*=/gi],
    ["<link href externo", /<link[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//gi],
    ["@import", /@import\b/g],
    ["url( com host ou data externa em CSS/estilo", /\burl\(\s*["']?(?!#)(?!\/)(?!data:)[^)]+\)/g],
    ["@font-face", /@font-face/gi],
    ["next/font", /next\/font/g],
    ["<img>, <iframe>, <video>, <audio>, <source>, <embed>, <object>, next/image", /<(?:img|iframe|video|audio|source|embed|object)\b|next\/image/gi],
    ["WebSocket, EventSource, XMLHttpRequest, sendBeacon, importScripts, new Worker", /\b(?:WebSocket|EventSource|XMLHttpRequest|sendBeacon|importScripts|new\s+Worker)\b/g],
    ["import() dinâmico com literal", /\bimport\(\s*["'`]/g],
    ["host sem esquema (domínio com TLD) em texto de código", /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|org|net|io|dev|app|gov|edu|co|ai|cloud)\b/gi],
  ];
  for (const f of lista) {
    const t = fs.readFileSync(f, "utf8");
    for (const [nome, re] of regras) for (const m of t.matchAll(re)) {
      const linha = t.slice(0, m.index).split("\n").length;
      achados.push({ arquivo: rel(f), linha, regra: nome, trecho: m[0].trim().slice(0, 100) });
    }
  }
  // justificativas EXATAS (arquivo + regra + trecho); qualquer achado fora delas falha
  const justificativas = [
    // Turnstile: só em cabecalhos.ts (a CSP o cita) e no widget; a URL do script e o <Script src> são do widget
    ...ARQS_COM_TURNSTILE.map((arquivo) => ({ arquivo, regra: "host sem esquema (domínio com TLD) em texto de código", trecho: HOST_TURNSTILE })),
    { arquivo: "src/components/account/turnstile.tsx", regra: "URL absoluta (http, https, ws, wss)", trecho: `https://${HOST_TURNSTILE}/turnstile/v0/api.js` },
    { arquivo: "src/components/account/turnstile.tsx", regra: "<script src", trecho: "<Script src=" },
    // D335: as duas saídas do SERVIDOR da central (e-mail do código e conferência do captcha), só em provedores.ts
    ...URLS_DA_SAIDA.map((trecho) => ({ arquivo: SAIDA, regra: "URL absoluta (http, https, ws, wss)", trecho })),
    { arquivo: SAIDA, regra: "host sem esquema (domínio com TLD) em texto de código", trecho: "api.resend.com" },
    // a própria origem da central e o alias que a guarda RECUSA (texto de comentário e de constante, nunca requisição)
    ...["src/lib/admin/guarda-regra.ts", "src/lib/admin/cabecalhos.ts", "src/middleware.admin.ts", "src/app/(admin)/layout.admin.tsx"].flatMap((arquivo) => ["admin.segueovoto.com.br", "segueovoto.com.br"].map((trecho) => ({ arquivo, regra: "host sem esquema (domínio com TLD) em texto de código", trecho }))),
    { arquivo: "src/lib/admin/guarda-regra.ts", regra: "host sem esquema (domínio com TLD) em texto de código", trecho: "vercel.app" },
  ];
  const nao = achados.filter((a) => !justificativas.some((j) => j.arquivo === a.arquivo && j.regra === a.regra && a.trecho.includes(j.trecho)));
  for (const a of achados) R.info(`achado${nao.includes(a) ? "" : " (justificado)"}: ${a.arquivo}:${a.linha} [${a.regra}] ${a.trecho}`);
  R.checa(nao.length === 0, `nenhuma URL absoluta, <script src>, <link href> externo, @import, fonte, imagem ou conexão (WebSocket, XHR, beacon) no fonte da central (${achados.length} achados, ${nao.length} sem justificativa)`, nao.map((a) => `${a.arquivo}:${a.linha} ${a.trecho}`).join("; "));

  // challenges.cloudflare.com: dentro da central (as pastas varridas e o middleware), só em cabecalhos.ts e no widget; e nenhum arquivo da central importa lib/captcha.ts
  // (D335: a central confere o token do Turnstile no próprio servidor, em provedores.ts, sem importar o módulo do site)
  const comTurnstile = lista.filter((f) => /\.(tsx?|css|mjs|js)$/.test(f) && fs.readFileSync(f, "utf8").includes(HOST_TURNSTILE)).map(rel);
  R.checa(comTurnstile.length > 0 && comTurnstile.every((f) => ARQS_COM_TURNSTILE.includes(f)), `${HOST_TURNSTILE} aparece, nos arquivos da central, só em ${ARQS_COM_TURNSTILE.join(" e ")} (achados: ${comTurnstile.join(", ")})`);
  const usaCaptcha = lista.filter((f) => /\.(tsx?|mjs|js)$/.test(f) && /lib\/captcha|verifyCaptcha/.test(fs.readFileSync(f, "utf8"))).map(rel);
  R.checa(usaCaptcha.length === 0, "nenhum arquivo da central usa lib/captcha.ts (a central tem a própria conferência, em provedores.ts)", usaCaptcha.join(", "));
  const hostSupabase = [];
  for (const f of lista.filter((x) => /\.(tsx?|mjs|js)$/.test(x))) if (/supabase\.(?:co|com|in)\b|@supabase\/|NEXT_PUBLIC_SUPABASE/i.test(fs.readFileSync(f, "utf8"))) hostSupabase.push(rel(f));
  R.checa(hostSupabase.length === 0, "D335: nenhum host, pacote ou variável do Supabase no fonte da central (o login é próprio, em Postgres)", hostSupabase.join(", "));
  // fetch: todo primeiro argumento tem de ser relativo (literal que começa por "/") ou um identificador cuja origem é provada
  const chamadas = [];
  for (const f of lista.filter((x) => /\.(tsx?|mjs|js)$/.test(x))) {
    const t = fs.readFileSync(f, "utf8");
    for (const m of t.matchAll(/\bfetch\(\s*([^,)\n]+)/g)) chamadas.push({ arquivo: rel(f), linha: t.slice(0, m.index).split("\n").length, arg: m[1].trim() });
  }
  R.info(`chamadas fetch( no fonte da central: ${chamadas.length}`);
  for (const c of chamadas) R.info(`  ${c.arquivo}:${c.linha} fetch(${c.arg}`);
  const literais = chamadas.filter((c) => /^["'`]/.test(c.arg));
  const idents = chamadas.filter((c) => !/^["'`]/.test(c.arg));
  R.checa(literais.every((c) => /^["'`]\//.test(c.arg) && !/^["'`]\/\//.test(c.arg)), "todo fetch com literal é relativo ao site (começa por uma barra, não por duas)", literais.map((c) => `${c.arquivo}:${c.linha} ${c.arg}`).join("; "));
  for (const c of idents) {
    let provado = false;
    let como = "";
    if (c.arquivo === SAIDA) {
      // D335: `fetch` do servidor, só para as duas constantes literais do próprio arquivo
      const t = fs.readFileSync(path.join(C.WEB, c.arquivo), "utf8");
      const consts = Object.fromEntries([...t.matchAll(/^const (URL_[A-Z]+) = "([^"]+)";$/gm)].map((m) => [m[1], m[2]]));
      provado = URLS_DA_SAIDA.includes(consts[c.arg]) && /^import "server-only";/.test(t);
      como = `${c.arg} = "${consts[c.arg]}" (constante literal; módulo server-only: o navegador nunca o executa)`;
    } else if (c.arg === "url" && c.arquivo.endsWith("mapa-admin.tsx")) {
      const t = fs.readFileSync(path.join(C.WEB, c.arquivo), "utf8");
      provado = /const url = nivel\.tipo === "pais" \? "\/geo\/br\.json" : `\/geo\/uf\/\$\{nivel\.uf\}\.json`;/.test(t);
      como = "url = \"/geo/br.json\" ou `/geo/uf/${uf}.json` (const url do componente), malhas do próprio repositório em web/public/geo";
    } else if (c.arg === "url" && c.arquivo.endsWith("formularios.tsx")) {
      // F3-C1: a entrada fala com a própria central por `postar(url, corpo)`; toda chamada passa um literal "/admin/api/entrar/..."
      const t = fs.readFileSync(path.join(C.WEB, c.arquivo), "utf8");
      const chamadas = [...t.matchAll(/\bpostar\(\s*([^,)]+)/g)].map((m) => m[1].trim()).filter((v) => v !== "url: string");
      provado = chamadas.length > 0 && chamadas.every((v) => /^["']\/admin\/api\/entrar\/[a-z/]+["']$/.test(v));
      como = `todo postar( recebe um literal "/admin/api/entrar/..." (${chamadas.length} chamadas: ${chamadas.join(", ")})`;
    } else if (c.arg === "endpoint" && c.arquivo.endsWith("enviar.ts")) {
      const usos = [];
      for (const f of lista.filter((x) => /\.tsx$/.test(x))) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bendpoint\s*[=:]\s*(\{?\s*[^\s}>]+)/g)) usos.push([rel(f), m[1]]);
      provado = usos.length > 0 && usos.every(([, v]) => /^\{?\s*["']\/admin\/api\//.test(v));
      como = `todo endpoint= nos componentes é literal "/admin/api/..." (${usos.length} usos: ${usos.map(([, v]) => v.replace(/[{\s]/g, "")).join(", ")})`;
    }
    R.checa(provado, `fetch(${c.arg}) em ${c.arquivo}:${c.linha} resolvido para caminho relativo: ${como || "não resolvido"}`);
  }
  // o mapa carrega só /geo (do repositório)
  R.checa(C.existe(path.join(C.WEB, "public", "geo", "br.json")) && C.existe(path.join(C.WEB, "public", "geo", "uf")), "as malhas /geo/br.json e /geo/uf/ existem em web/public (servidas pelo próprio site)");
}

// ================================================================== 2. dinâmica

const HOST = /\b(?:https?|wss?):\/\/[^\s"'`)<>\\,;]+/g;
// exceções JUSTIFICADAS, por padrão exato. Texto/namespace/comentário não é requisição.
const QUALQUER = /./;
const EXCECOES = [
  [/^http:\/\/www\.w3\.org\/2000\/svg$/, QUALQUER, "namespace XML do SVG (createElementNS e atributo xmlns): identificador, nunca buscado"],
  [/^http:\/\/www\.w3\.org\/1999\/xlink$/, QUALQUER, "namespace XML do xlink: identificador, nunca buscado"],
  [/^http:\/\/www\.w3\.org\/1998\/Math\/MathML$/, QUALQUER, "namespace XML do MathML dentro do react-dom: identificador, nunca buscado"],
  [/^http:\/\/www\.w3\.org\/XML\/1998\/namespace$/, QUALQUER, "namespace XML (xml:lang) dentro do react-dom: identificador, nunca buscado"],
  [/^https:\/\/react\.dev\/errors\/?[^\s]*$/, /^\/_next\/static\/chunks\//, "texto da mensagem de erro minificada do React (decodificador): só é exibida num console de erro, nunca é buscada"],
  [/^https:\/\/nextjs\.org\/docs\/[^\s]*$/, /^\/_next\/static\/chunks\//, "texto de mensagem de erro ou aviso do Next (link de documentação dentro de string): não é requisição"],
  // polyfill de URL do core-js que o Next embute (polyfills-*.js): casos de teste do parser, construídos em memória com `new URL(...)`; nenhum é buscado
  [/^https:\/\/(?:a|x|тест|a#б|a@b|a\/c%20d\?a=1&c=3)$/, /^\/_next\/static\/chunks\/polyfills-/, "caso de teste do polyfill de URL do core-js (new URL em memória para checar o parser): não é requisição"],
  [/^https:\/\/github\.com\/zloirock\/core-js(?:\/blob\/v[\d.]+\/LICENSE)?$/, /^\/_next\/static\/chunks\/polyfills-/, "texto do aviso de licença do core-js dentro do polyfill: não é requisição"],
  // CSS do Tailwind: comentário de licença /*! ... */ (removido antes da busca de recurso; listado aqui só como texto)
  [/^https:\/\/tailwindcss\.com$/, /^\/_next\/static\/css\//, "comentário de licença do Tailwind no topo do CSS: não é requisição"],
  // widget Turnstile (components/account/turnstile.tsx, client component): o chunk da página de entrada traz a URL do script como literal; é o host permitido (checado adiante: só nos chunks das páginas de entrada)
  [/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js$/, /^\/_next\/static\/chunks\//, "URL do script do Turnstile no widget (Script src): host permitido, só na página de entrada (conferido contra o app-build-manifest)"],
  // dados do banco exibidos COMO TEXTO nas páginas (URL da casa SAPL e da evidência da proposta): o HTML as escreve em texto, sem href/src (conferido na seção de referências)
  [/^https:\/\/sapl\.al\.[a-z]{2}\.leg\.br(?:\/[^\s]*)?$/, /^HTML /, "URL de fonte (casa SAPL ou evidência da proposta) vinda do banco e escrita como texto na ficha/rodada; o HTML não a usa como href nem src e a página não a busca"],
];
const justificativa = (u, onde = "") => EXCECOES.find(([re, reOnde]) => re.test(u) && reOnde.test(onde))?.[2] ?? null;

// uso de host externo COMO RECURSO em JS: nenhuma exceção possível
const USO_JS = [
  /\bfetch\(\s*["'`]\s*(?:https?:)?\/\/(?!127\.0\.0\.1)/g,
  /\.src\s*=\s*["'`]\s*(?:https?:)?\/\//g,
  /\.href\s*=\s*["'`]\s*https?:\/\//g,
  /\bnew\s+URL\(\s*["'`]https?:\/\/(?!localhost|example)/g,
  /\.open\(\s*["'][A-Z]+["']\s*,\s*["'`]https?:/g,
  /\bimportScripts\(/g,
  /\bsendBeacon\(\s*["'`]https?:/g,
  /\bnew\s+WebSocket\(\s*["'`]wss?:/g,
  /\bnew\s+EventSource\(/g,
  /\bimport\(\s*["'`]https?:/g,
];

function garantirBanco() {
  R.cabecalho("banco de ensaio");
  let reaproveita = false;
  try {
    // reaproveita só se o banco é da F3 (tem o admin local da 0156/post_0004) E já tem as rodadas simuladas
    reaproveita = C.bancoExiste(C.BANCO_C7) && C.sql(C.BANCO_C7, `select count(*) from adm_admins where email = '${C.ADMIN_LOCAL_EMAIL}' and ativo`) === "1" && Number(C.sql(C.BANCO_C7, "select count(*) from adm_rodadas where status = 'concluida'")) >= 2;
  } catch {}
  if (reaproveita) R.ok(`reaproveita ${C.BANCO_C7}: já tem rodadas SIMULADAS concluídas`);
  else {
    R.info(`${C.BANCO_C7} ausente ou sem rodadas: recriando e preparando (rodadas SIMULADAS)`);
    C.recriarC7();
    C.prepararRodadas();
    R.ok(`${C.BANCO_C7} recriado, com rodadas v1 e v2 SIMULADAS`);
  }
  return {
    rodada: C.sql(C.BANCO_C7, "select id from adm_rodadas where status = 'concluida' order by iniciada_em desc, id limit 1"),
    casaComProposta: C.sql(C.BANCO_C7, "select registro_chave from adm_pendencias where classe = 'vinculo_sapl' order by criada_em, id limit 1"),
    casa: C.sql(C.BANCO_C7, "select h.id || ',' || p.ibge_code from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' order by h.id limit 1").split(","),
  };
}

function paginasDaCentral() {
  const raiz = path.join(C.WEB, "src", "app", "(admin)");
  const out = [];
  (function anda(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) anda(p);
      else if (e.name === "page.admin.tsx") out.push("/" + path.relative(raiz, d).split(path.sep).filter((s) => !/^\(.*\)$/.test(s)).join("/"));
    }
  })(raiz);
  return out;
}

const refsDoHtml = (h) => {
  const refs = [];
  const add = (tipo, v) => v && refs.push({ tipo, v });
  for (const m of h.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add("script", m[1]);
  for (const m of h.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*/gi)) add("link", m[1]);
  for (const m of h.matchAll(/<(?:img|iframe|source|video|audio|embed|track)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add("media", m[1]);
  for (const m of h.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) add("srcset", m[1]);
  for (const m of h.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) add("a", m[1]);
  for (const m of h.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi)) add("form", m[1]);
  for (const m of h.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["']([^"']+)["']/gi)) add("refresh", m[1]);
  for (const m of h.matchAll(/<style\b[^>]*>(.*?)<\/style>/gis)) for (const u of m[1].matchAll(/url\(\s*["']?([^)"']+)/g)) add("css-inline", u[1]);
  for (const m of h.matchAll(/\bstyle\s*=\s*["']([^"']*url\([^"']*)["']/gi)) add("style-attr", m[1]);
  return refs;
};
const ehExterno = (v) => /^(?:https?:)?\/\//i.test(v.trim()) || /^(?:wss?|ftp):/i.test(v.trim());

async function dinamica(ctx, estaticosDoManifest) {
  R.cabecalho("2. central ligada: HTML de cada página e todo recurso que ele referencia");
  const srv = await C.subirNext(C.envCentral(C.BANCO_C7));
  try {
    const paginas = paginasDaCentral().map((p) => p.replace("[classe]", "vinculo_sapl").replace("[chave]", ctx.casa[0]).replace("[id]", ctx.rodada).replace("[uf]", ctx.casa[1]));
    const alvos = [...paginas, `/admin?visao=revisao&rodada=${ctx.rodada}`, `/admin/uf/${ctx.casa[1]}?visao=revisao`, `/admin/registros?uf=${ctx.casa[1]}`, `/admin/registros?uf=${ctx.casa[1]}&municipio=1190099`, ...(ctx.casaComProposta ? [`/admin/ficha/vinculo_sapl/${ctx.casaComProposta}`] : [])];
    R.info(`páginas (do sistema de arquivos, com parâmetros reais do banco): ${paginas.join("  ")}`);
    const recursos = new Map(); // caminho -> de onde veio
    const achadosHost = new Map(); // url -> {onde: Set}
    const externosEmRef = [];
    const lerTexto = (onde, texto) => {
      for (const u of new Set(texto.match(HOST) ?? [])) {
        const e = achadosHost.get(u) ?? new Set();
        e.add(onde);
        achadosHost.set(u, e);
      }
    };
    for (const p of alvos) {
      if (p === "/admin/entrar" || p === "/admin/entrar/fator") {
        const r = await C.http(srv.base, p);
        R.checa(r.status === 404, `GET ${p}: 404 no modo local (as páginas de entrada só existem no modo produção; as de produção são provadas na seção 3)`, `status ${r.status}`);
        continue;
      }
      const r = await C.http(srv.base, p);
      if (!R.checa(r.status === 200, `GET ${p} responde 200`, `status ${r.status}`)) continue;
      const lk = r.cabecalhos.get("link");
      if (lk) for (const x of lk.matchAll(/<([^>]+)>/g)) { if (ehExterno(x[1])) externosEmRef.push(`${p}: cabeçalho Link ${x[1]}`); else recursos.set(x[1], `${p} (cabeçalho Link)`); }
      for (const ref of refsDoHtml(r.texto)) {
        if (ref.tipo === "a") { if (ehExterno(ref.v)) externosEmRef.push(`${p}: <a> ${ref.v}`); continue; }
        const alvoRef = ref.tipo === "srcset" ? ref.v.split(",").map((s) => s.trim().split(/\s+/)[0]) : ref.tipo === "refresh" ? [ref.v.replace(/^\d+;\s*url=/i, "")] : [ref.v];
        for (const v of alvoRef) {
          if (ehExterno(v)) externosEmRef.push(`${p}: <${ref.tipo}> ${v}`);
          else if (/^\/_next\/|\.(?:js|css|woff2?|ttf|png|jpe?g|svg|ico)(?:\?|$)/.test(v)) recursos.set(v.split("?")[0], `${p} <${ref.tipo}>`);
        }
      }
      // texto inline (payload RSC, scripts inline): hosts em texto, para a lista de justificativas
      lerTexto(`HTML ${p}`, C.semComentarios(r.texto).replace(/<(?:script|style)\b[^>]*\bsrc=[^>]*>/g, ""));
    }
    R.checa(externosEmRef.length === 0, `nenhum <script src>, <link href>, <a href>, <img>, <iframe>, srcset, form action, meta refresh, url() inline ou cabeçalho Link externo em ${alvos.length} páginas`, externosEmRef.join("; "));
    // chunks que o app-build-manifest lista para as páginas da central (inclui o que o HTML não referencia de cara)
    let doManifest = 0;
    for (const f of estaticosDoManifest) if (!recursos.has("/_next/" + f)) { recursos.set("/_next/" + f, "app-build-manifest"); doManifest++; }
    for (const extra of ["/geo/br.json", `/geo/uf/${ctx.casa[1]}.json`]) recursos.set(extra, "carregado pelo mapa (fetch relativo)");
    R.info(`recursos referenciados: ${recursos.size} (${doManifest} só pelo app-build-manifest): ${[...recursos.keys()].filter((k) => /\.(js|css)$/.test(k)).length} js/css, ${[...recursos.keys()].filter((k) => k.startsWith("/geo/")).length} malhas`);
    const usos = [];
    const dentroDeUso = [];
    const resultados = [];
    for (const [caminho, de] of recursos) {
      const r = await C.http(srv.base, caminho);
      if (r.status !== 200) { resultados.push(`${caminho} -> ${r.status} (de ${de})`); continue; }
      lerTexto(caminho, /\.css$/.test(caminho) ? r.texto.replace(/\/\*.*?\*\//gs, "") : r.texto);
      if (/\.css$/.test(caminho)) {
        for (const m of r.texto.matchAll(/\/\*.*?\*\//gs)) for (const u of m[0].match(HOST) ?? []) { const e = achadosHost.get(u) ?? new Set(); e.add(caminho); achadosHost.set(u, e); }
        for (const m of r.texto.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) usos.push(`${caminho}: @import ${m[1]}`);
        for (const m of r.texto.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/g)) if (ehExterno(m[1])) usos.push(`${caminho}: url(${m[1]})`);
        for (const m of r.texto.matchAll(/@font-face[^}]*}/g)) if (/src\s*:[^;}]*(?:https?:)?\/\//.test(m[0])) usos.push(`${caminho}: @font-face externo`);
      } else if (/\.js$/.test(caminho)) {
        for (const re of USO_JS) for (const m of r.texto.matchAll(re)) {
          const alvo = r.texto.slice(m.index, m.index + 160).match(/["'`](https?:\/\/[^"'`]*)/)?.[1];
          if (alvo && justificativa(alvo, caminho)) { dentroDeUso.push(`${caminho}: ${m[0].slice(0, 60)}… (${alvo})`); continue; }
          usos.push(`${caminho}: ${m[0].slice(0, 80)}`);
        }
      }
    }
    R.checa(resultados.length === 0, `todos os ${recursos.size} recursos baixam com 200`, resultados.join("; "));
    R.checa(usos.length === 0, "nenhum recurso (js, css) usa host externo como recurso: sem fetch(\"http…\"), .src=, new URL(\"http…\"), XHR, sendBeacon, WebSocket, EventSource, import() de URL, @import nem url() externo", usos.slice(0, 8).join("; "));
    if (dentroDeUso.length) R.info(`usos que casam o padrão de recurso mas são justificados (new URL em memória no polyfill do core-js, nunca buscado): ${dentroDeUso.length}, ex.: ${dentroDeUso[0]}`);
    // hosts que aparecem como TEXTO: cada um precisa de justificativa exata
    const injust = [];
    R.info(`URLs absolutas que aparecem como texto no HTML e nos recursos: ${achadosHost.size} distintas`);
    for (const [u, onde] of [...achadosHost.entries()].sort()) {
      const j = [...onde].map((o) => justificativa(u, o)).every(Boolean) ? justificativa(u, [...onde][0]) : null;
      const quem = [...onde].slice(0, 2).join(", ") + (onde.size > 2 ? ` (+${onde.size - 2})` : "");
      R.info(`  ${j ? "justificada" : "SEM JUSTIFICATIVA"}: ${u.slice(0, 90)}  em ${quem}${j ? `  -> ${j}` : ""}`);
      if (!j) injust.push(u);
    }
    const urlTs = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    if (achadosHost.has(urlTs)) {
      let paginasDoChunk = null;
      try {
        const mf = JSON.parse(fs.readFileSync(path.join(C.WEB, C.DIST_ADMIN_LOCAL, "app-build-manifest.json"), "utf8")).pages ?? {};
        const chunks = [...achadosHost.get(urlTs)].filter((o) => o.startsWith("/_next/")).map((o) => o.replace("/_next/", ""));
        paginasDoChunk = [...new Set(chunks.flatMap((c) => Object.entries(mf).filter(([, v]) => v.includes(c)).map(([k]) => k)))];
      } catch {}
      R.checa(paginasDoChunk !== null && paginasDoChunk.length > 0 && paginasDoChunk.every((k) => /^\/\(admin\)\/admin\/entrar\//.test(k)), `o chunk com a URL do Turnstile só é carregado pelas páginas de entrada (app-build-manifest: ${paginasDoChunk?.join(", ")})`);
    }
    R.checa(injust.length === 0, "toda URL absoluta que aparece como texto tem justificativa exata (namespace, mensagem do runtime, comentário), nenhuma é recurso", injust.slice(0, 6).join("; "));
    // contagem de fetch( dinâmicos no runtime (não resolvíveis no minificado): a prova de que são relativos está na varredura estática
    R.info("fetch( com argumento variável existe no runtime do Next (prefetch de rotas, RSC) e no mapa/painel da central; todos relativos ao site (provado no fonte, seção 1); nenhum com literal absoluto (varredura acima)");
  } finally {
    await srv.parar();
  }
}

// ---- 3. modo produção simulado (AC-23): o que a central na internet pode contactar
async function producaoSimulada() {
  R.cabecalho("3. modo produção simulado: hosts permitidos (a própria origem; challenges.cloudflare.com só na entrada, na CSP; e-mail e conferência do captcha só do lado do servidor)");
  const srv = await C.subirNext(await C.envProducao(C.BANCO_C7));
  const cab = { host: C.HOST_PRODUCAO };
  try {
    for (const caminho of ["/admin/entrar", "/admin/entrar?etapa=codigo"]) {
      const r = await C.crua(srv.base, caminho, { cabecalhos: cab });
      if (!R.checa(r.status === 200, `GET ${caminho} (Host ${C.HOST_PRODUCAO}, sem cookie) responde 200`, `status ${r.status}`)) continue;
      const csp = r.cabecalhos["content-security-policy"] ?? "";
      const hostsCsp = [...new Set((csp.match(/(?:^|[\s;])(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?=[\s;]|$)/gi) ?? []).map((x) => x.trim().replace(/^[;\s]+/, "")))];
      R.checa(hostsCsp.length === 1 && hostsCsp[0] === "challenges.cloudflare.com" && /frame-ancestors 'none'/.test(csp) && !/'unsafe-eval'/.test(csp), `CSP de ${caminho}: o único host externo é challenges.cloudflare.com; frame-ancestors 'none'; sem unsafe-eval (hosts na política: ${hostsCsp.join(", ") || "nenhum"})`, csp);
      const ext = refsDoHtml(r.texto).filter((x) => x.tipo !== "a" && ehExterno(x.v));
      R.checa(ext.every((x) => new URL(x.v.startsWith("//") ? "https:" + x.v : x.v).host === "challenges.cloudflare.com"), `HTML de ${caminho}: nenhuma referência externa além de challenges.cloudflare.com (o widget só aparece com NEXT_PUBLIC_TURNSTILE_SITE_KEY no build; aqui: ${ext.length})`, ext.map((x) => x.v).join("; "));
      const outrosHosts = (C.semComentarios(r.texto).match(HOST) ?? []).filter((u) => !justificativa(u, "HTML") && !/^https?:\/\/(?:www\.w3\.org|react\.dev|nextjs\.org|challenges\.cloudflare\.com|admin\.segueovoto\.com\.br)/.test(u));
      R.checa(outrosHosts.length === 0, `HTML de ${caminho}: nenhuma URL absoluta de outro host em texto`, outrosHosts.slice(0, 4).join("; "));
      const js = [...new Set([...r.texto.matchAll(/\/_next\/static\/[^"'\s]+\.js/g)].map((m) => m[0]))];
      const usos = [];
      for (const j of js) {
        const x = await C.crua(srv.base, j, { cabecalhos: cab });
        if (x.status !== 200) { usos.push(`${j} -> ${x.status}`); continue; }
        for (const re of USO_JS) for (const m of x.texto.matchAll(re)) { const alvo = x.texto.slice(m.index, m.index + 160).match(/["'`](https?:\/\/[^"'`]*)/)?.[1]; if (!(alvo && justificativa(alvo, j))) usos.push(`${j}: ${m[0].slice(0, 70)}`); }
      }
      R.checa(usos.length === 0, `${js.length} chunks de JS de ${caminho}: nenhum usa host externo como recurso (fetch, .src, XHR, beacon, WebSocket, import de URL)`, usos.slice(0, 4).join("; "));
    }
    R.checa(!/\[admin\] entrada/.test(srv.log()), "abrir as páginas de entrada não dispara envio de e-mail nem conferência de captcha (o log do servidor não registra nenhuma tentativa)", srv.log().slice(-200));
    R.info("NÃO provado sem navegador e sem as chaves reais: o widget Turnstile carregando de fato (precisa da chave pública no build) e o e-mail do código saindo pelo Resend. O fluxo código -> TOTP -> sessão, com banco, está em e2e-admin/login-http.mjs.");
  } finally {
    await srv.parar();
  }
}

(async () => {
  try {
    R.info("SIMULADO: critério 23 sem navegador. Banco de ensaio admin_coleta_c7 (rodadas fabricadas). Só localhost.");
    estatica();
    // AC-29: a central é um build próprio (ADMIN_CENTRAL no build e na execução): local em .next-admin-local, produção em .next-admin-prod. O build do site (.next) não tem a central.
    const buildId = path.join(C.WEB, C.DIST_ADMIN_LOCAL, "BUILD_ID");
    if (!C.temFlag("--sem-build")) {
      for (const modo of ["1", "producao"]) {
        const b = C.construirCentral(modo);
        R.checa(b.rc === 0, `next build da central (ADMIN_CENTRAL=${modo}) terminou com código ${b.rc}`, b.out.slice(-500));
      }
    } else R.checa(C.existe(buildId) && C.existe(path.join(C.WEB, C.DIST_ADMIN_PROD, "BUILD_ID")), `--sem-build: reaproveita ${C.DIST_ADMIN_LOCAL} e ${C.DIST_ADMIN_PROD}`, "falta BUILD_ID");
    if (!R.falhas || C.existe(buildId)) {
      const ctx = garantirBanco();
      let est = [];
      try {
        const m = JSON.parse(fs.readFileSync(path.join(C.WEB, C.DIST_ADMIN_LOCAL, "app-build-manifest.json"), "utf8")).pages ?? {};
        est = [...new Set(Object.entries(m).filter(([k]) => /^\/\(admin\)\//.test(k)).flatMap(([, v]) => v).filter((f) => /^static\/.*\.(js|css)$/.test(f)))];
        R.info(`app-build-manifest: ${Object.keys(m).filter((k) => /^\/\(admin\)\//.test(k)).length} entradas da central, ${est.length} arquivos js/css`);
      } catch (e) {
        R.aviso(`não deu para ler o app-build-manifest (${e.message}); sigo só com o que o HTML referencia`);
      }
      await dinamica(ctx, est);
      await producaoSimulada();
    }
  } catch (e) {
    R.falha(`exceção: ${e.stack?.split("\n").slice(0, 4).join(" | ") ?? e}`);
  }
  console.log(`\n${R.falhas === 0 ? "RESULTADO: tudo passou" : `RESULTADO: ${R.falhas} FALHOU`} (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(R.falhas === 0 ? 0 : 1);
})();
