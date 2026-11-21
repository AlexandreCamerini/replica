import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Visão consolidada do mandato (painel em /pessoa/[slug] e página /pessoa/[slug]/mandato). Demo/fake (DATA_SOURCE=demo).
// Critérios: a11y, ordem A–Z, "—" no lugar de 0, "desde AAAA" em todo número, e nenhuma comparação, ranking ou média.
// Escrito para rodar fora do sandbox (Playwright não roda lá).

const FEDERAL = "helena-siqueira"; // senadora: tem gasto na demo
const VEREADOR = "alvaro-coutinho-sp"; // vereador: cota municipal não lida, só lacuna com motivo
const PROIBIDO = /\b(ranking|média|na média|acima da média|abaixo da média|mais gastou|menos gastou|maior gasto|menor gasto|beneficia|polêmic|total do mandato)/i;

test.describe("painel do mandato na Pessoa", () => {
  test("quatro blocos, cada um uma pergunta, sem violação de a11y", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}`);
    const painel = page.getByTestId("painel-mandato");
    await expect(painel).toBeVisible();
    for (const q of ["Qual é o mandato?", "Quanto custou?", "O que fez?", "O que ficou de fora?"]) {
      await expect(painel.getByRole("heading", { name: q })).toBeVisible();
    }
    const r = await new AxeBuilder({ page }).include('[data-testid="painel-mandato"]').analyze();
    expect(r.violations).toEqual([]);
  });

  test("todo número de atuação diz desde quando; sem comparação, ranking ou média", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}`);
    const texto = await page.getByTestId("painel-mandato").innerText();
    expect(texto).not.toMatch(PROIBIDO);
    // cada linha (dt/dd) do bloco que traz número carrega o próprio "desde"/"a partir de"
    const linhas = page.getByTestId("bloco-fez").locator(".sv-pm__r");
    for (const l of await linhas.all()) {
      const t = await l.innerText();
      if (/\d/.test(t) && !/sem dado/.test(t)) expect(t).toMatch(/(desde|a partir de) (\d{4}|\d{2}\/\d{4})/);
    }
  });

  test("sem dado, '—' e o motivo, nunca 0", async ({ page }) => {
    await page.goto(`/pessoa/${VEREADOR}`);
    const painel = page.getByTestId("painel-mandato");
    await expect(painel.getByTestId("bloco-fora")).toBeVisible();
    const fez = await painel.getByTestId("bloco-fez").innerText();
    expect(fez).not.toMatch(/(^|\n)\s*0\s*(\n|$)|\b0 (votos|propostas|discursos|comiss)/i);
    const custo = await painel.getByTestId("bloco-custo").innerText();
    expect(custo).not.toMatch(/R\$\s*0,00/);
  });

  test("só soma salário e cota quando os dois existem, e diz o que ficou fora", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}`);
    const custo = page.getByTestId("bloco-custo");
    const t = await custo.innerText();
    if (/de salário e cota/.test(t)) {
      await expect(custo.getByText(/Soma do que está carregado/)).toBeVisible();
      expect(t).toMatch(/desde \d{4}/);
      await expect(custo.getByText(/A soma cobre de \d{2}\/\d{4} a \d{2}\/\d{4}/)).toBeVisible();
    } else {
      await expect(custo.getByText(/Não somamos: faltam?/)).toBeVisible();
    }
  });
});

test.describe("página /pessoa/[slug]/mandato", () => {
  test("a11y e fonte com data da leitura em cada quadro", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}/mandato`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations).toEqual([]);
    const fontes = page.locator(".sv-fonte", { hasText: /^Fonte:/ });
    expect(await fontes.count()).toBeGreaterThanOrEqual(2);
  });

  test("categorias em ordem A–Z e meses em ordem cronológica, nunca por valor", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}/mandato`);
    const cats = await page.getByTestId("tabela-categorias-mandato").locator("tbody th").allInnerTexts();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats).toEqual([...cats].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const meses = await page.getByTestId("tabela-meses-mandato").locator("tbody tr").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-mes")));
    expect(meses.length).toBeGreaterThan(0);
    expect(meses).toEqual([...meses].sort());
  });

  test("mês sem nota mostra '—', não R$ 0", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}/mandato`);
    const tabela = page.getByTestId("tabela-meses-mandato");
    const vazios = tabela.locator("tbody tr", { hasText: "sem nota" });
    for (const v of await vazios.all()) await expect(v.locator("td").first()).not.toContainText("R$");
    await expect(tabela).not.toContainText("R$ 0,00");
  });

  test("diz 'desde AAAA' e não diz 'total do mandato'; sem comparação, ranking ou média", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}/mandato`);
    const t = await page.locator("main, .sv-pg").first().innerText();
    expect(t).toMatch(/desde \d{4}/);
    expect(t).not.toMatch(PROIBIDO);
  });

  test("link para o nota a nota que já existe", async ({ page }) => {
    await page.goto(`/pessoa/${FEDERAL}/mandato`);
    const href = await page.getByRole("link", { name: "Ver nota por nota" }).getAttribute("href");
    expect(href).toBe(`/pessoa/${FEDERAL}/gastos`);
    expect((await page.request.get(href!)).status()).toBe(200);
  });

  test("cargo sem cota: lacuna com motivo, sem tabela e sem R$ 0", async ({ page }) => {
    await page.goto(`/pessoa/${VEREADOR}/mandato`);
    await expect(page.getByTestId("tabela-categorias-mandato")).toHaveCount(0);
    await expect(page.getByTestId("bloco-fora")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/R\$\s*0,00/);
  });

  test("390 px sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const u of [`/pessoa/${FEDERAL}`, `/pessoa/${FEDERAL}/mandato`]) {
      await page.goto(u);
      const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sobra).toBeLessThanOrEqual(0);
    }
  });

  test("pessoa que não existe: 404", async ({ page }) => {
    expect((await page.goto("/pessoa/nao-existe-xyz/mandato"))?.status()).toBe(404);
  });
});
