import { expect, test } from "./fixtures";

// Mapa de votos da sv em /votacao/[id] (components/sv/mapa-votos.tsx). Votação demo com voto individual.
// Modelo: f02-map.spec.ts (mapa, teclado, sem JS) e v2-d2-aceite.spec.ts (cor e copy). Não executado no sandbox: roda fora, com a base semeada.
const URL = "/votacao/camara-v2026-15";
const PROIBIDAS = [/benefici/i, /pol[êe]mic/i, /prejudic/i, /ranking/i, /mais votad/i, /menos votad/i, /lidera/i];

test.describe("sv · mapa de votos", () => {
  test("renderiza, tem a base do percentual escrita e passa no axe", async ({ page, axe }) => {
    await page.goto(URL);
    const mapa = page.locator("[data-mapa-votos]");
    await expect(mapa.locator("svg")).toBeVisible();
    await expect(mapa.locator("[data-mapa-base]")).toContainText("Sim ÷ (Sim + Não + abstenção) dos votos registrados");
    await expect(mapa.locator("[data-mapa-base]")).toContainText("ausência não conta como voto contra");
    await expect(mapa.locator("[data-mapa-total]")).toContainText(/de \d+ registrados? votaram Sim|Nenhum voto/);
    await axe();
  });

  test("lista = mapa: cada estado com link no mapa tem o mesmo link na lista, na mesma ordem (alfabética)", async ({ page }) => {
    await page.goto(URL);
    const doMapa = await page.locator("[data-mapa-votos] a[data-uf]").evaluateAll((as) => as.map((a) => (a as unknown as SVGAElement).getAttribute("href")));
    const daLista = await page.locator("nav.sv-ufs a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(doMapa.length).toBeGreaterThan(0);
    expect(doMapa.map((h) => (h ?? "").replace(/#.*$/, ""))).toEqual(daLista);
    const siglas = await page.locator("[data-mapa-votos] [data-uf]").evaluateAll((els) => els.map((e) => e.getAttribute("data-uf") ?? ""));
    expect(siglas).toEqual([...siglas].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  test("cada estado tem descrição (desc + aria-describedby) com os números, e o preenchimento bate com o texto", async ({ page }) => {
    await page.goto(URL);
    const links = page.locator("[data-mapa-votos] a[data-uf]");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const a = links.nth(i);
      const uf = await a.getAttribute("data-uf");
      const id = await a.getAttribute("aria-describedby");
      expect(id).toBe(`mv-d-${uf}`);
      const desc = (await page.locator(`#${id}`).textContent()) ?? "";
      expect(desc).toMatch(/registrados?/);
      const pct = (await a.locator("text.sv-mv__pc").textContent())?.trim();
      const off = await page.locator(`#mv-g-${uf} stop`).first().getAttribute("offset");
      if (pct === "–") expect(off).toBe("0%");
      else expect(`${off}`).toBe(pct);
    }
  });

  test("teclado: Tab percorre os estados com foco visível sem cor; Enter abre o estado e a lista mostra os nomes", async ({ page }) => {
    await page.goto(URL);
    const primeiro = page.locator("[data-mapa-votos] a[data-uf]").first();
    await primeiro.focus();
    await expect(primeiro).toBeFocused();
    const fx = await primeiro.locator(".sv-mv__hit").evaluate((el) => {
      const c = getComputedStyle(el);
      return { w: parseFloat(c.strokeWidth), s: c.stroke };
    });
    expect(fx.w).toBeGreaterThanOrEqual(3);
    expect(fx.s).toBe("rgb(20, 20, 20)"); // tinta
    const uf = await primeiro.getAttribute("data-uf");
    await page.keyboard.press("Tab");
    await expect(page.locator("[data-mapa-votos] a[data-uf]").nth(1)).toBeFocused();
    await primeiro.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`uf=${uf}`));
    await expect(page.locator(`[data-placar-uf="${uf}"]`)).toBeVisible();
    await expect(page.locator(`[data-mapa-votos] a[data-uf="${uf}"]`)).toHaveAttribute("aria-current", "page");
  });

  test("sem JavaScript: o mapa e os links funcionam", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_BASE_URL || "http://localhost:3200" });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator("[data-mapa-votos] svg")).toBeVisible();
    const href = await page.locator("[data-mapa-votos] a[data-uf]").first().getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("[data-placar-uf]")).toBeVisible();
    await ctx.close();
  });

  test("sem overflow horizontal em 390 px e a lista continua como rota de toque (alvo de 44 px)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(0);
    const alturas = await page.locator("nav.sv-ufs a").evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    expect(Math.min(...alturas)).toBeGreaterThanOrEqual(44);
  });

  test("só tinta e papel, sem animação, sem sombra, raio 0; voto não é cor", async ({ page }) => {
    await page.goto(URL);
    const r = await page.locator("[data-mapa-votos]").evaluate((fig) => {
      const out: string[] = [];
      const ok = new Set(["rgb(20, 20, 20)", "rgb(242, 238, 229)", "rgba(0, 0, 0, 0)", "none"]);
      for (const el of fig.querySelectorAll("svg *")) {
        const c = getComputedStyle(el);
        for (const p of ["fill", "stroke", "stopColor"] as const) {
          const v = c[p as "fill"];
          if (v && !v.startsWith("url(") && !ok.has(v)) out.push(`${el.tagName}.${p}=${v}`);
        }
        if (c.boxShadow !== "none") out.push("sombra");
        if (parseFloat(c.transitionDuration) > 0 || parseFloat(c.animationDuration) > 0) out.push("animação");
      }
      if (fig.querySelector("circle")) out.push("bolha");
      return out;
    });
    expect(r).toEqual([]);
  });

  test("copy: sem juízo nem ranking no mapa e nas legendas", async ({ page }) => {
    await page.goto(URL);
    const texto = (await page.locator("[data-mapa-votos]").evaluate((el) => el.textContent ?? "")) + (await page.locator("[data-mapa-votos] desc").allTextContents()).join(" ");
    for (const re of PROIBIDAS) expect(texto, String(re)).not.toMatch(re);
  });

  test("votação sem voto individual: sem mapa e com lacuna honesta", async ({ page }) => {
    // `?simular=erro` não vale aqui; usa uma votação secreta ou sem votos da demo, se houver. Sem ela, o teste se declara pulado.
    await page.goto("/votacoes");
    const href = await page.locator('a[href^="/votacao/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    let achou = false;
    for (const h of href.slice(0, 40)) {
      await page.goto(h!);
      if ((await page.locator("[data-sem-voto-individual]").count()) > 0) {
        achou = true;
        await expect(page.locator("[data-mapa-votos]")).toHaveCount(0);
        await expect(page.locator(".sv-lac").first()).toBeVisible();
        break;
      }
    }
    test.skip(!achou, "a base demo não tem votação sem voto individual");
  });
});
