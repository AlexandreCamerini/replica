import { expect, test } from "@playwright/test";

// Protótipo "Segue o Voto" em /v2, Direção 2 (decisão do dono em 10/11/2026).
// Portado do desenho anterior: a intenção de cada teste que ainda faz sentido foi mantida; busca por cidade virou escolha de UF
// por formulário em /v2/ajustes, e o menu hambúrguer virou navegação sempre visível com aria-current.
// As páginas atuais (v1) não podem mudar: o shell antigo some só sob /v2.

const PAGES = [
  "/v2",
  "/v2/acompanhando",
  "/v2/ajustes",
  "/v2/temas",
  "/v2/decisoes",
  "/v2/decisoes?aba=leis",
  "/v2/decisao/camara-pl-79-2020",
  "/v2/decisao/camara-pl-4567-2024",
  "/v2/decisao/camara-pl-9999-2026",
  "/v2/votacoes",
  "/v2/votacao/camara-v2026-15",
  "/v2/votacao/camara-v2026-15?uf=SP",
  "/v2/pessoas",
  "/v2/pessoas?cargo=senador&uf=SP",
  "/v2/pessoas?cidade=3509502&grupo=vereadores",
  "/v2/pessoa/helena-siqueira",
  "/v2/tema/agro",
  "/v2/como-funciona",
];

// Mesmas palavras vetadas do teste de neutralidade das páginas atuais.
const FORBIDDEN = /\b(ranking|melhor|pior|recomend\w*|nota (final|geral)|pontuação)\b/i;

const SIGO = ["helena-siqueira", "alvaro-teixeira-sp", "bruno-sampaio"];

for (const width of [390, 768, 1280]) {
  test(`v2 a ${width}px: abre, sem rolagem horizontal, com o shell novo`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const url of PAGES) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(200);
      await expect(page.locator(".sv h1").first(), url).toBeVisible();
      // o cabeçalho antigo não aparece no protótipo
      await expect(page.locator("header.sticky"), url).toHaveCount(0);
      // a navegação nova está sempre visível, sem botão de menu
      await expect(page.getByRole("navigation", { name: "Perguntas" }), url).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} tem rolagem horizontal`).toBeLessThanOrEqual(0);
      const text = await page.locator(".sv-main").innerText();
      // a frase "Não há nota nem ranking." (Escolhidos) NEGA o ranking: é a declaração de neutralidade, não um ranking
      expect(text.replace(/Não há nota nem ranking\./g, ""), url).not.toMatch(FORBIDDEN);
    }
  });
}

test("v2: a UF se escolhe por formulário em Ajustes (sem busca por cidade) e aparece no topo", async ({ page }) => {
  // não existe mais busca de lugar na entrada
  await page.goto("/v2");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator('.sv-main input[type="search"], .sv-main input[name="q"]')).toHaveCount(0);

  await page.getByRole("link", { name: "Escolha seu estado" }).first().click();
  await expect(page).toHaveURL(/\/v2\/ajustes/);
  await page.locator("#aj-uf-sel").selectOption("SP");
  await page.getByRole("button", { name: "Guardar estado" }).click();
  await expect(page).toHaveURL(/\/v2\/ajustes$/);
  await expect(page.locator(".sv-uf")).toContainText("São Paulo (SP)");
  expect((await page.context().cookies()).find((c) => c.name === "sv_uf")?.value).toBe("SP");

  // a UF vale nas outras telas
  await page.goto("/v2");
  await expect(page.locator(".sv-uf")).toContainText("São Paulo (SP)");
  await expect(page.locator(".sv-uf").getByRole("link", { name: "trocar estado" })).toBeVisible();

  // limpar a escolha volta ao estado "sem estado escolhido"
  await page.goto("/v2/ajustes");
  await page.locator("#aj-uf-sel").selectOption("");
  await page.getByRole("button", { name: "Guardar estado" }).click();
  await expect(page.locator(".sv-uf")).toContainText("Escolha seu estado");
  expect((await page.context().cookies()).find((c) => c.name === "sv_uf")).toBeUndefined();
});

test("v2: pessoas de um grupo aparecem em ordem alfabética", async ({ page }) => {
  await page.goto("/v2/pessoas?cidade=3509502&grupo=vereadores");
  await expect(page.locator(".sv h1")).toHaveText("Vereadores");
  const names = await page.locator(".sv-item > div").evaluateAll((els) => els.map((e) => (e.firstChild?.textContent ?? "").trim()));
  expect(names.length).toBeGreaterThan(1);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
});

test("v2: voto é forma mais palavra, nunca cor", async ({ page }) => {
  await page.goto("/v2/votacao/camara-v2026-15?uf=SP");
  const marks = page.locator(".sv-voterow .sv-vote");
  await expect(marks.first()).toBeVisible();
  // toda marca vem com a palavra ao lado
  const words = await marks.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(words.every((w) => w.length > 0)).toBe(true);
  // a tinta de Sim e de Não é a mesma: só a forma muda
  const inks = await page.locator(".sv-voterow .sv-mark").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).borderTopColor))]);
  expect(inks).toHaveLength(1);
  // e a tinta é a da página (tinta), não uma cor de destaque
  expect(inks[0]).toBe("rgb(20, 20, 20)");
});

test("v2: a navegação fica sempre visível e marca a seção atual com aria-current", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/v2");
    // sem hambúrguer: nenhum botão Menu/Fechar e nenhum #sv-menu
    await expect(page.getByRole("button", { name: /^(Menu|Fechar)$/ })).toHaveCount(0);
    await expect(page.locator("#sv-menu")).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Perguntas" });
    const rolando = nav.getByRole("link", { name: "O que está rolando?" });
    const escolhidos = nav.getByRole("link", { name: "O que meus escolhidos estão fazendo?" });
    await expect(rolando).toBeVisible();
    await expect(escolhidos).toBeVisible();
    for (const n of ["O que mexe comigo?", "O que está em jogo?", "Ajustes"]) await expect(nav.getByRole("link", { name: n })).toBeVisible();
    await expect(rolando).toHaveAttribute("aria-current", "page");
    await expect(escolhidos).not.toHaveAttribute("aria-current", /.+/);

    await escolhidos.click();
    await expect(page).toHaveURL(/\/v2\/acompanhando$/);
    await expect(escolhidos).toHaveAttribute("aria-current", "page");
    await expect(rolando).not.toHaveAttribute("aria-current", /.+/);

    // dentro de uma decisão, "O que mexe comigo?" segue marcado (seção), sem ser a página
    await page.goto("/v2/decisao/camara-pl-79-2020");
    await expect(nav.getByRole("link", { name: "O que mexe comigo?" })).toHaveAttribute("aria-current", "true");
    await page.goto("/v2/ajustes");
    await expect(nav.getByRole("link", { name: "Ajustes" })).toHaveAttribute("aria-current", "page");
  }
});

test("v2: página inexistente responde 404 dentro do shell novo", async ({ page }) => {
  const res = await page.goto("/v2/decisao/nao-existe");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".sv h1")).toHaveText("Não consta");
  await expect(page.getByRole("navigation", { name: "Perguntas" })).toBeVisible();
  await expect(page.locator("header.sticky")).toHaveCount(0);
  const res2 = await page.goto("/v2/pessoa/nao-existe");
  expect(res2?.status()).toBe(404);
  await expect(page.locator(".sv h1")).toHaveCount(1);
});

test("páginas atuais continuam com o shell atual", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header.sticky")).toBeVisible();
  await expect(page.locator(".sv")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Perguntas" })).toHaveCount(0);
});

test("v2: marcar em quem votei põe a pessoa em Escolhidos e no Início", async ({ page }) => {
  await page.goto("/v2/pessoas?cargo=senador&uf=SP");
  const first = page.locator(".sv-item").first();
  const name = ((await first.locator("div").first().evaluate((e) => e.firstChild?.textContent)) ?? "").trim();
  await first.click();
  await page.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(page.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  expect((await page.context().cookies()).find((c) => c.name === "sv_sigo")?.value).toBeTruthy();
  // "Escolhidos": um quadro com o nome e as cinco perguntas fixas
  await page.goto("/v2/acompanhando");
  await expect(page.locator(".sv-esc__pessoas").getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  await expect(page.locator(".sv-esc__pessoas h3.sv-r3l__q")).toHaveText(["Foi trabalhar?", "Como votou?", "Quanto gastou o gabinete?", "O patrimônio declarado mudou?", "O que propôs?"]);
  // no Início, "Em quem eu votei" cita a pessoa
  await page.goto("/v2");
  await expect(page.locator(".sv-main").getByText(name).first()).toBeVisible();
  // desmarcar: volta ao estado vazio, com convite
  await page.goto("/v2/pessoas?cargo=senador&uf=SP");
  await page.locator(".sv-item").first().click();
  await page.getByRole("button", { name: "Você acompanha" }).click();
  await page.goto("/v2/acompanhando");
  await expect(page.getByRole("heading", { name: "Você ainda não marcou ninguém." })).toBeVisible();
});

test("v2: cookie sv_sigo fora de ordem é mostrado em ordem alfabética, com a ordem declarada", async ({ page, context }) => {
  await context.addCookies([{ name: "sv_sigo", value: SIGO.join("."), domain: "localhost", path: "/" }]);
  await page.goto("/v2/acompanhando");
  const nomes = await page.locator(".sv-esc__pessoas .sv-esc__n").allTextContents();
  expect(nomes).toHaveLength(SIGO.length);
  expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  await expect(page.locator(".sv-topq")).toContainText("de A a Z");
});

test("v2: a decisão mostra os três estados de cada resposta e diz quem conferiu", async ({ page }) => {
  await page.goto("/v2/decisao/camara-pl-9999-2026");
  await expect(page.locator(".sv h1")).toHaveText("O que estão decidindo que mexe comigo?");
  // conferida: frase + trecho + conferência por agentes de IA
  await expect(page.locator('[aria-labelledby="sv-d1"]')).toContainText(/Conferido com o texto oficial por agentes de IA em \d{2}\/\d{2}/);
  // não conferida e "o texto não trata disso" são frases diferentes
  await expect(page.getByText("Ainda não conseguimos conferir esta resposta.").first()).toBeVisible();
  await expect(page.getByText("O texto oficial não trata disso.")).toHaveCount(1);
  // proposta sem respostas: "Aguardando conferência", nunca "não trata"
  await page.goto("/v2/decisao/camara-pl-79-2020");
  await expect(page.getByText("Aguardando conferência").first()).toBeVisible();
  await expect(page.getByText("O texto oficial não trata disso.")).toHaveCount(0);
  // a página diz que quem conferiu foram agentes de IA e não promete revisão humana
  await expect(page.locator('[aria-labelledby="sv-d10"]')).toContainText("Agentes de inteligência artificial (IA), não uma pessoa.");
  await expect(page.locator(".sv-main")).not.toContainText(/conferid[ao] por uma pessoa|revisad[ao] por pessoa/i);
  // na demonstração, o exemplo vem marcado como exemplo
  await expect(page.getByText("Exemplo ilustrativo").first()).toBeVisible();
  // glossário/trecho: o resumo oficial abre sob demanda
  await page.locator('[aria-labelledby="sv-d9"] summary').click();
  await expect(page.locator('[aria-labelledby="sv-d9"] details p')).toBeVisible();
});

test("v2: a visão por temas leva às votações de cada tema", async ({ page }) => {
  await page.goto("/v2/temas");
  await expect(page.locator(".sv h1")).toHaveText("O que está em jogo no Congresso?");
  const tema = page.locator('a[href^="/v2/tema/"]').first();
  await expect(tema).toBeVisible();
  await tema.click();
  await expect(page).toHaveURL(/\/v2\/tema\//);
  await expect(page.locator('a.sv-item[href^="/v2/votacao/"]').first()).toBeVisible();
});
