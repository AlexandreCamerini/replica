import { expect, test } from "./fixtures";

// build 6 · W2 (parity.md itens 12–15). Dependem do banco real.
test.describe("B6-W2", () => {
  test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");

  test("B6-W12 card OG do crachá: 1200×630, PNG, ligado no og:image", async ({ page, request }) => {
    await page.goto("/p/adriana-ventura");
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(og).toMatch(/\/p\/adriana-ventura\/opengraph-image/);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
    const r = await request.get(new URL(og!).pathname + new URL(og!).search);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
    const buf = await r.body();
    // cabeçalho PNG: largura e altura nos bytes 16–23
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1200, 630]);
    // crachá inexistente não quebra a imagem
    expect((await request.get("/p/ninguem-com-este-nome-xyz/opengraph-image")).status()).toBeLessThan(500);
  });
});
