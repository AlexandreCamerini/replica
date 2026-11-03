import { expect, test } from "./fixtures";

const SLUGS = ["presidente", "senador", "deputado-federal", "governador", "deputado-estadual", "prefeito", "vereador", "ministro-do-stf"];

test.describe("W2 · S18 Entenda os cargos", () => {
  test("S18-H1 os oito cargos com mandato, eleição, fiscalização e artigo", async ({ page, axe }) => {
    await page.goto("/cargos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entenda os cargos");
    await axe();
    for (const s of SLUGS) {
      const sec = page.locator(`section#${s}`);
      await expect(sec, s).toHaveCount(1);
      for (const h of ["O que faz", "O que pode", "O que não pode", "Quem fiscaliza", "Mandato"]) await expect(sec.getByText(h, { exact: true }), `${s} ${h}`).toBeVisible();
      await expect(sec).toContainText(/art\./);
      await expect(page.getByRole("navigation", { name: "Cargos" }).locator(`a[href="#${s}"]`)).toHaveCount(1);
    }
    await expect(page.locator("#ministro-do-stf")).toContainText("não eletivo");
  });

  test("S18-H2 diagrama tem nome e a lista traz as mesmas relações", async ({ page }) => {
    await page.goto("/cargos");
    await expect(page.getByRole("img", { name: "Quem faz o quê com quem" })).toBeVisible();
    const items = page.locator("#quem-faz-o-que ol > li");
    expect(await items.count()).toBeGreaterThanOrEqual(8);
    await expect(items.first()).toContainText("Eleitores");
  });

  test("S18-H3 links para o dicionário resolvem para termos existentes", async ({ page, request }) => {
    await page.goto("/cargos");
    const hrefs = await page.locator("a[href^='/dicionario#termo-']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
    expect(hrefs.length).toBeGreaterThan(5);
    const html = await (await request.get("/dicionario")).text();
    for (const h of hrefs) expect(html, h).toContain(`id="${h.split("#")[1]}"`);
  });

  test("S18-E1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/cargos");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test.describe("tema escuro", () => {
    test.use({ colorScheme: "dark" });
    test("S18-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/cargos");
      await axe();
    });
  });
});
