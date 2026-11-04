import { expect, test } from "./fixtures";

test.describe("W2 · S19 Dicionário", () => {
  test("S19-H1 pelo menos 80 termos, cada um com fonte e âncora", async ({ page, axe }) => {
    await page.goto("/dicionario");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dicionário");
    await axe();
    const cards = page.locator("li[id^='termo-']");
    expect(await cards.count()).toBeGreaterThanOrEqual(80);
    const bad = await cards.evaluateAll((els) =>
      els.filter((e) => !e.querySelector("a[href^='https://'][target=_blank][rel*=noopener]") || !(e.querySelector("p")?.textContent || "").trim()).map((e) => e.id),
    );
    expect(bad).toEqual([]);
  });

  test("S19-H2 filtro por tema e busca pela URL (sem JS)", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_BASE_URL });
    const page = await ctx.newPage();
    await page.goto("/dicionario?tema=justica");
    const n = await page.locator("li[id^='termo-']").count();
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(40);
    await expect(page.locator("#tema-leis")).toHaveCount(0);
    await page.goto("/dicionario?q=" + encodeURIComponent("orcamento"));
    await expect(page.locator("#termo-orcamento-publico")).toHaveCount(1);
    await page.goto("/dicionario?q=xyzxyz");
    await expect(page.getByText("Não achamos esse termo")).toBeVisible();
    // formulário funciona sem JS
    await page.goto("/dicionario");
    await page.getByLabel("Procurar um termo").fill("veto");
    await page.locator("select[name=tema]").selectOption("leis");
    await page.getByRole("button", { name: "Procurar no dicionário" }).click();
    await expect(page).toHaveURL(/q=veto/);
    await expect(page.locator("#termo-veto")).toHaveCount(1);
    await ctx.close();
  });

  test("S19-H3 índice A–Z leva ao grupo e âncora de termo rola até ele", async ({ page }) => {
    await page.goto("/dicionario");
    await expect(page.getByRole("navigation", { name: "Índice de A a Z" }).locator("a").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Índice de A a Z" }).getByRole("link", { name: "V", exact: true }).click();
    await expect(page.locator("#letra-V")).toBeInViewport();
    await page.goto("/dicionario#termo-veto");
    await expect(page.locator("#termo-veto")).toBeInViewport();
  });

  test("S19-E1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/dicionario");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto("/dicionario?tema=controle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test.describe("tema escuro", () => {
    test.use({ colorScheme: "dark" });
    test("S19-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/dicionario");
      await axe();
    });
  });
});
