import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// D328: em "O que fizeram por último?" (/acompanhando) a mesma frase não aparece duas vezes.
// Causa em produção (16/11/2026): várias votações nominais da mesma proposta no mesmo dia (texto-base, destaques, turnos) e
// gastos iguais no mesmo dia eram escritos com a mesma frase. A demonstração não gera esse caso sozinha (lá cada votação
// tem descrição própria): `?simular=atos_repetidos` injeta as repetições, como em simular.ts. A regra do agrupamento tem
// teste unitário com as linhas reais de produção (sv-agrupar-atos.test.ts).

const SIGO = ["helena-siqueira", "alvaro-teixeira-sp", "bruno-sampaio"]; // federal (com votos), estadual e municipal
const cookies = [
  { name: "sv_uf", value: "SP", domain: "localhost", path: "/" },
  { name: "sv_sigo", value: SIGO.join("."), domain: "localhost", path: "/" },
];
const quadro = (page: import("@playwright/test").Page) => page.locator('[aria-labelledby="esc-recentes"]');
const frases = async (page: import("@playwright/test").Page) =>
  (await quadro(page).locator(".sv-esc__fd > li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

test.describe("O que fizeram por último: sem linha repetida", () => {
  test("o caso que duplicava: votações da mesma proposta no mesmo dia viram uma linha, com a contagem e um link para cada", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/acompanhando?simular=atos_repetidos");
    const linhas = await frases(page);
    expect(linhas.length).toBeGreaterThan(2);
    expect(linhas.length, "no máximo 8 linhas").toBeLessThanOrEqual(8);
    expect(new Set(linhas).size, `nenhuma frase repetida: ${JSON.stringify(linhas)}`).toBe(linhas.length);
    // três registros do mesmo voto (um deles o mesmo registro lido duas vezes) = 2 votações, uma linha
    const voto = quadro(page).locator(".sv-esc__fd > li", { hasText: "em 2 votações de" });
    await expect(voto).toHaveCount(1);
    await expect(voto).toContainText(/(votou|ficou) .+ em 2 votações de .+ neste dia: votação 1, votação 2\./);
    await expect(voto.locator("i.sv-m")).toHaveCount(1); // o voto segue em forma e palavra, uma vez
    const links = voto.locator("a");
    await expect(links).toHaveCount(2);
    const destinos = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(new Set(destinos).size, "cada link leva a uma votação diferente").toBe(2);
    for (const d of destinos) expect(d).toMatch(/^\/votacao\//);
    // o nome acessível de cada link diz qual votação, de qual proposta e de quem
    await expect(links.first()).toHaveAttribute("aria-label", /^votação 1 de 2: .+, .+/);
    await links.nth(1).click();
    await expect(page).toHaveURL(/\/votacao\//);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("dois gastos iguais no mesmo dia viram uma linha, que diz que são dois", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/acompanhando?simular=atos_repetidos");
    const gasto = quadro(page).locator(".sv-esc__fd > li", { hasText: "gastos registrados" });
    await expect(gasto).toHaveCount(1);
    await expect(gasto).toContainText("teve 2 gastos registrados em Divulgação da atividade parlamentar, de R$ 60,26 cada.");
    await expect(quadro(page).locator(".sv-esc__fd > li", { hasText: "teve gasto registrado" })).toHaveCount(0);
  });

  test("sem repetição na fonte, a lista segue com uma linha por registro, a mais recente primeiro", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/acompanhando");
    const linhas = await frases(page);
    expect(linhas.length).toBe(8);
    expect(new Set(linhas).size).toBe(linhas.length);
    await expect(quadro(page)).not.toContainText(/em \d+ votações de|gastos registrados/);
    const datas = linhas.map((l) => l.slice(0, 10).split("/").reverse().join("-"));
    expect(datas, "mais recente primeiro").toEqual([...datas].sort().reverse());
    await expect(quadro(page).locator(".sv-prova")).toContainText(/Mais recente primeiro\. Fonte: .+\d{2}\/\d{2}\/\d{4}/);
  });

  test("com as linhas agrupadas: axe sem violação, sem estouro a 390px e igual sem JavaScript", async ({ browser }, info) => {
    for (const javaScriptEnabled of [true, false]) {
      const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled, locale: "pt-BR", viewport: { width: 390, height: 844 } });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      await page.goto("/acompanhando?simular=atos_repetidos");
      await expect(quadro(page).locator(".sv-esc__fd > li", { hasText: "em 2 votações de" })).toHaveCount(1);
      const larguras = await page.locator("html").evaluate((h) => [h.scrollWidth, h.clientWidth]);
      expect(larguras[0], "sem rolagem horizontal").toBeLessThanOrEqual(larguras[1]);
      if (javaScriptEnabled) {
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      }
      await ctx.close();
    }
  });
});
