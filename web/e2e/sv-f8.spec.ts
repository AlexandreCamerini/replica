import { expect, test } from "@playwright/test";

// F8: leis citadas na ementa; o glossário nasce vazio, então cada lei mostra lacuna nomeada (nunca texto inventado).
test("ementa que cita leis lista cada uma com a lacuna 'sem verbete conferido'", async ({ page }) => {
  await page.goto("/decisao/camara-pl-79-2020");
  const b = page.locator('[data-leis-citadas="ementa"]');
  await expect(b).toContainText("Leis citadas na ementa");
  await expect(b.locator("li")).toHaveCount(5);
  await expect(b.locator("li").first()).toContainText("Ainda sem verbete conferido");
  await expect(b).not.toContainText("Decreto-Lei");
});

test("proposta sem lei citada não mostra o bloco", async ({ page }) => {
  await page.goto("/decisao/camara-pl-9999-2026");
  await expect(page.locator("[data-leis-citadas]")).toHaveCount(0);
});
