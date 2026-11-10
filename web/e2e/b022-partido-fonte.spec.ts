import { expect, test } from "./fixtures";

// BUG-022 / D220: o crachá diz de onde vem o partido e desde quando. Precisa de dados reais (Eliziane e Romário).
test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");

const FONTE = '[data-testid="partido-fonte"]';
const DATA = "\\d{2}/\\d{2}/\\d{4}";

async function semRolagem(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

test.describe("B022 fonte e data do partido no crachá", () => {
  test("B022-H1 Eliziane Gama: PSD segundo o Senado", async ({ page, axe }) => {
    await page.goto("/p/eliziane-gama");
    await expect(page.locator("main").getByText("PSD", { exact: true }).first()).toBeVisible();
    await expect(page.locator(FONTE)).toHaveText(new RegExp(`^Partido segundo o Senado, vigente desde ${DATA}\\.$`));
    await axe();
  });

  test("B022-H2 Romário: S/Partido segundo o Senado, desde 10/09/2026", async ({ page, axe }) => {
    await page.goto("/p/romario");
    await expect(page.locator("main").getByText("S/Partido", { exact: true }).first()).toBeVisible();
    await expect(page.locator(FONTE)).toHaveText("Partido segundo o Senado, vigente desde 10/09/2026.");
    await axe();
  });

  test("B022-H3 deputado federal: partido segundo a Câmara", async ({ page, axe }) => {
    await page.goto("/quem?cargo=deputado_federal");
    await page.locator('a[href^="/p/"]').first().click();
    await expect(page.locator(FONTE)).toHaveText(new RegExp(`^Partido segundo a Câmara, vigente desde ${DATA}\\.$`));
    await axe();
  });

  test.describe("390 px", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    for (const slug of ["eliziane-gama", "romario"]) {
      test(`B022-M1 ${slug} @mobile sem rolagem horizontal`, async ({ page, axe }) => {
        await page.goto(`/p/${slug}`);
        await expect(page.locator(FONTE)).toBeVisible();
        await semRolagem(page);
        await axe();
      });
    }
  });

  test.describe("tema escuro", () => {
    test.use({ colorScheme: "dark" });
    test("B022-D1 Romário no escuro: fonte visível e axe limpo @mobile", async ({ page, axe }) => {
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));
      await page.goto("/p/romario");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.locator(FONTE)).toBeVisible();
      await semRolagem(page);
      await axe();
    });
  });
});
