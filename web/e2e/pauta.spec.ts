import { expect, test } from "./fixtures";

// Pauta "No seu bolso" (canvas, critérios de aceite). Roda nos dados de demonstração: dois itens reais de 04/11/2026.
const FORBIDDEN = /beneficia|prejudica|polêmica|ataque|conquista|retrocesso|avanço|vitória|derrota|absurdo|finalmente|pressione|fique de olho|!/i;

test.describe("Pauta no seu bolso", () => {
  test("PA-H1 número com definição e hora da leitura; igual à lista do plenário", async ({ page, axe }) => {
    await page.goto("/no-seu-bolso");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText(/propostas? pode(m)? mexer no que você paga ou recebe nesta semana/);
    const n = Number((await h1.locator("span.font-display").innerText()).trim());
    await expect(page.getByText(/^Contamos propostas sobre dinheiro, trabalho e benefícios/)).toBeVisible();
    await expect(page.getByText(/Pauta lida em \d{2}\/\d{2}, \d{2}:\d{2}/).first()).toBeVisible();
    await axe();
    await page.getByRole("link", { name: /Ver tudo o que vem aí/ }).click();
    await expect(page.locator("section[aria-labelledby=semana-h] li")).toHaveCount(n);
    await expect(page.locator("main")).not.toContainText(FORBIDDEN);
  });

  test("PA-H2 página da proposta: motivo, revisão pendente, texto oficial e quem decide", async ({ page, axe }) => {
    await page.goto("/proposta/camara-pl-79-2020");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("PL 79/2020");
    await expect(page.getByText("Câmara dos Deputados · PL · lei comum")).toBeVisible();
    await expect(page.getByText(/Termo na ementa: "contribuição"/)).toBeVisible();
    await expect(page.getByText("Aguardando revisão").first()).toBeVisible();
    await expect(page.locator("#quem-decide")).toContainText("A mensagem é sua: não sugerimos texto.");
    await expect(page.locator("main")).not.toContainText(FORBIDDEN);
    await axe();
  });

  test("PA-E1 endereço fora da regra dá 404 em português", async ({ page, request }) => {
    expect((await request.get("/proposta/camara-pl-1-1999")).status()).toBe(404);
    await page.goto("/proposta/camara-pl-1-1999");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proposta não encontrada");
  });

  test("PA-E2 navegação sem link para página em construção", async ({ page }) => {
    await page.goto("/no-seu-bolso");
    for (const href of await page.locator("header a, footer a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
      expect(href).not.toMatch(/^\/(partidos|governos|eleicoes|stf|impostos|sobre|dados-abertos|entrar|sugestoes)/);
    }
  });
});
