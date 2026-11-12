import { expect, test } from "./fixtures";

// BUG-008: com o JavaScript já em cache e o HTML chegando devagar, a hidratação começa antes do fim do documento.
// Sem a espera de AguardaDocumento, o React vendorizado pelo Next 15.5 dava #418 em ~29% das cargas do perfil
// (n=100, HTML a 200 KB/s) e apagava o data-theme do <html>. Aqui: várias cargas seguidas, cada uma tem de sair
// sem pageerror e com o tema claro escolhido. Só Chromium (CDP).
// Contra o build sem a correção (main b095ba9), este teste falhou em 9 de 10 execuções (--repeat-each 10, 2 workers);
// com a correção, 0 falhas. A detecção é probabilística: uma regressão pode passar numa execução isolada.
const CARGAS = 30;

test.describe("BUG-008: perfil hidrata sem erro com o HTML chegando devagar", () => {
  test.use({ timezoneId: "Pacific/Pago_Pago", colorScheme: "dark" });
  // sem retry: uma regressão que falha só às vezes não pode virar "flaky" e passar no CI
  test.describe.configure({ retries: 0 });

  test("perfil /p/[slug] com rede lenta: zero pageerror e data-theme preservado", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "emulação de rede via CDP");
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await page.goto("/quem?cargo=deputado_federal");
    const href = (await page.locator('a[href^="/p/"]').first().getAttribute("href"))!;
    // aquece o cache: os chunks de JS vêm do disco e só o HTML passa pela rede lenta
    await page.goto(href, { waitUntil: "networkidle" });

    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message.slice(0, 200)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 50, downloadThroughput: 200 * 1024, uploadThroughput: 1024 * 1024 });

    for (let i = 0; i < CARGAS; i++) {
      await page.goto(href, { waitUntil: "load" });
      // hidratado: o seletor de tema já leu o localStorage
      await expect(page.getByRole("radio", { name: "Tema claro" }).first()).toBeChecked();
      await page.waitForLoadState("networkidle");
      expect(erros, `carga ${i + 1}: pageerror`).toEqual([]);
      await expect(page.locator("html"), `carga ${i + 1}: data-theme`).toHaveAttribute("data-theme", "light");
    }
  });
});
