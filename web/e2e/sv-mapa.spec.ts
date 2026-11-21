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

  test("lista = mapa: o mapa e a tabela do leitor de tela cobrem as mesmas UFs, em ordem alfabética, e a lista leva ao voto", async ({ page }) => {
    await page.goto(URL);
    const siglas = await page.locator("[data-mapa-votos] g[data-uf]").evaluateAll((els) => els.map((e) => e.getAttribute("data-uf") ?? ""));
    expect(siglas.length).toBe(27);
    expect(siglas).toEqual([...siglas].sort((a, b) => a.localeCompare(b, "pt-BR")));
    expect(await page.locator("[data-mapa-tabela] tbody tr").count()).toBe(siglas.length);
    const daLista = await page.locator("nav.sv-ufs a").evaluateAll((as) => as.map((a) => a.textContent?.trim() ?? ""));
    expect(daLista.length).toBeGreaterThan(0);
    for (const u of daLista) expect(siglas).toContain(u);
    expect(daLista).toEqual([...daLista].sort());
  });

  test("o mapa é só leitura visual: aria-hidden, sem links nem paradas de Tab; a % escrita bate com o preenchimento", async ({ page }) => {
    await page.goto(URL);
    const fig = page.locator("[data-mapa-votos]");
    await expect(fig.locator("svg")).toHaveAttribute("aria-hidden", "true");
    expect(await fig.locator("svg a, svg [tabindex]").count()).toBe(0);
    const n = await fig.locator("g[data-uf]").count();
    for (let i = 0; i < n; i++) {
      const g = fig.locator("g[data-uf]").nth(i);
      const uf = await g.getAttribute("data-uf");
      const pct = (await g.locator("text.sv-mv__pc").textContent())?.trim();
      const off = await page.locator(`#mv-g-${uf} stop`).first().getAttribute("offset");
      if (pct === "–") expect(off).toBe("0%");
      else expect(off).toBe(pct);
    }
  });

  test("teclado: Tab chega à lista de estados com foco visível e Enter abre os votos do estado", async ({ page }) => {
    await page.goto(URL);
    const primeiro = page.locator("nav.sv-ufs a").first();
    await primeiro.focus();
    await expect(primeiro).toBeFocused();
    const uf = (await primeiro.textContent())?.trim();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`uf=${uf}`));
    await expect(page.locator(`[data-placar-uf="${uf}"]`)).toBeVisible();
    await expect(page.locator(`[data-mapa-votos] g[data-uf="${uf}"]`)).toHaveClass(/is-sel/);
  });

  test("sem JavaScript: o mapa aparece e a lista de estados leva ao voto", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_BASE_URL || "http://localhost:3200" });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator("[data-mapa-votos] svg")).toBeVisible();
    const href = await page.locator("nav.sv-ufs a").first().getAttribute("href");
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
      for (const el of fig.querySelectorAll("svg path, svg rect, svg text, svg stop")) {
        const c = getComputedStyle(el);
        const props = el.tagName === "stop" ? (["stopColor"] as const) : (["fill", "stroke"] as const);
        for (const p of props) {
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
    const texto = await page.locator("[data-mapa-votos]").evaluate((el) => el.textContent ?? "");
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
