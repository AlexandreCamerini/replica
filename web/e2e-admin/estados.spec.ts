// Estados de tela pelo atributo `data-estado` (web/src/lib/admin/estado-tela.ts). Os que dependem só do banco preparado pela primeira rodada são lidos como estão;
// os que dependem do momento (carregando, erro de leitura, executor parado) são provocados interceptando a consulta periódica /admin/api/estado no NAVEGADOR
// (a resposta é alterada só dentro do teste; nada muda no banco). Estado fora do alcance do banco preparado fica em `test.skip` com o motivo.
import { expect, test } from "@playwright/test";
import { abrirMapaPais, primeiraFichaDaFila, vigiarErros } from "./apoio";

const ESTADOS_RODADA = ["rodada_em_andamento", "rodada_interrompida", "rodada_concluida"] as const;
const TEXTO_RODADA: Record<(typeof ESTADOS_RODADA)[number], RegExp> = {
  rodada_em_andamento: /Em andamento\./,
  rodada_interrompida: /Rodada (interrompida|com falha)\./,
  rodada_concluida: /Rodada concluída\./,
};

test.describe("estados de tela", () => {
  test("rodada exibida: data-estado é um dos três e bate com o texto do bloco", async ({ page }) => {
    const conferir = vigiarErros(page);
    await abrirMapaPais(page);
    const bloco = page.locator('section[data-estado^="rodada_"]');
    await expect(bloco, "o banco da primeira rodada tem rodada registrada").toHaveCount(1);
    const estado = (await bloco.getAttribute("data-estado")) as (typeof ESTADOS_RODADA)[number];
    expect(ESTADOS_RODADA).toContain(estado);
    await expect(bloco).toContainText(TEXTO_RODADA[estado]);
    await expect(bloco.getByRole("button", { name: "Repetir rodada" })).toBeVisible();
    conferir();
  });

  test("executor: data-estado é executor_ok ou executor_parado e bate com o texto", async ({ page }) => {
    await abrirMapaPais(page);
    const bloco = page.locator('section[data-estado^="executor_"]');
    await expect(bloco).toHaveCount(1);
    const estado = await bloco.getAttribute("data-estado");
    expect(["executor_ok", "executor_parado"]).toContain(estado);
    await expect(bloco).toContainText(estado === "executor_parado" ? "Executor parado." : "Sem pedido atrasado.");
  });

  test("executor_parado: resposta da consulta periódica com executor parado mostra o aviso com o tempo de espera (resposta simulada no navegador)", async ({ page }) => {
    await page.route("**/admin/api/estado", async (route) => {
      const resp = await route.fetch();
      const j = await resp.json();
      j.executor = { ...j.executor, parado: true, motivoParado: "pedido na fila há mais de 60 s sem batimento", filaMaisAntigaS: 125, batimentoMaisAntigoS: null };
      await route.fulfill({ response: resp, json: j });
    });
    await abrirMapaPais(page);
    const bloco = page.locator('section[data-estado="executor_parado"]');
    await expect(bloco).toBeVisible();
    await expect(bloco).toContainText("Executor parado.");
    await expect(bloco).toContainText(/Tempo de espera: 2 min 5 s/);
  });

  test("carregando: com a consulta periódica segurada, a região viva marca data-estado=carregando e aria-busy; ao responder, sai", async ({ page }) => {
    let liberar!: () => void;
    const segurada = new Promise<void>((r) => (liberar = r));
    await page.route("**/admin/api/estado", async (route) => {
      await segurada;
      await route.continue();
    });
    await page.goto("/admin");
    const viva = page.locator('[data-regiao="viva"]');
    await expect(viva).toHaveAttribute("data-estado", "carregando");
    await expect(viva).toHaveAttribute("aria-busy", "true");
    liberar();
    await expect(viva).not.toHaveAttribute("data-estado", "carregando");
    await expect(viva).toHaveAttribute("aria-busy", "false");
  });

  test("erro_leitura: falha da consulta periódica mostra o aviso sem números (resposta 500 simulada no navegador)", async ({ page }) => {
    await page.route("**/admin/api/estado", (route) => route.fulfill({ status: 500, json: { erro: "falha" } }));
    await page.goto("/admin");
    const erro = page.locator('section[data-estado="erro_leitura"]');
    await expect(erro).toBeVisible();
    await expect(erro).toHaveAttribute("role", "alert");
    await expect(erro.getByRole("heading", { name: "Não foi possível ler o banco" })).toBeVisible();
  });

  test("territorio_sem_ficha: UF com 0 fichas mostra o bloco e o botão de recoleta continua disponível", async ({ page }) => {
    const mapa = await abrirMapaPais(page);
    const links = mapa.getByRole("link");
    let vazia: string | null = null;
    for (let i = 0; i < (await links.count()); i++) {
      if (/: 0 fichas/.test((await links.nth(i).getAttribute("aria-label")) ?? "")) {
        vazia = (await links.nth(i).getAttribute("href")) ?? null;
        break;
      }
    }
    test.skip(vazia === null, "todas as UFs têm ficha neste banco: não há território vazio para observar");
    await page.goto(vazia!.replace("/admin/uf/", "/admin/registros?uf=").replace(/\?visao=.*$/, ""));
    await expect(page.locator('section[data-estado="territorio_sem_ficha"]')).toBeVisible();
    await expect(page.getByText(/0 fichas neste território/)).toBeVisible();
  });

  test("ficha_sem_evidencia: nas primeiras fichas da fila, o bloco aparece só quando falta URL, trecho e hash", async ({ page }) => {
    await page.goto("/admin/fila");
    const hrefs = await page.locator("[data-pendencia] a").evaluateAll((as) => as.slice(0, 5).map((a) => (a as HTMLAnchorElement).getAttribute("href")));
    expect(hrefs.length, "fila vazia: banco não preparado pela primeira rodada").toBeGreaterThan(0);
    let vistas = 0;
    for (const h of hrefs) {
      await page.goto(h!);
      const bloco = page.locator('section[data-estado="ficha_sem_evidencia"]');
      if ((await bloco.count()) > 0) {
        vistas++;
        await expect(bloco.getByRole("heading", { name: "Sem evidência válida" })).toBeVisible();
      }
    }
    test.info().annotations.push({ type: "observado", description: `${vistas} de ${hrefs.length} fichas sem evidência válida` });
  });

  test("ficha inexistente e UF inválida respondem 404 mesmo com a central ligada", async ({ page }) => {
    expect((await page.goto("/admin/ficha/vinculo_sapl/chave-que-nao-existe"))?.status()).toBe(404);
    expect((await page.goto("/admin/uf/xx"))?.status()).toBe(404);
  });

  test("vazio: sem nenhuma rodada o bloco mostra o comando e o formulário", async () => {
    test.skip(true, "o banco da primeira rodada já tem rodada registrada; o estado 'vazio' só existe em banco sem adm_rodadas (provado em teste unitário de estadoDaTela)");
  });

  test("a ficha da fila não exibe estado de pedido antes de qualquer clique", async ({ page }) => {
    await page.goto(await primeiraFichaDaFila(page));
    await expect(page.locator('[role="status"][data-estado^="pedido_"]')).toHaveCount(0);
  });
});
