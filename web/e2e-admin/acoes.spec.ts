// Critério 20: clicar duas vezes em "Recoletar fichas pendentes" gera um pedido só, e a tela mostra "já existe um pedido igual".
// Pré-condição: o executor NÃO está rodando (um pedido consumido antes do segundo envio deixaria de ser "igual na fila"). Esta spec grava pedidos em adm_pedidos.
import { expect, test, type Page, type Response } from "@playwright/test";
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
  test("duplo clique em 'Recoletar fichas pendentes' envia um POST só; um novo clique mostra 'pedido já existente'", async ({ page }) => {
    const conferir = vigiarErros(page);
    const uf = await primeiraUfComFichas(page);
    await page.goto(`/admin/uf/${uf.ibge}`);
    const form = page.getByRole("form", { name: /Recoletar fichas pendentes em Estado/ });
    await form.getByLabel("Classe de campo").selectOption("vinculo_sapl");
    const botao = form.getByRole("button", { name: "Recoletar fichas pendentes" });

    const primeiro = await contarPedidos(page, () => botao.dblclick());
    expect(primeiro, "dois cliques rápidos viram uma requisição só").toHaveLength(1);
    expect(typeof primeiro[0].id).toBe("string");
    const resultado = form.locator('[role="status"][data-estado]');
    await expect(resultado).toHaveCount(1);

    // novo envio com o primeiro pedido ainda na fila: o servidor devolve o mesmo id, sem pedido novo
    await expect(botao).toBeEnabled();
    const segundo = await contarPedidos(page, () => botao.click());
    expect(segundo).toHaveLength(1);
    expect(segundo[0].novo).toBe(false);
    expect(segundo[0].id).toBe(primeiro[0].id);
    await expect(resultado).toHaveAttribute("data-estado", "pedido_existente");
    await expect(resultado).toContainText("Já existe um pedido igual na fila");
    await expect(resultado).toContainText(String(primeiro[0].id));
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

  test("formulário de decisão exige 'por' e justificativa antes de enviar (nenhum POST sai)", async ({ page }) => {
    await page.goto(await primeiraFichaDaFila(page));
    let posts = 0;
    page.on("request", (r) => {
      if (r.method() === "POST") posts++;
    });
    const form = page.getByRole("form", { name: /Pedido de decisão sobre o campo/ }).first();
    await form.getByRole("button", { name: "Pedir decisão" }).click();
    expect(posts).toBe(0);
    // a validação nativa (required) impede o envio; o campo obrigatório vazio fica inválido
    await expect(form.getByLabel(/Por \(quem decide/)).toHaveJSProperty("validity.valueMissing", true);
  });
});
