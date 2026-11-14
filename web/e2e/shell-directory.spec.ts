import { CAMPINAS, expect, test } from "./fixtures";

test.describe("Shell e diretório", () => {
  test("SH-H1 skip link, navegação v1, tema persiste, aria-current", async ({ page }) => {
    await page.goto("/no-seu-bolso");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Pular para o conteúdo" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#conteudo")).toBeFocused();
    const nav = page.getByRole("navigation", { name: "Principal" });
    await expect(nav.getByRole("link")).toHaveText(["Entrada", "Vem aí", "Já decidido", "Quem eu votei", "Como escolhemos", "Correções"]);
    await expect(nav.getByRole("link", { name: "Entrada" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Vem aí" }).click();
    await expect(page).toHaveURL(/\/pauta$/);
    await expect(nav.getByRole("link", { name: "Vem aí" })).toHaveAttribute("aria-current", "page");
    const dark = page.getByRole("radio", { name: "Tema escuro" });
    // a página de destino é pesada em dev: um clique antes da hidratação é perdido, então repete até pegar
    await expect(async () => {
      await dark.click();
      await expect(dark).toHaveAttribute("aria-checked", "true", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Tema do sistema" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  });

  test("SH-E1 rota desconhecida dá 404 com navegação", async ({ page, request }) => {
    expect((await request.get("/xyz-nao-existe")).status()).toBe(404);
    await page.goto("/xyz-nao-existe");
    // D316: o 404 do site é o da Direção 2
    await expect(page.getByRole("navigation", { name: "Perguntas" })).toBeVisible();
  });

  test("SH-E2 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto(CAMPINAS);
    const a = await page.locator("#vereadores a[href^='/p/']").nth(0).getAttribute("href");
    const b = await page.locator("#vereadores a[href^='/p/']").nth(1).getAttribute("href");
    for (const u of ["/", "/no-seu-bolso", "/sobre", "/atualizacoes", "/dados-abertos", "/congresso", CAMPINAS, a!, `/comparar?p=${a!.split("/").pop()},${b!.split("/").pop()}`, "/quem"]) {
      await page.goto(u);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - 390), u).toBeLessThanOrEqual(0);
    }
  });

  test("S04-H1 diretório filtra, pagina e conta", async ({ page, axe }) => {
    await page.goto("/quem");
    await axe();
    await page.locator("select[name=cargo]").selectOption("senador");
    await page.locator("select[name=uf]").selectOption("SP");
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
