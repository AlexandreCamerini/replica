#!/usr/bin/env node
// Pós-build SÓ da central (ADMIN_CENTRAL=1|producao): cria o `route_client-reference-manifest.js` dos route handlers que o Next 15.5 não emitiu.
//
// Por quê: no build da central (pageExtensions só `.admin.*`), o FlightManifestPlugin do Next não emite manifesto de referência de cliente para NENHUM route handler
// (nem o `favicon.ico/route`); as páginas recebem o delas. O `next start` não precisa dele (route handler não renderiza componente de cliente; o manifesto só serve
// ao `'use cache'`, que a central não usa), mas o builder da Vercel (@vercel/next) faz `lstat` de `<rota>_client-reference-manifest.js` ao montar cada função e
// falha com ENOENT (deploy de 19/11/2026, `app/(admin)/admin/api/decisoes/route_client-reference-manifest.js`).
// O que faz: para cada entrada `/…/route` de `server/app-paths-manifest.json` sem manifesto, grava um manifesto no formato do Next com os mapeamentos VAZIOS e o
// `moduleLoading` copiado de um manifesto de página do mesmo build. Não sobrescreve manifesto existente. Fora do build da central, não faz nada.
// Uso (buildCommand do projeto da central): `next build && node scripts/manifestos-rotas-central.mjs`
import fs from "node:fs";
import path from "node:path";

const env = process.env;
if (env.ADMIN_CENTRAL !== "1" && env.ADMIN_CENTRAL !== "producao") {
  console.log("[manifestos-rotas-central] build do site: nada a fazer");
  process.exit(0);
}
const dist = path.resolve(process.cwd(), env.NEXT_DIST_DIR || ".next");
const servidor = path.join(dist, "server");
const appPaths = JSON.parse(fs.readFileSync(path.join(servidor, "app-paths-manifest.json"), "utf8"));
const SUFIXO = "_client-reference-manifest.js";

// moduleLoading de referência: o de qualquer manifesto de página deste build (todos iguais). Sem nenhum, aborta (build inesperado).
const umaPagina = Object.keys(appPaths).find((k) => k.endsWith("/page") && fs.existsSync(path.join(servidor, "app", `${k}${SUFIXO}`)));
if (!umaPagina) {
  console.error("[manifestos-rotas-central] nenhum manifesto de página encontrado: build inesperado, abortado");
  process.exit(1);
}
const globalRef = { globalThis: {} };
new Function("globalThis", fs.readFileSync(path.join(servidor, "app", `${umaPagina}${SUFIXO}`), "utf8"))(globalRef.globalThis);
const moduleLoading = globalRef.globalThis.__RSC_MANIFEST[umaPagina].moduleLoading;

let criados = 0;
for (const chave of Object.keys(appPaths)) {
  if (!chave.endsWith("/route")) continue;
  if (chave.includes("..") || !chave.startsWith("/")) throw new Error(`chave inesperada: ${chave}`);
  const destino = path.join(servidor, "app", `${chave}${SUFIXO}`);
  if (fs.existsSync(destino)) continue;
  const vazio = { moduleLoading, ssrModuleMapping: {}, edgeSSRModuleMapping: {}, clientModules: {}, entryCSSFiles: {}, rscModuleMapping: {}, edgeRscModuleMapping: {} };
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(chave)}]=${JSON.stringify(vazio)}`);
  criados++;
}
const faltando = Object.keys(appPaths).filter((k) => (k.endsWith("/route") || k.endsWith("/page")) && !fs.existsSync(path.join(servidor, "app", `${k}${SUFIXO}`)));
if (faltando.length) {
  console.error("[manifestos-rotas-central] ainda faltam:", faltando.join(", "));
  process.exit(1);
}
console.log(`[manifestos-rotas-central] ${criados} manifesto(s) de route handler criados; todas as ${Object.keys(appPaths).length} entradas têm manifesto`);
