import { expect, test, type Page } from "@playwright/test";

// D329: listas de pessoas em ordem alfabética também quando o nome traz acento solto ou sinal no começo.
// A demonstração tem duas pessoas com nome fora do padrão (fake.ts, DEMO_NOMES_FORA_DO_PADRAO): "´álvaro Bezerra"
// (acento agudo solto antes da primeira letra, como o "´rondiney Topógrafo" da fonte real) e "André Gomes" em forma
// decomposta (letra + acento combinante). A regra da comparação tem teste unitário em ordem-nomes.test.ts; aqui a
// conferência usa uma regra escrita de outro jeito (classe Unicode), para os dois lados não errarem juntos.

const SINAL = "´álvaro Bezerra";
const chave = (n: string) => n.normalize("NFC").replace(/^[^\p{L}\p{N}]+/u, "") || n;
const comparar = (a: string, b: string) => chave(a).localeCompare(chave(b), "pt-BR") || a.localeCompare(b, "pt-BR");
const nomes = async (page: Page) => (await page.locator('.sv-pp > li > a[href^="/pessoa/"]').allTextContents()).map((t) => t.trim());

/** Todas as páginas de uma lista de /pessoas, na ordem em que o site entrega. */
async function listaInteira(page: Page, url: string, maxPaginas = 40) {
  const todos: string[] = [];
  await page.goto(url);
  for (let i = 0; i < maxPaginas; i++) {
    todos.push(...(await nomes(page)));
    const proxima = page.locator('a.sv-lk[href*="pagina="]', { hasText: "Próximas" });
    if ((await proxima.count()) === 0) break;
    // navega pelo endereço do link (o mesmo que o clique seguiria): da 2ª página em diante a URL já tem `pagina=`, e esperar
    // por ela resolvia na hora, com o clique seguinte caindo no meio da navegação
    await page.goto((await proxima.getAttribute("href"))!);
    await expect(page.locator(".sv-pp > li").first()).toBeVisible();
  }
  return todos;
}

test.describe("ordem alfabética com acento solto e sinal no começo do nome", () => {
  test("a lista do país não abre com o nome que começa por sinal: ele está na letra dele, uma vez", async ({ page }) => {
    // D331: a lista só aparece com um filtro do eleitor; o partido (DEL) é o do nome com sinal na demonstração
    await page.goto("/pessoas?uf=&partido=del");
    const primeira = await nomes(page);
    expect(primeira.length).toBeGreaterThan(10);
    expect(primeira[0], "o primeiro nome começa por letra").toMatch(/^\p{L}/u);
    // o nome com sinal existe e aparece entre os "Álvaro", depois de alguém e antes de alguém
    await page.goto("/pessoas?uf=&nome=lvaro");
    const alvaros = await nomes(page);
    const i = alvaros.indexOf(SINAL);
    expect(i, `"${SINAL}" na lista: ${alvaros.slice(0, 12).join(" | ")}`).toBeGreaterThan(0);
    expect(alvaros.filter((n) => n === SINAL)).toHaveLength(1);
    expect(comparar(alvaros[i - 1], SINAL), `${alvaros[i - 1]} vem antes`).toBeLessThan(0);
    if (i + 1 < alvaros.length) expect(comparar(SINAL, alvaros[i + 1]), `${alvaros[i + 1]} vem depois`).toBeLessThan(0);
    expect(alvaros, "a página inteira em ordem").toEqual([...alvaros].sort(comparar));
  });

  test("a ordem vale de uma página para a outra: a lista inteira de um partido no país, com o nome com sinal no meio, sem pular ninguém", async ({ page }) => {
    test.setTimeout(180_000);
    // D331: a lista só aparece com um filtro do eleitor; filtrado por estado e cargo, nenhum recorte da Paraíba passa de uma página
    const todos = await listaInteira(page, "/pessoas?uf=&partido=del");
    expect(todos.length, "mais de uma página").toBeGreaterThan(60);
    const i = todos.indexOf(SINAL);
    expect(i, "o nome com sinal não é o primeiro da lista").toBeGreaterThan(0);
    const fora = todos.flatMap((n, k) => (k > 0 && comparar(todos[k - 1], n) > 0 ? [`"${todos[k - 1]}" antes de "${n}" (posição ${k})`] : []));
    expect(fora, "nenhum par fora de ordem, inclusive entre páginas").toEqual([]);
    // ninguém pulado nem repetido: as páginas somam o total que a tela declara ("N pessoas")
    await page.goto("/pessoas?uf=&partido=del");
    const declarado = Number((await page.locator('[aria-labelledby="pp-2"] .sv-a').first().innerText()).match(/^([\d.]+) pessoas?/)![1].replace(/\./g, ""));
    expect(todos.length, "as páginas somam o total declarado").toBe(declarado);
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText(/ordem alfabética/);
  });

  // Já era assim antes da D329: o teste fixa que a troca do comparador não tirou o nome decomposto do lugar.
  test("continua valendo: nome em forma decomposta (letra + acento combinante) fica no lugar do nome composto", async ({ page }) => {
    await page.goto("/pessoas?uf=PA&nome=andr");
    const lista = await nomes(page);
    const decomposto = lista.find((n) => n !== n.normalize("NFC"));
    expect(decomposto, `há um nome decomposto na lista: ${lista.join(" | ")}`).toBeTruthy();
    expect(decomposto!.normalize("NFC")).toBe("André Gomes");
    expect(lista).toEqual([...lista].sort(comparar));
    // a ordem é a mesma de se o nome estivesse composto
    const compostos = lista.map((n) => n.normalize("NFC"));
    expect(compostos).toEqual([...compostos].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  test("em Escolhidos e na home, o nome com sinal fica depois de quem vem antes dele no alfabeto", async ({ page, context }) => {
    // Álvaro Aguiar < ´álvaro Bezerra < Bruno Sampaio < Helena Siqueira; antes da D329 o nome com sinal abria a lista
    await context.addCookies([
      { name: "sv_uf", value: "SP", domain: "localhost", path: "/" },
      { name: "sv_sigo", value: ["helena-siqueira", "alvaro-bezerra", "bruno-sampaio", "alvaro-aguiar-sp"].join("."), domain: "localhost", path: "/" },
    ]);
    await page.goto("/acompanhando");
    const blocos = (await page.locator(".sv-esc__pessoas .sv-esc__n").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
    expect(blocos).toEqual(["Álvaro Aguiar", SINAL, "Bruno Sampaio", "Helena Siqueira"]);
    await page.goto("/");
    const naHome = (await page.locator(".sv-main ul.sv-esc > li .sv-esc__n").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
    expect(naHome, "a mesma ordem na home").toEqual(blocos);
  });

  test("o nome mostrado é o da fonte: o sinal continua na tela e na página da pessoa", async ({ page }) => {
    await page.goto("/pessoa/alvaro-bezerra");
    await expect(page.locator("h1")).toContainText(SINAL);
  });
});
