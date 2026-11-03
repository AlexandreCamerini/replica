import { expect, test } from "./fixtures";

// build 6 · A: correções de tela pedidas pelo lote de dados (D30–D44). Dependem do banco real.
test.describe("B6-A correções de front do ETL", () => {
  test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");
  const tiles = "section[aria-labelledby='numeros-h']";

  test("B6-A1 presença: sessões deliberativas na Câmara; Senado \"—\" com motivo", async ({ page, axe }) => {
    await page.goto("/p/adriana-ventura");
    await expect(page.locator(tiles)).toContainText(/sessões deliberativas/);
    await page.goto("/p/randolfe-rodrigues");
    const presence = page.locator(`${tiles} > div > div`).filter({ hasText: /^—\s*presença/ });
    await expect(presence).toContainText("o Senado não publica a lista de presença por senador");
    await page.goto("/comparar?p=adriana-ventura,randolfe-rodrigues");
    const row = page.getByRole("row", { name: /Presença em sessões deliberativas/ });
    await expect(row).toContainText(/\d+% \(/);
    await expect(row).toContainText("—");
    await axe();
  });

  test("B6-A2 renúncia e sucessão do vice no crachá", async ({ page }) => {
    await page.goto("/p/zema");
    await expect(page.getByTestId("fora-do-cargo")).toContainText(/Renunciou ao cargo em \d{2}\/\d{2}\/\d{4}/);
    await expect(page.locator("[data-status='renunciou']")).toContainText(/Renunciou em/);
    await page.goto("/p/mailza");
    await expect(page.locator("[data-status='em_exercicio']")).toContainText(/por sucessão/);
  });

  test("B6-A3 campanha somada por ano de eleição (2º turno não conta de novo)", async ({ page }) => {
    await page.goto("/p/tarcisio");
    await expect(page.locator(tiles)).toContainText("R$ 69.110.114");
    await expect(page.locator(tiles)).toContainText(/arrecadou em 2 campanhas/);
  });

  test("B6-A5 teto e \"não conferido\" nunca juntos", async ({ page }) => {
    await page.goto("/p/rubinho-nunes");
    await expect(page.locator(tiles)).toContainText("teto do salário");
    await expect(page.getByText(/dados? ainda não est/)).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Salário dos vereadores");
  });

  test("B6-A7 Executivo sem lista do Legislativo; carreira com a janela; \"—\" quando não carregado", async ({ page, axe }) => {
    await page.goto("/p/tarcisio");
    await expect(page.getByTestId("executivo")).toBeVisible();
    for (const t of ["Presença em sessões", "Votos em plenário", "Propostas apresentadas", "Gastos do gabinete", "Salário dos deputados estaduais"])
      await expect(page.locator("main")).not.toContainText(t);
    await page.goto("/p/adriana-ventura");
    await expect(page.locator(tiles)).toContainText(/propostas desde 2019/);
    await expect(page.locator(tiles)).not.toContainText(/na carreira/);
    await axe();
  });

  test("B6-A6 Senado: propostas, cota, votação secreta e emendas rotuladas", async ({ page, axe }) => {
    await page.goto("/p/randolfe-rodrigues");
    await expect(page.locator("#propostas ol li").first()).toBeVisible();
    await expect(page.locator("#propostas")).toContainText("Fonte: Senado Federal");
    await expect(page.locator("#gastos table").first()).toBeVisible();
    await expect(page.getByTestId("votos-secretos")).toContainText(/votaç(ão|ões) secretas?/);
    await expect(page.locator("#votos")).not.toContainText(/secreta.*Não votou/);
    await page.goto("/congresso?casa=senado");
    const secret = page.locator("li").filter({ hasText: "votação secreta" }).first();
    await secret.getByRole("link").click();
    await expect(page.getByTestId("votacao-secreta")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Voto de cada pessoa/ })).toHaveCount(0);
    await axe();
    await page.goto("/p/adriana-ventura?tipo=emenda#propostas");
    const first = page.locator("#propostas ol li").first();
    await expect(first).toContainText(/^(EMC|EMP|EMR|ESB) /);
    await expect(first).toContainText("emenda");
  });
});
