import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

// D330: estado de carregamento da Direção 2. É melhoria no cliente: sem JavaScript a página chega inteira do servidor.
// Dois jeitos de atrasar a rede: (1) o padrão do bug008 (CDP, Network.emulateNetworkConditions), para o caso real de rede
// lenta; (2) segurar a resposta com page.route, para o aviso ficar parado na tela enquanto o axe e as medidas rodam.

const AVISO = ".sv-carga";
const TEXTO = "Carregando a página…";
const AXE = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const cookies = [
  { name: "sv_uf", value: "SP", domain: "localhost", path: "/" },
  { name: "sv_sigo", value: "helena-siqueira", domain: "localhost", path: "/" },
];

/** Segura as respostas cujo endereço casa com `padrao` até `soltar()`; devolve também quantas foram seguradas. */
async function segurar(page: Page, padrao: RegExp) {
  const presas: Route[] = [];
  await page.route(padrao, (route) => {
    presas.push(route);
  });
  return {
    presas,
    soltar: async () => {
      await page.unroute(padrao);
      await Promise.all(presas.map((r) => r.continue().catch(() => {})));
    },
  };
}

test.describe("carregamento: troca de página", () => {
  test("rede lenta (padrão do bug008): o aviso aparece em texto, a página chega e o aviso some", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "emulação de rede via CDP");
    await context.addCookies(cookies);
    await page.goto("/", { waitUntil: "networkidle" }); // aquece: o JavaScript vem do cache e só a resposta da página nova passa pela rede lenta
    await expect(page.locator(AVISO)).toBeHidden(); // parado, o aviso não existe na tela
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 2500, downloadThroughput: 200 * 1024, uploadThroughput: 1024 * 1024 });
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Votações", exact: true }).click();
    await expect(page.locator(AVISO)).toHaveText(TEXTO);
    await expect(page.locator(AVISO)).toBeVisible();
    await expect(page).toHaveURL(/\/votacoes$/, { timeout: 30_000 });
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(AVISO)).toBeHidden();
    await expect(page.locator(AVISO)).toHaveText("");
  });

  test("com o aviso na tela: legível, sem cor nova, sem animação, sem tirar o foco, e axe sem violação", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/", { waitUntil: "networkidle" });
    const rede = await segurar(page, /\/pessoas(\?|$)/);
    const link = page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true });
    await link.click();
    const aviso = page.locator(AVISO);
    await expect(aviso).toHaveText(TEXTO);
    await expect(aviso).toHaveAttribute("role", "status");
    const estilo = await aviso.evaluate((el) => {
      const c = getComputedStyle(el);
      const papel = getComputedStyle(document.querySelector(".sv")!).getPropertyValue("--papel").trim().toLowerCase();
      const tinta = getComputedStyle(document.querySelector(".sv")!).getPropertyValue("--tinta").trim().toLowerCase();
      const hex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
      const r = el.getBoundingClientRect();
      return { cor: hex(c.color), fundo: hex(c.backgroundColor), borda: hex(c.borderTopColor), papel, tinta, fonte: parseFloat(c.fontSize), animacao: c.animationName, transicao: c.transitionDuration, dentro: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight, ativo: document.activeElement?.textContent?.trim() ?? "" };
    });
    expect(estilo.cor, "texto na cor da tinta").toBe(estilo.tinta);
    expect(estilo.fundo, "fundo na cor do papel").toBe(estilo.papel);
    expect(estilo.borda).toBe(estilo.tinta);
    expect(estilo.fonte, "texto de pelo menos 13px").toBeGreaterThanOrEqual(13);
    expect(estilo.animacao, "sem animação").toBe("none");
    expect(estilo.transicao, "sem transição").toMatch(/^0s/);
    expect(estilo.dentro, "inteiro dentro da janela").toBe(true);
    expect(estilo.ativo, "o foco continua no link clicado").toBe("Pessoas");
    // a página de antes continua na tela e utilizável enquanto a nova não chega
    await expect(page.locator("h1")).toBeVisible();
    const res = await new AxeBuilder({ page }).withTags(AXE).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await rede.soltar();
    await expect(page).toHaveURL(/\/pessoas$/);
    await expect(aviso).toBeHidden();
    await expect(page).toHaveTitle(/\S/); // o título da página nova chega logo depois do endereço
    const depois = await new AxeBuilder({ page }).withTags(AXE).analyze();
    expect(depois.violations.map((v) => v.id)).toEqual([]);
  });

  test("a 390px o aviso cabe na tela, não estoura e não cobre o link em foco", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    const rede = await segurar(page, /\/pessoas(\?|$)/);
    const link = page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true });
    await link.click();
    await expect(page.locator(AVISO)).toHaveText(TEXTO);
    const m = await page.evaluate((sel) => {
      const a = document.querySelector(sel)!.getBoundingClientRect();
      const f = document.activeElement!.getBoundingClientRect();
      const cobre = !(a.right <= f.left || a.left >= f.right || a.bottom <= f.top || a.top >= f.bottom);
      return { estouro: document.documentElement.scrollWidth - window.innerWidth, dentro: a.left >= 0 && a.right <= window.innerWidth, cobre };
    }, AVISO);
    expect(m.estouro, "sem rolagem horizontal").toBeLessThanOrEqual(0);
    expect(m.dentro).toBe(true);
    expect(m.cobre, "o aviso não cobre o elemento em foco").toBe(false);
    await rede.soltar();
    await expect(page.locator(AVISO)).toBeHidden();
  });

  test("demora longa: o aviso muda de texto; em janela de 320×256 (zoom de 400%) não encobre por inteiro o que recebe foco", async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.addCookies(cookies);
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto("/", { waitUntil: "networkidle" });
    const rede = await segurar(page, /\/pessoas(\?|$)/);
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true }).click();
    await expect(page.locator(AVISO)).toHaveText(TEXTO);
    await expect(page.locator(AVISO)).toContainText("Ainda carregando.", { timeout: 25_000 }); // o texto muda aos 8 s; folga para máquina carregada (some aos 30 s)
    await expect(page.locator(AVISO)).toContainText("Não é preciso clicar de novo");
    // foco pelo teclado em cada link do rodapé (o lugar mais perto da caixa): nenhum fica inteiro debaixo dela (WCAG 2.4.11)
    const links = page.locator("footer.sv-rod a");
    const n = await links.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      await links.nth(i).focus();
      const m = await page.evaluate((sel) => {
        const a = document.querySelector(sel)!.getBoundingClientRect();
        const f = document.activeElement!.getBoundingClientRect();
        const largura = Math.max(0, Math.min(a.right, f.right) - Math.max(a.left, f.left));
        const altura = Math.max(0, Math.min(a.bottom, f.bottom) - Math.max(a.top, f.top));
        return { coberto: (largura * altura) / Math.max(1, f.width * f.height), aviso: [Math.round(a.width), Math.round(a.height)], texto: document.activeElement!.textContent };
      }, AVISO);
      expect(m.coberto, `link "${m.texto}" coberto pelo aviso (${m.aviso.join("×")}px)`).toBeLessThan(1);
    }
    const caixa = (await page.locator(AVISO).boundingBox())!;
    expect(caixa.height, "o aviso ocupa menos de um terço da janela").toBeLessThan(256 / 3);
    await rede.soltar();
    await expect(page).toHaveURL(/\/pessoas$/);
    await expect(page.locator(AVISO)).toBeHidden();
  });

  test("não avisa quando nada é carregado: link da própria página, âncora e nova aba", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/pessoa/helena-siqueira", { waitUntil: "networkidle" });
    // âncora na mesma página (o quadro do topo leva às seções)
    await page.locator('.sv-main a[href^="#"]').first().click();
    await page.waitForTimeout(1000);
    await expect(page.locator(AVISO)).toBeHidden();
    await page.goto("/pessoas", { waitUntil: "networkidle" });
    // o link da página em que já se está
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(AVISO)).toBeHidden();
    // clique com tecla de nova aba: esta aba não carrega nada
    const rede = await segurar(page, /\/votacoes(\?|$)/);
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Votações", exact: true }).click({ modifiers: ["ControlOrMeta"] });
    await page.waitForTimeout(1000);
    await expect(page.locator(AVISO)).toBeHidden();
    await expect(page).toHaveURL(/\/pessoas$/);
    await rede.soltar();
  });

  test("voltar pelo histórico com uma troca de página em andamento: o aviso some", async ({ page, context }) => {
    await context.addCookies(cookies);
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Votações", exact: true }).click();
    await expect(page).toHaveURL(/\/votacoes$/);
    await expect(page.locator("h1")).toBeVisible();
    // uma troca que não chega: o aviso fica na tela
    const rede = await segurar(page, /\/pessoas(\?|$)/);
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true }).click();
    await expect(page.locator(AVISO)).toHaveText(TEXTO);
    // a pessoa desiste e volta: o endereço muda para o anterior e o aviso some
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(AVISO)).toHaveText("");
    await expect(page.locator(AVISO)).toBeHidden();
    await rede.soltar();
  });

  test("formulário de busca (filtro de pessoas): o envio liga o aviso; envio cancelado por outro código, não", async ({ page, context }) => {
    // O formulário de busca troca de página pelo navegador (documento novo), e nesta bateria não há como atrasar só essa
    // resposta (segurar com page.route troca o documento na hora). O teste mede o que dá para medir: com a navegação
    // suspensa por um ouvinte que roda DEPOIS do nosso, o envio liga o aviso; com um que roda ANTES e cancela, não liga.
    await context.addCookies(cookies);
    await page.goto("/pessoas", { waitUntil: "networkidle" });
    await page.evaluate(() => window.addEventListener("submit", (e) => e.preventDefault())); // depois do ouvinte do aviso
    await page.locator("#pp-nome").fill("silva");
    await page.getByRole("button", { name: "Procurar" }).click();
    await expect(page.locator(AVISO)).toHaveText(TEXTO);
    await page.goto("/pessoas", { waitUntil: "networkidle" });
    await page.evaluate(() => document.addEventListener("submit", (e) => e.preventDefault())); // antes dele: o envio foi cancelado
    await page.locator("#pp-nome").fill("silva");
    await page.getByRole("button", { name: "Procurar" }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator(AVISO)).toHaveText("");
    await expect(page).toHaveURL(/\/pessoas$/);
  });
});

test.describe("carregamento: envio de formulário", () => {
  test("marcar uma pessoa: o botão diz Guardando… enquanto o servidor responde, e depois mostra o resultado", async ({ page, context }) => {
    await context.addCookies([cookies[0]]);
    await page.goto("/pessoas", { waitUntil: "networkidle" });
    const linha = page.locator(".sv-pp > li").first();
    const presas: Route[] = [];
    await page.route("**/pessoas*", (route) => (route.request().method() === "POST" ? void presas.push(route) : route.continue()));
    await linha.locator("button").click();
    const envio = linha.locator(".sv-envio");
    await expect(envio).toHaveText("Guardando…");
    await expect(envio).toHaveAttribute("role", "status");
    const res = await new AxeBuilder({ page }).withTags(AXE).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(presas.length, "o envio ficou preso").toBeGreaterThan(0);
    await page.unroute("**/pessoas*");
    await Promise.all(presas.map((r) => r.continue().catch(() => {}))); // o unroute pode já ter soltado
    await expect(linha.locator("button")).toHaveAttribute("aria-pressed", "true");
    await expect(envio).toBeHidden();
    await expect(page.locator(".sv-pp__m > p[role=status]")).toContainText("Você acompanha 1 pessoa.");
  });

  test("os formulários que guardam escolha têm o aviso de envio, vazio enquanto nada é enviado", async ({ page, context }) => {
    await context.addCookies(cookies);
    for (const [url, minimo] of [["/pessoas", 2], ["/pessoa/helena-siqueira", 1], ["/ajustes", 2], ["/comecar", 2], ["/comecar?passo=2", 2]] as const) {
      await page.goto(url);
      const avisos = page.locator(".sv-main form .sv-envio");
      expect(await avisos.count(), `${url}: formulários com aviso de envio`).toBeGreaterThanOrEqual(minimo);
      for (const a of await avisos.all()) await expect(a, url).toBeHidden();
    }
  });
});

test.describe("carregamento: sem JavaScript", () => {
  test("a página chega inteira, sem aviso preso, e navegar e marcar funcionam", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR" });
    await ctx.addCookies([cookies[0]]);
    const page = await ctx.newPage();
    for (const url of ["/", "/acompanhando", "/pessoas", "/pessoa/helena-siqueira", "/votacoes", "/votacao/camara-v2026-15", "/decisoes", "/temas", "/tema/agro", "/ajustes", "/comecar"]) {
      await page.goto(url);
      await expect(page.locator("h1"), url).toBeVisible();
      await expect(page.locator(".sv-main"), url).not.toContainText("Carregando");
      await expect(page.locator(AVISO), url).toBeHidden();
      // O conteúdo não vem escondido à espera de script (o que loading.tsx faria: medido antes desta decisão). Página com
      // título próprio traz do Next um recipiente escondido vazio, do título; o que não pode haver é recipiente com conteúdo.
      const escondido = await page.locator('[hidden][id^="S:"]').evaluateAll((els) => els.map((e) => e.innerHTML.trim()).filter(Boolean));
      expect(escondido, `${url}: nenhum conteúdo escondido à espera de script`).toEqual([]);
      // o próprio aviso está no HTML, fora de recipiente escondido, vazio
      await expect(page.locator(AVISO), url).toHaveCount(1);
      await expect(page.locator(AVISO), url).toHaveText("");
    }
    await page.goto("/");
    await page.locator('nav[aria-label="Perguntas"]').getByRole("link", { name: "Pessoas", exact: true }).click();
    await expect(page).toHaveURL(/\/pessoas$/);
    await page.locator(".sv-pp > li").first().locator("button").click();
    await expect(page.locator(".sv-pp > li").first().locator("button")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".sv-envio").first()).toBeHidden();
    await ctx.close();
  });
});
