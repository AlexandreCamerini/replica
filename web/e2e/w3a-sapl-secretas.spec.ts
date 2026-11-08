import { expect, test } from "./fixtures";

// W3-A (pedido do orquestrador após a W3-B): vereador de câmara lida pelo SAPL (D126–D129) e votação secreta pela fonte (D123/D124).
test.describe("W3-A · SAPL no crachá de vereador e votação secreta pela fonte", () => {
  test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");

  test("W3A-S1 vereador de Porto Velho: projetos, presença sem % e votos, com fonte SAPL e data", async ({ page, axe }) => {
    await page.goto("/p/wanoel-martins");
    const sec = page.locator("#camara-municipal");
    await expect(sec.getByRole("heading", { level: 2 })).toHaveText("Na Câmara Municipal de Porto Velho");
    for (const d of ["propostas", "presenca", "votos"]) await expect(sec.locator(`li[data-dataset=${d}]`).getByText(/^Fonte:/)).toBeVisible();
    await expect(sec.locator("li[data-dataset=propostas] [data-testid=sapl-valor]")).toHaveText(/^\d[\d.]* como primeir[oa] autor[a]? · \d[\d.]* como coautor[a]?$/);
    const pres = sec.locator("li[data-dataset=presenca]");
    await expect(pres.getByTestId("sapl-valor")).toHaveText(/na lista de \d[\d.]* sess(ão|ões)/);
    await expect(pres).not.toContainText("%");
    await expect(pres).toContainText("Sem porcentagem");
    await expect(sec.locator("li[data-dataset=votos] [data-testid=sapl-valor]")).toHaveText(/^\d[\d.]*$/);
    // a nota de "dados que faltam" não diz que o que está no bloco falta
    await expect(page.locator("#missing-title")).not.toContainText(/^4/);
    await axe();
  });

  test("W3A-S2 vereador de Fortaleza: SAPL sem voto nominal vira \"—\" com motivo", async ({ page, axe }) => {
    await page.goto("/p/adail-jr");
    const v = page.locator("#camara-municipal li[data-dataset=votos]");
    await expect(v.getByTestId("sapl-valor")).toHaveText("—");
    await expect(v).toContainText("não tem voto nominal registrado");
    await axe();
  });

  test("W3A-S3 votação do Senado aberta sem voto individual não é rotulada secreta; Câmara não diz nada", async ({ page }) => {
    await page.goto("/votacoes/4ed8458f-900b-4d29-9686-5812f0eabfe2");
    await expect(page.getByTestId("votacao-sem-votos")).toBeVisible();
    await expect(page.getByTestId("votacao-secreta")).toHaveCount(0);
    await page.goto("/votacoes/84a12f9b-09d0-41c9-8b42-2866a3c2676a");
    await expect(page.getByTestId("votacao-sem-votos")).toHaveCount(0);
    await expect(page.getByTestId("votacao-secreta")).toHaveCount(0);
    await expect(page.locator("#pessoas")).toBeVisible();
  });

  test("W3A-S4 crachá de vereador SAPL em 390 px sem rolagem horizontal @mobile", async ({ page }) => {
    await page.goto("/p/wanoel-martins");
    await expect(page.locator("#camara-municipal")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
