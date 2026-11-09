import { expect, test } from "./fixtures";

// Pacote D · U08 grade de presença, U09 hemiciclo Hoje / fev-2027, U10 calendário da pauta.
// Roda nos dados de demonstração; os blocos com E2E_PG conferem o mesmo contra o banco real.
test.describe("Pacote D · Congresso de 2027", () => {
  test("U08 grade de presença: cheios = presenças, fora do exercício fora da conta, aria-label com data e estado", async ({ page, axe }) => {
    await page.goto("/congresso");
    await page.locator('a[href^="/votacoes/"]').first().click();
    await page.locator('[aria-labelledby="pessoas-h"] a[href^="/p/"]').first().click();
    const grid = page.getByTestId("grade-presenca");
    await expect(grid).toBeVisible();
    const squares = grid.locator('ul[aria-label^="Presença em cada sessão"] [role="img"]');
    const n = await squares.count();
    expect(n).toBeGreaterThan(0);
    // todo quadrado diz a data e o estado
    for (const l of await squares.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))) expect(l).toMatch(/^\d{2}\/\d{2}\/\d{4}: (presente|ausente|ausência justificada|fora do exercício)$/);
    const full = await grid.locator('ul[aria-label^="Presença em cada sessão"] .vS').count();
    const outside = await grid.locator('ul[aria-label^="Presença em cada sessão"] .vA').count();
    // o mesmo número do bloco "em números": X de Y
    const cell = await page.getByTestId("ano-em-numeros").innerText();
    const m = /\((\d+) de (\d+)\)/.exec(cell);
    expect(m, "presença X de Y no bloco do ano").not.toBeNull();
    expect(full).toBe(Number(m![1]));
    expect(n - outside).toBe(Number(m![2]));
    await expect(page.getByTestId("grade-total")).toContainText(`${full} presenças em ${n - outside} sessões`);
    await axe();
  });

  test("U08 os quatro padrões: pontilhado (fora do exercício) fica fora do denominador", async ({ page }) => {
    await page.goto("/design");
    const grid = page.getByTestId("grade-presenca");
    const list = grid.locator('ul[aria-label^="Presença em cada sessão"]');
    await expect(list.locator(".vS")).toHaveCount(3);
    await expect(list.locator(".vX")).toHaveCount(1);
    await expect(list.locator(".vN")).toHaveCount(1);
    await expect(list.locator(".vA")).toHaveCount(1);
    await expect(list.locator('[aria-label="17/03/2026: fora do exercício"]')).toHaveCount(1);
    await expect(page.getByTestId("grade-total")).toContainText("3 presenças em 5 sessões");
    await expect(grid).toContainText("1 fora do exercício, que não contam como falta");
  });

  for (const [casa, capacity] of [["camara", 513], ["senado", 81]] as const) {
    test(`U09 hemiciclo ${casa}: ${capacity} cadeiras nos dois modos, só continua / entra / sai`, async ({ page, axe }) => {
      await page.goto(casa === "senado" ? "/congresso?casa=senado" : "/congresso");
      const fig = page.getByTestId("hemiciclo-posse");
      const circles = fig.locator("circle");
      await expect(circles).toHaveCount(capacity);
      const kinds = async () => circles.evaluateAll((cs) => cs.map((c) => c.getAttribute("data-kind")));
      const hoje = await kinds();
      expect(new Set(hoje.filter((k) => k !== "vazio"))).toEqual(new Set(["continua", "sai"]));
      expect(hoje.filter((k) => k === "entra")).toHaveLength(0);
      // nenhuma cor de partido: só a tinta do tema e o papel
      const fills = await circles.evaluateAll((cs) => [...new Set(cs.map((c) => c.getAttribute("fill")))]);
      for (const f of fills) expect(f).toMatch(/^(var\(--text\)|var\(--surface\)|url\(#hach-\d+\))$/);
      await fig.getByRole("button", { name: "A partir de fev/2027" }).click();
      await expect(fig.getByRole("button", { name: "A partir de fev/2027" })).toHaveAttribute("aria-pressed", "true");
      await expect(circles).toHaveCount(capacity);
      const fev = await kinds();
      expect(fev.filter((k) => k === "sai")).toHaveLength(0);
      const entra = fev.filter((k) => k === "entra").length;
      expect(entra).toBeGreaterThan(0);
      // "entra" no resumo e na legenda é o mesmo número do desenho
      await expect(fig.getByTestId("posse-resumo")).toContainText(`${capacity} cadeiras`);
      await expect(fig.getByTestId("posse-resumo")).toContainText(`${entra} entra`);
      await expect(fig.getByTestId("posse-resumo")).not.toContainText(/partido|PT|PL\b/);
      await axe();
    });
  }

  test("U10 calendário: números = itens da lista, próxima sessão e consultado há N min", async ({ page, axe }) => {
    await page.goto("/pauta");
    const cal = page.getByTestId("pauta-calendario");
    await expect(cal).toBeVisible();
    const counts = await cal.locator("[data-n]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-n"))));
    const shown = counts.reduce((a, b) => a + b, 0);
    const listed = await page.locator("section[aria-labelledby=semana-h] li, #depois li").count();
    expect(shown).toBe(listed);
    expect(shown).toBeGreaterThan(0);
    await expect(cal.getByTestId("proxima-sessao")).toContainText(/Próxima sessão: \w+ \d{2}\/\d{2}, \d{2}h|Nenhuma sessão marcada/);
    await expect(cal.getByTestId("consultado-ha")).toHaveText(/^consultado há \d+ (min|h|d)$/);
    await expect(cal.getByTestId("pauta-leituras")).toContainText("Câmara 9 reuniões lidas, 0 sem carregar · Senado 12 reuniões lidas, 0 sem carregar");
    await expect(cal.getByRole("alert")).toHaveCount(0);
    // um dia com item leva à lista
    await cal.locator("a[data-n]").first().click();
    await expect(page).toHaveURL(/#(dia-\d{4}-\d{2}-\d{2}|depois)$/);
    await axe();
  });

  test("U10 estado de erro do v1 com events_failed > 0", async ({ page, axe }) => {
    await page.goto("/pauta?simular=erro");
    const err = page.getByTestId("pauta-erro-camara");
    await expect(err).toBeVisible();
    await expect(err).toContainText("Não conseguimos ler a pauta da Câmara. Última leitura:");
    await expect(err).toContainText("2 de 9 reuniões não carregaram");
    await expect(err.getByRole("link", { name: "Tentar de novo" })).toBeVisible();
    await expect(page.getByTestId("pauta-erro-senado")).toHaveCount(0);
    await expect(page.getByTestId("pauta-leituras")).toContainText("Câmara 9 reuniões lidas, 2 sem carregar");
    await axe();
  });

  test("U10 calendário sem rolagem horizontal e com alvo de 44 px @mobile", async ({ page }) => {
    await page.goto("/pauta");
    const cal = page.getByTestId("pauta-calendario");
    await expect(cal).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cell = cal.locator("a[data-n]").first();
    const box = await cell.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/congresso");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
