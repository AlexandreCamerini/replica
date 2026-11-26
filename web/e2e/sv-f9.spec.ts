import { expect, test } from "@playwright/test";

// F9: destino da lei e situação da proposta. Demonstração: número final 4 = virou lei; final 2 = situação fora da tabela (texto original da fonte).
test("proposta que virou lei mostra número, sanção e resumo, marcados como exemplo na demonstração", async ({ page }) => {
  await page.goto("/decisao/camara-pl-79-2020");
  const d = page.locator('[data-destino="lei"]');
  await expect(d).toContainText("Virou lei:");
  await expect(d).toContainText("sancionada em");
  await expect(d).toContainText("Exemplo ilustrativo");
});

test("situação fora da tabela curada mostra o texto original da fonte, sem palpite", async ({ page }) => {
  await page.goto("/decisao/camara-pl-4567-2024");
  const d = page.locator('[data-destino="situacao"]');
  await expect(d).toContainText("Situação na fonte: Situação nova da fonte (exemplo).");
  await expect(d).not.toContainText("Virou lei");
});
