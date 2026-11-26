import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// D352: na tela do tema, como votaram as pessoas que o leitor marcou, com fonte e data, em ordem alfabética e sem placar
// comparativo. Quem não vota a proposta aparece como lacuna com nome. Fonte de dados: demonstração.

const TEMA = "/tema/agro";
const uf = { name: "sv_uf", value: "SP", domain: "localhost", path: "/" };
const sigo = (slugs: string[]) => ({ name: "sv_sigo", value: slugs.join("."), domain: "localhost", path: "/" });
// três esferas: Senado (federal), Assembleia (estadual) e Câmara Municipal (municipal)
const TRES = ["helena-siqueira", "alvaro-teixeira-sp", "bruno-sampaio"];
const quadro = (page: Page) => page.locator('[aria-labelledby="tm1-esc"]');
const bloco = (page: Page, slug: string) => quadro(page).locator(".sv-tm1-esc > li", { has: page.locator(`a[href="/pessoa/${slug}"]`) });
const DATA = /\d{2}\/\d{2}\/\d{4}/;
// deputados federais da demonstração com mais de cinco votos no tema (o recolhido de "votos mais antigos")
const COM_MAIS_DE_CINCO = ["rosana-esteves", "alvaro-aguiar-sp"];

test.describe("tema: como votaram as pessoas que eu marquei", () => {
  test("três pessoas de esferas diferentes: ordem alfabética; quem vota, com voto, data e fonte; quem não vota, lacuna com nome", async ({ page, context }) => {
    await context.addCookies([uf, sigo(TRES)]);
    await page.goto(TEMA);
    await expect(quadro(page).getByRole("heading", { name: "Como votaram as pessoas que eu marquei?" })).toBeVisible();
    // ordem alfabética, uma pessoa por bloco
    const nomes = (await quadro(page).locator(".sv-tm1-esc > li > h3 > a").allTextContents()).map((t) => t.trim());
    expect(nomes).toEqual(["Álvaro Teixeira", "Bruno Sampaio", "Helena Siqueira"]);
    await expect(quadro(page).locator(".sv-prova")).toContainText("Pessoas em ordem alfabética.");
    // cada pessoa é um título (leitor de tela salta de pessoa em pessoa)
    await expect(quadro(page).getByRole("heading", { level: 3 })).toHaveCount(3);

    // federal (Senado): votos com data, forma e palavra, link para a votação e fonte com data da leitura
    const helena = bloco(page, "helena-siqueira");
    // o cargo tem fonte e data (o período do mandato)
    await expect(helena.locator(".sv-esf")).toHaveText(/^Esfera: Federal\. Mandato (de \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}|desde \d{2}\/\d{2}\/\d{4}), conforme .+\.$/);
    const votos = helena.locator(".sv-tm1-votos").first().locator("li");
    expect(await votos.count(), "Helena tem voto em votações deste tema").toBeGreaterThan(0);
    for (const li of await votos.all()) {
      await expect(li.locator(".sv-tm1-vd")).toHaveText(DATA); // a data da votação
      await expect(li.locator(".sv-voto")).toHaveCount(1);
      await expect(li.locator(".sv-voto i.sv-m")).toHaveCount(1); // forma
      await expect(li.locator(".sv-voto")).toHaveText(/^(Sim|Não|Abstenção|Obstrução|Sem voto|Presidia)$/); // palavra
      await expect(li.locator("a")).toHaveAttribute("href", /^\/votacao\/senado-/); // só votações da Casa dela
      // o que se votou (texto principal ou destaque, no texto da fonte), a Casa e o resultado
      await expect(li.locator(".sv-tm1-vk")).toContainText(/Senado Federal\. (Aprovada|Rejeitada|Resultado não publicado)/);
    }
    // o tipo da votação que a fonte registra (texto principal ou destaque) aparece na linha
    expect((await votos.locator(".sv-tm1-vk").allTextContents()).some((t) => /(Texto principal|Destaque)\. Senado Federal\./.test(t)), "tipo da votação na linha").toBe(true);
    await expect(helena.locator(".sv-fonte")).toHaveText(/^Fonte: Senado Federal, votações nominais, lidas em \d{2}\/\d{2}\/\d{4}\.$/);
    // as datas vêm da mais recente para a mais antiga
    const dias = (await votos.locator(".sv-tm1-vd").allTextContents()).map((d) => d.split("/").reverse().join("-"));
    expect(dias).toEqual([...dias].sort().reverse());

    // estadual e municipal: lacuna que diz por quê, nunca zero nem lista vazia
    const alvaro = bloco(page, "alvaro-teixeira-sp");
    await expect(alvaro.locator(".sv-esf")).toHaveText(/^Esfera: Estadual\. Mandato .+, conforme .+\.$/);
    await expect(alvaro.locator(".sv-lac")).toContainText("Não vota nestas votações.");
    await expect(alvaro.locator(".sv-lac")).toContainText(/vota na Assembleia Legislativa .*, que não decide as propostas do Congresso\./);
    const bruno = bloco(page, "bruno-sampaio");
    await expect(bruno.locator(".sv-esf")).toHaveText(/^Esfera: Municipal\. Mandato .+, conforme .+\.$/);
    await expect(bruno.locator(".sv-lac")).toContainText("Não vota nestas votações.");
    await expect(bruno.locator(".sv-lac")).toContainText(/vota na Câmara Municipal .*, que não decide as propostas do Congresso\./);
    for (const b of [alvaro, bruno]) {
      await expect(b.locator(".sv-tm1-votos")).toHaveCount(0);
      await expect(b.locator(".sv-voto")).toHaveCount(0);
      await expect(b).not.toContainText(/\b0 votos?\b|nenhum voto/i);
    }
  });

  test("sem placar comparativo: nenhuma soma por pessoa, tabela, coluna lado a lado nem palavra de ranking", async ({ page, context }) => {
    await context.addCookies([uf, sigo([...TRES, "rosana-esteves", "alvaro-aguiar-sp"])]);
    await page.goto(TEMA);
    const q = quadro(page);
    await expect(q.locator(".sv-tm1-esc > li")).toHaveCount(5);
    await expect(q.locator("table")).toHaveCount(0);
    await expect(q).not.toContainText(/ranking|placar|mais vezes que|menos vezes que|em média|nota \d|\d+\s*%|\d+ (de|em) \d+ vota|\d+ votos? (sim|não|a favor|contra)/i);
    await expect(q).toContainText("Não somamos nem comparamos");
    // um bloco embaixo do outro, nunca lado a lado
    const caixas = await q.locator(".sv-tm1-esc > li").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: Math.round(r.left) })));
    for (let i = 1; i < caixas.length; i++) {
      expect(caixas[i].top, `bloco ${i + 1} abaixo do anterior`).toBeGreaterThanOrEqual(caixas[i - 1].bottom - 1);
      expect(caixas[i].left).toBe(caixas[0].left);
    }
    // cada pessoa do Congresso só com votações da própria Casa
    for (const [slug, casa] of [["rosana-esteves", "camara"], ["alvaro-aguiar-sp", "camara"], ["helena-siqueira", "senado"]] as const) {
      const hrefs = await bloco(page, slug).locator(".sv-tm1-votos a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      expect(hrefs.length, `${slug} tem voto neste tema`).toBeGreaterThan(0);
      for (const h of hrefs) expect(h, slug).toMatch(new RegExp(`^/votacao/${casa}-`));
      expect(new Set(hrefs).size, `${slug}: cada votação uma vez`).toBe(hrefs.length);
    }
  });

  test("o voto mostrado é o mesmo da página da votação, para cada voto à vista", async ({ page, context }) => {
    await context.addCookies([uf, sigo(["helena-siqueira"])]);
    await page.goto(TEMA);
    const linhas = bloco(page, "helena-siqueira").locator(":scope > .sv-tm1-votos > li");
    const pares = await linhas.evaluateAll((lis) => lis.map((li) => ({ voto: li.querySelector(".sv-voto")!.textContent!.trim(), href: li.querySelector("a")!.getAttribute("href")! })));
    expect(pares.length).toBeGreaterThan(0);
    for (const { voto, href } of pares) {
      // a página da votação agrupa por voto, estado a estado; Helena é senadora por SP: o grupo dela tem de trazer a mesma palavra
      await page.goto(`${href}?uf=SP`);
      const grupo = page.locator(".sv-vt-grupo", { has: page.locator('a[href="/pessoa/helena-siqueira"]') });
      await expect(grupo, href).toHaveCount(1);
      await expect(grupo.locator("h3 .sv-voto"), `${href}: mesmo voto`).toHaveText(voto);
    }
  });

  test("ninguém marcado: convite, sem lacuna e sem lista", async ({ page, context }) => {
    await context.addCookies([uf]);
    await page.goto(TEMA);
    await expect(quadro(page)).toContainText("Você ainda não marcou ninguém.");
    await expect(quadro(page).getByRole("link", { name: /Escolher em quem votei/ })).toHaveAttribute("href", "/pessoas");
    await expect(quadro(page).locator(".sv-tm1-esc")).toHaveCount(0);
    await expect(quadro(page).locator(".sv-lac")).toHaveCount(0);
  });

  test("marcação que não é de ninguém vira lacuna; a mesma pessoa pelo endereço antigo e pelo atual aparece uma vez", async ({ page, context }) => {
    await context.addCookies([uf, sigo(["slug-antigo-demo", "pessoa-que-sumiu", "rosana-esteves"])]);
    await page.goto(TEMA);
    await expect(quadro(page).locator(".sv-tm1-esc > li")).toHaveCount(1);
    await expect(bloco(page, "rosana-esteves")).toHaveCount(1);
    await expect(quadro(page).locator(":scope > * .sv-lac, :scope > .sv-lac").last()).toContainText("1 marcação guardada não é de nenhuma pessoa dos dados de hoje.");
    // só marcações que não são de ninguém: a lacuna, sem lista
    await context.clearCookies();
    await context.addCookies([uf, sigo(["pessoa-que-sumiu", "outra-que-sumiu"])]);
    await page.goto(TEMA);
    await expect(quadro(page).locator(".sv-tm1-esc")).toHaveCount(0);
    await expect(quadro(page)).toContainText("2 marcações guardadas não são de nenhuma pessoa dos dados de hoje.");
    await expect(quadro(page)).not.toContainText("Você ainda não marcou ninguém.");
  });

  test("leitura que falha vira lacuna de leitura, não 'sem voto': dos votos de uma pessoa, e das pessoas", async ({ page, context }) => {
    await context.addCookies([uf, sigo(TRES)]);
    await page.goto(`${TEMA}?simular=erro_dados`);
    const helena = bloco(page, "helena-siqueira");
    await expect(helena.locator(".sv-lac")).toContainText("Não conseguimos ler esta fonte agora.");
    await expect(helena.locator(".sv-lac")).toContainText("Os votos de Helena Siqueira não puderam ser lidos agora.");
    await expect(helena).not.toContainText("Sem voto registrado");
    // quem não vota no Congresso não depende dessa leitura: segue com a própria lacuna
    await expect(bloco(page, "bruno-sampaio").locator(".sv-lac")).toContainText("Não vota nestas votações.");
    await page.goto(`${TEMA}?simular=erro_pagina`);
    await expect(quadro(page).locator(".sv-lac")).toContainText("Não conseguimos ler esta fonte agora.");
    await expect(quadro(page).locator(".sv-lac")).toContainText("Suas marcações continuam guardadas.");
    // sem lista, a prova não afirma ordem nem fonte de votos que não estão na tela
    await expect(quadro(page).locator(".sv-prova")).toHaveCount(0);
    await expect(quadro(page)).not.toContainText("Você ainda não marcou ninguém.");
    // o resto da tela do tema segue de pé
    await expect(page.locator('[aria-labelledby="tm1-3"] .sv-vls > li').first()).toBeVisible();
  });

  test("votos mais antigos ficam recolhidos e abrem sem JavaScript; a 390px não estoura", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 390, height: 844 } });
    await ctx.addCookies([uf, sigo([...TRES, ...COM_MAIS_DE_CINCO])]);
    const page = await ctx.newPage();
    await page.goto(TEMA);
    await expect(quadro(page).locator(".sv-tm1-esc > li")).toHaveCount(3 + COM_MAIS_DE_CINCO.length);
    const larguras = await page.locator("html").evaluate((h) => [h.scrollWidth, h.clientWidth]);
    expect(larguras[0], "sem rolagem horizontal").toBeLessThanOrEqual(larguras[1]);
    // quem tem mais de cinco votos no tema: cinco à vista, o resto num details
    const comDetalhe = quadro(page).locator(".sv-tm1-esc > li", { has: page.locator("details") });
    // determinístico: a demonstração dá a estas pessoas mais de cinco votos no tema; se mudar, o teste falha em vez de pular
    expect(await comDetalhe.count(), "alguém com mais de cinco votos no tema").toBeGreaterThan(0);
    const b = comDetalhe.first();
    await expect(b.locator(":scope > .sv-tm1-votos > li")).toHaveCount(5);
    const escondido = b.locator("details .sv-tm1-votos > li").first();
    await expect(escondido).toBeHidden();
    await expect(b.locator("summary")).toHaveText(/^Ver os votos mais antigos de .+ neste tema$/);
    expect((await b.locator("summary").boundingBox())!.height, "alvo do resumo").toBeGreaterThanOrEqual(44);
    await b.locator("summary").click();
    await expect(escondido).toBeVisible();
    await ctx.close();
  });

  test("axe sem violação com as três esferas, e a numeração dos quadros segue sem pular", async ({ page, context }) => {
    await context.addCookies([uf, sigo(TRES)]);
    await page.goto(TEMA);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const numeros = (await page.locator(".sv-main .sv-n").allTextContents()).map((t) => t.trim()).filter(Boolean);
    expect(numeros).toEqual(["1", "2", "3", "4", "5"]);
    // nenhuma cor: texto, marca e fundo do voto são tinta sobre papel, iguais para todo valor de voto
    const cores = await quadro(page)
      .locator(".sv-voto")
      .evaluateAll((els) => els.map((e) => { const m = e.querySelector(".sv-m"); const cs = m ? getComputedStyle(m) : null; return [getComputedStyle(e).color, cs?.backgroundColor, cs?.borderTopColor].join("|"); }));
    expect(cores.length).toBeGreaterThan(0);
    const tinta = new Set(cores.flatMap((c) => c.split("|")).filter((c) => c && c !== "rgba(0, 0, 0, 0)"));
    for (const c of tinta) expect(["rgb(20, 20, 20)", "rgb(74, 72, 68)", "rgb(242, 238, 229)"], `cor ${c}`).toContain(c);
  });
});
