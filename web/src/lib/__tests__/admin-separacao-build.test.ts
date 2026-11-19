import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXTENSOES_DA_CENTRAL } from "../../../next.config.ts";

// AC-29: dois builds disjuntos por `pageExtensions`. O build do SITE usa as extensões padrão (tsx, ts, jsx, js); o da CENTRAL só `admin.tsx` e `admin.ts`.
// Este teste trava a partição: nada da central tem extensão padrão (não entraria no build da central) e nada `.admin.*` existe fora da central (não pode entrar no build do site por engano).

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const APP = join(SRC, "app");
const GRUPO = join(APP, "(admin)");
const todos = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
const rel = (f: string): string => relative(SRC, f);
const ehAdmin = (f: string): boolean => /\.admin\.(?:tsx|ts)$/.test(f);
const CENTRAL_FORA_DO_GRUPO = [join(APP, "layout.admin.tsx"), join(APP, "not-found.admin.tsx"), join(SRC, "middleware.admin.ts")];

test("a partição de extensões: as da central não coincidem com as padrão do Next, e o nome do middleware e dos arquivos especiais só casa com um dos dois builds", () => {
  const padrao = ["tsx", "ts", "jsx", "js"];
  for (const ext of EXTENSOES_DA_CENTRAL) assert.ok(!padrao.includes(ext), ext);
  for (const f of ["page", "route", "layout", "not-found", "middleware", "icon", "opengraph-image", "manifest", "robots", "sitemap"]) {
    for (const ext of EXTENSOES_DA_CENTRAL) {
      const nome = `${f}.${ext}`;
      assert.ok(new RegExp(`^${f}\\.(?:${EXTENSOES_DA_CENTRAL.join("|")})$`).test(nome));
      assert.ok(!new RegExp(`^${f}\\.(?:${padrao.join("|")})$`).test(nome), `${nome} entraria no build do site`);
    }
  }
});

test("todo arquivo sob src/app/(admin) tem extensão .admin.* (senão não entra no build da central); o middleware é middleware.admin.ts e o site não tem middleware", () => {
  for (const f of todos(GRUPO)) assert.ok(ehAdmin(f), `${rel(f)} sob (admin) sem extensão .admin.*`);
  assert.ok(todos(GRUPO).length > 0);
  const naRaizDoSrc = readdirSync(SRC).filter((n) => /^middleware\./.test(n));
  assert.deepEqual(naRaizDoSrc, ["middleware.admin.ts"], "o site não pode ter middleware; o da central é middleware.admin.ts");
});

test("nenhum arquivo .admin.* existe fora da central (grupo (admin), layout e not-found raiz da central, middleware)", () => {
  const permitido = (f: string): boolean => f.startsWith(GRUPO + "/") || CENTRAL_FORA_DO_GRUPO.includes(f);
  for (const f of todos(SRC).filter((x) => /\.admin\./.test(x))) assert.ok(permitido(f), `${rel(f)} é .admin.* fora da central`);
  for (const f of CENTRAL_FORA_DO_GRUPO) assert.ok(todos(SRC).includes(f), `${rel(f)} não existe`);
  // e os arquivos especiais do site (extensão padrão) não estão sob (admin)
  for (const f of todos(APP).filter((x) => x.startsWith(GRUPO + "/"))) assert.ok(!/\/(?:page|route|layout|not-found|loading|error|template|default|icon|opengraph-image|manifest|robots|sitemap)\.(?:tsx|ts|jsx|js)$/.test(f), rel(f));
});

test("exceção declarada: o único metadado estático do site que o Next incorpora ao build da central é src/app/favicon.ico (rota /favicon.ico); o middleware da central o serve só como ícone estático, nunca HTML", async () => {
  // `pageExtensions` não filtra arquivos de metadado estático (ico, png, txt, xml, webmanifest): eles entram no build da central. Hoje só há o favicon; qualquer outro aparece aqui e exige decisão.
  const estaticos = readdirSync(APP).filter((n) => /\.(?:ico|png|jpe?g|gif|svg|txt|xml|webmanifest)$/i.test(n));
  assert.deepEqual(estaticos, ["favicon.ico"]);
  const { ehEstaticoDaCentral } = await import("../admin/guarda-regra.ts");
  assert.equal(ehEstaticoDaCentral("/favicon.ico"), true, "as páginas da central referenciam /favicon.ico (link rel=icon): o middleware o deixa passar (ícone binário)");
  assert.equal(ehEstaticoDaCentral("/FAVICON.ICO"), false);
});
