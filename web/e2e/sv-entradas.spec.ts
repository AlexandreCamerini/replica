import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F3 do roteiro do eleitor (eixo D, pergunta 1): entradas por intenção na primeira tela da home. Fonte de dados: demonstração.
// "Quanto custa?" não existe até o dado do custo das casas (F10).

const ENTRADAS = [
  ["Quem me representa?", "#inicio-representa"],
  ["O que está em votação?", "#inicio-semana"],
] as const;

test.describe("F3 · entradas por intenção", () => {
  for (const [width, height] of [[390, 844], [1440, 900]] as const)
    test(`a ${width}px as duas entradas estão à vista, em ordem fixa, com alvo de 44 px e levam a um bloco que existe`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Por onde começar" });
      expect(await nav.getByRole("link").allInnerTexts()).toEqual(ENTRADAS.map(([nome]) => nome));
      for (const [nome, href] of ENTRADAS) {
        const link = nav.getByRole("link", { name: nome, exact: true });
        await expect(link).toHaveAttribute("href", href);
        await expect(link, `${nome} à vista sem rolar`).toBeInViewport({ ratio: 1 });
        const b = await link.boundingBox();
        expect(Math.min(b!.width, b!.height), `${nome}: alvo de toque`).toBeGreaterThanOrEqual(44);
        await expect(page.locator(href), `${nome}: o bloco existe`).toHaveCount(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "sem rolagem horizontal").toBeLessThanOrEqual(0);
    });

  test("o clique rola a página até o bloco da resposta (a 390px o bloco começa abaixo da dobra)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    for (const [nome, href] of ENTRADAS) {
      await page.goto("/");
      const antes = await page.evaluate((h) => document.querySelector(h)!.getBoundingClientRect().top, href);
      expect(antes, `${nome}: o bloco começa abaixo da primeira tela`).toBeGreaterThan(300);
      await page.getByRole("navigation", { name: "Por onde começar" }).getByRole("link", { name: nome, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(await page.evaluate(() => document.querySelector(":target")?.id), `${nome}: o alvo da âncora`).toBe(href.slice(1));
      // a página rolou e o título do bloco ficou perto do topo da janela (com o respiro de scroll-margin-top)
      const depois = await page.evaluate((h) => ({ y: window.scrollY, top: document.querySelector(h)!.getBoundingClientRect().top }), href);
      expect(depois.y, `${nome}: a página rolou`).toBeGreaterThan(0);
      expect(depois.top, `${nome}: título do bloco perto do topo`).toBeLessThan(120);
    }
  });

  test("a entrada de custo não existe antes do dado do custo das casas", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Quanto custa/ })).toHaveCount(0);
  });

  test("a primeira tela não perde o título nem o convite: o cabeçalho segue o primeiro bloco e o convite o segundo", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sv h1")).toHaveText("O que está rolando?");
    const ordem = await page.evaluate(() => Array.from(document.querySelector(".sv-pg--rola")!.children).slice(0, 2).map((el) => (el.matches(".sv-folio") ? "folio" : (el.querySelector("h2")?.id ?? el.className))));
    expect(ordem).toEqual(["folio", "inicio-convite"]);
  });

  test("funciona sem JavaScript (links de âncora, com rolagem) e passa no axe", async ({ browser, page }, info) => {
    const sem = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 390, height: 844 } });
    const p = await sem.newPage();
    await p.goto("/");
    const nav = p.getByRole("navigation", { name: "Por onde começar" });
    await expect(nav.getByRole("link")).toHaveCount(2);
    for (const [nome, href] of ENTRADAS) {
      await expect(nav.getByRole("link", { name: nome, exact: true })).toHaveAttribute("href", href);
      await nav.getByRole("link", { name: nome, exact: true }).click();
      expect(await p.evaluate(() => document.querySelector(":target")?.id), `${nome}: âncora sem JavaScript`).toBe(href.slice(1));
    }
    await sem.close();
    await page.goto("/");
    const r = await new AxeBuilder({ page }).include(".sv-ent").analyze();
    expect(r.violations).toEqual([]);
  });
});
