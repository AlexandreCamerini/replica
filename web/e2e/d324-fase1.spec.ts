import type { Browser, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

// D324: Fase 1 da auditoria de design da Direção 2. Um bloco por item da decisão. Fonte de dados: demonstração.
// A bateria geral (axe, reflow, alvos de 44px, cor, ordem, sem JavaScript) está em v2-d2-aceite.spec.ts e já cobre as
// rotas novas (/comecar e /comecar?passo=2); aqui fica o que é próprio de cada item.

const SP = { name: "sv_uf", value: "SP", domain: "localhost", path: "/" };
const sigo = (slugs: string[]) => ({ name: "sv_sigo", value: slugs.join("."), domain: "localhost", path: "/" });

async function semJs(browser: Browser, info: TestInfo) {
  return browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
}

/** O ponto central do elemento cai nele mesmo (nada o cobre). */
const visivelNoCentro = (el: Element) => {
  const r = el.getBoundingClientRect();
  const no = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!no && (no === el || el.contains(no));
};

// ---------------------------------------------------------------------------------------------------------------------
// 1. Navegação: "Pessoas" e "Votações" no topo
// ---------------------------------------------------------------------------------------------------------------------
test.describe("1. navegação do topo", () => {
  for (const [width, height] of [[390, 844], [1440, 900]] as const)
    test(`Pessoas e Votações estão na navegação "Perguntas" a ${width}px, com aria-current`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const nav = page.getByRole("navigation", { name: "Perguntas" });
      for (const [url, nome, atual] of [
        ["/pessoas", "Pessoas", "page"],
        ["/pessoa/helena-siqueira", "Pessoas", "true"],
        ["/votacoes", "Votações", "page"],
        ["/votacao/camara-v2026-15", "Votações", "true"],
      ] as const) {
        await page.goto(url);
        const link = nav.getByRole("link", { name: nome, exact: true });
        // D325: à vista ao abrir a página, sem rolar a linha (a 390px os dois ficam presos à borda direita dela)
        await expect(link, `${url}: ${nome}`).toBeInViewport({ ratio: 1 });
        expect(await link.evaluate(visivelNoCentro), `${url}: ${nome} não está coberto`).toBe(true);
        await expect(link, `${url}: ${nome}`).toHaveAttribute("aria-current", atual);
        // o outro link está lá, sem marca de atual; e só um item da navegação fica marcado
        const outro = nav.getByRole("link", { name: nome === "Pessoas" ? "Votações" : "Pessoas", exact: true });
        await expect(outro).toHaveCount(1);
        await expect(outro).not.toHaveAttribute("aria-current", /.+/);
        await expect(nav.locator("[aria-current]")).toHaveCount(1);
      }
      // na home, nenhum dos dois é o atual
      await page.goto("/");
      await expect(nav.getByRole("link", { name: "Pessoas", exact: true })).not.toHaveAttribute("aria-current", /.+/);
      await expect(nav.getByRole("link", { name: "O que está rolando?" })).toHaveAttribute("aria-current", "page");
    });

  test("a 390px, Pessoas e Votações à vista sem rolar; pelo teclado, nenhum link da linha fica escondido", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/", "/acompanhando", "/temas"]) {
      await page.goto(url);
      const nav = page.getByRole("navigation", { name: "Perguntas" });
      expect(await page.locator(".sv-perg").evaluate((n) => n.scrollLeft), `${url}: a linha começa do início`).toBe(0);
      for (const nome of ["Pessoas", "Votações"]) {
        const link = nav.getByRole("link", { name: nome, exact: true });
        await expect(link, `${url}: ${nome}`).toBeInViewport({ ratio: 1 });
        expect(await link.evaluate(visivelNoCentro), `${url}: ${nome}`).toBe(true);
      }
      // a primeira pergunta continua à vista, inteira
      await expect(nav.getByRole("link", { name: "O que está rolando?" })).toBeInViewport({ ratio: 1 });
      // Tab por todos os links da navegação, na ordem do DOM: o focado nunca fica sob o grupo preso (WCAG 2.4.11)
      const links = await nav.getByRole("link").all();
      expect(links.length).toBe(7);
      await page.locator(".sv-marca").focus();
      await page.keyboard.press("Tab"); // UF ou "Escolha seu estado"
      for (const link of links) {
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        const nome = (await link.innerText()).trim();
        // a pergunta mais longa é mais larga que o espaço livre a 390px: ela não cabe inteira, mas a maior parte e o centro ficam à vista
        await expect(link, `${url}: ${nome} focado`).toBeInViewport({ ratio: 0.6 });
        expect(await link.evaluate(visivelNoCentro), `${url}: ${nome} focado e coberto`).toBe(true);
      }
    }
    // com espaçamento de texto WCAG 1.4.12 a linha continua sem estourar a página
    await page.addStyleTag({ content: "*{letter-spacing:.12em !important;word-spacing:.16em !important}" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("a partir de 900px o grupo de Pessoas e Votações não existe na tela: a linha Também é a mesma", async ({ page }) => {
    for (const width of [900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      expect(await page.locator(".sv-fixo").evaluate((e) => getComputedStyle(e).display), `${width}px`).toBe("contents");
      // os cinco links da linha "Também" seguem na mesma linha, na ordem de antes
      const r = await page.locator(".sv-nv2 a").evaluateAll((as) => as.map((a) => ({ t: (a.textContent ?? "").trim(), y: Math.round(a.getBoundingClientRect().top) })));
      expect(r.map((x) => x.t), `${width}px`).toEqual(["O que mexe comigo?", "O que está em jogo?", "Pessoas", "Votações", "Ajustes"]);
      expect(new Set(r.map((x) => x.y)).size, `${width}px: uma linha só`).toBe(1);
    }
  });

  // D326: a partir de 1280px as duas camadas voltam a dividir a mesma linha. O espaço das perguntas depende da largura do
  // nome do estado no topo: o teste passa por todos.
  const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
  const medirLinha = async () => {
    await document.fonts.ready; // sem isto a medida pode sair com a fonte de reserva
    const nav = document.querySelector(".sv-perg")!.getBoundingClientRect();
    const ul = document.querySelector(".sv-nv1")!;
    const nv1 = [...document.querySelectorAll(".sv-nv1 a")].map((a) => a.getBoundingClientRect());
    const nv2 = document.querySelector(".sv-nv2")!.getBoundingClientRect();
    const mesmaLinha = Math.abs(nv2.top - nav.top) < 2 && nv2.left >= Math.max(...nv1.map((r) => r.right)) - 1;
    return {
      topo: Math.round(document.querySelector(".sv-topo")!.getBoundingClientRect().bottom),
      alturaPerguntas: Math.max(...nv1.map((r) => Math.round(r.height))),
      // "Também" ao lado das perguntas: começa na mesma altura que elas e termina à direita delas
      mesmaLinha,
      estouro: document.documentElement.scrollWidth - window.innerWidth,
      // Espaço livre da linha, em px: o que sobra depois do mínimo das perguntas (flex-basis) e da linha "Também". As duas
      // crescem por igual (flex-grow 1), então o livre é o dobro do que as perguntas ganharam. Só vale com as duas na mesma
      // linha; com a linha "Também" embaixo não há o que medir (-1).
      livre: mesmaLinha ? Math.floor((ul.getBoundingClientRect().width - parseFloat(getComputedStyle(ul).flexBasis)) * 2) : -1,
      base: getComputedStyle(ul).flexBasis,
    };
  };
  // Espaço livre mínimo exigido onde a linha tem de caber. Com menos de 1px (primeira versão da D326) o teste passava no
  // Chrome do macOS e a linha descia no Chromium do Linux, que mede o texto um pouco mais largo: exigir a sobra pega isso nos dois.
  const LIVRE_MIN = 12;

  test("a partir de 1280px o topo volta a uma linha só (86px), com qualquer estado guardado", async ({ page, context }) => {
    test.setTimeout(240_000);
    const falhas: string[] = [];
    let menor = { livre: Infinity, caso: "" };
    const casos: [string | null, string, number][] = [];
    for (const uf of [null, ...UFS]) casos.push([uf, "/", 1280]);
    // o link atual fica em negrito (mais largo): conta nas rotas em que a segunda pergunta ou um link da linha "Também" é o atual
    for (const uf of [null, "RN", "MS"]) for (const url of ["/acompanhando", "/decisoes", "/temas", "/votacoes"]) casos.push([uf, url, 1280]);
    // o conteúdo tem teto de 1232px: em tela mais larga a conta é a mesma, e o pior caso (RN em /decisoes) também
    for (const uf of [null, "RN"]) for (const w of [1440, 1920]) for (const url of ["/", "/decisoes"]) casos.push([uf, url, w]);
    for (const [uf, url, width] of casos) {
      await context.clearCookies();
      if (uf) await context.addCookies([{ ...SP, value: uf }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      if (uf) await expect(page.locator(".sv-uf"), `${uf} aplicado`).toContainText(`(${uf})`);
      const m = await page.evaluate(medirLinha);
      const caso = `${uf ?? "sem estado"} ${url} a ${width}px`;
      if (m.mesmaLinha && m.livre < menor.livre) menor = { livre: m.livre, caso };
      if (m.topo > 87 || m.alturaPerguntas > 52 || !m.mesmaLinha || m.estouro > 0 || m.livre < LIVRE_MIN) falhas.push(`${caso}: ${JSON.stringify(m)}`);
    }
    // fica no log do ci: é a única medida da sobra no Chromium do Linux
    console.log(`D326: menor espaço livre do topo = ${menor.livre}px (${menor.caso}); mínimo exigido ${LIVRE_MIN}px`);
    expect(falhas).toEqual([]);
  });

  test("com a barra de rolagem clássica (17px a menos de conteúdo) a linha ainda cabe; sem espaço, a linha Também desce sem estourar", async ({ page, context }) => {
    // A barra clássica (Windows) não muda a media query, só tira largura do conteúdo. O Chromium do teste esconde a barra:
    // o aperto é simulado com margem no html, numa janela de 1280px. 17px cabem na sobra; 80px, não.
    for (const [aperto, cabe] of [[17, true], [80, false]] as const) {
      await context.clearCookies();
      await context.addCookies([{ ...SP, value: "RN" }]);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/decisoes");
      await expect(page.locator(".sv-uf")).toContainText("(RN)");
      await page.addStyleTag({ content: `html{margin-right:${aperto}px}` });
      const m = await page.evaluate(medirLinha);
      expect(m.mesmaLinha, `RN com ${aperto}px a menos`).toBe(cabe);
      expect(m.alturaPerguntas, `RN com ${aperto}px a menos: perguntas em até duas linhas`).toBeLessThanOrEqual(56);
      expect(m.estouro, `RN com ${aperto}px a menos`).toBeLessThanOrEqual(aperto);
      expect(m.topo, `RN com ${aperto}px a menos`).toBeLessThanOrEqual(cabe ? 87 : 112);
    }
  });

  test("com o texto do topo maior (zoom só de texto) nada estoura, e até 130% as perguntas seguem em até duas linhas", async ({ page, context }) => {
    // Zoom só de texto (Firefox, Safari) aumenta toda fonte e não a janela. Simulado com as fontes do topo multiplicadas:
    // perguntas (21px), linha "Também" e estado (14px), marca (26px). A largura mínima das perguntas está em em e cresce junto.
    for (const fator of [1.15, 1.3, 2]) {
      const px = (n: number) => `${(n * fator).toFixed(2)}px`;
      const css = `.sv .sv-nv1,.sv .sv-nv1 a{font-size:${px(21)}}.sv .sv-nv2,.sv .sv-nv2 a,.sv .sv-uf,.sv .sv-uf a{font-size:${px(14)}}.sv .sv-marca{font-size:${px(26)}}`;
      for (const uf of [null, "RN"]) {
        await context.clearCookies();
        if (uf) await context.addCookies([{ ...SP, value: uf }]);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/decisoes");
        if (uf) await expect(page.locator(".sv-uf")).toContainText(`(${uf})`);
        await page.addStyleTag({ content: css });
        const m = await page.evaluate(medirLinha);
        const caso = `${uf ?? "sem estado"} com texto a ${Math.round(fator * 100)}%`;
        // duas linhas de 1,15 da fonte, mais 4px de respiro do link e 2px de arredondamento; nunca menos que os 52px da linha
        // A 200% não há largura para duas linhas nem com a linha inteira (a coluna da marca e do estado também cresce): as
        // perguntas quebram em mais linhas, sozinhas na linha, e o que se exige é não estourar.
        if (fator < 2) expect(m.alturaPerguntas, `${caso}: perguntas em até duas linhas (${JSON.stringify(m)})`).toBeLessThanOrEqual(Math.max(52, Math.ceil(2 * 21 * fator * 1.15) + 6));
        else expect(m.mesmaLinha, `${caso}: a linha Também não fica ao lado das perguntas (${JSON.stringify(m)})`).toBe(false);
        expect(m.estouro, `${caso}: sem estouro (${JSON.stringify(m)})`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("abaixo de 1280px a linha Também segue embaixo, sem estourar nem quebrar as perguntas em três linhas", async ({ page, context }) => {
    for (const uf of [null, "RN"]) {
      await context.clearCookies();
      if (uf) await context.addCookies([{ ...SP, value: uf }]);
      for (const width of [900, 1100, 1200, 1279]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        if (uf) await expect(page.locator(".sv-uf"), `${uf} aplicado`).toContainText(`(${uf})`);
        const m = await page.evaluate(medirLinha);
        expect(m.mesmaLinha, `${uf} ${width}px`).toBe(false);
        expect(m.alturaPerguntas, `${uf} ${width}px`).toBeLessThanOrEqual(56);
        expect(m.topo, `${uf} ${width}px`).toBeLessThanOrEqual(112);
        expect(m.estouro, `${uf} ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("o rodapé continua com Votações, Pessoas e Como funciona", async ({ page }) => {
    await page.goto("/");
    const rod = page.locator("footer.sv-rod");
    for (const nome of ["Votações", "Pessoas", "Como funciona"]) await expect(rod.getByRole("link", { name: nome, exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Topo compacto no celular
// ---------------------------------------------------------------------------------------------------------------------
const medirTopo = () => {
  const topo = document.querySelector(".sv-topo")!.getBoundingClientRect();
  const nav = document.querySelector<HTMLElement>(".sv-perg")!;
  const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getBoundingClientRect());
  return {
    fim: Math.round(topo.bottom),
    rola: nav.scrollWidth - nav.clientWidth,
    linhas: new Set(links.map((r) => Math.round(r.top))).size,
    menor: Math.min(...links.map((r) => Math.min(r.width, r.height))),
    n: links.length,
    estouro: document.documentElement.scrollWidth - window.innerWidth,
    menus: document.querySelectorAll(".sv-topo button, .sv-topo details, .sv-topo [aria-expanded]").length,
  };
};

test.describe("2. topo compacto", () => {
  for (const leitor of ["anon", "com estado"] as const)
    test(`a 390px o topo termina em até 130px e as perguntas ficam numa linha que rola [${leitor}]`, async ({ page, context }) => {
      // o estado de nome mais comprido: no celular só a sigla aparece, e a primeira linha não quebra
      if (leitor === "com estado") await context.addCookies([{ ...SP, value: "RN" }]);
      await page.setViewportSize({ width: 390, height: 844 });
      for (const url of ["/", "/pessoas", "/decisoes"]) {
        await page.goto(url);
        const m = await page.evaluate(medirTopo);
        // o <main> começa logo abaixo do topo; na demonstração há uma faixa "Versão de demonstração" entre os dois, que
        // produção não tem: por isso a medida é o fim do topo (era 229px antes da D324)
        expect(m.fim, `${url}: fim do topo`).toBeLessThanOrEqual(130);
        expect(m.n, "sete links na navegação").toBe(7);
        expect(m.linhas, `${url}: todos os links na mesma linha`).toBe(1);
        expect(m.rola, `${url}: a linha rola na horizontal`).toBeGreaterThan(0);
        expect(m.menor, `${url}: alvos de toque ≥ 44px`).toBeGreaterThanOrEqual(44);
        expect(m.estouro, `${url}: a página não rola na horizontal`).toBeLessThanOrEqual(0);
        expect(m.menus, `${url}: sem menu que abre e fecha`).toBe(0);
      }
      if (leitor === "com estado") {
        // o nome do estado segue no texto (leitor de tela), a sigla é o que se vê
        await expect(page.locator(".sv-uf")).toContainText("Rio Grande do Norte (RN)");
        await expect(page.locator(".sv-uf").getByRole("link", { name: "trocar estado" })).toBeInViewport({ ratio: 1 });
      }
    });

  test("a 390px o topo compacto funciona sem JavaScript", async ({ browser }, info) => {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto("/");
    const m = await page.evaluate(medirTopo);
    expect(m.fim).toBeLessThanOrEqual(130);
    expect(m.linhas).toBe(1);
    await page.getByRole("navigation", { name: "Perguntas" }).getByRole("link", { name: "Votações", exact: true }).click();
    await expect(page).toHaveURL(/\/votacoes$/);
    await context.close();
  });

  test("a partir de 900px a navegação não rola e segue em duas camadas", async ({ page }) => {
    for (const width of [900, 1100, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const m = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>(".sv-perg")!;
        return { rola: nav.scrollWidth - nav.clientWidth, overflow: getComputedStyle(nav).overflowX, nv1: getComputedStyle(document.querySelector(".sv-nv1")!).display, estouro: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(m.overflow, `${width}px`).toBe("visible");
      expect(m.rola, `${width}px`).toBeLessThanOrEqual(0);
      expect(m.nv1, `${width}px`).toBe("grid");
      expect(m.estouro, `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("topo compacto no perfil de celular @mobile", async ({ page, context }) => {
    await context.addCookies([SP]);
    await page.goto("/");
    const m = await page.evaluate(medirTopo);
    expect(m.fim).toBeLessThanOrEqual(130);
    expect(m.linhas).toBe(1);
    expect(m.estouro).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. Home: "O que lemos" perto do fim; convite único para quem chega sem estado nem escolhidos
// ---------------------------------------------------------------------------------------------------------------------
test.describe("3. home", () => {
  test('"O que lemos" vem depois do conteúdo e antes de "Quem conferiu isso?"', async ({ page, context }) => {
    await context.addCookies([SP, sigo(["helena-siqueira"])]);
    for (const width of [390, 900, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const ordem = await page.evaluate(() =>
        Array.from(document.querySelector(".sv-pg--rola")!.children)
          .map((el) => ({ el, y: el.getBoundingClientRect().top }))
          .sort((a, b) => a.y - b.y)
          .map(({ el }) => (el.matches(".sv-lemos") ? "lemos" : el.matches(".sv-folio") ? "folio" : (el.querySelector("h2")?.id ?? el.className))),
      );
      const i = ordem.indexOf("lemos");
      expect(ordem[0], `${width}px`).toBe("folio");
      expect(ordem[1], `${width}px: o primeiro bloco é "Em quem eu votei"`).toBe("inicio-escolhidos");
      expect(i, `${width}px: "O que lemos" depois de "E no Congresso?"`).toBeGreaterThan(ordem.indexOf("inicio-congresso"));
      expect(ordem.slice(i + 1).some((x) => x === "quem-conferiu"), `${width}px: antes de "Quem conferiu isso?"`).toBe(true);
      expect(ordem.length - i, `${width}px: perto do fim`).toBeLessThanOrEqual(3);
    }
  });

  test("sem estado e sem escolhidos: um convite para /comecar, sem redirecionar", async ({ page, request }) => {
    // a raiz responde 200 com a própria página: nada de redirecionamento automático
    const res = await request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".sv h1")).toHaveText("O que está rolando?");
    const convite = page.locator('[aria-labelledby="inicio-convite"]');
    await expect(convite).toHaveCount(1);
    await expect(convite.getByRole("heading", { name: "Primeira vez aqui?" })).toBeVisible();
    await expect(convite.getByRole("link", { name: /Começar/ })).toHaveAttribute("href", "/comecar");
    await expect(page.locator('.sv-main a[href="/comecar"]'), "um convite só").toHaveCount(1);
    // é o primeiro bloco depois do cabeçalho, no celular e no desktop
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const segundo = await page.evaluate(() => {
        const blocos = Array.from(document.querySelector(".sv-pg--rola")!.children).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        return blocos[1].querySelector("h2")?.id;
      });
      expect(segundo, `${width}px`).toBe("inicio-convite");
    }
  });

  for (const [nome, cookies] of [
    ["só estado", [SP]],
    ["só escolhidos", [sigo(["helena-siqueira"])]],
    ["estado e escolhidos", [SP, sigo(["helena-siqueira"])]],
  ] as const)
    test(`com ${nome} não há convite`, async ({ page, context }) => {
      await context.addCookies([...cookies]);
      await page.goto("/");
      await expect(page.locator(".sv h1")).toHaveText("O que está rolando?");
      await expect(page.locator('[aria-labelledby="inicio-convite"]')).toHaveCount(0);
      await expect(page.locator('.sv-main a[href="/comecar"]')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. /pessoas abre no estado guardado
// ---------------------------------------------------------------------------------------------------------------------
test.describe("4. /pessoas pelo estado do visitante", () => {
  test("sem uf no endereço e com sv_uf: abre no estado, diz isso e oferece ver todos", async ({ page, context }) => {
    await page.goto("/pessoas");
    const totalPais = await page.locator('[aria-labelledby="pp-2"] .sv-a').innerText();
    await expect(page.locator("#pp-uf")).toHaveValue("");
    await expect(page.locator("#pp-estado")).toContainText("lista é do país inteiro");

    await context.addCookies([SP]);
    await page.goto("/pessoas");
    await expect(page.locator("#pp-uf")).toHaveValue("SP");
    await expect(page.locator("#pp-estado")).toContainText("A lista abre em São Paulo (SP), o estado guardado em Ajustes.");
    await expect(page.getByRole("heading", { name: "Quem está no cargo em São Paulo, em ordem alfabética?" })).toBeVisible();
    const totalSp = await page.locator('[aria-labelledby="pp-2"] .sv-a').innerText();
    expect(totalSp).toMatch(/no cargo hoje em São Paulo/);
    expect(totalSp).not.toBe(totalPais);
    // D331: sem filtro do eleitor não há lista, só o total e o pedido do filtro
    await expect(page.locator(".sv-pp > li")).toHaveCount(0);
    await expect(page.locator("#pp-pede")).toBeVisible();
    // com filtro, é a mesma lista do estado explícito
    await page.goto("/pessoas?cargo=deputado_estadual&uf=SP");
    const nomesFiltro = await page.locator(".sv-pp > li > a").allInnerTexts();
    expect(nomesFiltro.length).toBeGreaterThan(0);
    await page.goto("/pessoas?cargo=deputado_estadual");
    expect(await page.locator(".sv-pp > li > a").allInnerTexts()).toEqual(nomesFiltro);
    // a próxima página segue no estado guardado, sem pôr o estado no endereço
    const proximas = page.getByRole("link", { name: /Próximas 60/ });
    await expect(proximas).not.toHaveAttribute("href", /uf=/);

    // "ver todos os estados" é o pedido explícito de todos: vale sobre o cookie, inclusive na página seguinte
    await page.goto("/pessoas");
    await page.getByRole("link", { name: "Ver todos os estados" }).click();
    await expect(page).toHaveURL(/\/pessoas\?uf=$/);
    await expect(page.locator("#pp-uf")).toHaveValue("");
    await expect(page.locator("#pp-estado")).toHaveCount(0);
    expect(await page.locator('[aria-labelledby="pp-2"] .sv-a').innerText()).toBe(totalPais);
    await page.goto("/pessoas?cargo=deputado_estadual&uf=");
    await expect(page.getByRole("link", { name: /Próximas 60/ })).toHaveAttribute("href", /(\?|&)uf=(&|$)/);
  });

  test("uf explícito vale sobre o cookie; nome e cargo sem uf mantêm o estado guardado", async ({ page, context }) => {
    await context.addCookies([SP]);
    await page.goto("/pessoas?uf=RJ&cargo=vereador");
    await expect(page.locator("#pp-uf")).toHaveValue("RJ");
    await expect(page.locator("#pp-estado")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Quem está no cargo, com esses filtros?" })).toBeVisible();

    await page.goto("/pessoas?cargo=senador");
    await expect(page.locator("#pp-uf")).toHaveValue("SP");
    await expect(page.locator("#pp-estado")).toContainText("A lista abre em São Paulo (SP)");
    // "ver todos os estados" tira só o estado: o cargo continua
    await expect(page.getByRole("link", { name: "Ver todos os estados" })).toHaveAttribute("href", "/pessoas?cargo=senador&uf=");
    await expect(page.getByRole("link", { name: "Limpar os filtros" })).toBeVisible();
    // o formulário envia o estado escolhido: escolher "Todos os estados" e procurar é pedido explícito
    await page.locator("#pp-uf").selectOption("");
    await page.getByRole("button", { name: "Procurar" }).click();
    await expect(page).toHaveURL(/uf=(&|$)/);
    await expect(page.locator("#pp-estado")).toHaveCount(0);
  });

  test("cookie de estado inválido não filtra nem aparece", async ({ page, context }) => {
    await context.addCookies([{ ...SP, value: "ZZ" }]);
    await page.goto("/pessoas");
    await expect(page.locator("#pp-uf")).toHaveValue("");
    await expect(page.locator(".sv-main")).not.toContainText("ZZ");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 5. Marcar pessoas direto na lista
// ---------------------------------------------------------------------------------------------------------------------
test.describe("5. marcar direto na lista", () => {
  test("cada linha tem o botão; marcar grava sv_sigo httpOnly e desmarcar apaga", async ({ page, context }) => {
    await page.goto("/pessoas?cargo=senador&uf=SP");
    const linhas = page.locator(".sv-pp > li");
    const n = await linhas.count();
    expect(n).toBeGreaterThan(1);
    await expect(page.locator(".sv-pp > li form button.sv-follow")).toHaveCount(n);
    await expect(page.locator(".sv-pp__m > p[role=status]")).toContainText("Você ainda não marcou ninguém.");

    const primeira = linhas.first();
    const nome = (await primeira.locator("a").first().innerText()).trim();
    const slug = (await primeira.locator("a").first().getAttribute("href"))!.replace("/pessoa/", "");
    // o nome da pessoa está no rótulo acessível do botão (um botão por pessoa); o texto visível é o começo do rótulo
    await expect(primeira.getByRole("button")).toHaveAccessibleName(`Votei nesta pessoa: ${nome}`);
    await expect(primeira.getByRole("button")).toHaveText("Votei nesta pessoa");
    await expect(primeira.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    await primeira.getByRole("button").click();
    await expect(primeira.getByRole("button", { name: `Você acompanha: ${nome}` })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/pessoas\?cargo=senador&uf=SP$/); // continua na lista
    await expect(page.locator(".sv-pp__m > p[role=status]")).toContainText("Você acompanha 1 pessoa.");
    await expect(page.locator(".sv-pp > li button[aria-pressed=true]")).toHaveCount(1);

    const cookie = (await context.cookies()).filter((c) => c.name === "sv_sigo");
    expect(cookie).toHaveLength(1);
    expect(cookie[0].value).toBe(slug);
    expect(cookie[0].httpOnly, "httpOnly").toBe(true);
    expect(cookie[0].path).toBe("/");
    expect(await page.evaluate(() => document.cookie), "o navegador não enxerga o cookie").not.toContain("sv_sigo");

    // a pessoa marcada aparece em Escolhidos e na página dela
    await page.goto("/acompanhando");
    await expect(page.locator(".sv-esc__pessoas .sv-esc__n")).toHaveText([nome]);
    await page.goto(`/pessoa/${slug}`);
    await expect(page.locator(".sv-cab").getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");

    // desmarcar na lista
    await page.goto("/pessoas?cargo=senador&uf=SP");
    await linhas.first().getByRole("button").click();
    await expect(linhas.first().getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect((await context.cookies()).filter((c) => c.name === "sv_sigo")).toHaveLength(0);
  });

  test("funciona sem JavaScript, também na lista de um grupo", async ({ browser }, info) => {
    const context = await semJs(browser, info);
    const page = await context.newPage();
    for (const url of ["/pessoas?cargo=senador&uf=SP", "/pessoas?cidade=3509502&grupo=vereadores"]) {
      await page.goto(url);
      const botao = page.locator(".sv-pp > li").nth(1).getByRole("button");
      await expect(botao).toHaveAttribute("aria-pressed", "false");
      const slug = (await page.locator(".sv-pp > li").nth(1).locator("a").first().getAttribute("href"))!.replace("/pessoa/", "");
      await Promise.all([page.waitForLoadState("load"), botao.click()]);
      await expect(page.locator(".sv-pp > li").nth(1).getByRole("button")).toHaveAttribute("aria-pressed", "true");
      const c = (await context.cookies()).find((x) => x.name === "sv_sigo");
      expect(c?.value.split("."), url).toContain(slug);
      expect(c?.httpOnly, url).toBe(true);
    }
    await context.close();
  });

  test("com 12 marcados, os demais botões ficam desligados e a lista diz o limite uma vez", async ({ page, context }) => {
    await page.goto("/pessoas?cargo=deputado_estadual&uf=SP");
    const slugs = (await page.locator(".sv-pp > li > a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!.replace("/pessoa/", "")))).slice(0, 12);
    expect(new Set(slugs).size).toBe(12);
    await context.addCookies([sigo(slugs)]);
    await page.goto("/pessoas?cargo=deputado_estadual&uf=SP");
    await expect(page.locator(".sv-pp > li button[aria-pressed=true]")).toHaveCount(12);
    await expect(page.locator(".sv-pp > li button[aria-pressed=true]:disabled")).toHaveCount(0); // quem está marcado pode ser tirado
    const fora = page.locator(".sv-pp > li button[aria-pressed=false]");
    expect(await fora.count()).toBeGreaterThan(0);
    await expect(page.locator(".sv-pp > li button[aria-pressed=false]:not(:disabled)")).toHaveCount(0);
    await expect(page.getByText("Você já acompanha 12 pessoas, o limite. Tire alguém para incluir.")).toHaveCount(1);
    // o botão desligado segue em tinta sobre papel (sem a cor cinza do navegador)
    expect(await fora.first().evaluate((b) => getComputedStyle(b).color)).toBe("rgb(74, 72, 68)");
  });

  test("o botão é igual para toda pessoa (mesmo texto, mesma moldura)", async ({ page }) => {
    await page.goto("/pessoas?cargo=deputado_estadual&uf=SP");
    const r = await page.locator(".sv-pp > li button.sv-follow").evaluateAll((bs) =>
      bs.map((b) => {
        const cs = getComputedStyle(b);
        return [b.childNodes[0].textContent, cs.color, cs.backgroundColor, cs.borderTopWidth, cs.borderTopStyle, cs.fontWeight, cs.fontSize, Math.round(b.getBoundingClientRect().height)].join("|");
      }),
    );
    expect(r.length).toBeGreaterThan(10);
    expect(new Set(r).size).toBe(1);
    expect(r[0]).toMatch(/^Votei nesta pessoa\|/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 6. Começo em dois passos
// ---------------------------------------------------------------------------------------------------------------------
test.describe("6. começo em dois passos", () => {
  test("fora de busca, com os dois passos nomeados e 'pular' em cada um", async ({ page }) => {
    await page.goto("/comecar");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator(".sv h1")).toHaveText("Por onde eu começo?");
    await expect(page.locator(".sv-passos [aria-current=step]")).toHaveText("Passo 1 de 2: seu estado");
    // sem estado não há formulário de cidade nem nome de estado fora do campo
    await expect(page.locator("#cm-cid")).toHaveCount(0);
    await page.getByRole("link", { name: /Pular este passo/ }).click();
    await expect(page).toHaveURL(/\/comecar\?passo=2$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator(".sv h1")).toHaveText("Em quem você votou?");
    await expect(page.locator(".sv-passos [aria-current=step]")).toHaveText("Passo 2 de 2: em quem você votou");
    await expect(page.locator(".sv-main")).toContainText("Sem estado escolhido, a lista é do país inteiro");
    // D331: a lista espera o filtro do eleitor
    await expect(page.locator(".sv-pp > li")).toHaveCount(0);
    await expect(page.locator("#cm-pede")).toBeVisible();
    await page.getByRole("link", { name: /Pular este passo/ }).click();
    await expect(page).toHaveURL(/\/$/);
    // quem pulou tudo continua sem cookies: o convite segue na home
    await expect(page.locator('[aria-labelledby="inicio-convite"]')).toHaveCount(1);
  });

  test("sem JavaScript: estado, cidade, marcar e concluir; só os cookies que já existiam", async ({ browser }, info) => {
    const context = await semJs(browser, info);
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('[aria-labelledby="inicio-convite"]').getByRole("link", { name: /Começar/ }).click();
    await expect(page).toHaveURL(/\/comecar$/);

    // passo 1: estado
    await page.locator("#cm-uf").selectOption("SP");
    await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Guardar estado" }).click()]);
    expect(new URL(page.url()).pathname + new URL(page.url()).hash).toBe("/comecar#cm-cidade");
    expect((await context.cookies()).find((c) => c.name === "sv_uf")?.value).toBe("SP");
    await expect(page.locator('[aria-labelledby="cm-estado"] .sv-a')).toHaveText("São Paulo (SP).");
    await expect(page.locator(".sv-uf")).toContainText("São Paulo (SP)");

    // passo 1: cidade (opcional). Liga a esfera municipal e mantém a estadual como estava (ligada por padrão)
    const cidade = await page.locator("#cm-cid option").nth(1).getAttribute("value");
    expect(cidade).toMatch(/^35\d{5}$/);
    await page.locator("#cm-cid").selectOption(cidade!);
    await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Guardar cidade e continuar" }).click()]);
    await expect(page).toHaveURL(/\/comecar\?passo=2#cm-pessoas$/);
    expect((await context.cookies()).find((c) => c.name === "sv_esferas")?.value).toBe(`e1.m1.c${cidade}`);

    // passo 2: sem lista até o eleitor filtrar (D331); o partido é o primeiro campo
    await expect(page.getByRole("heading", { name: "Quem está no cargo em São Paulo, em ordem alfabética?" })).toBeVisible();
    await expect(page.locator(".sv-pp > li")).toHaveCount(0);
    await expect(page.locator(".sv-filtro label").first()).toHaveText("Partido");
    // partido fixo da demonstração com gente em SP (a primeira opção pode não ter ninguém no estado)
    await page.locator("#cm-partido").selectOption("aur");
    await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Procurar" }).click()]);
    await expect(page).toHaveURL(/passo=2&partido=aur/);
    const nomes = await page.locator(".sv-pp > li > a").allInnerTexts();
    expect(nomes.length).toBeGreaterThan(0);
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await expect(page.locator(".sv-cm-nav").getByRole("link", { name: /Pular este passo/ })).toBeVisible();
    const slug = (await page.locator(".sv-pp > li > a").first().getAttribute("href"))!.replace("/pessoa/", "");
    await Promise.all([page.waitForLoadState("load"), page.locator(".sv-pp > li").first().getByRole("button").click()]);
    // sem JavaScript o formulário GET manda também os campos vazios (cargo=, nome=): a volta mantém o mesmo filtro
    await expect(page).toHaveURL(/\/comecar\?passo=2&partido=[^&#]+(&(cargo|nome)=[^&#]*)*(#cm-pessoas)?$/);
    await expect(page.locator(".sv-pp > li").first().getByRole("button")).toHaveAttribute("aria-pressed", "true");
    const c = (await context.cookies()).find((x) => x.name === "sv_sigo");
    expect(c?.value).toBe(slug);
    expect(c?.httpOnly).toBe(true);

    // concluir leva à home, que não convida mais e já mostra a pessoa marcada
    await page.locator(".sv-cm-nav").getByRole("link", { name: /Concluir/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[aria-labelledby="inicio-convite"]')).toHaveCount(0);
    await expect(page.locator("ul.sv-esc > li")).toHaveCount(1);

    // nenhum cookie novo: só os três que já existiam
    // ("onb" é o cookie que a config do Playwright põe em todo contexto, do desenho anterior: não vem do site)
    expect((await context.cookies()).map((x) => x.name).filter((x) => x !== "onb").sort()).toEqual(["sv_esferas", "sv_sigo", "sv_uf"]);
    await context.close();
  });

  test("guardar a cidade não desliga a Assembleia nem religa a que estava desligada; sem cidade, municipal desligado", async ({ page, context }) => {
    const esferas = async () => (await context.cookies()).find((c) => c.name === "sv_esferas")?.value;
    // estadual desligada nos Ajustes continua desligada
    await context.addCookies([SP, { name: "sv_esferas", value: "e0.m0", domain: "localhost", path: "/" }]);
    await page.goto("/comecar");
    const cidade = (await page.locator("#cm-cid option").nth(1).getAttribute("value"))!;
    await page.locator("#cm-cid").selectOption(cidade);
    await page.getByRole("button", { name: "Guardar cidade e continuar" }).click();
    await expect(page).toHaveURL(/\/comecar\?passo=2(#cm-pessoas)?$/);
    expect(await esferas()).toBe(`e0.m1.c${cidade}`);
    // "Nenhuma cidade": apaga a cidade e desliga a municipal
    await page.goto("/comecar");
    await expect(page.locator("#cm-cid")).toHaveValue(cidade);
    await page.locator("#cm-cid").selectOption("");
    await page.getByRole("button", { name: "Guardar cidade e continuar" }).click();
    await expect(page).toHaveURL(/\/comecar\?passo=2(#cm-pessoas)?$/);
    expect(await esferas()).toBe("e0.m0");
  });

  test("cidade adulterada (de outro estado ou fora do padrão) não é gravada nem liga a esfera municipal", async ({ browser }, info) => {
    for (const valor of ["3304557", "abc", "35095021"]) {
      const context = await semJs(browser, info);
      await context.addCookies([SP]);
      const page = await context.newPage();
      await page.goto("/comecar");
      await page.locator("#cm-cid").evaluate((sel: HTMLSelectElement, v) => {
        sel.add(new Option(v, v));
        sel.value = v;
      }, valor);
      await Promise.all([page.waitForURL(/passo=2/), page.getByRole("button", { name: "Guardar cidade e continuar" }).click()]);
      // o formulário foi enviado (chegou ao passo 2) e o cookie gravado não tem cidade nem a esfera municipal ligada
      expect(new URL(page.url()).search, valor).toBe("?passo=2");
      expect((await context.cookies()).find((c) => c.name === "sv_esferas")?.value, valor).toBe("e1.m0");
      await context.close();
    }
  });

  test("sem estado guardado, a ação da cidade não grava cidade nenhuma", async ({ browser }, info) => {
    // o formulário da cidade só existe com estado; aqui o cookie do estado some entre abrir a página e enviar
    const context = await semJs(browser, info);
    await context.addCookies([SP]);
    const page = await context.newPage();
    await page.goto("/comecar");
    const cidade = (await page.locator("#cm-cid option").nth(1).getAttribute("value"))!;
    await page.locator("#cm-cid").selectOption(cidade);
    await context.clearCookies({ name: "sv_uf" });
    await Promise.all([page.waitForURL(/passo=2/), page.getByRole("button", { name: "Guardar cidade e continuar" }).click()]);
    expect((await context.cookies()).find((c) => c.name === "sv_esferas")?.value).toBe("e1.m0");
    await context.close();
  });

  test("passo 2: filtro por nome e cargo e a paginação seguem no passo 2", async ({ page, context }) => {
    await context.addCookies([SP]);
    await page.goto("/comecar?passo=2&cargo=deputado_estadual");
    await expect(page.locator(".sv-pp > li")).toHaveCount(60);
    const proximas = page.getByRole("link", { name: /Próximas 60/ });
    await expect(proximas).toHaveAttribute("href", /^\/comecar\?passo=2&cargo=deputado_estadual&pagina=\d+$/);
    await proximas.click();
    await expect(page.locator(".sv h1")).toHaveText("Em quem você votou?");
    await page.locator("#cm-cargo").selectOption("senador");
    await page.getByRole("button", { name: "Procurar" }).click();
    await expect(page).toHaveURL(/passo=2/);
    await expect(page).toHaveURL(/cargo=senador/);
    const cargos = await page.locator(".sv-pp__c").allInnerTexts();
    expect(cargos.length).toBeGreaterThan(0);
    for (const c of cargos) expect(c).toMatch(/^Senador/);
    await expect(page.getByRole("link", { name: "Limpar os filtros" })).toHaveAttribute("href", "/comecar?passo=2");
    // entrada inválida não derruba a página
    for (const q of ["passo=2&pagina=abc", "passo=2&cargo=rei", "passo=2&passo=1", "passo=3", "passo=2&nome=" + "x".repeat(300)]) {
      const res = await page.goto(`/comecar?${q}`);
      expect(res?.status(), q).toBe(200);
      await expect(page.locator(".sv h1"), q).toHaveCount(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 7. Página da pessoa: quatro respostas no topo
// ---------------------------------------------------------------------------------------------------------------------
const PERGUNTAS = ["Como vota?", "Quanto gasta?", "O patrimônio declarado mudou?", "Foi trabalhar?"];
const SECOES = ["votos", "gastos", "patrimonio", "trabalho"];

test.describe("7. quatro respostas na página da pessoa", () => {
  test("deputado federal: as quatro, nesta ordem, com o dado da seção, a fonte e o link", async ({ page }) => {
    await page.goto("/pessoa/alvaro-aguiar-sp");
    const quadro = page.locator("section.sv-q4");
    await expect(quadro).toHaveCount(1);
    expect(await quadro.locator("dt").allInnerTexts()).toEqual(PERGUNTAS);
    // vem antes de todas as seções
    const antes = await page.evaluate(() => {
      const q = document.querySelector(".sv-q4")!.getBoundingClientRect().bottom;
      return Array.from(document.querySelectorAll(".sv-pg--pessoa > section.sv-l3")).every((s) => s.getBoundingClientRect().top >= q - 1);
    });
    expect(antes, "o quadro vem antes das seções").toBe(true);

    const itens = quadro.locator(".sv-q4__i");
    for (let i = 0; i < 4; i++) {
      const item = itens.nth(i);
      const secao = page.locator(`section#${SECOES[i]}`);
      await expect(secao, SECOES[i]).toHaveCount(1);
      await expect(item.locator("a")).toHaveAttribute("href", `#${SECOES[i]}`);
      // a mesma fonte, com a mesma data, da seção
      expect((await item.locator(".sv-fonte").innerText()).trim(), PERGUNTAS[i]).toBe((await secao.locator(":scope > .sv-fonte").innerText()).trim());
      await expect(item.locator(".sv-fonte")).toContainText(/^Fonte: /);
    }
    // o dado é o que a seção mostra
    await expect(itens.nth(0).locator(".sv-q4__a")).toContainText(/^\d[\d.]* votos? nomina(l|is) em leis\./);
    await expect(itens.nth(0).locator(".sv-q4__a .sv-voto")).toHaveCount(1); // voto em forma e palavra
    await expect(page.locator("section#votos")).toContainText(new RegExp(`de ${(await itens.nth(0).locator(".sv-q4__a").innerText()).match(/^[\d.]+/)![0]} votos? em leis`));
    for (const [i, sel] of [[1, "section#gastos .sv-a"], [2, "section#patrimonio .sv-a"], [3, "section#trabalho .sv-a"]] as const) {
      const naSecao = (await page.locator(sel).first().innerText()).trim();
      await expect(itens.nth(i).locator(".sv-q4__a"), PERGUNTAS[i]).toContainText(naSecao);
    }
    // sem nota, média nem comparação
    await expect(quadro).not.toContainText(/ranking|em média|média d[aeo]s?|acima da média|abaixo da média/i);
    // o link leva à seção
    await itens.nth(1).locator("a").click();
    await expect(page).toHaveURL(/#gastos$/);
    await expect(page.locator("section#gastos")).toBeInViewport();
  });

  for (const slug of ["alvaro-coutinho-sp", "carlos-machado-sp", "alvaro-cardoso-rj", "alvaro-teixeira-sp"])
    test(`sem dado, a lacuna do quadro é a mesma da seção, nunca zero: ${slug}`, async ({ page }) => {
      await page.goto(`/pessoa/${slug}`);
      const itens = page.locator("section.sv-q4 .sv-q4__i");
      await expect(itens).toHaveCount(4);
      expect(await page.locator("section.sv-q4 dt").allInnerTexts()).toEqual(PERGUNTAS);
      let lacunas = 0;
      for (let i = 0; i < 4; i++) {
        const lac = itens.nth(i).locator(".sv-lac");
        if ((await lac.count()) === 0) continue;
        lacunas++;
        // mesma frase e mesmo motivo da lacuna da seção
        const naSecao = page.locator(`section#${SECOES[i]} .sv-lac`).first();
        expect((await lac.innerText()).trim(), `${slug}: ${PERGUNTAS[i]}`).toBe((await naSecao.innerText()).trim());
        expect((await lac.innerText()).trim()).not.toMatch(/^\s*(R\$\s*)?0\b/);
        // o estado de cobertura é marcado uma vez só, na seção
        await expect(lac).not.toHaveAttribute("data-cobertura", /.*/);
      }
      expect(lacunas, `${slug}: ao menos uma lacuna no quadro`).toBeGreaterThan(0);
      await expect(page.locator("section.sv-q4")).not.toContainText(/R\$\s*0(?![\d,.])/);
    });

  test("leitura que falha: a página inteira vira lacuna nomeada, sem quadro pela metade", async ({ page }) => {
    const res = await page.goto("/pessoa/helena-siqueira?simular=erro_pagina");
    expect(res?.status()).toBe(200);
    await expect(page.locator("section.sv-q4")).toHaveCount(0);
    await expect(page.locator(".sv-main")).toContainText("Não conseguimos ler");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 8. Decisão: sem resposta conferida, um aviso só (o estado de cada campo está em v2-d2-aceite.spec.ts)
// ---------------------------------------------------------------------------------------------------------------------
test.describe("8. decisão sem resposta conferida", () => {
  test("um aviso só, que nomeia o que falta e aponta o texto oficial; o resto continua", async ({ page }) => {
    await page.goto("/decisao/camara-pl-79-2020");
    const aviso = page.locator('[aria-labelledby="sv-d3"]');
    await expect(aviso.getByRole("heading", { name: "O que muda para mim?" })).toBeVisible();
    await expect(aviso.locator(".sv-lac")).toHaveText("Aguardando conferência");
    await expect(aviso).toContainText("não diz o que ela propõe, o que muda, quem é afetado, quanto custa nem quem paga");
    await expect(page.locator(".sv-main .sv-lac", { hasText: "Aguardando conferência" })).toHaveCount(1);
    // "O que é isso?" responde com a identificação oficial, que é dado da fonte
    await expect(page.locator('[aria-labelledby="sv-d1"] .sv-a')).toHaveText(/^Projeto de lei \(PL\) 79\/2020\.$/);
    await expect(page.locator('[aria-labelledby="sv-d1"]')).toContainText("Onde se decide?");
    // o aviso leva ao texto oficial
    await aviso.getByRole("link", { name: "Onde eu confiro o texto oficial?" }).click();
    await expect(page).toHaveURL(/#sv-d9$/);
    await expect(page.locator('[aria-labelledby="sv-d9"]')).toBeInViewport();
    // o selo segue dizendo que não há resposta publicada, sem afirmar quem conferiu
    await expect(page.locator('[aria-labelledby="sv-d10"]')).toContainText("Esta proposta ainda não tem resposta publicada.");
  });

  test("decisão respondida não muda: nove quadros numerados, com as respostas e sem o aviso", async ({ page }) => {
    await page.goto("/decisao/camara-pl-9999-2026");
    expect(await page.locator(".sv-pg--decisao .sv-n").allInnerTexts()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    await expect(page.locator(".sv-pg--aguarda")).toHaveCount(0);
    for (const q of ["Quem é afetado?", "Quanto muda na conta?", "Quem paga?", "Quem propôs?"]) await expect(page.getByRole("heading", { name: q })).toBeVisible();
    await expect(page.locator('[aria-labelledby="sv-d3"] .sv-hs__m--se .sv-hs__t')).toHaveText("Se aprovado");
    await expect(page.locator(".sv-main")).not.toContainText("Aguardando conferência");
  });
});
