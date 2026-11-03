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

  test("B6-W8 comparar: em que votaram diferente, filtro por tema na URL e mostrar mais", async ({ page, axe }) => {
    await page.goto("/comparar?p=adriana-ventura,baleia-rossi");
    const sec = page.locator("#diferente");
    const total = Number((await sec.getByTestId("divergencias-total").innerText()).match(/^([\d.]+)/)![1].replace(/\./g, ""));
    // bate com o cartão "Votaram igual?": total - iguais
    const card = await page.locator("section[aria-labelledby='iguais-h'] li").first().innerText();
    const [same, all] = card.match(/([\d.]+) de ([\d.]+) votações/)!.slice(1).map((x) => Number(x.replace(/\./g, "")));
    expect(total).toBe(all - same);
    const items = sec.getByTestId("divergencias").locator("li");
    await expect(items).toHaveCount(20);
    await sec.getByRole("link", { name: /^Mostrar mais/ }).click();
    await expect(page).toHaveURL(/nd=40/);
    await expect(items).toHaveCount(40);
    await sec.locator('select[name="tema"]').selectOption("saude");
    await sec.getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/tema=saude/);
    await expect(page.locator("#diferente").getByTestId("divergencias-total")).toContainText("em Saúde");
    await axe();
  });

  test("B6-W8 comparar com 3 pessoas escolhe o par pela URL", async ({ page }) => {
    await page.goto("/comparar?p=adriana-ventura,baleia-rossi,randolfe-rodrigues&par=adriana-ventura,randolfe-rodrigues");
    const sec = page.locator("#diferente");
    await expect(sec.getByRole("navigation", { name: "Escolher o par" }).getByRole("link")).toHaveCount(3);
    await expect(sec.locator("[aria-current='true']")).toContainText("Adriana Ventura × Randolfe Rodrigues");
    await expect(sec).toContainText(/Sem votação com votos diferentes/);
  });

  test("B6-W10 salário acumulado desde a posse, com os meses e o que falta carregar", async ({ page }) => {
    await page.goto("/p/adriana-ventura");
    const tile = page.locator("section[aria-labelledby='numeros-h'] > div > div").filter({ hasText: /salário recebido desde/ });
    await expect(tile).toContainText(/R\$\s[\d.]+/);
    // D120 (W3-B): subsídio federal semeado desde 2015, os 94 meses têm valor (antes era "46 de 94")
    await expect(tile).toContainText(/94 meses no cargo desde 02\/2019/);
    await expect(tile).not.toContainText("ainda não está carregado");
    await page.goto("/p/adriana-ventura?ano=2025");
    await expect(page.locator("section[aria-labelledby='numeros-h']")).toContainText(/salário recebido em 2025\s*12 meses no cargo/);
    // teto (vereador) não vira "recebido"
    await page.goto("/p/rubinho-nunes");
    await expect(page.locator("section[aria-labelledby='numeros-h']")).not.toContainText("salário recebido");
  });

  test("B6-W11b como cobrar: contato oficial + ouvidoria da casa; \"—\" com motivo fora do federal", async ({ page, axe }) => {
    await page.goto("/p/adriana-ventura");
    const sec = page.locator("#como-cobrar");
    await expect(sec.getByRole("link", { name: "Contato oficial" })).toHaveAttribute("href", "#contato");
    await expect(sec.getByTestId("ouvidoria").getByRole("link")).toHaveAttribute("href", "https://www.camara.leg.br/ouvidoria");
    await page.goto("/p/randolfe-rodrigues");
    await expect(page.locator("#como-cobrar").getByTestId("ouvidoria").getByRole("link")).toHaveAttribute("href", /senado\.leg\.br/);
    await page.goto("/p/rubinho-nunes");
    await expect(page.locator("#como-cobrar").getByTestId("ouvidoria")).toContainText("ainda não conferimos o canal de ouvidoria da Câmara Municipal");
    await axe();
  });
});
