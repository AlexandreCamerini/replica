import { expect, test } from "./fixtures";

test.describe("F07 acompanhar o Congresso", () => {
  test("F07-H1 hemiciclo, votações e detalhe", async ({ page, axe }) => {
    await page.goto("/congresso");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Congresso");
    const seats = page.locator('svg[role="img"][aria-label*="cadeiras"] circle');
    expect(await seats.count()).toBeGreaterThan(400);
    // neutralidade: todas as cadeiras com a mesma cor até escolher um partido
    const fills = await seats.evaluateAll((cs) => [...new Set(cs.map((c) => c.getAttribute("fill")))]);
    expect(fills).toEqual(["var(--seat)"]);
    await axe();
    const first = page.locator('a[href^="/votacoes/"]').first();
    await first.click();
    await expect(page).toHaveURL(/\/votacoes\//);
    await expect(page.getByRole("heading", { name: "Placar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Voto de cada pessoa/ })).toBeVisible();
    await axe();
    await page.getByRole("navigation", { name: "Filtrar por voto" }).getByRole("link", { name: /^Sim/ }).click();
    await expect(page).toHaveURL(/voto=sim/);
    const badges = page.locator('[aria-labelledby="pessoas-h"] li').locator("text=/^(Sim|Não|Abstenção|Obstrução|Art\\. 17|Não votou)$/");
    const n = Math.min(await badges.count(), 10);
    for (let i = 0; i < n; i++) await expect(badges.nth(i)).toHaveText("Sim");
  });

  test("F07-E1 Senado, filtros e 404", async ({ page, request }) => {
    await page.goto("/congresso?casa=senado");
    expect(await page.locator('svg[role="img"][aria-label*="cadeiras"] circle').count()).toBeLessThanOrEqual(81);
    await page.goto("/congresso?resultado=rejeitado&busca=zzzzzz");
    await expect(page.getByText("Nenhuma votação com esses filtros.")).toBeVisible();
    expect((await request.get("/votacoes/abc")).status()).toBe(404);
  });
});
