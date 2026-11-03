import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const box = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: /Buscar político, cidade, estado ou cargo/ });

test.describe("W1a · S03 busca global", () => {
  test("S03-H1 resultados em grupos; escolher cidade leva à lista da cidade", async ({ page, axe }) => {
    await page.goto("/");
    await box(page).fill("campi");
    const list = page.getByRole("listbox", { name: "Resultados" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("group", { name: "Cidades" })).toBeVisible();
    // com a lista aberta o React Aria esconde o resto da página (aria-hidden): essas 4 regras são artefato disso, o resto vale
    const open = await new AxeBuilder({ page }).disableRules(["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"]).analyze();
    expect(open.violations.map((v) => v.id)).toEqual([]);
    const city = list.getByRole("group", { name: "Cidades" }).getByRole("option", { name: /^Campinas/ });
    await expect(city).toBeVisible();
    await city.click();
    await expect(page).toHaveURL(/\/representantes\?cidade=3509502/);
    await axe(); // fechada, a página inteira passa
    await expect(box(page)).toHaveValue("");
  });

  test("S03-H2 grupos de estado e cargo; escolher cargo filtra o diretório", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("minas");
    await expect(page.getByRole("group", { name: "Estados" }).getByRole("option", { name: /Minas Gerais/ })).toBeVisible();
    await box(page).fill("vereador");
    await page.getByRole("group", { name: "Cargos" }).getByRole("option", { name: /Vereador/ }).first().click();
    await expect(page).toHaveURL(/\/quem\?cargo=vereador/);
  });

  test("S03-H3 pessoa: grupo Políticos leva ao crachá", async ({ page }) => {
    await page.goto("/");
    await box(page).fill("adriana ventura");
    const opt = page.getByRole("group", { name: "Políticos" }).getByRole("option").first();
    await expect(opt).toBeVisible();
    await opt.click();
    await expect(page).toHaveURL(/\/p\/[a-z0-9-]+/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("S03-K1 só teclado: digitar, seta, Enter; Esc fecha; Enter sem opção busca por nome", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab"); // skip link
    await box(page).focus();
    await expect(box(page)).toBeFocused();
    await page.keyboard.type("salvador");
    await expect(page.getByRole("option").first()).toBeVisible(); // resultados chegaram
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Resultados" })).toBeHidden();
    await page.keyboard.press("ArrowDown");
    await expect(box(page)).toHaveAttribute("aria-activedescendant", /option/);
    const first = await box(page).getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    await expect(box(page)).not.toHaveAttribute("aria-activedescendant", first!);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/(p\/|representantes\?|quem\?)/);
    // texto livre, nada focado: Enter vai para /quem?nome=
    await page.goto("/");
    await box(page).fill("zzzzqq");
    await expect(page.getByText(/Nada com esse nome/)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/quem\?nome=zzzzqq/);
  });

  test("S03-E1 1 caractere não busca; 80+ caracteres não quebra", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => /\/api\/(places|people)/.test(r.url()) && calls.push(r.url()));
    await page.goto("/");
    await box(page).fill("c");
    await page.waitForTimeout(500);
    expect(calls).toEqual([]);
    await box(page).fill("x".repeat(90));
    await expect(page.getByText(/Nada com esse nome/)).toBeVisible();
  });

  test.describe("sem JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("S03-N1 formulário GET cai em /quem?nome=", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("combobox").first().fill("Ana");
      await page.getByRole("button", { name: "Procurar no site" }).click();
      await expect(page).toHaveURL(/\/quem\?nome=Ana/);
    });
  });

  test("S03-M1 cabe em 390 px sem rolagem horizontal e alvo ≥ 40 px @mobile", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const b = await box(page).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(40);
    expect(b!.width).toBeGreaterThan(300);
    await box(page).fill("campi");
    await page.getByRole("option", { name: /Campinas/ }).first().tap?.().catch(() => {});
  });
});
