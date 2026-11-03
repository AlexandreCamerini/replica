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

  // D228: Serafim Corrêa virou mandato (fonte ALEAM), não mais motivo de vaga
  test("B034-3 vice do AM: Serafim Corrêa aparece como vice com a ALEAM como fonte", async ({ page }) => {
    await page.goto("/p/serafim-correa");
    await expect(page.getByText(/Vice-governador/).first()).toBeVisible();
    await expect(page.getByText("situação segundo a Assembleia Legislativa do Amazonas").first()).toBeVisible();
  });
});
