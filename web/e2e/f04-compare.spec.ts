import { CAMPINAS, expect, test } from "./fixtures";

test.describe("F04 comparar representantes", () => {
  test("F04-H1 marca duas pessoas, compara, tira uma", async ({ page, axe }) => {
    await page.goto(CAMPINAS);
    const buttons = page.getByRole("button", { name: /^Comparar / });
    const n1 = (await buttons.nth(0).getAttribute("aria-label"))!.replace("Comparar ", "");
    const n2 = (await buttons.nth(1).getAttribute("aria-label"))!.replace("Comparar ", "");
    await buttons.nth(0).click();
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("1 de 5");
    await buttons.nth(0).click(); // a segunda virou a primeira "Comparar " (a marcada agora diz "Tirar")
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("2 de 5");
    await page.getByRole("complementary", { name: "Comparação" }).getByRole("link", { name: "Comparar" }).click();
    await expect(page).toHaveURL(/\/comparar\?p=[^,]+,[^,]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comparar");
    const table = page.getByRole("table");
    await expect(table).toContainText(n1);
    await expect(table).toContainText(n2);
    await expect(page.getByRole("heading", { name: "Votaram igual?" })).toBeVisible();
    await axe();
    await page.getByRole("link", { name: new RegExp(`Tirar ${n2}`) }).click();
    await expect(page).toHaveURL(/\/comparar\?p=[^,]+$/);
    await expect(page.getByText(/Adicione mais uma pessoa/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /comece por um destes/ })).toBeVisible();
  });

  test("F04-H2 adiciona pela busca; F04-E4 sem votação em comum", async ({ page }) => {
    await page.goto(CAMPINAS);
    const a = await page.locator("#prefeitura a[href^='/p/']").first().getAttribute("href");
    const b = await page.locator("#vereadores a[href^='/p/']").first().getAttribute("href");
    await page.goto(`/comparar?p=${a!.split("/").pop()},${b!.split("/").pop()}`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/Nenhuma votação em comum/)).toBeVisible(); // F04-E4
    await expect(page.getByRole("table").getByText("—").first()).toBeVisible(); // F04-E3 cargos diferentes
    const box = page.getByRole("combobox", { name: "Adicionar pessoa" });
    await box.fill("a");
    await box.fill("an");
    // o estado vazio do ListBox também tem role=option (sem data-key): esperar um item de verdade
    const opt = page.locator("[role=option][data-key]").first();
    await expect(opt).toBeVisible();
    await opt.click();
    await expect(page).toHaveURL(/\/comparar\?p=[^,]+,[^,]+,[^,]+/);
  });

  test("F04-E1 limite de cinco", async ({ page }) => {
    await page.goto(CAMPINAS);
    const slugs = (await page.locator("#vereadores a[href^='/p/']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!.split("/").pop()))).slice(0, 7);
    await page.goto(`/comparar?p=${slugs.join(",")}`);
    await expect(page.getByRole("status")).toContainText("limite é 5");
    expect(await page.locator("thead th").count()).toBe(5);
    await expect(page.getByRole("combobox", { name: "Adicionar pessoa" })).toBeDisabled();
    // na lista, com 5 marcadas, o 6º botão fica desabilitado e explica
    await page.goto(CAMPINAS);
    const buttons = page.getByRole("button", { name: /^Comparar / });
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /^Comparar / }).first().click();
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("5 de 5");
    const full = page.getByRole("button", { name: /Comparação cheia/ });
    await expect(full.first()).toBeDisabled();
    expect(await full.count()).toBeGreaterThan(0);
    await expect(buttons).toHaveCount(0); // ninguém mais pode ser adicionado
    await page.getByRole("complementary", { name: "Comparação" }).getByRole("button", { name: /^Tirar/ }).first().click();
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("4 de 5");
  });

  test("F04-E2 slug inválido e repetido", async ({ page }) => {
    await page.goto(CAMPINAS);
    const a = (await page.locator("#vereadores a[href^='/p/']").nth(0).getAttribute("href"))!.split("/").pop();
    const b = (await page.locator("#vereadores a[href^='/p/']").nth(1).getAttribute("href"))!.split("/").pop();
    await page.goto(`/comparar?p=${a},${a},nao-existe-123,${b}`);
    await expect(page.getByRole("status")).toContainText("não foi encontrada");
    expect(await page.locator("thead th").count()).toBe(2);
  });

  test("F04-E5 seleção persiste depois de atualizar", async ({ page }) => {
    await page.goto(CAMPINAS);
    await page.getByRole("button", { name: /^Comparar / }).first().click();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("1 de 5");
    await page.goto("/no-seu-bolso");
    await expect(page.getByRole("complementary", { name: "Comparação" })).toContainText("1 de 5");
  });
});
