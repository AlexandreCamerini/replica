import { expect, test } from "./fixtures";

// W4: /eleicoes, /governos, /impostos e /partidos. Rodam contra o demo (build próprio) e contra o banco real (E2E_PG=1 + E2E_BASE_URL).
const PG = process.env.E2E_PG === "1";
const noOverflow = async (page: import("@playwright/test").Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test.describe("S14 · /eleicoes", () => {
  test("EL-H1 panorama, cargo e estado; fonte e data no rodapé", async ({ page, axe }) => {
    await page.goto("/eleicoes?ano=2022");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Eleições");
    await axe();
    await expect(page.getByTestId("panorama")).toContainText("Governador");
    await page.getByRole("link", { name: "Governador" }).first().click();
    await expect(page).toHaveURL(/cargo=governador/);
    await expect(page.getByTestId("disputas")).toBeVisible();
    await expect(page.getByText(/^Fonte:/)).toBeVisible();
    await page.getByTestId("ufs").getByRole("link", { name: "SP" }).click();
    await expect(page.getByTestId("disputa").first()).toContainText("São Paulo");
    await axe();
  });

  test("EL-E1 voto de presidente aparece; ausente é “—” com motivo, nunca 0", async ({ page }) => {
    await page.goto("/eleicoes?ano=2022&cargo=presidente");
    const rows = page.getByTestId("disputa").first().locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    let withVotes = 0;
    for (const r of await rows.all()) {
      const cell = r.locator("td").last();
      const txt = (await cell.innerText()).trim();
      if (txt.startsWith("—")) await expect(cell.locator(".sr-only")).toContainText(/não carregado/);
      else {
        withVotes++;
        expect(txt).toMatch(/^\d{1,3}(\.\d{3})*$/);
      }
      expect(txt).not.toMatch(/^0$/);
    }
    expect(withVotes).toBeGreaterThan(0);
    await expect(page.locator("#cobertura")).not.toContainText("dobrando");
  });

  test("EL-PG0 presidente 2022: Lula no 2º turno = 60.345.999 (TSE)", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/eleicoes?ano=2022&cargo=presidente");
    const t = await page.getByTestId("cargo").innerText();
    expect(t).toContain("60.345.999");
    expect(t).not.toContain("120.691.998"); // o valor em dobro do BUG-019
  });

  test("EL-E2 municipal exige estado; ano inválido cai no mais recente; uf inválida é ignorada", async ({ page }) => {
    test.skip(!PG, "o demo só tem um cargo municipal sem disputas");
    await page.goto("/eleicoes?ano=2024&cargo=prefeito");
    await expect(page.getByTestId("escolha-uf")).toBeVisible();
    await page.goto("/eleicoes?ano=1900&uf=XX;drop");
    await expect(page.getByRole("heading", { level: 2, name: /Panorama de/ })).toBeVisible();
  });

  test("EL-PG1 números conferidos com o TSE (SP, governador 2022)", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/eleicoes?ano=2022&cargo=governador&uf=SP");
    const t = await page.getByTestId("disputa").nth(1).innerText();
    expect(t).toContain("13.480.643"); // Tarcísio, 2º turno
    expect(t).toContain("10.909.371"); // Haddad, 2º turno
  });

  test("EL-M1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/eleicoes?ano=2022&cargo=governador&uf=SP");
    await noOverflow(page);
  });

  test.describe("escuro", () => {
    test.use({ colorScheme: "dark" });
    test("EL-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/eleicoes?ano=2022&cargo=governador&uf=SP");
      await axe();
    });
  });
});

test.describe("S12 · /governos", () => {
  test("GO-H1 nove mandatos desde 1985, tabela ano a ano e regra publicada", async ({ page, axe }) => {
    await page.goto("/governos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Governos");
    await axe();
    await expect(page.locator("[data-term]")).toHaveCount(9);
    await expect(page.locator("[data-term='itamar']")).toContainText("29/12/1992");
    await expect(page.locator("#como")).toContainText("SIDRA");
    await expect(page.getByText(/^Fonte:/)).toBeVisible();
    // ano de troca lista os dois presidentes
    await expect(page.locator("tr[data-year='2016']")).toContainText("Dilma Rousseff");
    await expect(page.locator("tr[data-year='2016']")).toContainText("Michel Temer");
  });

  test("GO-E1 “—” com motivo: antes de 1996 sem PIB, 2026 em andamento; nunca 0", async ({ page }) => {
    await page.goto("/governos");
    const pib85 = page.locator("tr[data-year='1985'] td[data-ind='pib_variacao']");
    await expect(pib85).toContainText("—");
    await expect(pib85.locator(".sr-only")).toContainText("1996");
    const cur = page.locator(`tr[data-year='${new Date().getFullYear()}'] td[data-ind='pib_variacao']`);
    await expect(cur.locator(".sr-only")).toContainText("ainda não terminou");
    const cells = await page.locator("td[data-ind]").allInnerTexts();
    expect(cells.filter((c) => c.trim() === "0")).toEqual([]);
  });

  test("GO-PG1 valores conferidos com a fonte", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/governos");
    await expect(page.locator("tr[data-year='2022'] td[data-ind='pib_variacao']")).toHaveText("3,0");
    await expect(page.locator("tr[data-year='2023'] td[data-ind='ipca_acumulado']")).toHaveText("4,62");
    await expect(page.locator("tr[data-year='2022'] td[data-ind='selic_meta_fim_ano']")).toHaveText("13,75");
  });

  test("GO-M1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/governos");
    await noOverflow(page);
  });

  test.describe("escuro", () => {
    test.use({ colorScheme: "dark" });
    test("GO-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/governos");
      await axe();
    });
  });
});

test.describe("S16 · /impostos", () => {
  test("IM-H1 total do ano, estados A–Z, mês e tributo; fonte e data", async ({ page, axe }) => {
    await page.goto("/impostos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Impostos");
    await axe();
    await expect(page.getByTestId("total-ano")).toContainText("R$");
    const names = await page.getByTestId("por-uf").locator("tbody th a").allInnerTexts();
    expect([...names].sort((a, b) => a.localeCompare(b, "pt-BR"))).toEqual(names);
    await page.getByTestId("por-uf").locator("tbody th a").first().click();
    await expect(page).toHaveURL(/uf=/);
    await expect(page.getByTestId("por-mes").locator("tbody tr")).toHaveCount(12);
    await expect(page.locator("#regra")).toContainText("recolhido");
    await expect(page.getByText(/^Fonte:/)).toBeVisible();
  });

  test("IM-PG1 totais conferidos com a Receita e ano parcial com mês vazio “—”", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/impostos?ano=2023");
    await expect(page.getByTestId("total-ano")).toContainText("2.318,1 bi");
    await page.goto("/impostos?ano=2024");
    await expect(page.getByTestId("total-ano")).toContainText("2.651,3 bi");
    await page.goto(`/impostos?ano=${new Date().getFullYear()}`);
    const dec = page.getByTestId("por-mes").locator("tbody tr").last();
    await expect(dec).toContainText("—");
    await expect(dec.locator(".sr-only")).toContainText("ainda não foi publicado");
  });

  test("IM-M1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/impostos?ano=2023&uf=SP");
    await noOverflow(page);
  });

  test.describe("escuro", () => {
    test.use({ colorScheme: "dark" });
    test("IM-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/impostos");
      await axe();
    });
  });
});

test.describe("S11 · /partidos", () => {
  test("PA-H1 A–Z, sem espectro nem ranking, regra do alinhamento publicada", async ({ page, axe }) => {
    await page.goto("/partidos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Partidos");
    await axe();
    const sig = await page.getByTestId("partidos").locator("tbody tr").evaluateAll((trs) => trs.map((t) => t.getAttribute("data-party")!));
    expect([...sig].sort((a, b) => a.localeCompare(b, "pt-BR"))).toEqual(sig);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/\b(extrema|centro-direita|centro-esquerda|ranking dos|melhor|pior)\b/i);
    await expect(page.locator("#alinhamento")).toContainText("orientação");
    await expect(page.getByText(/^Fonte:/)).toBeVisible();
  });

  test("PA-E1 poucas votações ou sem orientação viram “—” com motivo, nunca 0%", async ({ page }) => {
    await page.goto("/partidos");
    const cells = page.locator("td[data-gov]");
    const n = await cells.count();
    expect(n).toBeGreaterThan(0);
    for (const c of await cells.all()) {
      const t = (await c.innerText()).trim();
      if (t.startsWith("—")) await expect(c.locator(".sr-only")).toContainText(/votaç|orientação/);
      expect(t).not.toMatch(/^0\s*%/);
    }
  });

  test("PA-PG1 cadeiras fecham com o hemiciclo", async ({ page }) => {
    test.skip(!PG, "números reais");
    await page.goto("/partidos");
    await expect(page.getByTestId("soma")).toContainText("de 513 deputados");
    await expect(page.getByTestId("soma")).toContainText("81 de 81 senadores");
  });

  test("PA-M1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/partidos");
    await noOverflow(page);
  });

  test.describe("escuro", () => {
    test.use({ colorScheme: "dark" });
    test("PA-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/partidos");
      await axe();
    });
  });
});
