import { CAMPINAS, expect, test } from "./fixtures";

test.describe("F05–F08 fluxos com telas provisórias (R2)", () => {
  test("F05 Acompanhar leva a /entrar com volta; F05-E1 volta malicioso não vira link", async ({ page, axe }) => {
    await page.goto(CAMPINAS);
    const first = page.locator('a[href^="/p/"]').first();
    const href = await first.getAttribute("href");
    await first.click();
    await page.getByRole("link", { name: "Acompanhar" }).click();
    await expect(page).toHaveURL(new RegExp(`/entrar\\?volta=${encodeURIComponent(href!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
    await expect(page.getByText(/S20/)).toBeVisible();
    await axe();
    for (const bad of ["javascript:alert(1)", "//evil.example", "https://evil.example"]) {
      await page.goto(`/entrar?volta=${encodeURIComponent(bad)}`);
      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
      expect(hrefs.some((h) => h.startsWith("javascript:") || h.includes("evil.example")), bad).toBe(false);
    }
  });

  test("F06-H2 WhatsApp e F08 reportar erro", async ({ page }) => {
    await page.goto(CAMPINAS);
    const first = page.locator('a[href^="/p/"]').first();
    const href = await first.getAttribute("href");
    await first.click();
    const wa = page.getByRole("link", { name: "WhatsApp" });
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await expect(wa).toHaveAttribute("rel", /noopener/);
    await expect(wa).toHaveAttribute("target", "_blank");
    expect(decodeURIComponent((await wa.getAttribute("href"))!)).toContain(href!);
    await page.getByRole("link", { name: "Reportar erro" }).click();
    await expect(page).toHaveURL(new RegExp(`/sugestoes\\?tipo=erro&p=${href!.split("/").pop()}`));
    await expect(page.getByText(/S25/)).toBeVisible();
  });

  test("F06-H1 Compartilhar copia o link e avisa", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(CAMPINAS);
    const first = page.locator('a[href^="/p/"]').first();
    const href = await first.getAttribute("href");
    await first.click();
    await page.getByRole("button", { name: "Compartilhar" }).click();
    await expect(page.getByRole("button", { name: "Link copiado" })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(href!);
    await expect(page.getByRole("button", { name: "Compartilhar" })).toBeVisible({ timeout: 5000 });
  });

  test("F07 Congresso e demais stubs dizem o release", async ({ page, axe }) => {
    for (const [path, sid] of [["/congresso", "S09"], ["/dados-abertos", "S23"], ["/sobre", "S22"], ["/votacoes/abc", "S10"]]) {
      await page.goto(path);
      await expect(page.getByText(new RegExp(`${sid} · entra no R\\d`))).toBeVisible();
      await expect(page.getByRole("link", { name: /quem representa a sua cidade/ })).toBeVisible();
    }
    await axe();
  });
});
