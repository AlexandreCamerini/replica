import { canonicalUrl } from "../src/lib/share";
import { CAMPINAS, expect, test } from "./fixtures";

test.describe("W1a · copiar link e WhatsApp no topo", () => {
  test("SHARE-U1 URL canônica remove rastreio e âncora, mantém o resto", () => {
    expect(canonicalUrl("https://x.org", "/representantes", "?cidade=3509502&utm_source=a&fbclid=b&gclid=c")).toBe("https://x.org/representantes?cidade=3509502");
    expect(canonicalUrl("https://x.org", "/", "")).toBe("https://x.org/");
    expect(canonicalUrl("https://x.org", "/quem", "?UTM_Medium=z&nome=Ana&igshid=1")).toBe("https://x.org/quem?nome=Ana");
    expect(canonicalUrl("https://x.org", "/p/a", "?ano=2024&mc_cid=1&mc_eid=2&_ga=3")).toBe("https://x.org/p/a?ano=2024");
  });

  test("SHARE-H1 em páginas de conteúdo: copia a URL canônica e o WhatsApp leva a mesma", async ({ page, context, axe }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const path of ["/", "/sobre", "/atualizacoes", "/dados-abertos", "/quem", "/representantes"]) {
      await page.goto(path);
      await expect(page.getByTestId("page-share")).toBeVisible();
    }
    await page.goto(`${CAMPINAS}&utm_source=zap&fbclid=abc#vereadores`);
    const bar = page.getByTestId("page-share");
    await bar.getByRole("button", { name: "Copiar link" }).click();
    await expect(bar.getByRole("button", { name: "Link copiado" })).toBeVisible();
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}${CAMPINAS}`);
    const wa = bar.getByRole("link", { name: /WhatsApp/ });
    await expect(wa).toHaveAttribute("target", "_blank");
    await expect(wa).toHaveAttribute("rel", /noopener/);
    expect(decodeURIComponent((await wa.getAttribute("href"))!)).toContain(`${origin}${CAMPINAS}`);
    expect(decodeURIComponent((await wa.getAttribute("href"))!)).not.toContain("utm_");
    await axe();
  });

  test("SHARE-E1 crachá usa o compartilhamento próprio, sem barra duplicada; /entrar sem barra", async ({ page }) => {
    await page.goto(CAMPINAS);
    await page.locator("#vereadores a[href^='/p/']").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("page-share")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveCount(1);
    await page.goto("/entrar");
    await expect(page.getByTestId("page-share")).toHaveCount(0);
  });

  test("SHARE-M1 cabe em 390 px sem rolagem horizontal @mobile", async ({ page }) => {
    await page.goto("/sobre");
    await expect(page.getByTestId("page-share")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
