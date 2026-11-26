import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F5b do roteiro do eleitor: calendário (.ics) da pauta do plenário. Fonte de dados: demonstração. Só plenário, sem filtro por assunto.
// O CI é o único árbitro deste arquivo (o Playwright não roda no sandbox da sessão).

test.describe("F5b · calendário da pauta", () => {
  test("/decisoes mostra os três downloads, de 44 px, com o aviso de que o arquivo é um retrato e não se atualiza", async ({ page }) => {
    await page.goto("/decisoes");
    const bloco = page.locator('[data-calendario="pauta"]');
    await expect(bloco).toBeVisible();
    const links = bloco.locator("a");
    await expect(links).toHaveCount(3);
    for (const a of await links.all()) expect((await a.boundingBox())!.height, "alvo de toque").toBeGreaterThanOrEqual(44);
    await expect(bloco).toContainText("não se atualiza sozinho");
    await expect(bloco).toContainText("sem filtro por assunto");
    await expect(bloco).toContainText("horário é o do início da sessão");
    await expect(links.first()).toHaveAttribute("aria-label", /Baixar calendário da pauta/);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("o arquivo é um calendário válido: tipo, download, CRLF, só plenário e link da proposta", async ({ request }) => {
    const r = await request.get("/calendario/pauta.ics");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/calendar");
    expect(r.headers()["content-disposition"]).toContain("attachment");
    const t = await r.text();
    expect(t.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(t.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const desdobrado = t.replace(/\r\n /g, "");
    // a demonstração move as datas para a semana corrente: conforme o dia da semana, o plenário já passou e o arquivo sai sem eventos (o conteúdo dos eventos é coberto pelo teste de unidade)
    expect(desdobrado).toContain("X-WR-CALDESC:");
    expect(desdobrado).toContain("não se atualiza sozinho");
    if (t.includes("BEGIN:VEVENT")) {
      expect(desdobrado).toMatch(/URL:https?:\/\/[^\r]+\/decisao\/[^\r]+\r\n/);
      expect(desdobrado).toContain("no plenário da");
    }
    expect(t.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  test("casa filtra de verdade (sem a Casa de fora, nem em aviso); casa inválida é 400, nunca um chute", async ({ request }) => {
    const s = await request.get("/calendario/pauta.ics?casa=senado");
    expect(s.status()).toBe(200);
    const ts = (await s.text()).replace(/\r\n /g, "");
    expect(ts).not.toContain("Câmara dos Deputados");
    expect(ts).not.toMatch(/da Senado|do Câmara/);
    const c = await request.get("/calendario/pauta.ics?casa=camara");
    expect(c.status()).toBe(200);
    expect((await c.text()).replace(/\r\n /g, "")).not.toContain("Senado Federal");
    expect((await request.get("/calendario/pauta.ics?casa=outra")).status()).toBe(400);
  });

  test("demonstração: o evento diz que é exemplo, o horário é o da sessão e há a data de leitura da Casa", async ({ request }) => {
    const t = (await (await request.get("/calendario/pauta.ics")).text()).replace(/\r\n /g, "");
    if (!t.includes("BEGIN:VEVENT")) return; // sem plenário futuro na demonstração deste dia da semana
    expect(t).toContain("SUMMARY:[Exemplo] ");
    expect(t).toContain("início da sessão do plenário");
    expect(t).toMatch(/lida em \d{2}\/\d{2}\/\d{4}/);
  });
});
