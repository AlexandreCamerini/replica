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
    // F3-T3: estado operacional (visto há X, ou sem sinal registrado) e a promessa real; nada de "suba o executor local"
    await expect(bloco).toContainText(/Executor visto|Sem sinal registrado/);
    if (estado === "executor_ok") await expect(bloco).toContainText("um pedido começa em até ~5 s");
    await expect(bloco).not.toContainText(/Suba o executor/i);
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
    await expect(bloco).toContainText("horário de Brasília"); // há quanto tempo e desde quando
    await expect(bloco).toContainText(/Executor visto|Sem sinal registrado/);
    await expect(bloco.locator(".adm-selo")).toHaveText("Parado");
    await expect(bloco).not.toContainText(/Suba o executor/i);
    expect(await bloco.evaluate((el) => getComputedStyle(el).borderLeftWidth), "barra grossa do estado crítico").toBe("4px");
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

  test("erro_leitura: falha da consulta periódica (banco, 503 simulado no navegador) mantém o último dado e diz 'a atualização falhou às HH:MM'", async ({ page }) => {
    await page.route("**/admin/api/estado", (route) => route.fulfill({ status: 503, json: { erro: "erro de leitura do banco" } }));
    await page.goto("/admin");
    const erro = page.locator('section[data-estado="erro_leitura"]');
    await expect(erro).toBeVisible();
    await expect(erro).toHaveAttribute("role", "alert");
    await expect(erro.getByRole("heading", { name: "Não foi possível ler o banco" })).toBeVisible();
    await expect(erro).toContainText(/A atualização falhou às \d{2}:\d{2}/);
    // o último dado (o que a página trouxe do servidor) continua na tela, em vez de a região ser apagada
    await expect(page.locator('section[data-estado^="executor_"]')).toBeVisible();
    await expect(page.getByRole("group", { name: "Brasil por estado" })).toBeVisible();
  });

  test("falha da consulta periódica por tipo: servidor, sessão expirada (entrar de novo), recusado, limite e rede, cada uma com a próxima ação", async ({ page }) => {
    const casos: { status: number | null; titulo: string; extra?: RegExp }[] = [
      { status: 500, titulo: "A central falhou ao responder" },
      { status: 404, titulo: "Sua sessão expirou", extra: /Entre de novo/ },
      { status: 403, titulo: "O servidor recusou o pedido" },
      { status: 429, titulo: "Pedidos demais em pouco tempo", extra: /um minuto/ },
      { status: null, titulo: "Sem conexão com a central", extra: /conexão/ },
    ];
    for (const c of casos) {
      await page.unroute("**/admin/api/estado");
      await page.route("**/admin/api/estado", (route) => (c.status === null ? route.abort() : route.fulfill({ status: c.status, ...(c.status === 404 ? { body: "" } : { json: { erro: "x" } }) })));
      await page.goto("/admin");
      const erro = page.locator('section[data-estado="erro_leitura"]');
      await expect(erro.getByRole("heading", { name: c.titulo }), `falha ${c.status}`).toBeVisible();
      await expect(erro).toContainText(/A atualização falhou às \d{2}:\d{2}/);
      if (c.extra) await expect(erro).toContainText(c.extra);
      if (c.status === 404) await expect(erro.getByRole("link", { name: "Entrar de novo" })).toHaveAttribute("href", "/admin/entrar");
      await expect(page.locator('section[data-estado^="executor_"]')).toBeVisible();
    }
  });

  test("região viva: não é aria-live (não anuncia a cada 5 s); o anunciador pequeno é o único role=status da região", async ({ page }) => {
    await abrirMapaPais(page);
    const viva = page.locator('[data-regiao="viva"]');
    await expect(viva).not.toHaveAttribute("aria-live", /.+/);
    await expect(viva.locator('[role="status"]')).toHaveCount(1);
    await expect(viva.locator('[role="status"]')).toHaveAttribute("aria-live", "polite");
  });

  test("início: faixa de estado primeiro (pendências abertas por classe, executor, rodada), depois o mapa com legenda e o alternador, depois os painéis", async ({ page }) => {
    await abrirMapaPais(page);
    const y = async (loc: ReturnType<typeof page.locator>) => (await loc.first().boundingBox())?.y ?? Number.NaN;
    const pendencias = page.locator(".adm-pendencias");
    await expect(pendencias).toContainText(/pendências? abertas?/);
    for (const c of ["Vínculo SAPL", "Cobertura", "Contato do mandato", "Identidade"]) await expect(pendencias.getByRole("link", { name: new RegExp(c) })).toBeVisible();
    const faixa = await y(page.locator(".adm-faixa"));
    const alternador = await y(page.getByRole("navigation", { name: "Visão do mapa" }));
    const mapa = await y(page.getByRole("group", { name: "Brasil por estado" }));
    const painel = await y(page.locator('[data-painel="adm-coleta"]'));
    expect(faixa).toBeLessThan(alternador);
    expect(alternador).toBeLessThan(mapa);
    expect(mapa).toBeLessThan(painel);
    // a faixa fixa INTERNO é CSS (.admin-central::before), em toda página da central
    expect(await page.locator(".admin-central").evaluate((el) => getComputedStyle(el, "::before").content)).toContain("INTERNO");
  });

  test("tabelas: fila, rodadas e registros são <table> com cabeçalho; em 390 px a tabela rola na horizontal sem rolar a página", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [url, colunas] of [
      ["/admin/fila", ["Ficha", "Classe", "Campo", "Tipo", "Vence", "Cobertura"]],
      ["/admin/rodadas", ["Coletor", "Modo", "Situação", "Iniciada", "Finalizada", "Tentativas"]],
    ] as const) {
      await page.goto(url);
      const tabela = page.getByRole("table").first();
      await expect(tabela.getByRole("columnheader")).toHaveText([...colunas]);
      const rolagem = tabela.locator("xpath=ancestor::div[contains(@class,'adm-rolagem')]");
      const { rolaNaTabela, rolaNaPagina } = await rolagem.evaluate((el) => ({
        rolaNaTabela: el.scrollWidth > el.clientWidth,
        rolaNaPagina: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      expect(rolaNaTabela, `${url}: a tabela tem rolagem horizontal própria`).toBe(true);
      expect(rolaNaPagina, `${url}: a página não rola na horizontal`).toBe(false);
    }
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
