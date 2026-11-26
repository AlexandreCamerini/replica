import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F12 do roteiro do eleitor: modo leitura fácil. Cookie sv_facil lido no servidor (a página já sai no modo certo), botão "Aa" no topo de toda
// página, funciona sem JavaScript. O modo amplia a letra (zoom de 120%), dá contraste forte ao texto secundário e sublinha os links.
// Não muda o conteúdo nem a ordem. Fonte de dados: demonstração.

const ROTAS = ["/", "/votacoes", "/pessoas", "/ajustes"];
const botao = (page: import("@playwright/test").Page) => page.locator(".sv-facil");

test.describe("F12 · modo leitura fácil", () => {
  test("o botão Aa está em toda página, desligado por padrão, com alvo de 44 px e nome fixo que começa com o texto visível", async ({ page }) => {
    for (const rota of ROTAS) {
      await page.goto(rota);
      const b = botao(page);
      await expect(b, rota).toHaveCount(1);
      await expect(b, rota).toHaveAttribute("aria-pressed", "false");
      await expect(b, `${rota}: nome acessível fixo, que começa com o texto visível`).toHaveAttribute("aria-label", "Aa, leitura fácil");
      const box = await b.boundingBox();
      expect(Math.min(box!.width, box!.height), `${rota}: alvo de toque`).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".sv"), rota).not.toHaveClass(/sv--facil/);
    }
  });

  test("um toque liga o modo, que fica ligado ao navegar e vira cookie do servidor; outro toque desliga", async ({ page, context }) => {
    await page.goto("/votacoes");
    await botao(page).click();
    await expect(page.locator(".sv")).toHaveClass(/sv--facil/);
    await expect(botao(page)).toHaveAttribute("aria-pressed", "true");
    await expect(botao(page), "o nome não muda com o estado (aria-pressed diz o estado)").toHaveAttribute("aria-label", "Aa, leitura fácil");
    const ck = (await context.cookies()).find((c) => c.name === "sv_facil");
    expect(ck?.value, "cookie sv_facil").toBe("1");
    expect(ck?.httpOnly, "lido só pelo servidor").toBe(true);
    for (const rota of ["/", "/pessoas", "/ajustes"]) {
      await page.goto(rota);
      await expect(page.locator(".sv"), `${rota}: segue ligado`).toHaveClass(/sv--facil/);
    }
    await botao(page).click();
    await expect(page.locator(".sv")).not.toHaveClass(/sv--facil/);
    expect((await context.cookies()).find((c) => c.name === "sv_facil"), "cookie apagado ao desligar").toBeUndefined();
  });

  test("com JavaScript, o toque volta à mesma página com a consulta e a âncora", async ({ page }) => {
    await page.goto("/votacao/camara-v2026-15?uf=SP#vt-3");
    await botao(page).click();
    await expect(page.locator(".sv")).toHaveClass(/sv--facil/);
    await expect(page).toHaveURL(/\/votacao\/camara-v2026-15\?uf=SP#vt-3$/);
  });

  test("sem JavaScript o formulário também liga e desliga (volta ao caminho da página)", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto("/pessoas");
    await botao(p).click();
    await expect(p.locator(".sv")).toHaveClass(/sv--facil/);
    await expect(p).toHaveURL(/\/pessoas$/);
    await botao(p).click();
    await expect(p.locator(".sv")).not.toHaveClass(/sv--facil/);
    await ctx.close();
  });

  test("ligado: letra 20% maior, texto secundário na cor do texto principal e links sublinhados", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_facil", value: "1", domain: "localhost", path: "/" }]);
    await page.goto("/");
    const sv = page.locator(".sv");
    await expect(sv).toHaveClass(/sv--facil/);
    await expect(sv).toHaveCSS("zoom", "1.2");
    const cores = await page.evaluate(() => {
      const raiz = getComputedStyle(document.querySelector(".sv")!);
      return { tinta: raiz.getPropertyValue("--tinta").trim(), tinta2: raiz.getPropertyValue("--tinta2").trim() };
    });
    expect(cores.tinta2, "contraste forte: o texto secundário tem a cor do principal").toBe(cores.tinta);
    await expect(page.locator(".sv-main a:not(.sv-btn)").first()).toHaveCSS("text-decoration-line", "underline");
  });

  test("ligado: a página não rola na horizontal de 320 a 430 px, nem com o espaçamento de texto da WCAG 1.4.12", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_facil", value: "1", domain: "localhost", path: "/" }]);
    const ESPACAMENTO = "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}";
    for (const width of [320, 360, 390, 412, 430]) {
      await page.setViewportSize({ width, height: 800 });
      for (const rota of ["/", "/votacoes", "/pessoas", "/ajustes"]) {
        await page.goto(rota);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${rota} a ${width}px`).toBeLessThanOrEqual(0);
        await page.addStyleTag({ content: ESPACAMENTO });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${rota} com espaçamento a ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("ligado: o zoom não deixa uma página curta mais alta que a janela (o mínimo de altura vale na escala do zoom)", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_facil", value: "1", domain: "localhost", path: "/" }]);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/pagina-que-nao-existe"); // o 404 é curto: o .sv só ocupa a altura mínima
    const m = await page.evaluate(() => ({ raiz: document.querySelector(".sv")!.getBoundingClientRect().height, janela: window.innerHeight, rolagem: document.documentElement.scrollHeight - window.innerHeight }));
    expect(m.raiz, "altura do .sv numa página curta").toBeLessThanOrEqual(m.janela + 1);
    expect(m.rolagem, "sem rolagem vertical vazia").toBeLessThanOrEqual(1);
  });

  test("ligado e desligado: os títulos e a ordem dos blocos são os mesmos nas principais páginas (só a apresentação muda) e o axe passa", async ({ page, context }) => {
    const estrutura = async () => page.evaluate(() => [...document.querySelectorAll(".sv-main h1, .sv-main h2, .sv-main h3")].map((h) => `${h.tagName} ${h.textContent?.trim()}`));
    const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
    const desligado: Record<string, string[]> = {};
    for (const rota of ["/", "/votacoes", "/pessoas", "/ajustes", "/como-funciona"]) {
      await page.goto(rota);
      desligado[rota] = await estrutura();
    }
    await context.addCookies([{ name: "sv_facil", value: "1", domain: "localhost", path: "/" }]);
    for (const rota of Object.keys(desligado)) {
      await page.goto(rota);
      expect(await estrutura(), `${rota}: os títulos e a ordem não mudam`).toEqual(desligado[rota]);
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(r.violations.map((v) => v.id), `axe em ${rota} com o modo ligado`).toEqual([]);
    }
  });

  test("em Ajustes: o cookie é explicado e o mesmo botão liga e desliga", async ({ page }) => {
    await page.goto("/ajustes");
    await expect(page.getByText("sv_facil")).toBeVisible();
    await page.getByRole("button", { name: "Ligar a leitura fácil", exact: true }).click();
    await expect(page.locator(".sv")).toHaveClass(/sv--facil/);
    await expect(page).toHaveURL(/\/ajustes$/);
    await page.getByRole("button", { name: "Desligar a leitura fácil", exact: true }).click();
    await expect(page.locator(".sv")).not.toHaveClass(/sv--facil/);
  });
});
