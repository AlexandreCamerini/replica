import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

// primeira visita: sem o cookie que o config injeta nos outros specs
test.use({ storageState: { cookies: [], origins: [] } });

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Quem trabalha por você?" });
const cookie = async (page: import("@playwright/test").Page) => (await page.context().cookies()).find((c) => c.name === "onb");

test.describe("W1a · onboarding na 1ª visita", () => {
  test("ONB-H1 abre na 1ª visita, Pular fecha, lembra por cookie e não volta", async ({ page }) => {
    await page.goto("/");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("listitem")).toHaveCount(3);
    // foco dentro do modal
    expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    const r = await new AxeBuilder({ page }).disableRules(["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await dialog(page).getByRole("button", { name: "Pular" }).click();
    await expect(dialog(page)).toBeHidden();
    const c = await cookie(page);
    expect(c?.value).toBe("1");
    expect(c!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400); // ~1 ano
    await page.reload();
    await page.waitForTimeout(1200);
    await expect(dialog(page)).toHaveCount(0);
    await page.goto("/representantes");
    await page.waitForTimeout(800);
    await expect(dialog(page)).toHaveCount(0);
  });

  test("ONB-K1 Esc fecha; sem cookie volta na visita seguinte", async ({ page, context }) => {
    await page.goto("/representantes");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect((await cookie(page))?.value).toBe("1");
    await context.clearCookies();
    await page.goto("/");
    await expect(dialog(page)).toBeVisible();
  });

  test("ONB-H2 'Achar minha cidade' leva à busca de cidade", async ({ page }) => {
    await page.goto("/");
    await dialog(page).getByRole("button", { name: "Achar minha cidade" }).click();
    await expect(page).toHaveURL(/\/representantes$/);
    await expect(dialog(page)).toBeHidden();
  });

  test("ONB-E1 link direto para um crachá não recebe o modal", async ({ page }) => {
    await page.goto("/representantes?cidade=3509502");
    await page.waitForTimeout(1200);
    await expect(dialog(page)).toHaveCount(0);
    await page.goto("/sobre");
    await page.waitForTimeout(800);
    await expect(dialog(page)).toHaveCount(0);
  });

  test.describe("sem JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("ONB-N1 nunca bloqueia o conteúdo", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const link = page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Minha cidade" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/\/representantes/);
    });
  });

  test("ONB-M1 cabe em 390 px e os botões são alcançáveis @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(dialog(page)).toBeVisible();
    const b = await dialog(page).getByRole("button", { name: "Pular" }).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
