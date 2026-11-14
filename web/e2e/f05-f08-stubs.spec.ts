import { CAMPINAS, expect, test } from "./fixtures";

test.describe("F05–F08 a partir do crachá e telas provisórias", () => {
  test("F05 Acompanhar leva a /entrar com volta; F05-E1 volta malicioso não vira link", async ({ page, axe }) => {
    await page.goto(CAMPINAS);
    const first = page.locator('a[href^="/p/"]').first();
    const href = await first.getAttribute("href");
    await first.click();
    await page.getByRole("link", { name: "Acompanhar" }).click();
    await expect(page).toHaveURL(new RegExp(`/entrar\\?volta=${encodeURIComponent(href!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
    await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
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
    await expect(page).toHaveURL(/\/p\//); // a barra global (com outro WhatsApp) some no crachá: espera a navegação
    await expect(page.getByTestId("page-share")).toHaveCount(0);
    const wa = page.getByRole("link", { name: "WhatsApp" });
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    await expect(wa).toHaveAttribute("rel", /noopener/);
    await expect(wa).toHaveAttribute("target", "_blank");
    expect(decodeURIComponent((await wa.getAttribute("href"))!)).toContain(href!);
    await page.getByRole("link", { name: "Reportar erro" }).click();
    await expect(page).toHaveURL(new RegExp(`/sugestoes\\?tipo=erro&p=${href!.split("/").pop()}`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sugerir ou corrigir");
    await expect(page.getByLabel("Algo está errado")).toBeChecked();
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

  test("stubs de release posterior dizem o release", async ({ page, axe }) => {
    // S22, S23 e S24 saíram de stub no build 5 (têm spec própria em w1a-*); aqui ficam as que ainda são stub
    for (const [path, sid] of [["/propostas", "S13"]]) {
      await page.goto(path);
      await expect(page.getByText(new RegExp(`${sid} · entra no R\\d`))).toBeVisible();
      await expect(page.getByRole("link", { name: /quem representa a sua cidade/ })).toBeVisible();
    }
    await axe();
  });

  test("stubs aposentados (D304) respondem 404 e a capa não aponta para eles", async ({ page, request }) => {
    for (const path of ["/stf", "/mais-vistos"]) expect((await request.get(path)).status(), path).toBe(404);
    await page.goto("/no-seu-bolso");
    await expect(page.locator('a[href="/stf"], a[href="/mais-vistos"]')).toHaveCount(0);
  });

  test("rodapé não promete revisão por pessoa: diz a regra de conferência e leva à explicação", async ({ page }) => {
    await page.goto("/no-seu-bolso");
    const rodape = page.getByRole("contentinfo").filter({ hasText: "Segue o Voto" }).last();
    await expect(rodape).not.toContainText("aguardando revisão por pessoa");
    await expect(rodape).toContainText("só aparece depois de conferida com o texto oficial");
    await rodape.getByRole("link", { name: "Como conferimos" }).click();
    await expect(page).toHaveURL(/\/como-escolhemos#revisao$/);
    await expect(page.locator("#revisao")).toContainText("por pessoa ou por agentes de IA");
  });
});
