import { CAMPINAS, expect, test } from "./fixtures";

test.describe("Shell e diretório", () => {
  test("SH-H1 skip link, menu Mais por teclado, tema persiste, aria-current", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#conteudo")).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
    const more = page.getByRole("button", { name: "Mais" });
    await more.focus();
    await page.keyboard.press("Enter");
    const item = page.getByRole("menuitem", { name: "Quem publica dados" });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/dados-abertos/);
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quem publica dados");
    const dark = page.getByRole("radio", { name: "Tema escuro" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Tema do sistema" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  });

  test("SH-E1 rota desconhecida dá 404 com navegação", async ({ page, request }) => {
    expect((await request.get("/xyz-nao-existe")).status()).toBe(404);
    await page.goto("/xyz-nao-existe");
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  });

  test("SH-E2 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto(CAMPINAS);
    const a = await page.locator("#vereadores a[href^='/p/']").nth(0).getAttribute("href");
    const b = await page.locator("#vereadores a[href^='/p/']").nth(1).getAttribute("href");
    for (const u of ["/", CAMPINAS, a!, `/comparar?p=${a!.split("/").pop()},${b!.split("/").pop()}`, "/quem"]) {
      await page.goto(u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), u).toBeLessThanOrEqual(0);
    }
  });

  test("S04-H1 diretório filtra, pagina e conta", async ({ page, axe }) => {
    await page.goto("/quem");
    await axe();
    await page.getByLabel("Cargo").selectOption("senador");
    await page.getByLabel("Estado").selectOption("SP");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page).toHaveURL(/cargo=senador/);
    await expect(page).toHaveURL(/uf=SP/);
    await expect(page.getByText(/^[\d.]+ pessoas?/)).toBeVisible();
    const cards = page.locator('a[href^="/p/"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
    expect(await cards.count()).toBeLessThanOrEqual(3);
    await page.goto("/quem?cargo=vereador");
    await expect(page.getByText(/mostrando 1–60/)).toBeVisible();
    await page.getByRole("link", { name: "Próximas →" }).click();
    await expect(page).toHaveURL(/pagina=60/);
    await expect(page.getByText(/mostrando 61–/)).toBeVisible();
    await page.getByRole("navigation", { name: "Primeira letra do nome" }).getByRole("link", { name: "z", exact: true }).click();
    await expect(page).toHaveURL(/letra=z/);
    const names = await page.locator('a[href^="/p/"]').allTextContents();
    for (const n of names) expect(n.trim().toLowerCase().normalize("NFD")[0]).toBe("z");
  });

  test("S04-E1/E2 filtro inválido ignorado; nenhum resultado explica", async ({ page }) => {
    await page.goto("/quem?partido=xxx&letra=9&cargo=rei");
    await expect(page.getByText(/^[\d.]+ pessoas?/)).toBeVisible();
    await page.goto("/quem?nome=zzzzzzzz");
    await expect(page.getByText(/Ninguém no cargo com esses filtros/)).toBeVisible();
    await page.getByRole("link", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL(/\/quem$/);
  });
});
