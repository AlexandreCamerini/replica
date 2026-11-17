// Critério 26: uma captura de tela de cada visão (Coleta, Revisão, Ver registros, ficha), em 1440 px e em 390 px de largura,
// gravadas em replica/prompts/evidencias/central-<visao>-<largura>.png. Os dados são os do banco local preparado pela primeira rodada (SIMULADO).
import { expect, test, type Page } from "@playwright/test";
import { join } from "path";
import { LARGURAS, PASTA_EVIDENCIAS, abrirMapaPais, primeiraFichaDaFila, primeiraUfComFichas } from "./apoio";

const altura = (l: number) => (l >= 1000 ? 900 : 844);

/** Espera o que muda depois do primeiro desenho: malha do mapa carregada (quando a tela tem mapa) e a primeira consulta periódica respondida. */
async function estabilizar(page: Page, comMapa: boolean) {
  if (comMapa) await expect(page.locator("svg.admin-mapa__svg").first()).toBeVisible();
  const viva = page.locator('[data-regiao="viva"]').first();
  if ((await viva.count()) > 0) await expect(viva).not.toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => document.fonts.ready);
}

async function capturar(page: Page, visao: string, largura: number) {
  const arquivo = join(PASTA_EVIDENCIAS, `central-${visao}-${largura}.png`);
  await page.screenshot({ path: arquivo, fullPage: true, animations: "disabled" });
  return arquivo;
}

for (const largura of LARGURAS) {
  test.describe(`capturas em ${largura} px`, () => {
    test.use({ viewport: { width: largura, height: altura(largura) }, hasTouch: largura < 768 });

    test(`Coleta ${largura}`, async ({ page }) => {
      await abrirMapaPais(page, "coleta");
      await expect(page.getByRole("heading", { level: 1, name: "Central de coleta" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Coleta" }).first()).toHaveAttribute("aria-current", "page");
      await estabilizar(page, true);
      await capturar(page, "coleta", largura);
    });

    test(`Revisão ${largura}`, async ({ page }) => {
      await abrirMapaPais(page, "revisao");
      await expect(page.getByRole("link", { name: "Revisão" }).first()).toHaveAttribute("aria-current", "page");
      await estabilizar(page, true);
      await capturar(page, "revisao", largura);
    });

    test(`Ver registros ${largura}`, async ({ page }) => {
      const uf = await primeiraUfComFichas(page);
      await page.goto(`/admin/registros?uf=${uf.ibge}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Registros/);
      await expect(page.getByText(/fichas?, das quais/)).toBeVisible();
      await estabilizar(page, false);
      await capturar(page, "registros", largura);
    });

    test(`ficha ${largura}`, async ({ page }) => {
      const href = await primeiraFichaDaFila(page);
      await page.goto(href);
      await expect(page.getByRole("heading", { name: "Parecer é ensaio" })).toBeVisible();
      await estabilizar(page, false);
      await capturar(page, "ficha", largura);
    });
  });
}
