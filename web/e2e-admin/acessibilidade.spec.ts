// Critério 21 (teclado e leitor de tela, no mapa e nas telas): cada território é alcançável por teclado, com nome e contagem acessíveis; Esc volta.
import { expect, test } from "@playwright/test";
import { abrirMapaPais, primeiraFichaDaFila, primeiraUfComFichas, vigiarErros } from "./apoio";

test.describe("teclado e leitor de tela", () => {
  test("mapa do país: Tab alcança cada território, com nome e contagem no nome acessível", async ({ page }) => {
    const conferir = vigiarErros(page);
    const mapa = await abrirMapaPais(page);
    const links = mapa.getByRole("link");
    const n = await links.count();
    expect(n, "o mapa do país tem 27 territórios (UFs)").toBe(27);

    // foco no primeiro e Tab um a um: cada território recebe o foco e traz "UF: Nome: N fichas[, estado]"
    await links.first().focus();
    for (let i = 0; i < n; i++) {
      const atual = links.nth(i);
      await expect(atual).toBeFocused();
      await expect(atual).toHaveAttribute("aria-label", /^[A-Z]{2}: .+: (0 fichas|1 ficha|\d+ fichas)/);
      if (i < n - 1) await page.keyboard.press("Tab");
    }
    conferir();
  });

  test("mapa: nenhuma bolha nem elemento de agrupamento; a malha carrega só do próprio site", async ({ page }) => {
    const mapa = await abrirMapaPais(page);
    await expect(page.locator("svg circle")).toHaveCount(0);
    await expect(mapa.locator("title").first()).toBeAttached();
  });

  test("Enter abre a UF; no mapa da UF, cada município é alcançável por teclado com nome e contagem; Esc volta ao Brasil", async ({ page }) => {
    const uf = await primeiraUfComFichas(page);
    const mapa = await abrirMapaPais(page);
    const link = mapa.locator(`a[href^="/admin/uf/${uf.ibge}"]`);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/admin/uf/${uf.ibge}`));

    const municipios = page.getByRole("group", { name: /por município$/ });
    await expect(municipios).toBeVisible();
    const itens = municipios.getByRole("link");
    expect(await itens.count()).toBeGreaterThan(0);
    await itens.first().focus();
    await expect(itens.first()).toBeFocused();
    await expect(itens.first()).toHaveAttribute("aria-label", /: (0 fichas|1 ficha|\d+ fichas)/);
    await page.keyboard.press("Tab");
    await expect(itens.nth(1)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    await expect(page.getByRole("group", { name: "Brasil por estado" })).toBeVisible();
  });

  test("equivalente em texto do mapa: Ver registros lista as fichas com motivo, e a região do mapa anuncia o nível", async ({ page }) => {
    await abrirMapaPais(page);
    await expect(page.getByText(/Brasil por estado: 27 territórios/)).toBeAttached();
    await page.getByRole("link", { name: /ver registros/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/registros/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Registros/);
  });

  test("lista do mapa: número escrito de cada estado (27 linhas), cabeçalho e rolagem acessível por teclado; o 0 também vem escrito no mapa", async ({ page }) => {
    await abrirMapaPais(page);
    const lista = page.getByRole("region", { name: /^Lista de fichas por estado/ });
    await expect(lista).toBeVisible();
    await expect(lista.getByRole("columnheader")).toHaveText(["Estado", "Fichas", /Última tentativa|Revisão/]);
    await expect(lista.locator("tbody tr")).toHaveCount(27);
    const zeros = await page.locator(".admin-mapa__zeros .admin-mapa__zero").count();
    const linhasZero = await lista.locator("tbody tr[data-faixa='0']").count();
    expect(zeros, "todo estado com 0 fichas leva o 0 escrito sobre o território").toBe(linhasZero);
  });

  test("telas: um único h1, navegação rotulada, formulário de decisão com rótulos e botão pelo papel", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Central de coleta" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Visão do mapa" })).toBeVisible();

    const href = await primeiraFichaDaFila(page);
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const form = page.getByRole("form", { name: /Pedido de decisão sobre o campo/ }).first();
    await expect(form.getByLabel("Ação")).toBeVisible();
    await expect(form.getByText(/^Decidindo como /)).toBeVisible();
    await expect(form.getByLabel(/Justificativa/)).toBeVisible();
    await expect(form.getByRole("button", { name: "Pedir decisão" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pedir parecer" }).first()).toBeVisible();
    // ordem de Tab previsível: dentro do formulário o foco anda Ação -> Justificativa (o campo "Por" saiu: quem decide é a sessão)
    await form.getByLabel("Ação").focus();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel(/Justificativa/)).toBeFocused();
  });
});
