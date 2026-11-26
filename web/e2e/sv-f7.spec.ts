import { expect, test } from "@playwright/test";

// F7: série mensal do gasto da própria pessoa e lacuna do teto da cota (conjunto ainda não carregado).
test("gastos: série mensal fecha com o total, mês sem nota é lacuna e não zero; sem comparação", async ({ page }) => {
  await page.goto("/pessoa/helena-siqueira/gastos");
  const t = page.locator('[data-serie-mensal="ano"]');
  await expect(t).toBeVisible();
  await expect(t.locator("tbody tr")).toHaveCount(12);
  const totais = await page.locator("table.sv-g tfoot td").allInnerTexts();
  expect(totais.length).toBeGreaterThan(1);
  expect(totais[0]).toBe(totais[1]);
  await expect(t).not.toContainText("R$ 0,00");
});

test("gastos de deputado federal: teto da cota aparece como lacuna nomeada, nunca como valor", async ({ page }) => {
  await page.goto("/pessoa/rosana-esteves/gastos");
  const teto = page.locator('[data-teto-cota="nao_carregado"]');
  await expect(teto).toContainText("não carregado");
  await expect(teto).not.toContainText(/R\$/);
});
