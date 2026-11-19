import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORA_DO_BUSCADOR, origemPublica, PAGINAS_DO_SITEMAP, robots, sitemap } from "../seo.ts";

const PROD = { SITE_URL: "https://www.segueovoto.com.br" };

test("origemPublica: só https com host de verdade; o resto não indexa", () => {
  assert.equal(origemPublica(PROD), "https://www.segueovoto.com.br");
  assert.equal(origemPublica({ SITE_URL: "https://www.segueovoto.com.br/" }), "https://www.segueovoto.com.br");
  assert.equal(origemPublica({ SITE_URL: " https://www.segueovoto.com.br/qualquer " }), "https://www.segueovoto.com.br");
  for (const v of [undefined, "", "www.segueovoto.com.br", "http://www.segueovoto.com.br", "https://localhost:3000", "https://u:p@www.segueovoto.com.br", "lixo"]) {
    assert.equal(origemPublica({ SITE_URL: v }), null, String(v));
  }
});

test("robots: sem SITE_URL (Preview, dev, CI) não indexa nada", () => {
  assert.deepEqual(robots({}), { rules: [{ userAgent: "*", disallow: "/" }] });
  assert.deepEqual(robots({ SITE_URL: "http://www.segueovoto.com.br" }), { rules: [{ userAgent: "*", disallow: "/" }] });
});

test("robots: em produção indexa o site, fecha as páginas pessoais e a API, e aponta o sitemap do www", () => {
  const r = robots(PROD);
  assert.equal(r.sitemap, "https://www.segueovoto.com.br/sitemap.xml");
  assert.equal(r.host, "https://www.segueovoto.com.br");
  assert.equal(r.rules.length, 1);
  assert.equal(r.rules[0].allow, "/");
  for (const c of ["/api/", "/ajustes", "/acompanhando", "/comecar", "/conta", "/entrar"]) assert.ok((r.rules[0].disallow as string[]).includes(c), c);
});

test("sitemap: vazio sem origem pública; em produção só URLs absolutas do www, sem página pessoal", () => {
  assert.deepEqual(sitemap({}), []);
  const s = sitemap(PROD);
  assert.equal(s.length, PAGINAS_DO_SITEMAP.length);
  assert.equal(s[0].url, "https://www.segueovoto.com.br");
  for (const e of s) {
    assert.ok(e.url.startsWith("https://www.segueovoto.com.br"), e.url);
    assert.ok(!FORA_DO_BUSCADOR.some((f) => new URL(e.url).pathname.startsWith(f.replace(/\/$/, ""))), e.url);
  }
});

test("as páginas do sitemap existem no app, e as que ficam de fora declaram noindex", () => {
  const app = new URL("../../app/", import.meta.url);
  const pagina = (caminho: string) => {
    for (const grupo of ["(sv)", "(v1)"]) {
      try {
        return readFileSync(new URL(`${grupo}${caminho === "/" ? "" : caminho}/page.tsx`, app), "utf8");
      } catch {}
    }
    return null;
  };
  for (const p of PAGINAS_DO_SITEMAP) assert.ok(pagina(p.caminho) !== null, `sem page.tsx para ${p.caminho}`);
  for (const c of ["/ajustes", "/acompanhando", "/comecar", "/conta", "/entrar"]) {
    const src = pagina(c);
    assert.ok(src && /noindex|index:\s*false/.test(src), `${c} deveria declarar noindex`);
  }
});

test("robots.ts e sitemap.ts leem o ambiente na requisição, não no build", () => {
  for (const f of ["robots.ts", "sitemap.ts"]) {
    const src = readFileSync(new URL(`../../app/${f}`, import.meta.url), "utf8");
    assert.match(src, /export const dynamic = "force-dynamic";/, f);
    assert.match(src, /\(process\.env\)/, f);
  }
});
