import { readFileSync } from "node:fs";
import { assertCard, CAVEAT, onlyWithCaveat, type CardFact } from "../src/lib/og-card";
import { expect, test } from "./fixtures";

const ok: CardFact = { value: "R$ 1.000", label: "cota", source: "Câmara", caveat: CAVEAT.salaryCeiling };

test.describe("U17 · card de compartilhar leva fonte, data e ressalva", () => {
  test("U17-U1 card completo passa; falta de fonte, data ou ressalva derruba", () => {
    expect(() => assertCard({ facts: [ok], asOf: "dados de 05/11/2026" })).not.toThrow();
    expect(() => assertCard({ facts: [{ ...ok, source: " " }], asOf: "x" })).toThrow(/sem fonte/);
    expect(() => assertCard({ facts: [{ ...ok, caveat: "" }], asOf: "x" })).toThrow(/sem ressalva/);
    expect(() => assertCard({ facts: [ok], asOf: "" })).toThrow(/sem data/);
  });

  test("U17-U2 número sem ressalva sai do card em vez de sair sem ela", () => {
    const kept = onlyWithCaveat([ok, { value: "9", label: "x", source: "TSE", caveat: "" }, { value: "8", label: "y", source: "TSE" }, null]);
    expect(kept).toEqual([ok]);
  });

  test("U17-U3 as ressalvas exigidas pelo catálogo existem", () => {
    expect(CAVEAT.salaryCeiling).toBe("teto, não gasto");
    expect(CAVEAT.assets).toContain("sem correção pela inflação");
  });

  // Trava estrutural: toda linha com `source:` nas imagens OG precisa estar no mesmo objeto de um `caveat:`; a imagem só passa por assertCard.
  for (const f of ["src/app/(v1)/p/[slug]/opengraph-image.tsx", "src/app/(v1)/proposta/[key]/opengraph-image.tsx"]) {
    test(`U17-U4 ${f} passa por assertCard e todo fato tem caveat`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("assertCard(");
      const facts = src.split("\n").filter((l) => /\bsource:/.test(l));
      expect(facts.length).toBeGreaterThan(0);
      for (const l of facts) expect(l, l).toMatch(/caveat:/);
    });
  }

  test("U17-E1 imagens OG respondem PNG (com banco: crachá e proposta reais)", async ({ page, request }) => {
    // D316: dentro de um grupo de rotas o Next põe um sufixo no endereço da imagem; o endereço certo é o do og:image da página
    await page.goto("/quem?cargo=deputado_federal");
    const perfil = await page.locator('a[href^="/p/"]').first().getAttribute("href");
    await page.goto(perfil!);
    const og = new URL((await page.locator('meta[property="og:image"]').first().getAttribute("content"))!);
    const real = await request.get(og.pathname + og.search);
    expect(real.status(), og.pathname).toBe(200);
    expect(real.headers()["content-type"]).toContain("image/png");
    const r = await request.get(og.pathname.replace(perfil!, "/p/inexistente-xyz") + og.search);
    expect(r.status()).toBe(200); // slug sem pessoa cai no fallback, sem número
    expect(r.headers()["content-type"]).toContain("image/png");
  });
});
