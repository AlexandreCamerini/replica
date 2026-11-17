// Utilitários das provas sem navegador da central de coleta (C7). Node puro, sem dependência nova.
// Regras duras deste arquivo:
//  - só toca nos bancos `admin_coleta_c7` (recria e apaga) e `admin_coleta_r1` (só leitura/uso pelo --fluxo); qualquer outro nome é recusado;
//  - só fala HTTP com 127.0.0.1; nenhuma chamada externa;
//  - o `next start` é sempre filho nosso, em grupo de processos próprio, e morre no fim (inclusive em sinal).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import nodeHttp from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(AQUI, "..");
export const RAIZ = path.resolve(WEB, "..");
export const ETL = path.join(RAIZ, "etl");
export const EVID = path.join(RAIZ, "replica", "prompts", "evidencias");
export const TMP = process.env.TMPDIR || os.tmpdir();

export const BANCO_C7 = "admin_coleta_c7";
const BANCOS_PERMITIDOS = new Set([BANCO_C7, "admin_coleta_r1"]);
const SERVIDOR = "postgres://postgres@localhost:54329";
export const urlDono = (banco) => {
  if (!BANCOS_PERMITIDOS.has(banco)) throw new Error(`banco recusado: ${banco} (só ${[...BANCOS_PERMITIDOS].join(" ou ")})`);
  return `${SERVIDOR}/${banco}`;
};
export const urlCentral = (banco) => {
  urlDono(banco);
  return `postgres://admin_central:admin_central@localhost:54329/${banco}`;
};

const PATH_PG = "/opt/homebrew/opt/postgresql@16/bin";
export function envLimpa(extra = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(ADMIN_|VERCEL)/.test(k) || k === "DATABASE_URL" || k === "ETL_DATABASE_URL") delete e[k];
  e.PATH = `${PATH_PG}:${e.PATH ?? ""}`;
  e.UV_CACHE_DIR = process.env.UV_CACHE_DIR || path.join(TMP, "uv-cache");
  e.npm_config_cache = process.env.npm_config_cache || path.join(TMP, "npm-cache");
  e.NEXT_TELEMETRY_DISABLED = "1";
  return { ...e, ...extra };
}
export const envCi = (extra = {}) => envLimpa({ DATA_SOURCE: "demo", ALLOW_DEMO_DATA: "1", ...extra });

// ------------------------------------------------------------------ comandos

export function rodar(cmd, args, { cwd = RAIZ, env = envLimpa(), timeout = 300_000, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 256 * 1024 * 1024, input });
  return { rc: r.status ?? (r.error ? 124 : 1), out: r.stdout ?? "", err: r.stderr ?? "", erro: r.error?.message };
}

export function sql(banco, consulta, { dono = true } = {}) {
  const r = rodar("psql", [urlDono(banco), "-X", "-q", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", consulta]);
  if (r.rc !== 0) throw new Error(`psql falhou (${banco}): ${r.err.trim() || r.erro}\n  ${consulta.slice(0, 200)}`);
  return r.out.trim();
}
export const sqlLinhas = (banco, consulta) => (sql(banco, consulta) === "" ? [] : sql(banco, consulta).split("\n").map((l) => l.split("|")));

function psqlManutencao(consulta) {
  const r = rodar("psql", [`${SERVIDOR}/postgres`, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", consulta]);
  if (r.rc !== 0) throw new Error(`psql de manutenção falhou: ${r.err.trim() || r.erro}`);
  return r.out.trim();
}

export function bancoExiste(banco) {
  urlDono(banco);
  return psqlManutencao(`select 1 from pg_database where datname = '${banco}'`) === "1";
}

// PYTHONPATH com o resolvedor de DNS falso (dns-falso/sitecustomize.py): `.invalid` resolve para um IP público fixo, só nos processos do ETL deste ensaio sem rede (ver o arquivo).
const envEtl = (banco, extra = {}) => envLimpa({ DATABASE_URL: urlDono(banco), ETL_DATABASE_URL: urlDono(banco), PYTHONPATH: path.join(AQUI, "dns-falso"), ...extra });

/** Recria `admin_coleta_c7` do zero (o único banco que este código apaga), migra, semeia e carrega a base mínima (como o roteiro da primeira rodada). SEM rodada. */
export function recriarC7() {
  psqlManutencao(`drop database if exists ${BANCO_C7} with (force)`);
  psqlManutencao(`create database ${BANCO_C7}`);
  if (sql(BANCO_C7, "select current_database()") !== BANCO_C7) throw new Error("o banco conectado não é admin_coleta_c7");
  const env = envEtl(BANCO_C7);
  let r = rodar("bash", ["db/migrate.sh", "--local"], { cwd: RAIZ, env });
  if (r.rc !== 0) throw new Error(`migrate falhou: ${r.err || r.out}`);
  r = rodar("uv", ["run", "--frozen", "civico-etl", "seed"], { cwd: ETL, env });
  if (r.rc !== 0) throw new Error(`seed falhou: ${r.err.slice(-600)}`);
  for (const f of ["base.sql", "admin_base.sql"]) {
    r = rodar("psql", [urlDono(BANCO_C7), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(ETL, "tests", "fixtures", f)], { env });
    if (r.rc !== 0) throw new Error(`${f} falhou: ${r.err}`);
  }
  return sql(BANCO_C7, "select count(*) from schema_migrations");
}

export const cacheDe = (banco) => {
  urlDono(banco);
  return path.join(TMP, `admin-${banco === BANCO_C7 ? "c7" : "r1"}-cache`);
};

/** A CLI REAL sobre respostas fabricadas (lançador simulado.py, sem rede). `args` são os da CLI depois de `admin`. Devolve também o JSON do stdout (sem a linha SIMULADO). */
export function simulado(banco, cenario, args, { timeout = 400_000 } = {}) {
  const r = rodar("uv", ["run", "--frozen", "python", "tests/simulado.py", "--cenario", cenario, "--cache-dir", cacheDe(banco), "--", ...args], { cwd: ETL, env: envEtl(banco), timeout });
  const linhas = r.out.split("\n");
  if (!linhas[0].startsWith("SIMULADO:")) r.semMarca = true;
  r.json = tentaJson(linhas.slice(1).join("\n"));
  return r;
}
/** CLI direta (só para comandos que não coletam: relatorio, pedido, pendencia, fila, rodada abrir sem --executar). */
export function cli(banco, args, { timeout = 120_000 } = {}) {
  const r = rodar("uv", ["run", "--frozen", "civico-etl", ...args], { cwd: ETL, env: envEtl(banco), timeout });
  r.json = tentaJson(r.out);
  return r;
}
function tentaJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ next start

const vivos = new Set();
function matarTudo() {
  for (const p of vivos) {
    try {
      process.kill(-p, "SIGKILL");
    } catch {}
  }
  vivos.clear();
}
process.on("exit", matarTudo);
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { matarTudo(); process.exit(130); });

export function portaLivre() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

export async function subirNext(env) {
  const porta = await portaLivre();
  const bin = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
  const filho = spawn(process.execPath, [bin, "start", "-p", String(porta), "-H", "127.0.0.1"], { cwd: WEB, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  vivos.add(filho.pid);
  let log = "";
  filho.stdout.on("data", (d) => (log += d));
  filho.stderr.on("data", (d) => (log += d));
  let saiu = false;
  filho.on("exit", () => (saiu = true));
  const base = `http://127.0.0.1:${porta}`;
  const t0 = Date.now();
  for (;;) {
    if (saiu) throw new Error(`next start saiu antes de responder:\n${log.slice(-800)}`);
    try {
      await fetch(base + "/", { redirect: "manual", signal: AbortSignal.timeout(3000) });
      break;
    } catch {
      if (Date.now() - t0 > 60_000) {
        matarTudo();
        throw new Error(`next start não respondeu em 60 s:\n${log.slice(-800)}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return {
    base,
    porta,
    log: () => log,
    async parar() {
      try {
        process.kill(-filho.pid, "SIGTERM");
      } catch {}
      const t = Date.now();
      while (!saiu && Date.now() - t < 4000) await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(-filho.pid, "SIGKILL");
      } catch {}
      vivos.delete(filho.pid);
    },
  };
}

// Modo local da central (AC-23): a identidade é ADMIN_LOCAL_EMAIL, que tem de ser admin ATIVO em adm_admins (o admin local nasce em db/local/post_0004_admin_local.sql, que `db/migrate.sh --local` roda).
export const ADMIN_LOCAL_EMAIL = "operador.local@segueovoto.invalid";
export const ADMIN_LOCAL_NOME = "Operador local";
export const envCentral = (banco, extra = {}) => envCi({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: urlCentral(banco), ADMIN_LOCAL_EMAIL, ...extra });

// Modo produção SIMULADO (AC-23): o `next start` local com as variáveis do projeto admin. O Supabase é FALSO: aponta para uma porta local FECHADA (nenhuma requisição sai da máquina);
// o provedor fora do ar tem de dar 404, nunca derrubar o servidor. O banco é o de ensaio com `sslmode=require` (a guarda só confere o formato; nada consulta o banco antes da sessão).
export const HOST_PRODUCAO = "admin.segueovoto.com.br";
// F3-C1: o projeto admin é um BUILD com ADMIN_CENTRAL=producao (rewrites e cabeçalhos entram no build, não no `next start`): pasta própria, para não pisar no build do site (.next).
export const DIST_ADMIN_PROD = ".next-admin-prod";
export async function envProducao(banco, extra = {}) {
  const fechada = await portaLivre(); // livre agora = fechada: ninguém escuta
  const base = urlCentral(banco).replace("@localhost:", "@127.0.0.1:");
  return envCi({
    ADMIN_CENTRAL: "producao",
    VERCEL_ENV: "production",
    AUTH_PROVIDER: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fechada}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "x",
    ADMIN_DATABASE_URL: `${base}?sslmode=require`,
    NEXT_DIST_DIR: DIST_ADMIN_PROD,
    ...extra,
  });
}

// ------------------------------------------------------------------ HTTP (só 127.0.0.1)

export async function http(base, caminho, { metodo = "GET", corpo, cabecalhos = {}, seguir = false } = {}) {
  const url = new URL(caminho, base);
  if (url.hostname !== "127.0.0.1") throw new Error(`recusado: host ${url.hostname} não é 127.0.0.1`);
  const h = { connection: "close", ...cabecalhos };
  let body;
  if (metodo !== "GET" && metodo !== "HEAD") {
    // como a página faz (AC-23): Origin da própria central e Sec-Fetch-Site same-origin. Um cabeçalho passado como `null` é REMOVIDO (para provar a recusa de POST sem ele).
    // (não use `??=`: um valor `null` passado de propósito tem de ficar `null` e ser removido, não trocado pelo padrão)
    if (!("content-type" in h)) h["content-type"] = "application/json";
    if (!("origin" in h)) h.origin = new URL(base).origin;
    if (!("sec-fetch-site" in h)) h["sec-fetch-site"] = "same-origin";
    body = typeof corpo === "string" ? corpo : JSON.stringify(corpo ?? {});
  }
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const r = await fetch(url, { method: metodo, headers: h, body, redirect: seguir ? "follow" : "manual", signal: AbortSignal.timeout(90_000) });
  const texto = await r.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {}
  return { status: r.status, texto, json, cabecalhos: r.headers };
}

/** Requisição crua por node:http (o fetch recusa TRACE e não deixa trocar o Host). Só 127.0.0.1. Devolve { status, cabecalhos (minúsculos), texto }. */
export function crua(base, caminho, { metodo = "GET", cabecalhos = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(caminho, base);
    if (u.hostname !== "127.0.0.1") return reject(new Error(`recusado: host ${u.hostname} não é 127.0.0.1`));
    const req = nodeHttp.request({ host: "127.0.0.1", port: u.port, path: u.pathname + u.search, method: metodo, headers: { connection: "close", ...cabecalhos }, agent: false, timeout: 60_000 }, (res) => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (texto += d));
      res.on("end", () => resolve({ status: res.statusCode, cabecalhos: res.headers, texto }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

/** Servidor TCP local que faz de Supabase: `drop` derruba a conexão, `http500` responde 500. Conta as conexões. Só 127.0.0.1. */
export function supabaseFalso(modo) {
  return new Promise((res) => {
    let conexoes = 0;
    const srv = net.createServer((sock) => {
      conexoes++;
      sock.on("error", () => {});
      if (modo === "drop") sock.destroy();
      else sock.once("data", () => sock.end("HTTP/1.1 500 Internal Server Error\r\ncontent-type: text/plain\r\ncontent-length: 2\r\nconnection: close\r\n\r\nxx"));
    });
    srv.listen(0, "127.0.0.1", () => res({ porta: srv.address().port, conexoes: () => conexoes, fechar: () => srv.close() }));
  });
}

// ------------------------------------------------------------------ relato

const T_INICIO = Date.now();
export function criarRelato() {
  const linhas = [];
  let falhas = 0;
  const p = (l) => {
    linhas.push(l);
    console.log(l);
  };
  return {
    linhas,
    ok: (d) => p(`ok      ${d}`),
    falha: (d) => {
      falhas++;
      p(`FALHOU  ${d}`);
    },
    aviso: (d) => p(`AVISO   ${d}`),
    info: (d) => p(`        ${d}`),
    cabecalho: (d) => p(`\n== [${Math.round((Date.now() - T_INICIO) / 1000)} s] ${d}`),
    checa(cond, d, detalhe = "") {
      if (cond) this.ok(d);
      else this.falha(`${d}${detalhe ? ` :: ${detalhe}` : ""}`);
      return !!cond;
    },
    get falhas() {
      return falhas;
    },
  };
}

// ------------------------------------------------------------------ HTML

export const semComentarios = (h) => h.replace(/<!--.*?-->/gs, "");
export const estadosDoHtml = (h) => [...new Set([...h.matchAll(/data-estado="([^"]+)"/g)].map((m) => m[1]))].sort();

/** Totais de um painel do relatório, como a tela os escreve: caminho -> "V de D" (texto de <strong class="adm-total__valor">), por painel (adm-coleta, adm-revisao). */
export function totaisDoHtml(html) {
  const h = semComentarios(html);
  const saida = {};
  const marcas = [...h.matchAll(/data-painel="([^"]+)"/g)];
  marcas.forEach((m, i) => {
    const trecho = h.slice(m.index, i + 1 < marcas.length ? marcas[i + 1].index : h.length);
    const mapa = {};
    for (const li of trecho.matchAll(/<li[^>]*data-total="([^"]+)"[^>]*>(.*?)<strong[^>]*adm-total__valor[^>]*>([^<]*)<\/strong>(.*?)(?=<li[^>]*data-total=|$)/gs)) {
      const ver = li[4].match(/Ver registros \((\d+)\)/);
      mapa[li[1]] = { texto: li[3].trim(), nIds: ver ? Number(ver[1]) : 0 };
    }
    saida[m[1]] = mapa;
  });
  return saida;
}

export const canonico = (o) => {
  const ord = (x) => (Array.isArray(x) ? x.map(ord) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ord(x[k])])) : x);
  return JSON.stringify(ord(o));
};
export const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const temFlag = (f) => process.argv.includes(f);
export const valorFlag = (f) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
export const existe = (p) => fs.existsSync(p);

// ------------------------------------------------------------------ preparo das rodadas simuladas (cenário v1, depois v2 com releitura forçada, como a primeira rodada)

export const UFARGS = ["--uf", "RO", "--uf", "AC", "--uf", "AM", "--uf", "PI", "--uf", "PB"];

export function limparCache(banco) {
  const c = cacheDe(banco);
  if (!/admin-(c7|r1)-cache$/.test(c)) throw new Error("diretório de cache inesperado");
  fs.rmSync(c, { recursive: true, force: true });
  fs.mkdirSync(c, { recursive: true });
}

export function prepararRodadas() {
  limparCache(BANCO_C7);
  const exige = (r, o) => {
    if (r.rc !== 0 || r.semMarca || !r.json) throw new Error(`${o} falhou (rc ${r.rc}): ${(r.err || r.out).slice(-500)}`);
    return r.json;
  };
  const v1 = exige(simulado(BANCO_C7, "v1", ["admin", "rodada", "abrir", "--coletor", "sapl.assembleias", ...UFARGS, "--executar", "--json"]), "rodada v1").rodada_id;
  const previa = exige(simulado(BANCO_C7, "v2", ["admin", "previa", "--coletor", "sapl.assembleias", ...UFARGS, "--json"]), "prévia v2");
  const forca = [];
  for (const i of previa.urls_entrada) if (i.url.endsWith("/robots.txt") || i.url.endsWith("/api/")) forca.push("--forcar-url", i.url);
  const v2 = exige(simulado(BANCO_C7, "v2", ["admin", "rodada", "abrir", "--coletor", "sapl.assembleias", ...UFARGS, ...forca, "--executar", "--json"]), "rodada v2").rodada_id;
  return { v1, v2, nForcadas: forca.length / 2 };
}

/** Roda `admin executor --uma-vez` (lançador simulado, cenário v2) até a fila esvaziar. Devolve os pedidos processados. */
export function esvaziarFila(banco, { max = 8 } = {}) {
  const feitos = [];
  for (let i = 0; i < max; i++) {
    const r = simulado(banco, "v2", ["admin", "executor", "--uma-vez", "--json"], { timeout: 500_000 });
    if (r.semMarca || !r.json) throw new Error(`executor sem JSON (rc ${r.rc}): ${(r.err || r.out).slice(-500)}`);
    if (r.json.pedido === null) return { feitos, vazia: true };
    feitos.push({ ...r.json.pedido, rc: r.rc });
  }
  return { feitos, vazia: false };
}
