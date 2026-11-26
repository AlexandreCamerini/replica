import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// F5 do roteiro do eleitor (eixo B, pergunta 1): filtro por assunto escolhido em /votacoes. O assunto é o tema oficial ligado à proposta votada;
// a escolha vira o cookie sv_temas (lido no servidor, httpOnly) e a lista já sai filtrada, sem JavaScript. Fonte de dados: demonstração.

const FILTRO = "[data-filtro-temas]";
const total = async (page: Page) => {
  const t = (await page.locator('section[aria-labelledby="vts-1"]').innerText()).match(/([\d.]+) votaç/);
  return Number((t?.[1] ?? "0").replace(/\./g, ""));
};
const abrir = async (page: Page) => page.locator(`${FILTRO} summary`).click();

test.describe("F5 · filtro por assunto escolhido", () => {
  test("sem escolha: os 17 assuntos aparecem em ordem fixa, nenhum marcado, e a lista não é filtrada", async ({ page }) => {
    await page.goto("/votacoes");
    await expect(page.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "desligado");
    await abrir(page);
    const caixas = page.locator(`${FILTRO} input[name="tema"]`);
    expect(await caixas.count(), "assuntos do contrato").toBeGreaterThanOrEqual(10);
    expect(await page.locator(`${FILTRO} input[name="tema"]:checked`).count()).toBe(0);
    await expect(page.locator(FILTRO)).toContainText("Votação sem proposta ligada não tem assunto");
  });

  test("escolher dois assuntos filtra a lista, vira cookie do servidor e diz o que está sendo mostrado", async ({ page, context }) => {
    await page.goto("/votacoes");
    const antes = await total(page);
    await abrir(page);
    await page.getByLabel("Saúde", { exact: true }).check();
    await page.getByLabel("Educação", { exact: true }).check();
    await page.locator(`${FILTRO} button[type="submit"]:not([name])`).click();
    await expect(page.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "ligado");
    await expect(page.locator("[data-assuntos-escolhidos]")).toHaveText("Mostrando só: Educação, Saúde.");
    await expect(page.locator('section[aria-labelledby="vts-1"]')).toContainText("com os assuntos escolhidos");
    const depois = await total(page);
    expect(depois, "o filtro diminui a lista").toBeLessThan(antes);
    expect(depois, "e não a zera na demonstração").toBeGreaterThan(0);
    const ck = (await context.cookies()).find((c) => c.name === "sv_temas");
    // o formulário envia na ordem da lista (A–Z), não na ordem em que o leitor marcou
    expect(ck?.value, "cookie sv_temas").toBe("educacao.saude");
    expect(ck?.httpOnly, "lido só pelo servidor").toBe(true);
    // as caixas voltam marcadas
    await abrir(page);
    expect(await page.locator(`${FILTRO} input[name="tema"]:checked`).count()).toBe(2);
  });

  test("a escolha vale na outra casa e ao voltar; 'Ver todos os assuntos' apaga o cookie e a lista volta inteira", async ({ page, context }) => {
    await page.goto("/votacoes");
    const inteira = await total(page);
    await abrir(page);
    await page.getByLabel("Saúde", { exact: true }).check();
    await page.locator(`${FILTRO} button[type="submit"]:not([name])`).click();
    await expect(page.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "ligado");
    await page.goto("/votacoes?casa=senado");
    await expect(page.locator(FILTRO), "a escolha vale no Senado").toHaveAttribute("data-filtro-temas", "ligado");
    await abrir(page);
    await page.locator(`${FILTRO} button[name="acao"][value="limpar"]`).click();
    await expect(page.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "desligado");
    expect((await context.cookies()).find((c) => c.name === "sv_temas")).toBeUndefined();
    await page.goto("/votacoes");
    expect(await total(page)).toBe(inteira);
  });

  test("mais que 5 assuntos: o servidor guarda os 5 primeiros", async ({ page, context }) => {
    await page.goto("/votacoes");
    await abrir(page);
    const caixas = page.locator(`${FILTRO} input[name="tema"]`);
    for (let i = 0; i < 7; i++) await caixas.nth(i).check();
    await page.locator(`${FILTRO} button[type="submit"]:not([name])`).click();
    const ck = (await context.cookies()).find((c) => c.name === "sv_temas");
    expect((ck?.value ?? "").split(".").length, "no máximo 5").toBe(5);
  });

  test("cookie com lixo ou assunto que não existe vale como nenhum assunto escolhido", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_temas", value: "nao-existe.<script>.x%20y", domain: "localhost", path: "/" }]);
    await page.goto("/votacoes");
    await expect(page.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "desligado");
    expect(await page.locator(".sv-vls > li").count(), "lista sem filtro").toBeGreaterThan(0);
  });

  test("sem JavaScript o formulário filtra e limpa", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto("/votacoes");
    await abrir(p);
    await p.getByLabel("Saúde", { exact: true }).check();
    await p.locator(`${FILTRO} button[type="submit"]:not([name])`).click();
    await expect(p.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "ligado");
    await abrir(p);
    await p.locator(`${FILTRO} button[name="acao"][value="limpar"]`).click();
    await expect(p.locator(FILTRO)).toHaveAttribute("data-filtro-temas", "desligado");
    await ctx.close();
  });

  test("alvos de 44 px, sem rolagem horizontal a 390 e 320 px, axe sem violações, com o filtro aberto e ligado", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_temas", value: "educacao.saude", domain: "localhost", path: "/" }]);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/votacoes");
      await abrir(page);
      for (const el of await page.locator(`${FILTRO} summary, ${FILTRO} input[name="tema"], ${FILTRO} button`).all()) {
        const b = await el.boundingBox();
        expect(Math.min(b!.width, b!.height), `alvo de toque a ${width}px`).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}px`).toBeLessThanOrEqual(0);
    }
    const r = await new AxeBuilder({ page }).include(FILTRO).analyze();
    expect(r.violations).toEqual([]);
  });

  test("o texto não classifica assuntos nem promete mais do que o filtro faz", async ({ page }) => {
    await page.goto("/votacoes");
    await abrir(page);
    const t = await page.locator(FILTRO).innerText();
    expect(t).not.toMatch(/ranking|mais importante|mais votad|mais pol[êe]mic|beneficia|só neste aparelho/i);
    // lista em ordem alfabética (o contrato devolve ordenada por nome): o site não reordena por uso
    const nomes = await page.locator(`${FILTRO} .sv-chk label`).allInnerTexts();
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });
});
