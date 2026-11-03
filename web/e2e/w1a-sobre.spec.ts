import { expect, test } from "./fixtures";

test.describe("W1a · S22 Metodologia e fontes", () => {
  test("S22-H1 âncoras do texto, sumário e links oficiais", async ({ page, axe }) => {
    await page.goto("/sobre");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Metodologia e fontes");
    await axe();
    for (const id of ["neutralidade", "fontes", "presenca", "traco", "identidade", "atualizacao", "s-priv", "s-resposta"]) {
      await expect(page.locator(`section#${id}`), id).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Neste texto" }).locator(`a[href="#${id}"]`), `sumário ${id}`).toHaveCount(1);
    }
    await page.goto("/sobre#s-priv");
    await expect(page.locator("#s-priv")).toBeInViewport();
    const ext = page.locator("#fontes a[target=_blank]");
    expect(await ext.count()).toBeGreaterThanOrEqual(8);
    for (const a of await ext.all()) await expect(a).toHaveAttribute("rel", /noopener/);
    // regra de presença e "—" vs 0 estão escritas
    await expect(page.locator("#presenca")).toContainText("Presente");
    await expect(page.locator("#traco")).toContainText("não é zero");
  });

  test("S22-H2 todo link do rodapé e do menu Mais resolve", async ({ page, request }) => {
    await page.goto("/sobre");
    const hrefs = await page.locator("footer a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThan(10);
    for (const h of hrefs) expect((await request.get(h)).status(), h).toBeLessThan(400);
  });

  test("S22-E1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/sobre");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
