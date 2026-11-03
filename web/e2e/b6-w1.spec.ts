import { expect, test } from "./fixtures";

// build 6 · W1 restante (parity.md itens 5, 6, 8, 10, 11b). Dependem do banco real.
test.describe("B6-W1", () => {
  test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");

  test("B6-W5 presença em gráfico, ano em números e tabela ano a ano", async ({ page, axe }) => {
    await page.goto("/p/adriana-ventura");
    const sec = page.locator("#ano-a-ano");
    await expect(sec.getByTestId("grafico-presenca")).toBeVisible();
    // a tabela acessível existe por trás do gráfico, com caption
    await expect(sec.getByRole("table", { name: /Presença em sessões deliberativas por mês/ })).toHaveCount(1);
    const rows = sec.getByTestId("tabela-ano-a-ano").locator("tbody tr");
    expect(await rows.count()).toBeGreaterThanOrEqual(8);
    await expect(rows.first()).toContainText(/^2026/);
    await expect(sec.getByTestId("ano-em-numeros")).toContainText("74 de 75");
    // trocar o ano pelo seletor do bloco guarda na URL
    await sec.getByRole("navigation").getByRole("link", { name: "2025" }).click();
    await expect(page).toHaveURL(/ano=2025/);
    await expect(page.locator("#ano-a-ano h3").first()).toHaveText("2025 em números");
    await axe();
    // Senado: presença "—" com o motivo, resto da tabela com número
    await page.goto("/p/randolfe-rodrigues");
    await expect(page.locator("#ano-a-ano")).toContainText("o Senado não publica a lista de presença por senador");
    await expect(page.locator("#ano-a-ano").getByTestId("grafico-presenca")).toHaveCount(0);
  });

  test("B6-W5 ano a ano sem rolagem horizontal da página @mobile", async ({ page }) => {
    await page.goto("/p/adriana-ventura");
    await expect(page.locator("#ano-a-ano")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("B6-W6 mais votados na cidade: federal e estadual, votos em ordem, rótulo de cobertura", async ({ page, axe }) => {
    await page.goto("/representantes?cidade=3509502");
    const sec = page.locator("#mais-votados");
    await expect(sec.getByRole("heading", { level: 2 })).toHaveText(/Mais votados em Campinas · eleição de \d{4}/);
    await expect(sec).toContainText("entre quem tem crachá");
    for (const o of ["deputado_federal", "deputado_estadual"]) {
      const items = sec.getByTestId(`mais-votados-${o}`).locator("li");
      await expect(items).toHaveCount(5);
      const votes = (await items.allInnerTexts()).map((t) => Number(t.match(/([\d.]+) votos/)![1].replace(/\./g, "")));
      expect(votes, "ordem por votos").toEqual([...votes].sort((a, b) => b - a));
    }
    await expect(sec.getByText(/^Fonte:/)).toBeVisible();
    await expect(page.getByTestId("populacao")).toContainText("1.189.761");
    await axe();
    await sec.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/p\//);
  });
});
