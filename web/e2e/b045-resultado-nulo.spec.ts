import { expect, test } from "./fixtures";

const PG = process.env.E2E_PG === "1";

// BUG-045: candidatura com resultado #NULO# no TSE não vira "Não eleito"
test("B045 candidatura sem resultado na fonte aparece como “Sem resultado publicado”", async ({ page }) => {
  test.skip(!PG, "números reais");
  await page.goto("/p/veter-martins");
  const row2020 = page.locator("#eleicoes tr").filter({ hasText: "2020" });
  await expect(row2020).toContainText("Sem resultado publicado");
  await expect(row2020).not.toContainText("Não eleito");
});
