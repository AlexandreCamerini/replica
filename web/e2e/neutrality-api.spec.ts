import { CAMPINAS, expect, test } from "./fixtures";

const FORBIDDEN = /\b(ranking|melhor|pior|recomend\w*|nota (final|geral)|pontuação)\b/i;

test.describe("Neutralidade e null nunca vira 0", () => {
  test("NEU-1 listas em ordem alfabética pt-BR", async ({ page }) => {
    for (const [u, sel] of [["/quem?cargo=deputado_estadual&uf=SP", "main a[href^='/p/']"], [CAMPINAS, "#vereadores a[href^='/p/']"]] as const) {
      await page.goto(u);
      const list = (await page.locator(sel).allTextContents()).map((s) => s.trim());
      expect(list.length, u).toBeGreaterThan(5);
      const sorted = [...list].sort((a, b) => a.localeCompare(b, "pt-BR"));
      expect(list, u).toEqual(sorted);
    }
  });

  test("NEU-2 Sim e Não têm a mesma cor; NEU-3 cadeiras não têm cor de partido", async ({ page }) => {
    await page.goto("/design");
    const bg = async (t: string) => page.locator("span", { hasText: new RegExp(`^${t}$`) }).first().evaluate((el) => getComputedStyle(el).backgroundColor + "|" + getComputedStyle(el).color);
    expect(await bg("Sim")).toBe(await bg("Não"));
    expect(await bg("Aprovado")).toBe(await bg("Rejeitado"));
    const fills = await page.locator("svg[role='img'] circle").evaluateAll((cs) => [...new Set(cs.map((c) => c.getAttribute("fill")))]);
    expect(fills.length).toBeLessThanOrEqual(2); // neutro + selecionado, nunca uma cor por partido
  });

  test("NEU-4 sem vocabulário de avaliação", async ({ page }) => {
    await page.goto(CAMPINAS);
    const first = await page.locator('a[href^="/p/"]').first().getAttribute("href");
    for (const u of ["/", "/no-seu-bolso", CAMPINAS, first!, "/quem"]) {
      await page.goto(u);
      const text = await page.locator("main").innerText();
      expect(text.match(FORBIDDEN), u).toBeNull();
    }
  });

  test("NUL-1 tile vazio mostra — com motivo", async ({ page }) => {
    await page.goto(CAMPINAS);
    await page.locator("#vereadores a[href^='/p/']").first().click();
    await expect(page).toHaveURL(/\/p\//);
    const dash = page.getByLabel("não publicado pela fonte");
    await expect(dash.first()).toBeVisible(); // count() não espera: primeiro a navegação termina
    expect(await dash.count()).toBeGreaterThan(0);
    await expect(dash.first()).toHaveAttribute("title", /não publica/);
  });
});

test.describe("API-1 contratos", () => {
  test("validação, 404, 401 e cache", async ({ request }) => {
    const places = await request.get("/api/places?q=camp");
    expect(places.status()).toBe(200);
    expect(places.headers()["cache-control"]).toContain("s-maxage");
    const rows = await places.json();
    expect(rows[0]).toEqual(expect.objectContaining({ ibge: expect.stringMatching(/^\d{7}$|^\d{2}$/), uf: expect.any(String), kind: expect.stringMatching(/municipio|uf/) }));
    expect((await request.get("/api/places?q=c")).status()).toBe(400);
    expect((await request.get(`/api/places?q=${"a".repeat(61)}`)).status()).toBe(400);
    expect((await request.get("/api/people/search?q=a")).status()).toBe(400);
    expect((await request.get("/api/compare/agreement?p=a")).status()).toBe(400);
    expect((await request.get("/api/compare/agreement?p=nao-1,nao-2")).status()).toBe(404);
    expect((await request.get("/api/compare/agreement?p=x,y&period=abc")).status()).toBe(400);
    expect((await request.post("/api/revalidate", { data: { tags: ["data"] } })).status()).toBe(401);
    expect((await request.post("/api/revalidate", { headers: { authorization: "Bearer errado" }, data: { tags: ["data"] } })).status()).toBe(401);
  });
});
