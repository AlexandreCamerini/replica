import type { Page } from "@playwright/test";
import { COMPARE_MAX } from "../src/lib/compare";
import { expect, test } from "./fixtures";

// Quem escolheu o tema claro continua no claro depois da hidratação, mesmo com o sistema em modo escuro.
// O data-theme é posto no <html> pelo script inline do layout. Se a hidratação falha (texto do servidor diferente do
// texto do navegador), o React recria o documento e apaga o atributo: foi o que houve no perfil, com uma data
// formatada no fuso de quem renderiza. Por isso o perfil roda em dois fusos distantes: juntos, eles garantem que o
// dia local do navegador difere do dia do servidor para qualquer horário de carimbo.
test.describe("tema escolhido sobrevive à hidratação", () => {
  test.use({ colorScheme: "dark" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
  });

  async function expectLight(page: Page) {
    await page.waitForLoadState("networkidle");
    // hidratado: o seletor de tema já leu o localStorage
    await expect(page.getByRole("radio", { name: "Tema claro" }).first()).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    expect(scheme).not.toMatch(/dark/);
  }

  for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    test.describe(`navegador em ${timezoneId}`, () => {
      test.use({ timezoneId });
      test("perfil /p/[slug] continua claro", async ({ page }) => {
        await page.goto("/quem?cargo=deputado_federal");
        const href = await page.locator('a[href^="/p/"]').first().getAttribute("href");
        await page.goto(href!);
        await expect(page.getByText(/atualizado em/).first()).toBeVisible();
        await expectLight(page);
      });
    });
  }

  for (const route of ["/no-seu-bolso", "/pauta", "/ja-decidido"]) {
    test(`controle: ${route} continua claro`, async ({ page }) => {
      await page.goto(route);
      await expectLight(page);
    });
  }
});

test("limite da comparação: acervo e /comparar citam o COMPARE_MAX do código", async ({ page }) => {
  const frase = `De 2 a ${COMPARE_MAX} pessoas`;
  await page.goto("/acervo");
  await expect(page.getByText(`${frase} lado a lado.`)).toBeVisible();
  await page.goto("/comparar");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", new RegExp(`^${frase} lado a lado`));
  await expect(page.getByText(new RegExp(`^${frase}\\.`))).toBeVisible();
});
