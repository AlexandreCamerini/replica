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

  test("B6-W13 campanha: de onde veio e com o que gastou, por eleição, sem nome de doador", async ({ page, axe }) => {
    await page.goto("/p/tarcisio");
    const sec = page.locator("#campanha");
    await expect(sec.getByTestId("campanha-2026")).toHaveAttribute("open", "");
    await expect(sec.getByTestId("campanha-2022")).toContainText("entrou R$ 38.608.189");
    await expect(sec.getByTestId("campanha-2026").getByRole("table", { name: "De onde veio" })).toContainText("Recursos de pessoas físicas");
    await expect(sec.getByTestId("campanha-2026").getByRole("table", { name: "Com o que gastou" })).toBeVisible();
    // 2026 + 2022 = soma por ano do cartão (o 2º turno de 2022 não repete)
    await expect(sec.locator("details")).toHaveCount(2);
    await expect(sec.getByText(/^Fonte:/)).toBeVisible();
    await axe();
  });

  test("B6-W14 equipe do gabinete: Câmara com nomes A–Z e salário \"—\" com motivo; Senado \"—\"; viagens \"—\"", async ({ page, axe }) => {
    await page.goto("/p/adriana-ventura");
    const sec = page.locator("#equipe");
    await expect(sec.getByRole("heading", { level: 2 })).toContainText("14 pessoas");
    const names = await sec.getByTestId("equipe").locator("li > span:first-child").allInnerTexts();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await expect(sec.getByTestId("equipe-salario")).toContainText("folha mensal");
    await expect(page.locator("#pendentes-h + ul")).toContainText("Viagens oficiais");
    await expect(page.locator("#pendentes-h + ul")).not.toContainText("Equipe do gabinete");
    await axe();
    await page.goto("/p/randolfe-rodrigues");
    await expect(page.locator("#equipe")).toContainText("Ainda não carregado");
  });
});
