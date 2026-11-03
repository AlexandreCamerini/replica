import { expect, test } from "./fixtures";

// BUG-034 (D230), ressalvas S4 da reverificação 2 (D231, D232). Dependem do banco real.
const PG = !!process.env.E2E_PG;

test.describe("B034 cota com glosa dupla e motivo da sucessão", () => {
  test.skip(!PG, "precisa do banco real (E2E_PG=1)");

  test("B034-1 cota de Eduardo Bolsonaro 2020 = página da Câmara (318.370,74)", async ({ page }) => {
    await page.goto("/p/eduardo-bolsonaro?ano=2020");
    await expect(page.getByTestId("ano-em-numeros")).toContainText("R$ 318.371");
    await expect(page.getByText("R$ 310.703")).toHaveCount(0);
  });

  test("B034-2 sucessão da lista curada diz o fato com a data, sem supor intenção", async ({ page, axe }) => {
    await page.goto("/p/celina-leao");
    const s = page.getByTestId("sucessao");
    await expect(s).toContainText("o governador renunciou em 28/03/2026");
    await expect(s).not.toContainText("para disputar");
    await axe();
    await page.goto("/p/mailza");
    await expect(page.getByTestId("sucessao")).toContainText("o governador renunciou em 02/04/2026");
  });

  test("B034-3 vice do AM: motivo cita Serafim Corrêa com fonte oficial", async ({ page }) => {
    await page.goto("/representantes?cidade=1302603");
    const gap = page.getByTestId("lacuna").filter({ hasText: /Vice-gov/ });
    await expect(gap).toContainText("Serafim Corrêa é o vice-governador desde 04/05/2026");
    await expect(gap).not.toContainText("não achamos o ato");
  });
});
