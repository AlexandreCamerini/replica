import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const TOOLS = ["buscar_politico", "ver_politico", "quem_me_representa", "como_votou", "comparar_votos", "gastos_cota"];

test.describe("S27 · /mcp", () => {
  test("MCP-H1 explica, lista as seis ferramentas e diz que é somente leitura", async ({ page, axe }) => {
    await page.goto("/mcp");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consulte pelo seu assistente de IA");
    await axe();
    const names = await page.locator("[data-tool]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tool")));
    expect(names).toEqual(TOOLS);
    const body = page.locator("main, body").first();
    await expect(body).toContainText("Somente leitura");
    await expect(body).toContainText("claude mcp add civico");
    await expect(body).toContainText("mcpServers");
    await expect(body).toContainText("Ainda não existe um endereço público");
    await expect(body).not.toContainText(/em breve|stub|S27 ·/i);
  });

  test("MCP-H2 as ferramentas da página são as registradas no servidor", async () => {
    const src = readFileSync(join(__dirname, "../../mcp/src/server.ts"), "utf8");
    const reg = [...src.matchAll(/registerTool\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(reg).toEqual(TOOLS);
  });

  test("MCP-H3 links internos resolvem", async ({ page, request }) => {
    await page.goto("/mcp");
    const hrefs = await page.locator("main a[href^='/'], a[href^='/']:not(header a):not(footer a)").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!.split("#")[0]))]);
    for (const h of hrefs.filter((x) => x && !x.startsWith("/api"))) expect((await request.get(h)).status(), h).toBeLessThan(400);
  });

  test("MCP-E1 sem rolagem horizontal em 390 px, blocos de código quebram linha @mobile", async ({ page }) => {
    await page.goto("/mcp");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const over = await page.locator("pre").evaluateAll((ps) => ps.filter((p) => p.scrollWidth > p.clientWidth + 1).length);
    expect(over).toBe(0);
  });

  test.describe("tema escuro", () => {
    test.use({ colorScheme: "dark" });
    test("MCP-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/mcp");
      await axe();
    });
  });
});

test.describe("S26 · /ajudar", () => {
  test("AJ-H1 quatro jeitos com destino certo e apoio financeiro como “—” com motivo", async ({ page, axe }) => {
    await page.goto("/ajudar");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Como ajudar");
    await axe();
    await expect(page.getByRole("link", { name: "Mandar um dado" })).toHaveAttribute("href", "/sugestoes?tipo=dado");
    await expect(page.getByRole("link", { name: "Avisar um erro" })).toHaveAttribute("href", "/sugestoes?tipo=erro");
    await expect(page.getByRole("link", { name: "Achar quem representa a sua cidade" })).toHaveAttribute("href", "/representantes");
    await expect(page.getByRole("link", { name: "Entrar", exact: true }).last()).toHaveAttribute("href", "/entrar");
    const apoio = page.locator("#apoio");
    await expect(apoio.locator("dd").first()).toHaveText("—");
    await expect(apoio).toContainText("responsável pelo site");
    // nada inventado: sem Pix, chave, conta ou valor
    await expect(page.locator("main, body").first()).not.toContainText(/\bpix\b|\bchave\b|agência|\biban\b|R\$\s?\d/i);
    await expect(page.locator("main, body").first()).not.toContainText(/em breve|S26 ·/i);
  });

  test("AJ-H2 o destino “dado” abre o formulário já no tipo certo", async ({ page }) => {
    await page.goto("/ajudar");
    await page.getByRole("link", { name: "Mandar um dado" }).click();
    await expect(page).toHaveURL(/\/sugestoes\?tipo=dado$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sugerir ou corrigir");
  });

  test("AJ-E1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/ajudar");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test.describe("tema escuro", () => {
    test.use({ colorScheme: "dark" });
    test("AJ-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/ajudar");
      await axe();
    });
  });
});
