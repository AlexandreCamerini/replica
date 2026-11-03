import { expect, test } from "./fixtures";

const PG = process.env.E2E_PG === "1";

test.describe("fixui · correções da verificação final", () => {
  test("FX-023 desemprego de /governos é a taxa média anual do IBGE (2024 = 6,6)", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/governos");
    await expect(page.locator("tr[data-year='2024'] td[data-ind='desemprego_media']")).toHaveText("6,6");
    await expect(page.getByText("taxa média anual (IBGE)")).toBeVisible();
  });

  test("FX-021 /partidos lista MISSÃO e a soma da Câmara fecha", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/partidos");
    await expect(page.locator("tr[data-party='MISSÃO']")).toHaveCount(1);
    await expect(page.getByTestId("soma")).toContainText("513 de 513 deputados");
    await expect(page.getByTestId("criterio")).toContainText("não ordena nem pinta");
  });

  test("FX-024 home mostra “26 de 27” em Governo do estado, com o motivo", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Governo do estado 26 de 27/ })).toBeVisible();
    await expect(page.getByTestId("lacunas-cargos")).toContainText("AM sem governador em exercício na fonte");
  });

  test("FX-024 Manaus mostra Governo do estado como “—” com o motivo", async ({ page, axe }) => {
    test.skip(!PG, "números reais");
    await page.goto("/representantes?cidade=1302603");
    const gap = page.getByTestId("lacuna").filter({ hasText: "Governo do estado" });
    await expect(gap).toContainText("renunciou");
    await expect(gap).toContainText("a fonte (TSE) não publica quem exerce o cargo agora");
    await axe();
  });

  test("FX-025 Campinas diz “N de M cadeiras carregadas” nos deputados estaduais", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/representantes?cidade=3509502");
    await expect(page.locator("#assembleia-h")).toContainText("90 de 94 cadeiras carregadas");
    await expect(page.getByTestId("cadeiras")).toContainText("suplentes");
  });

  test("FX-026 crachá: bloco Números cita fonte e data", async ({ page }) => {
    await page.goto("/quem?cargo=deputado_federal");
    await page.locator('a[href^="/p/"]').first().click();
    const fontes = page.getByTestId("numeros-fontes");
    await expect(fontes).toContainText("Fonte:");
    await expect(fontes).toContainText("atualizado em");
    await expect(fontes).toContainText("TSE");
  });

  test("FX-026 /comparar cita a Câmara para presença, votos e cota", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/comparar?p=adriana-ventura,baleia-rossi");
    const fontes = page.getByTestId("comparar-fontes");
    await expect(fontes).toContainText("Presença, propostas, votos e cota (Câmara)");
    await expect(fontes).toContainText("Câmara dos Deputados");
    await expect(fontes).toContainText("atualizado em");
  });

  test("FX-028 presença diz “sessões deliberativas” e /sobre explica a diferença para a Câmara", async ({ page }) => {
    await page.goto("/sobre");
    await expect(page.locator("#presenca")).toContainText("A página de cada deputado");
    await expect(page.locator("#presenca")).toContainText("sessões deliberativas");
  });

  const PAGES = ["/", "/representantes?cidade=1302603", "/representantes?cidade=3509502", "/p/adriana-ventura", "/comparar?p=adriana-ventura,baleia-rossi", "/partidos", "/governos"];
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`telas alteradas · ${scheme}`, () => {
      test.use({ colorScheme: scheme });
      for (const url of PAGES) {
        test(`FX-AX ${url} axe e sem rolagem horizontal (${scheme}) @mobile`, async ({ page, axe }) => {
          test.skip(!PG, "números reais");
          await page.goto(url);
          await axe();
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(over).toBeLessThanOrEqual(0);
        });
      }
    });
  }
});
