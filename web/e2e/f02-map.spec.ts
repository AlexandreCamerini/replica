import { expect, test } from "./fixtures";

test.describe("F02 navegar pelo mapa", () => {
  test("F02-H1 UF no mapa → municípios → cidade", async ({ page, axe }) => {
    await page.goto("/");
    await expect(page.getByText(/pessoas no cargo hoje/)).toBeVisible();
    const br = page.getByRole("group", { name: "Estados do Brasil" });
    await expect(br.getByRole("link")).toHaveCount(27);
    await axe();
    await br.getByRole("link", { name: "SP: São Paulo" }).click();
    const sp = page.getByRole("group", { name: "Municípios de São Paulo" });
    await expect(sp).toBeVisible();
    expect(await sp.getByRole("link").count()).toBeGreaterThan(600);
    await expect(page.getByRole("button", { name: "Brasil" })).toBeFocused();
    await axe();
    await sp.getByRole("link", { name: "Campinas", exact: true }).click();
    await expect(page).toHaveURL(/cidade=3509502/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campinas · SP");
  });

  test("F02-H2 teclado: Enter abre o estado, Esc volta", async ({ page }) => {
    await page.goto("/");
    const mg = page.getByRole("group", { name: "Estados do Brasil" }).getByRole("link", { name: "MG: Minas Gerais" });
    await mg.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Municípios de Minas Gerais" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Estados do Brasil" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MG: Minas Gerais" })).toBeFocused();
  });

  test("F02-E1 ?mapa=SP abre no estado; 'Estado inteiro' e região levam à UF", async ({ page }) => {
    await page.goto("/?mapa=SP#mapa");
    await expect(page.getByRole("group", { name: "Municípios de São Paulo" })).toBeVisible();
    await page.getByRole("link", { name: "Estado inteiro" }).click();
    await expect(page).toHaveURL(/uf=SP/);
    await page.goto("/");
    await page.getByRole("link", { name: "Minas Gerais", exact: true }).last().click();
    await expect(page).toHaveURL(/uf=MG/);
  });

  test("F02-E2 sem JavaScript o estado é um link comum", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");
    // o mapa SVG é montado no cliente; sem JS, a lista por região cumpre o mesmo papel
    await page.getByRole("link", { name: "São Paulo", exact: true }).first().click();
    await expect(page).toHaveURL(/uf=SP/);
    await ctx.close();
  });
});
