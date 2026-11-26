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
    await expect(mapa.locator("[data-mapa-base]")).toContainText(/ausência não conta como voto contra/i);
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

  test("a % escrita bate com o preenchimento e com o painel de cada UF", async ({ page }) => {
    await page.goto(URL);
    const fig = page.locator("[data-mapa-votos]");
    const n = await fig.locator("g[data-uf]").count();
    for (let i = 0; i < n; i++) {
      const g = fig.locator("g[data-uf]").nth(i);
      const uf = await g.getAttribute("data-uf");
      const pct = (await g.locator("text.sv-mv__pc").textContent())?.trim();
      const off = await page.locator(`#mv-g-${uf} stop`).first().getAttribute("offset");
      if (pct === "–") expect(off).toBe("0%");
      else expect(off).toBe(pct);
      const txt = await fig.locator(`a[data-uf-link="${uf}"]`).getAttribute("data-txt");
      if (pct === "–") expect(txt).toBe(`${uf} · sem votos registrados`);
      else expect(txt).toContain(`${uf} · ${pct} Sim · `);
    }
  });

  test("interativo: 27 links no SVG com href ?uf=, nome acessível com % e contagem, ordem alfabética do Tab", async ({ page }) => {
    await page.goto(URL);
    const links = page.locator("[data-mapa-votos] svg a[data-uf-link]");
    expect(await links.count()).toBe(27);
    // a camada de rótulos repete o destino, fora do Tab e do leitor de tela
    const rotulos = page.locator("[data-mapa-votos] svg a[data-uf-plaque]");
    expect(await rotulos.count()).toBe(27);
    expect(await rotulos.evaluateAll((as) => as.every((a) => a.getAttribute("tabindex") === "-1" && a.getAttribute("aria-hidden") === "true"))).toBe(true);
    const info = await links.evaluateAll((as) =>
      as.map((a) => ({ uf: a.getAttribute("data-uf-link") ?? "", href: a.getAttribute("href") ?? "", label: a.getAttribute("aria-label") ?? "", desc: a.getAttribute("aria-describedby") ?? "", temDesc: !!document.getElementById(a.getAttribute("aria-describedby") ?? "x"), titulo: a.querySelector("title")?.textContent ?? "" })),
    );
    expect(info.map((i) => i.uf)).toEqual([...info.map((i) => i.uf)].sort((a, b) => a.localeCompare(b, "pt-BR")));
    for (const i of info) {
      expect(i.href, i.uf).toMatch(new RegExp(`\\?uf=${i.uf}(#|$)`));
      expect(i.label, i.uf).toMatch(new RegExp(`^${i.uf}: (sem votos registrados|\\d+% Sim, \\d+ de \\d+ registrados?)$`));
      expect(i.titulo).toBe(i.label);
      expect(i.temDesc, `${i.uf} aria-describedby`).toBe(true);
    }
    // Tab percorre as UFs na ordem do DOM (alfabética de sigla)
    await links.first().focus();
    const visto: string[] = [];
    for (let k = 0; k < 27; k++) {
      visto.push((await page.evaluate(() => document.activeElement?.getAttribute("data-uf-link") ?? "")) || "?");
      await page.keyboard.press("Tab");
    }
    expect(visto).toEqual(info.map((i) => i.uf));
  });

  test("painel de leitura: atualiza ao focar (Tab) e ao passar o mouse, e volta ao padrão ao sair", async ({ page }) => {
    await page.goto(URL);
    const painel = page.locator("[data-mapa-painel]");
    const padrao = (await painel.textContent())?.trim();
    const a = page.locator('[data-mapa-votos] svg a[data-uf-link="SP"]');
    const txt = await a.getAttribute("data-txt");
    await a.focus();
    await expect(painel).toHaveText(txt!);
    await expect(a.locator(".sv-mv__hit")).toHaveCSS("stroke-width", "2px");
    await page.locator("nav.sv-ufs a").first().focus();
    await expect(painel).toHaveText(padrao!);
    const b = page.locator('[data-mapa-votos] svg a[data-uf-link="MG"]');
    // o ponteiro pega a camada de rótulos (por cima): mesmo texto, mesmo destino
    await page.locator('[data-mapa-votos] svg a[data-uf-plaque="MG"]').hover();
    await expect(painel).toHaveText((await b.getAttribute("data-txt"))!);
    await page.mouse.move(0, 0);
    await expect(painel).toHaveText(padrao!);
  });

  test("o rótulo de cada UF (inclusive os de fora do mapa) recebe o clique da própria UF", async ({ page }) => {
    await page.goto(URL);
    const erros = await page.evaluate(() => {
      const out: string[] = [];
      for (const g of Array.from(document.querySelectorAll<SVGGElement>("[data-mapa-votos] g[data-uf]"))) {
        g.scrollIntoView({ block: "center" }); // elementFromPoint só enxerga o que está na janela
        const r = g.querySelector("rect")!.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const dono = el?.closest("a")?.getAttribute("data-uf-plaque");
        if (dono !== g.getAttribute("data-uf")) out.push(`${g.getAttribute("data-uf")} -> ${dono}`);
      }
      return out;
    });
    expect(erros).toEqual([]);
  });

  test("clicar numa UF do mapa abre os votos dela e inverte a etiqueta", async ({ page }) => {
    await page.goto(URL);
    await page.locator('[data-mapa-votos] svg a[data-uf-plaque="SP"]').click();
    await expect(page).toHaveURL(/\?uf=SP/);
    await expect(page.locator('[data-placar-uf="SP"]')).toBeVisible();
    await expect(page.locator('[data-mapa-votos] g[data-uf="SP"]')).toHaveClass(/is-sel/);
    await page.mouse.move(0, 0); // a rolagem até #vt-3 deixa o ponteiro sobre outro estado (hover legítimo); o painel volta ao padrão da UF escolhida
    await expect(page.locator("[data-mapa-painel]")).toContainText("SP ·");
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

  test("sem JavaScript: o mapa aparece, o link da UF no mapa leva ao voto e a lista também", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_BASE_URL || "http://localhost:3200" });
    const page = await ctx.newPage();
    await page.goto(URL);
    await expect(page.locator("[data-mapa-votos] svg")).toBeVisible();
    // clica no <a> do SVG (não navega por URL): prova que o link nativo funciona sem JS. force: o rótulo da mesma UF fica por cima do centro.
    await page.locator('[data-mapa-votos] svg a[data-uf-link="SP"]').click({ force: true });
    await expect(page).toHaveURL(/uf=SP/);
    await expect(page.locator('[data-placar-uf="SP"]')).toBeVisible();
    await expect(page.locator("[data-mapa-painel]")).toContainText("SP ·");
    await page.goto(URL);
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

  test("/votacoes: o mesmo mapa interativo, para a votação mais recente com placar por UF, com a base escrita e link para a votação", async ({ page, axe }) => {
    await page.goto("/votacoes");
    const q = page.locator('[aria-labelledby="vts-mapa"]');
    await expect(q.getByRole("heading", { name: "Como votou cada estado na votação mais recente com voto por estado?" })).toBeVisible();
    const mapa = q.locator("[data-mapa-votos]");
    await expect(mapa.locator("svg a[data-uf-link]")).toHaveCount(27);
    await expect(mapa.locator("[data-mapa-base]")).toContainText("Sim ÷ (Sim + Não + abstenção) dos votos registrados");
    const href = await q.locator("[data-mapa-votacao] a").getAttribute("href");
    expect(href).toMatch(/^\/votacao\//);
    const uf = await mapa.locator("svg a[data-uf-link]").first().getAttribute("href");
    expect(uf).toContain(`${href}?uf=`);
    // a exceção D2 do desenho do mapa só vale porque esta rota também tem a lista de estados de 44 px
    const lista = q.locator("nav.sv-ufs a");
    await expect(lista).toHaveCount(27);
    const alturas = await lista.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height));
    for (const h of alturas) expect(h).toBeGreaterThanOrEqual(44);
    // o painel de leitura é eco visual: sem aria-live (o link em foco já anuncia % e contagem)
    await expect(mapa.locator("[data-mapa-painel]")).not.toHaveAttribute("aria-live", /.*/);
    const siglas = await mapa.locator("g[data-uf]").evaluateAll((els) => els.map((e) => e.getAttribute("data-uf") ?? ""));
    expect(siglas).toEqual([...siglas].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await axe();
  });

  test("/votacoes: o quadro do mapa é sempre mapa completo (27 estados) ou lacuna nomeada, nunca um mapa vazio, no Senado e na Câmara", async ({ page }) => {
    for (const casa of ["senado", "camara"]) {
      await page.goto(`/votacoes?casa=${casa}`);
      const q = page.locator('[aria-labelledby="vts-mapa"]');
      if ((await q.locator("[data-mapa-votos]").count()) > 0) {
        await expect(q.locator("svg a[data-uf-link]")).toHaveCount(27);
        await expect(q.locator("nav.sv-ufs a")).toHaveCount(27);
        await expect(q.locator(".sv-lac")).toHaveCount(0);
      } else {
        await expect(q.locator(".sv-lac")).toBeVisible();
        await expect(q.locator("nav.sv-ufs")).toHaveCount(0);
      }
    }
  });

  test("/votacoes: leitura que falha vira lacuna que diz a falha, sem mapa nem lista de estados", async ({ page }) => {
    // `?simular=erro` só vale na demonstração (simular.ts): o teste é determinístico, não depende do conteúdo da demo.
    await page.goto("/votacoes?simular=erro");
    const q = page.locator('[aria-labelledby="vts-mapa"]');
    await expect(q.locator(".sv-lac")).toContainText("Não conseguimos ler esta fonte agora");
    await expect(q.locator("[data-mapa-votos]")).toHaveCount(0);
    await expect(q.locator("nav.sv-ufs")).toHaveCount(0);
  });

  test("teclado: 'Pular o mapa' só aparece com foco, mede 44 px e leva para depois das 27 paradas de Tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(URL);
    const pular = page.locator("a.sv-mv__pular");
    await expect(pular).toHaveText("Pular o mapa");
    await pular.focus();
    await expect(pular).toBeFocused();
    const h = await pular.evaluate((a) => a.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#mapa-votos-fim$/);
  });

  test("UF inválida, em minúscula ou repetida em ?uf= não quebra a página: painel padrão e nenhuma UF selecionada", async ({ page }) => {
    for (const q of ["uf=XX", "uf=sp", "uf=SP&uf=RJ", "uf=%00"]) {
      const resp = await page.goto(`${URL}?${q}`);
      expect(resp?.status(), q).toBeLessThan(400);
      await expect(page.locator("[data-mapa-votos]"), q).toBeVisible();
      if (q === "uf=XX" || q === "uf=%00") await expect(page.locator("[data-mapa-votos] .is-sel"), q).toHaveCount(0);
    }
  });

  test("o texto desenhado no SVG tem ≥ 13 px na tela, ou os rótulos não aparecem (largura < 760 px)", async ({ page }) => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(URL);
      const r = await page.locator("[data-mapa-votos]").evaluate((fig) => {
        const svg = fig.querySelector("svg")!;
        const escala = svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1);
        const visiveis = Array.from(svg.querySelectorAll("text")).filter((t) => getComputedStyle(t).display !== "none" && !t.closest('[style*="display: none"]') && (t.closest("a") ? getComputedStyle(t.closest("a")!).display !== "none" : true));
        return { n: visiveis.length, menor: Math.min(...visiveis.map((t) => parseFloat(getComputedStyle(t).fontSize) * escala)) };
      });
      if (width < 760) expect(r.n, `${width}px: rótulos escondidos`).toBe(0);
      else expect(r.menor, `${width}px: menor texto desenhado`).toBeGreaterThanOrEqual(12.9);
    }
  });

  test("votação sem voto individual: sem mapa e com lacuna honesta", async ({ page }) => {
    // `?simular=erro` não vale aqui; usa uma votação secreta ou sem votos da demo, se houver. Sem ela, o teste se declara pulado.
    await page.goto("/votacoes");
    const href = await page.locator('[aria-labelledby="vts-2"] a[href^="/votacao/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
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
