import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F6 do roteiro do eleitor: pauta de comissões, aviso de pauta velha e lista da casa com frase de resultado e nota fixa. Fonte de dados: demonstração.
// O CI é o único árbitro deste arquivo (o Playwright não roda no sandbox da sessão).

test.describe("F6 · aviso de pauta velha", () => {
  test("pauta lida há 3 dias: aviso no topo de /decisoes, antes do primeiro quadro, com a data de cada Casa", async ({ page }) => {
    await page.goto("/decisoes?simular=pauta_velha");
    const aviso = page.locator('[data-aviso="pauta-velha"]');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("A pauta pode estar desatualizada.");
    await expect(aviso).toContainText("Câmara dos Deputados foi lida pela última vez em");
    await expect(aviso).toContainText("Senado Federal foi lida pela última vez em");
    await expect(aviso).toContainText("há mais de 3 dias");
    const antes = await page.evaluate(() => {
      const a = document.querySelector('[data-aviso="pauta-velha"]')!;
      const q = document.querySelector("#dc-1")!;
      return !!(a.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(antes, "o aviso vem antes do primeiro quadro").toBe(true);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("o aviso também aparece antes da semana na raiz; pauta recente não mostra aviso", async ({ page }) => {
    await page.goto("/?simular=pauta_velha");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toBeVisible();
    await page.goto("/");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toHaveCount(0);
    await page.goto("/decisoes");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toHaveCount(0);
    await page.goto("/temas?simular=pauta_velha");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toBeVisible();
    await page.goto("/temas");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toHaveCount(0);
  });

  test("Casa sem leitura não vira 'pauta velha' (tem o aviso próprio de não lida)", async ({ page }) => {
    await page.goto("/decisoes?simular=camara_nao_lida");
    await expect(page.locator('[data-aviso="pauta-velha"]')).toHaveCount(0);
  });

  test("item de comissão diz que não é votação de plenário", async ({ page }) => {
    await page.goto("/decisoes");
    const c = page.locator('[data-etapa="comissao"]').first();
    await expect(c).toContainText("não é votação de plenário");
    await expect(c).not.toContainText("costuma vir depois"); // a comissão pode decidir sozinha em alguns casos (caráter conclusivo, decisão terminativa): não afirmamos o que não conferimos
  });
});

test.describe("F6 · lista da casa", () => {
  test("a nota fixa está na primeira tela a 390 px, sem rolar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/votacoes");
    const nota = page.locator('[data-nota-fixa="votacoes"]');
    await expect(nota).toContainText("Na Câmara só entram votações nominais");
    await expect(nota).toContainText("Votação simbólica não aparece");
    const box = (await nota.boundingBox())!;
    expect(box.y + box.height, "a nota termina dentro da altura da tela").toBeLessThanOrEqual(844);
    // no Senado a nota é outra (a lista do Senado traz votações sem o voto de cada pessoa) e também fica na primeira tela
    await page.goto("/votacoes?casa=senado");
    const ns = page.locator('[data-nota-fixa="votacoes"]');
    await expect(ns).toContainText("No Senado entram as votações que a fonte lista");
    const bs = (await ns.boundingBox())!;
    expect(bs.y + bs.height).toBeLessThanOrEqual(844);
    await page.goto("/votacoes");
    const noSegundoPlano = await page.evaluate(() => document.querySelector('[data-nota-fixa="votacoes"]')!.compareDocumentPosition(document.querySelector("#vts-mapa")!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(noSegundoPlano, "a nota vem antes do primeiro quadro").toBeTruthy();
  });

  test("cada votação traz uma frase de resultado, sempre com Sim e Não rotulados quando há placar", async ({ page }) => {
    await page.goto("/votacoes");
    const frases = await page.locator(".sv-vl__k").allInnerTexts();
    expect(frases.length).toBeGreaterThan(0);
    for (const f of frases) expect(f, f).toMatch(/((Aprovada|Rejeitada)(, com [\d.]+ Sim e [\d.]+ Não)?\.|Resultado não publicado pela fonte\.)$/);
    expect(frases.some((f) => /, com [\d.]+ Sim e [\d.]+ Não\.$/.test(f)), "pelo menos uma com placar").toBe(true);
    expect(frases.join(" ")).not.toMatch(/Resultado: (aprovado|rejeitado)| por [\d.]+ a [\d.]+\./);
  });
});
