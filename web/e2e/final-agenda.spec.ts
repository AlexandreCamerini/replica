import { expect, test } from "./fixtures";

// final: aba "agenda" de /congresso (agenda_events/agenda_items, D125/D174). Contra o banco real (E2E_PG=1); no demo a agenda é vazia e a tela diz isso.
const PG = process.env.E2E_PG === "1";
const noOverflow = async (page: import("@playwright/test").Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

test.describe("Congresso · agenda", () => {
  test("AG-H1 aba, sessões, pauta com fonte e data; axe", async ({ page, axe }) => {
    await page.goto("/congresso?aba=agenda&casa=senado");
    await expect(page.getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(page.getByTestId("agenda")).toBeVisible();
    await axe();
    if (!PG) {
      await expect(page.getByTestId("agenda-vazia")).toContainText("Nenhuma sessão marcada");
      return;
    }
    const ev = page.getByTestId("agenda-evento");
    expect(await ev.count()).toBeGreaterThan(0);
    await expect(ev.first().locator("time")).toBeVisible();
    await expect(page.getByTestId("agenda").getByText(/^Fonte:/)).toBeVisible();
    await expect(page.getByTestId("agenda")).toContainText(/atualizado em \d{2}\/\d{2}\/\d{4}/);
  });

  test("AG-PG1 pauta do Senado liga ao site oficial e à votação quando a proposta está carregada", async ({ page }) => {
    test.skip(!PG, "dados reais");
    await page.goto("/congresso?aba=agenda&casa=senado&na=50");
    const pauta = page.getByRole("list", { name: "Pauta" }).first();
    await expect(pauta).toBeVisible();
    expect(await pauta.getByRole("listitem").count()).toBeGreaterThan(0);
    // links só quando há proposal_id: nunca href vazio nem fora de http(s)
    for (const a of await page.getByTestId("agenda").getByRole("link", { name: /proposta no site oficial|sessão no site oficial/ }).all()) {
      expect(await a.getAttribute("href")).toMatch(/^https?:\/\//);
    }
    for (const a of await page.getByTestId("agenda").getByRole("link", { name: "ver a votação" }).all()) {
      expect(await a.getAttribute("href")).toMatch(/^\/votacoes\/[0-9a-f-]{36}$/);
    }
  });

  test("AG-E1 sessão sem pauta mostra “—” com motivo, nunca lista vazia muda", async ({ page }) => {
    test.skip(!PG, "dados reais");
    await page.goto("/congresso?aba=agenda&na=50");
    for (const e of await page.getByTestId("agenda-evento").all()) {
      const temPauta = (await e.getByRole("list", { name: "Pauta" }).count()) > 0;
      if (!temPauta) await expect(e).toContainText("Pauta não publicada pela casa");
    }
  });

  test("AG-M1 sem rolagem horizontal em 390 px @mobile", async ({ page }) => {
    await page.goto("/congresso?aba=agenda&casa=senado&na=50");
    await noOverflow(page);
  });

  test.describe("escuro", () => {
    test.use({ colorScheme: "dark" });
    test("AG-D1 axe no escuro", async ({ page, axe }) => {
      await page.goto("/congresso?aba=agenda&casa=senado");
      await axe();
    });
  });
});
