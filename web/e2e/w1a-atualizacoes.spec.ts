import { freshness } from "../src/lib/sources";
import { expect, test } from "./fixtures";

test.describe("W1a · S24 Como atualizamos", () => {
  test("S24-U1 'fora do prazo' calculado: fonte artificialmente atrasada", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const h = (n: number) => new Date(now - n * 3_600_000).toISOString();
    expect(freshness(h(10), 36, now).state).toBe("no_prazo");
    expect(freshness(h(36), 36, now).state).toBe("no_prazo"); // no limite ainda vale
    const late = freshness(h(80), 36, now);
    expect(late.state).toBe("fora_do_prazo");
    expect(Math.round(late.overdueHours)).toBe(44);
    expect(freshness(null, 36, now).state).toBe("sem_carga");
    expect(freshness("lixo", 36, now).state).toBe("sem_carga");
    expect(freshness(h(-5), 36, now).ageHours).toBe(0); // relógio da fonte à frente: não fica negativo
  });

  test("S24-H1 tabela por fonte, situação coerente com a última carga, 'nunca faz'", async ({ page, axe }) => {
    await page.goto("/atualizacoes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Como atualizamos");
    await axe();
    const rows = page.locator("tbody tr[data-last]");
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    const now = Date.now();
    for (const r of await rows.all()) {
      const last = await r.getAttribute("data-last");
      const max = Number(await r.getAttribute("data-max-hours"));
      const expected = !last ? "sem_carga" : (now - Date.parse(last)) / 3_600_000 > max ? "fora_do_prazo" : "no_prazo";
      await expect(r.locator("[data-state]")).toHaveAttribute("data-state", expected);
    }
    // fontes ainda não lidas aparecem com traço e motivo, nunca com data inventada
    const pend = page.locator("tr[data-source=pendente]");
    expect(await pend.count()).toBeGreaterThanOrEqual(3);
    await expect(pend.first().locator("[data-state=pendente]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "O que a rotina nunca faz" })).toBeVisible();
    const summary = await page.getByTestId("resumo-prazo").innerText();
    const late = await page.locator("tbody [data-state=fora_do_prazo]").count();
    expect(summary.includes("fora do prazo")).toBe(late > 0);
  });

  test("S24-E1 sem rolagem horizontal da página em 390 px @mobile", async ({ page }) => {
    await page.goto("/atualizacoes");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator("[role=region][aria-label='Fontes e última carga']").focus();
  });
});
