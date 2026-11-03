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

  // D184/D197 e BUG-031 (D202/D203): o AM tem governador fora do TSE; RJ e RR não têm ninguém do diretório em exercício
  // (interino do TJ-RJ e da ALE-RR), então a home conta 25 de 27 e diz quais UFs
  test("FX-024 home conta 25 de 27 governos do estado e nomeia RJ e RR", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Governo do estado 25 de 27/ })).toBeVisible();
    await expect(page.getByText(/RJ, RR sem governador em exercício/)).toBeVisible();
  });

  test("FX-024 Manaus mostra o governador e o vice vago como “—” com o motivo", async ({ page, axe }) => {
    test.skip(!PG, "números reais");
    await page.goto("/representantes?cidade=1302603");
    await expect(page.getByText("Roberto Cidade").first()).toBeVisible();
    const gap = page.getByTestId("lacuna").filter({ hasText: /Vice-gov/ });
    await expect(gap).toContainText("—");
    await axe();
  });

  test("FX-031 Brasília mostra Celina Leão governadora e não Ibaneis; vice “—” com motivo", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/representantes?cidade=5300108");
    await expect(page.getByText("Celina Leão").first()).toBeVisible();
    await expect(page.getByText("Ibaneis Rocha")).toHaveCount(0);
    await expect(page.getByTestId("lacuna").filter({ hasText: /Vice-gov/ })).toContainText("quem era vice assumiu o governo");
  });

  test("FX-031 Rio e Boa Vista: governo “—” com o interino de outro Poder, sem Castro nem Denarium", async ({ page, axe }) => {
    test.skip(!PG, "números reais");
    await page.goto("/representantes?cidade=3304557");
    await expect(page.getByText("Cláudio Castro")).toHaveCount(0);
    await expect(page.getByTestId("lacuna").filter({ hasText: /Governo do estado/ })).toContainText("presidente do TJ-RJ");
    await axe();
    await page.goto("/representantes?cidade=1400100");
    await expect(page.getByText("Antonio Denarium")).toHaveCount(0);
    await expect(page.getByTestId("lacuna").filter({ hasText: /Governo do estado/ })).toContainText("sub judice");
  });

  test("FX-030 cota de Luciano Vieira 2024 soma a complementação do auxílio-moradia (Câmara: 516.374,69)", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/p/luciano-vieira?ano=2024");
    await expect(page.getByTestId("ano-em-numeros")).toContainText("R$ 516.375");
    await expect(page.getByText("R$ 449.994")).toHaveCount(0);
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
