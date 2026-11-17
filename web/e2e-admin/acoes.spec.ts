// Critério 20: clicar duas vezes no botão de confirmação da recoleta ("Recoletar N fichas em <UF>") gera um pedido só, e a tela mostra "já existe um pedido igual".
// F3-T3: toda ação com efeito passa por um resumo de confirmação; a recoleta não vem com classe escolhida (escolhe-se a classe, vê-se o resumo, confirma-se).
// Pré-condição: o executor NÃO está rodando (um pedido consumido antes do segundo envio deixaria de ser "igual na fila"). Esta spec grava pedidos em adm_pedidos.
import { expect, test, type Page, type Response } from "@playwright/test";
import catalogo from "../src/lib/admin/catalogo.json";
import { primeiraFichaDaFila, primeiraUfComFichas, vigiarErros } from "./apoio";

type Corpo = { id?: string; novo?: boolean };
const ehPedido = (r: Response) => r.url().endsWith("/admin/api/pedidos") && r.request().method() === "POST";

/** Conta os POST de pedido disparados enquanto `acao` roda e devolve as respostas lidas. */
async function contarPedidos(page: Page, acao: () => Promise<void>): Promise<Corpo[]> {
  const corpos: Promise<Corpo>[] = [];
  const aoResponder = (r: Response) => {
    if (ehPedido(r)) corpos.push(r.json() as Promise<Corpo>);
  };
  page.on("response", aoResponder);
  await acao();
  await expect(page.locator('[role="status"][data-estado]').first()).toBeVisible();
  page.off("response", aoResponder);
  return Promise.all(corpos);
}

test.describe("pedidos sem duplicar", () => {
  test("recoleta: sem classe pré-escolhida, resumo antes de enviar; duplo clique no botão que diz o efeito envia um POST só; um novo envio mostra 'pedido já existente'", async ({ page }) => {
    const conferir = vigiarErros(page);
    const uf = await primeiraUfComFichas(page);
    await page.goto(`/admin/uf/${uf.ibge}`);
    const form = page.getByRole("form", { name: /^Recoletar fichas pendentes em / });
    const classe = form.getByLabel("Classe de campo");
    await expect(classe, "nenhuma classe vem escolhida").toHaveValue("");

    // sem classe: o envio é recusado na tela, nenhum POST sai
    let posts = 0;
    const contar = (r: { method(): string; url(): string }) => {
      if (r.method() === "POST" && r.url().endsWith("/admin/api/pedidos")) posts++;
    };
    page.on("request", contar);
    await form.getByRole("button", { name: "Recoletar fichas pendentes" }).click();
    await expect(form.getByRole("alert")).toContainText("Escolha a classe");
    expect(posts).toBe(0);

    // com classe: o botão vira "Revisar: ..." e o resumo aparece SEM enviar nada
    await classe.selectOption("vinculo_sapl");
    await form.getByRole("button", { name: /^Revisar: Recoletar / }).click();
    const resumo = form.getByRole("group", { name: "Confirme a recoleta" });
    await expect(resumo).toBeVisible();
    for (const rotulo of ["Classe", "Território", "Fichas pendentes", "Coletor", "Efeito"]) await expect(resumo.getByText(rotulo, { exact: true })).toBeVisible();
    expect(posts, "o resumo não envia nada").toBe(0);
    page.off("request", contar);

    const confirmar = resumo.getByRole("button", { name: /^Recoletar (\d+|\d+ ou mais) fichas? em / });
    const primeiro = await contarPedidos(page, () => confirmar.dblclick());
    expect(primeiro, "dois cliques rápidos viram uma requisição só").toHaveLength(1);
    expect(typeof primeiro[0].id).toBe("string");
    const resultado = form.locator('[role="status"][data-estado]');
    await expect(resultado).toHaveCount(1);
    await expect(classe, "no sucesso o formulário é limpo").toHaveValue("");

    // novo envio com o primeiro pedido ainda na fila: o servidor devolve o mesmo id, sem pedido novo
    await classe.selectOption("vinculo_sapl");
    await form.getByRole("button", { name: /^Revisar: Recoletar / }).click();
    const segundo = await contarPedidos(page, () => form.getByRole("button", { name: /^Recoletar (\d+|\d+ ou mais) fichas? em / }).click());
    expect(segundo).toHaveLength(1);
    expect(segundo[0].novo).toBe(false);
    expect(segundo[0].id).toBe(primeiro[0].id);
    await expect(resultado).toHaveAttribute("data-estado", "pedido_existente");
    await expect(resultado).toContainText("Já existe um pedido igual na fila");
    await expect(resultado).toContainText(String(primeiro[0].id)); // o id inteiro fica no detalhe; na tela, abreviado
    conferir();
  });

  test("duplo clique em 'Pedir parecer' envia um POST só; segundo envio mostra 'pedido já existente'", async ({ page }) => {
    const conferir = vigiarErros(page);
    await page.goto(await primeiraFichaDaFila(page));
    const botao = page.getByRole("button", { name: "Pedir parecer" }).first();
    const bloco = botao.locator("xpath=ancestor::div[contains(@class,'adm-acao')]");

    const primeiro = await contarPedidos(page, () => botao.dblclick());
    expect(primeiro).toHaveLength(1);
    await expect(botao).toBeEnabled();
    const segundo = await contarPedidos(page, () => botao.click());
    expect(segundo[0].novo).toBe(false);
    expect(segundo[0].id).toBe(primeiro[0].id);
    await expect(bloco.locator('[role="status"]')).toHaveAttribute("data-estado", "pedido_existente");
    conferir();
  });

  test("pedido inválido não vira pedido: recoleta sem território é recusada pela API com 4xx (nunca 5xx)", async ({ page }) => {
    await page.goto("/admin");
    const resposta = await page.request.post("/admin/api/pedidos", { data: { tipo: "recoleta", parametros: {} } });
    expect(resposta.status()).toBeGreaterThanOrEqual(400);
    expect(resposta.status()).toBeLessThan(500);
  });

  test("formulário de decisão: 'Decidindo como {nome}', justificativa obrigatória antes de enviar (nenhum POST sai) e resumo com o botão que diz o efeito", async ({ page }) => {
    await page.goto(await primeiraFichaDaFila(page));
    let posts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST") posts++;
    });
    const form = page.getByRole("form", { name: /Pedido de decisão sobre o campo/ }).first();
    await expect(form.getByText(/^Decidindo como /)).toBeVisible();
    await expect(form.getByLabel(/^Por/), "o campo 'Por' não existe mais: quem decide é a sessão").toHaveCount(0);
    await form.getByRole("button", { name: "Pedir decisão" }).click();
    expect(posts).toBe(0);
    // a validação nativa (required) impede o envio; o campo obrigatório vazio fica inválido
    await expect(form.getByLabel(/Justificativa/)).toHaveJSProperty("validity.valueMissing", true);

    // com a justificativa: abre o resumo (campo, valor atual, valor novo, escopo) e ainda não envia
    await form.getByLabel(/Justificativa/).fill("Conferi a fonte oficial.");
    await form.getByRole("button", { name: "Pedir decisão" }).click();
    const resumo = form.getByRole("group", { name: "Confirme a decisão" });
    await expect(resumo).toBeVisible();
    for (const rotulo of ["Campo", "Valor atual", "Valor novo", "Escopo", "Decidindo como"]) await expect(resumo.getByText(rotulo, { exact: true })).toBeVisible();
    await expect(resumo.getByRole("button", { name: "Aprovar (sem aplicar)" })).toBeVisible();
    await resumo.getByRole("button", { name: "Voltar e editar" }).click();
    await expect(resumo).toHaveCount(0);
    expect(posts, "nenhum pedido sai até a confirmação").toBe(0);

    // o rascunho fica no navegador: recarregar a ficha recupera o que foi digitado
    await page.reload();
    const depois = page.getByRole("form", { name: /Pedido de decisão sobre o campo/ }).first();
    await expect(depois.getByLabel(/Justificativa/)).toHaveValue("Conferi a fonte oficial.");
    await expect(depois.getByText(/Rascunho recuperado/)).toBeVisible();
    await depois.getByLabel(/Justificativa/).fill(""); // limpa o rascunho guardado
  });

  test("abrir rodada: sempre disponível em /admin/rodadas, coletor da lista do catálogo e só os modos e recortes que ele suporta", async ({ page }) => {
    await page.goto("/admin/rodadas");
    const form = page.getByRole("form", { name: "Abrir rodada" });
    await expect(form).toBeVisible();
    const coletor = form.getByLabel("Coletor");
    await expect(coletor.locator("option")).toHaveCount(catalogo.coletores.length + 1); // a lista é o catálogo, mais "Escolha o coletor…"
    // coletor sem recorte e sem "descobrir": só dois modos, nenhum campo de recorte
    await coletor.selectOption("camara.equipe");
    await expect(form.getByLabel("Modo").locator("option")).toHaveText(["Recoletar fontes conhecidas", "Reprocessar sem rede"]);
    await expect(form.getByText("Estados do recorte (opcional)")).toHaveCount(0);
    // coletor com recorte por estado
    await coletor.selectOption("sapl.assembleias");
    await expect(form.getByText("Estados do recorte (opcional)")).toBeVisible();
    // enviar sem confirmar não grava: o resumo vem antes (nenhum POST)
    let posts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST") posts++;
    });
    await form.getByRole("button", { name: "Revisar e abrir rodada" }).click();
    await expect(form.getByRole("group", { name: "Confirme a abertura da rodada" })).toBeVisible();
    await expect(form.getByRole("button", { name: "Abrir rodada de sapl.assembleias" })).toBeVisible();
    expect(posts).toBe(0);
  });
});
