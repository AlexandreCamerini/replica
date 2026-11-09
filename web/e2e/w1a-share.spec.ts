import { canonicalUrl } from "../src/lib/share";
import { CAMPINAS, expect, test } from "./fixtures";

test.describe("W1a · copiar link e WhatsApp no topo", () => {
  test("SHARE-U1 URL canônica remove rastreio e âncora, mantém o resto", () => {
    expect(canonicalUrl("https://x.org", "/representantes", "?cidade=3509502&utm_source=a&fbclid=b&gclid=c")).toBe("https://x.org/representantes?cidade=3509502");
    expect(canonicalUrl("https://x.org", "/", "")).toBe("https://x.org/");
    expect(canonicalUrl("https://x.org", "/quem", "?UTM_Medium=z&nome=Ana&igshid=1")).toBe("https://x.org/quem?nome=Ana");
    expect(canonicalUrl("https://x.org", "/p/a", "?ano=2024&mc_cid=1&mc_eid=2&_ga=3")).toBe("https://x.org/p/a?ano=2024");
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

});
