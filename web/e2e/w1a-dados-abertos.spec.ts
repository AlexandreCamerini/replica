import postgres from "postgres";
import { CAMPINAS, expect, test } from "./fixtures";

test.describe("W1a · S23 Quem publica dados", () => {
  test("S23-H1 matriz UF × dado, CTA e busca de cidade", async ({ page, axe }) => {
    await page.goto("/dados-abertos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quem publica dados");
    await axe();
    const rows = page.locator("[data-testid=matriz] tbody tr[data-uf]");
    expect(await rows.count()).toBe(28); // 27 UFs + Brasil
    await expect(page.locator("tr[data-uf=BR]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Indicar onde o dado é publicado" })).toHaveAttribute("href", "/sugestoes?tipo=dado");
    // célula sem conferência é "—", nunca 0%
    for (const td of await page.locator("td[data-checked='0']").all()) expect(await td.innerText()).not.toMatch(/0%/);
    // busca de cidade (com JS): digita, escolhe, vê o quadro da cidade
    await page.getByLabel("Ver uma cidade").fill("campi");
    await page.getByRole("option", { name: /Campinas/ }).first().click();
    await expect(page).toHaveURL(/cidade=3509502/);
    await expect(page.getByTestId("quadro-cidade")).toContainText("Campinas");
  });

  test("S23-E1 entradas inválidas e estado vazio", async ({ page, request }) => {
    expect((await request.get("/dados-abertos?cidade=123")).status()).toBe(404);
    expect((await request.get("/dados-abertos?cidade=35")).status()).toBe(404);
    await page.goto("/dados-abertos?q=zzzzqq");
    await expect(page.getByText(/Nenhuma cidade com/)).toBeVisible();
    await page.goto("/dados-abertos?q=Bom+Jesus");
    expect(await page.locator("a[href^='/dados-abertos?cidade=']").count()).toBeGreaterThanOrEqual(2);
    await page.goto(CAMPINAS.replace("/representantes", "/dados-abertos"));
    await expect(page.getByTestId("quadro-cidade")).toBeVisible();
  });

  test("S23-E2 sem rolagem horizontal da página em 390 px @mobile", async ({ page }) => {
    await page.goto("/dados-abertos");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test("S23-D1 números da matriz batem com data_coverage", async ({ page }) => {
    test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");
    const sql = postgres(process.env.E2E_DB_URL ?? "postgres://web_reader:web_reader@localhost:54329/civico", { max: 1 });
    try {
      const db = await sql`
        select p.uf, dc.dataset,
               count(*)::int as n,
               count(*) filter (where dc.status = 'no_site')::int as no_site,
               count(*) filter (where dc.status <> 'desconhecido')::int as checked
        from data_coverage dc join places p on p.id = dc.place_id
        where p.kind = 'municipio' group by 1, 2`;
      const cities = await sql`select uf, count(*)::int as n from places where kind = 'municipio' group by 1`;
      expect(db.length).toBeGreaterThan(0);
      await page.goto("/dados-abertos");
      for (const r of db) {
        const cell = page.locator(`tr[data-uf=${r.uf}] td[data-dataset=${r.dataset}]`);
        await expect(cell, `${r.uf}/${r.dataset}`).toHaveAttribute("data-no-site", String(r.no_site));
        await expect(cell).toHaveAttribute("data-checked", String(r.checked));
      }
      for (const c of cities) await expect(page.locator(`tr[data-uf=${c.uf}] td`).first()).toHaveText(new Intl.NumberFormat("pt-BR").format(c.n));
      const tot = db.reduce((a, r) => a + (r.dataset === db[0].dataset ? r.n : 0), 0);
      await expect(page.locator(`tr[data-uf=BR] td[data-dataset=${db[0].dataset}]`)).toHaveAttribute("data-cities", String(cities.reduce((a, c) => a + c.n, 0)));
      expect(tot).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });
});
