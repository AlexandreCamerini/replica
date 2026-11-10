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
  for (const f of ["src/app/p/[slug]/opengraph-image.tsx", "src/app/proposta/[key]/opengraph-image.tsx"]) {
    test(`U17-U4 ${f} passa por assertCard e todo fato tem caveat`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("assertCard(");
      const facts = src.split("\n").filter((l) => /\bsource:/.test(l));
      expect(facts.length).toBeGreaterThan(0);
      for (const l of facts) expect(l, l).toMatch(/caveat:/);
    });
  }

  test("U17-E1 imagens OG respondem PNG (com banco: crachá e proposta reais)", async ({ request }) => {
    const r = await request.get("/p/inexistente-xyz/opengraph-image");
    expect(r.status()).toBe(200); // slug sem pessoa cai no fallback, sem número
    expect(r.headers()["content-type"]).toContain("image/png");
  });
});
