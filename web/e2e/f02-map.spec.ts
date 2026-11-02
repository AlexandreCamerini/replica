import { expect, test } from "./fixtures";

test.describe("F02 navegar pelo mapa", () => {
  test("F02-H1 UF no mapa → cidade na lista", async ({ page, axe }) => {
    await page.goto("/");
    await expect(page.getByText(/pessoas no cargo hoje/)).toBeVisible();
    await axe();
    await page.getByRole("list", { name: "Estados no mapa" }).getByRole("link", { name: "São Paulo" }).click();
    await expect(page).toHaveURL(/uf=SP/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("São Paulo");
    await expect(page.getByRole("heading", { level: 2, name: /Deputados federais/ })).toBeVisible();
    await page.getByRole("link", { name: "Campinas", exact: true }).click();
    await expect(page).toHaveURL(/cidade=3509502/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campinas · SP");
  });

  test("F02-H2 mapa por teclado", async ({ page }) => {
    await page.goto("/");
    const tile = page.getByRole("list", { name: "Estados no mapa" }).getByRole("link", { name: "Minas Gerais" });
    await tile.focus();
    await expect(tile).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/uf=MG/);
  });

  test("F02-E1 região e A–Z levam ao lugar certo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Minas Gerais" }).last().click();
    await expect(page).toHaveURL(/uf=MG/);
    await page.goto("/");
    await page.getByRole("link", { name: /^Campinas\s+SP$/ }).click();
    await expect(page).toHaveURL(/cidade=3509502/);
  });
});
