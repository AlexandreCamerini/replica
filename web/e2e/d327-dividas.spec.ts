import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// D327: as quatro dívidas da Fase 1 da auditoria (D324). Um bloco por item. Fonte de dados: demonstração.

const uf = (sigla: string) => ({ name: "sv_uf", value: sigla, domain: "localhost", path: "/" });
const sigo = (slugs: string[]) => ({ name: "sv_sigo", value: slugs.join("."), domain: "localhost", path: "/" });

// Na demonstração: "helena-siqueira" e "rosana-esteves" existem; "slug-antigo-demo" é o endereço antigo de "rosana-esteves"
// (pessoa fundida); "pessoa-que-sumiu" não existe.
const MARCADOS = ["helena-siqueira", "pessoa-que-sumiu", "slug-antigo-demo", "rosana-esteves"];

// ---------------------------------------------------------------------------------------------------------------------
// 1. "Você acompanha N pessoas" conta só pessoas que existem
// ---------------------------------------------------------------------------------------------------------------------
test.describe("1. a contagem de pessoas acompanhadas", () => {
  for (const [nome, url] of [["/pessoas", "/pessoas"], ["passo 2 do começo", "/comecar?passo=2"]] as const)
    test(`${nome}: slug inexistente e slug antigo de pessoa fundida não contam`, async ({ page, context }) => {
      await context.addCookies([uf("SP"), sigo(MARCADOS)]);
      await page.goto(url);
      const status = page.locator(".sv-pp__m > p[role=status]");
      // quatro slugs no cookie, duas pessoas: a que sumiu não conta e a fundida conta uma vez
      await expect(status).toContainText("Você acompanha 2 pessoas.");
      await expect(status).toContainText("Outras 2 marcações guardadas não entram na conta");
      await expect(status).not.toContainText(/acompanha 4 pessoas/);
    });

  test("só pessoas que existem: a frase não muda", async ({ page, context }) => {
    await context.addCookies([uf("SP"), sigo(["helena-siqueira", "rosana-esteves"])]);
    await page.goto("/pessoas");
    await expect(page.locator(".sv-pp__m > p[role=status]")).toHaveText("Você acompanha 2 pessoas. Cabem até 12.");
  });

  test("nenhuma das marcadas existe: a tela não diz zero nem o número de slugs", async ({ page, context }) => {
    await context.addCookies([uf("SP"), sigo(["pessoa-que-sumiu", "outra-que-sumiu"])]);
    await page.goto("/pessoas");
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toContainText("Nenhuma das 2 pessoas que você marcou aparece nos dados de hoje.");
    await expect(status).not.toContainText(/acompanha \d/);
  });

  test("a conferência falhou: a tela diz que não conferiu, sem número", async ({ page, context }) => {
    await context.addCookies([uf("SP"), sigo(MARCADOS)]);
    await page.goto("/comecar?passo=2&simular=erro");
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toContainText("Não conseguimos conferir agora quantas pessoas você acompanha.");
    await expect(status).not.toContainText(/acompanha \d/);
  });

  const ROSANA = "/pessoas?uf=&nome=Rosana+Esteves";
  const botaoDaRosana = (page: import("@playwright/test").Page) => page.locator(".sv-pp > li", { has: page.locator('a[href="/pessoa/rosana-esteves"]') }).locator("button");

  test("pessoa fundida só pelo endereço antigo: conta uma, a linha dela aparece marcada e desmarcar tira a marcação", async ({ page, context }) => {
    await context.addCookies([sigo(["slug-antigo-demo"])]);
    await page.goto(ROSANA);
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toHaveText("Você acompanha 1 pessoa. Cabem até 12.");
    await expect(botaoDaRosana(page)).toHaveAttribute("aria-pressed", "true");
    await botaoDaRosana(page).click();
    await expect(status).toContainText("Você ainda não marcou ninguém.");
    await expect(botaoDaRosana(page)).toHaveAttribute("aria-pressed", "false");
    expect((await context.cookies()).find((c) => c.name === "sv_sigo"), "cookie apagado").toBeUndefined();
  });

  test("pessoa fundida pelos dois endereços: desmarcar tira os dois", async ({ page, context }) => {
    await context.addCookies([sigo(["slug-antigo-demo", "rosana-esteves", "helena-siqueira"])]);
    await page.goto(ROSANA);
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toContainText("Você acompanha 2 pessoas.");
    await botaoDaRosana(page).click();
    await expect(status).toHaveText("Você acompanha 1 pessoa. Cabem até 12.");
    expect((await context.cookies()).find((c) => c.name === "sv_sigo")?.value).toBe("helena-siqueira");
  });

  test("o botão tira as marcações que não entram na conta e deixa as pessoas que existem", async ({ page, context }) => {
    await context.addCookies([uf("SP"), sigo(MARCADOS)]);
    await page.goto("/pessoas");
    const status = page.locator(".sv-pp__m > p[role=status]");
    await page.getByRole("button", { name: "Tirar as 2 marcações que não entram na conta" }).click();
    await expect(status).toHaveText("Você acompanha 2 pessoas. Cabem até 12.");
    await expect(page.getByRole("button", { name: /Tirar .* marcaç/ })).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === "sv_sigo")?.value).toBe("helena-siqueira.rosana-esteves");
  });

  test("limite ocupado só por marcações que não aparecem: a tela não manda tirar alguém, e o botão abre lugar (sem JavaScript)", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR" });
    await ctx.addCookies([uf("SP"), sigo(Array.from({ length: 12 }, (_, i) => `pessoa-que-sumiu-${i}`))]);
    const page = await ctx.newPage();
    await page.goto("/pessoas");
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toContainText("Nenhuma das 12 pessoas que você marcou aparece nos dados de hoje.");
    await expect(status).toContainText("tire as que não entram na conta para abrir lugar");
    await expect(status).not.toContainText("tire alguém");
    await expect(page.locator(".sv-pp__f button[aria-pressed=false]").first()).toBeDisabled();
    await page.getByRole("button", { name: "Tirar as 12 marcações que não entram na conta" }).click();
    await expect(status).toContainText("Você ainda não marcou ninguém.");
    await expect(page.locator(".sv-pp__f button[aria-pressed=false]").first()).toBeEnabled();
    await ctx.close();
  });

  test("marcar uma pessoa na lista soma uma à conta de quem existe", async ({ page, context }) => {
    await context.addCookies([uf("SP"), sigo(["pessoa-que-sumiu"])]);
    await page.goto("/pessoas");
    const status = page.locator(".sv-pp__m > p[role=status]");
    await expect(status).toContainText("A pessoa que você marcou não aparece nos dados de hoje.");
    await page.locator(".sv-pp__f button[aria-pressed=false]").first().click();
    await expect(status).toContainText("Você acompanha 1 pessoa.");
    await expect(status).toContainText("Outra marcação guardada não entra na conta");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. /comecar: lista de cidades vazia e leitura que falhou dão avisos diferentes
// ---------------------------------------------------------------------------------------------------------------------
test.describe("2. cidades no começo", () => {
  const VAZIA = "Ainda não temos cidades de RN para escolher.";
  const FALHOU = /Não conseguimos listar as cidades de [A-Z]{2} agora\./;

  test("estado sem cidade na fonte: lacuna nomeada, e não aviso de falha", async ({ page, context }) => {
    await context.addCookies([uf("RN")]); // a demonstração não tem cidade do Rio Grande do Norte
    await page.goto("/comecar");
    const quadro = page.locator('[aria-labelledby="cm-cidade"]');
    await expect(quadro).toContainText(VAZIA);
    await expect(quadro).toContainText("A lista de municípios que o site carregou não traz nenhum de RN.");
    await expect(quadro.locator(".sv-prova")).toContainText(/^Fonte: IBGE, lista de municípios.*\d{2}\/\d{2}\/\d{4}/); // fonte e data
    await expect(quadro).not.toContainText(FALHOU);
    await expect(quadro.locator("select")).toHaveCount(0);
  });

  test("leitura das cidades falhou: aviso de falha, e não de lista vazia", async ({ page, context }) => {
    await context.addCookies([uf("SP")]);
    await page.goto("/comecar?simular=erro");
    const quadro = page.locator('[aria-labelledby="cm-cidade"]');
    await expect(quadro).toContainText("Não conseguimos listar as cidades de SP agora.");
    await expect(quadro).toContainText("A lista de cidades não pôde ser lida.");
    await expect(quadro).not.toContainText(/Ainda não temos cidades/);
    await expect(quadro.locator("select")).toHaveCount(0);
    // o resto do passo segue de pé: dá para continuar sem cidade
    await expect(page.locator("#cm-uf")).toBeVisible();
  });

  test("os dois avisos têm textos diferentes; com cidades na fonte não aparece nenhum", async ({ page, context }) => {
    await context.addCookies([uf("RN")]);
    await page.goto("/comecar");
    const vazia = (await page.locator('[aria-labelledby="cm-cidade"] .sv-lac').innerText()).trim();
    await page.goto("/comecar?simular=erro");
    const falhou = (await page.locator('[aria-labelledby="cm-cidade"] .sv-lac').innerText()).trim();
    expect(vazia).not.toBe(falhou);
    await context.clearCookies();
    await context.addCookies([uf("SP")]);
    await page.goto("/comecar");
    await expect(page.locator("#cm-cid")).toBeVisible();
    await expect(page.locator('[aria-labelledby="cm-cidade"] .sv-lac')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3. /pessoas?uf= com sigla que não existe
// ---------------------------------------------------------------------------------------------------------------------
test.describe("3. sigla de estado que não existe", () => {
  for (const sigla of ["XX", "zz"])
    test(`/pessoas?uf=${sigla} diz que a sigla não existe, em vez de "nenhuma pessoa"`, async ({ page }) => {
      await page.goto(`/pessoas?uf=${sigla}`);
      const quadro = page.locator('[aria-labelledby="pp-2"]');
      await expect(quadro).toContainText(`A sigla “${sigla.toUpperCase()}” não é de nenhum estado.`);
      await expect(quadro).not.toContainText("Nenhuma pessoa encontrada");
      await expect(quadro.locator(".sv-pp__f")).toHaveCount(0); // nenhuma pessoa listada
      // a saída: todos os estados
      await quadro.getByRole("link", { name: /Ver todos os estados/ }).click();
      await expect(page).toHaveURL(/\/pessoas\?uf=$/);
      await expect(page.locator('[aria-labelledby="pp-2"] .sv-pp__f').first()).toBeVisible();
    });

  test("a sigla do endereço vale sobre o estado guardado, e nome e cargo seguem no link de saída", async ({ page, context }) => {
    await context.addCookies([uf("SP")]);
    await page.goto("/pessoas?uf=XX&nome=ana");
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText("A sigla “XX” não é de nenhum estado.");
    await expect(page.locator('[aria-labelledby="pp-2"]').getByRole("link", { name: /Ver todos os estados/ })).toHaveAttribute("href", /nome=ana/);
  });

  test("sigla que existe e não tem ninguém com o filtro segue dizendo nenhuma pessoa", async ({ page }) => {
    await page.goto("/pessoas?uf=SP&nome=zzzzqqqq");
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText("Nenhuma pessoa encontrada com esses filtros.");
    await expect(page.locator('[aria-labelledby="pp-2"]')).not.toContainText("não é de nenhum estado");
  });

  test("sem JavaScript o aviso é o mesmo", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR" });
    const page = await ctx.newPage();
    await page.goto("/pessoas?uf=XX");
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText("A sigla “XX” não é de nenhum estado.");
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 4. Comissões: cinco à vista e o resto num <details> (pessoa da demonstração com sete)
// ---------------------------------------------------------------------------------------------------------------------
test.describe("4. mais de cinco comissões", () => {
  const PESSOA = "/pessoa/alvaro-barros";
  const secao = (page: import("@playwright/test").Page) => page.locator("section", { has: page.getByRole("heading", { name: "Em que comissões está?" }) });

  test("cinco à vista, as outras duas no details, que abre e fecha; ordem alfabética nos dois", async ({ page }) => {
    await page.goto(PESSOA);
    const s = secao(page);
    await expect(s).toContainText("7 comissões.");
    const aVista = s.locator(".sv-bloco > ul > li");
    await expect(aVista).toHaveCount(5);
    const det = s.locator("details");
    await expect(det).toHaveCount(1);
    expect(await det.evaluate((d) => (d as HTMLDetailsElement).open), "fechado ao abrir a página").toBe(false);
    await expect(det.locator("summary")).toHaveText("Ver as outras 2 comissões");
    const resto = det.locator("li");
    await expect(resto).toHaveCount(2);
    await expect(resto.first()).toBeHidden();
    await det.locator("summary").click();
    await expect(resto.first()).toBeVisible();
    const nomes = [...(await aVista.allInnerTexts()), ...(await resto.allInnerTexts())].map((t) => t.trim());
    expect(nomes, "ordem alfabética, sem repetir").toEqual([...new Set(nomes)].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await det.locator("summary").click();
    await expect(resto.first()).toBeHidden();
    // fonte e data na seção
    await expect(s.locator(".sv-fonte")).toContainText(/^Fonte: .*\d{2}\/\d{2}\/\d{4}/);
  });

  test("o resumo do details tem alvo de 44px, abre pelo teclado e a página passa no axe com ele aberto", async ({ page }) => {
    await page.goto(PESSOA);
    const sum = secao(page).locator("summary");
    const caixa = (await sum.boundingBox())!;
    expect(caixa.height, "altura do alvo").toBeGreaterThanOrEqual(44);
    await sum.focus();
    await page.keyboard.press("Enter");
    await expect(secao(page).locator("details li").first()).toBeVisible();
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("sem JavaScript o details abre do mesmo jeito; a 390px não estoura", async ({ browser }, info) => {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(PESSOA);
    const det = secao(page).locator("details");
    await expect(det.locator("li").first()).toBeHidden();
    await det.locator("summary").click();
    await expect(det.locator("li")).toHaveCount(2);
    await expect(det.locator("li").first()).toBeVisible();
    const larguras = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(larguras[0], "sem rolagem horizontal").toBeLessThanOrEqual(larguras[1]);
    await ctx.close();
  });

  for (const slug of ["alvaro-aguiar-sp", "rosana-esteves", "helena-siqueira"])
    test(`as outras pessoas da demonstração seguem sem comissão, com o motivo: ${slug}`, async ({ page }) => {
      await page.goto(`/pessoa/${slug}`);
      await expect(secao(page).locator(".sv-lac")).toBeVisible();
      await expect(secao(page).locator("details")).toHaveCount(0);
      await expect(secao(page)).not.toContainText(/\d+ comissões\./);
    });
});
