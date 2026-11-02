import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Toda spec: falha em erro de console, em resposta 5xx e em violação do axe nas telas visitadas.
type Fixtures = { axe: (page?: Page) => Promise<void> };

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const t = msg.text();
      if (/Failed to load resource.*(404|400|401)/.test(t)) return; // navegação para 404/400 esperada
      errors.push(t.slice(0, /ydrat/.test(t) ? 3000 : 300));
    });
    page.on("response", (res) => {
      if (res.status() >= 500) errors.push(`${res.status()} em ${res.url()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 300)}`));
    await use(page);
    // dev server emite avisos de HMR como erro em raras situações: só o que vem da página conta
    const real = errors.filter((e) => !e.includes("Fast Refresh") && !e.includes("DevTools"));
    expect(real, "erros de console / 5xx").toEqual([]);
  },
  axe: async ({ page }, use) => {
    await use(async (p = page) => {
      // Next 15 transmite o <title> depois do corpo em páginas dinâmicas: espera o documento completo
      await p.waitForLoadState("load");
      await expect(p).toHaveTitle(/\S/);
      const r = await new AxeBuilder({ page: p }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
    });
  },
});

export { expect };

export const CAMPINAS = "/representantes?cidade=3509502";
