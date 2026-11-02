import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Precisa do Postgres e do login local (AUTH_PROVIDER=dev): rode com E2E_PG=1 E2E_BASE_URL=http://localhost:3101
test.skip(!process.env.E2E_PG, "fluxos de conta exigem o banco real e o login local");

const MAIL = join(__dirname, "..", "..", ".local", "mail");
const PERSON = process.env.E2E_PERSON ?? "adriana-ventura";

async function codeFor(email: string) {
  await expect
    .poll(() => readdirSync(MAIL).filter((f) => f.includes(email.replace(/[^a-z0-9@._-]/gi, "_"))).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const file = readdirSync(MAIL).filter((f) => f.includes(email.replace(/[^a-z0-9@._-]/gi, "_"))).sort().pop()!;
  return readFileSync(join(MAIL, file), "utf8").match(/código é (\d{6})/)![1];
}

async function login(page: Page, email: string, start = "/entrar") {
  if (!page.url().includes("/entrar")) await page.goto(start);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Mandar código" }).click();
  await expect(page).toHaveURL(/etapa=codigo/);
  await expect(page.getByText(`Mandamos um código para ${email}`)).toBeVisible();
  expect(page.url()).not.toContain(encodeURIComponent(email)); // e-mail nunca na URL
  await page.getByLabel("Código de 6 números").fill(await codeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("F05 monitorar", () => {
  test("F05-H1 acompanhar pelo crachá, feed, preferências, deixar de acompanhar, apagar conta", async ({ page, axe }) => {
    const email = `teste.${Date.now()}@exemplo.test`;
    await page.goto(`/p/${PERSON}`);
    await page.getByRole("link", { name: "Acompanhar" }).click();
    await expect(page).toHaveURL(new RegExp(`/entrar\\?volta=.*&seguir=${PERSON}`));
    await axe();
    // código errado primeiro
    await page.getByLabel("E-mail", { exact: true }).fill(email);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Mandar código" }).click();
    await expect(page).toHaveURL(/etapa=codigo/);
    await page.getByLabel("Código de 6 números").fill("000000");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator("form [role=alert]")).toContainText(/Código errado|venceu/);
    await page.getByLabel("Código de 6 números").fill(await codeFor(email));
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${PERSON}$`));
    await expect(page.getByRole("button", { name: /Deixar de acompanhar/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: "Acompanhando" })).toBeVisible();

    await page.goto("/acompanhando");
    await expect(page.getByRole("heading", { name: /Quem eu acompanho/ })).toContainText("1 de 200");
    await expect(page.locator('[aria-labelledby="novidades-h"] li').first()).toBeVisible();
    await axe();
    await page.getByLabel("Todo dia").check();
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Todo dia")).toBeChecked();

    await page.goto(`/p/${PERSON}`);
    await page.getByRole("button", { name: /Deixar de acompanhar/ }).click();
    await expect(page.getByRole("button", { name: /^Acompanhar/ })).toHaveAttribute("aria-pressed", "false");

    await page.goto("/acompanhando");
    await page.getByLabel("Digite APAGAR para confirmar").fill("errado");
    await page.getByRole("button", { name: "Apagar minha conta" }).click();
    await expect(page.locator("form [role=alert]").filter({ hasText: "Digite APAGAR" })).toBeVisible();
    await page.getByLabel("Digite APAGAR para confirmar").fill("APAGAR");
    await page.getByRole("button", { name: "Apagar minha conta" }).click();
    await expect(page).toHaveURL(/conta=apagada/);
    await page.goto("/acompanhando");
    await expect(page).toHaveURL(/\/entrar\?volta=(%2F|\/)acompanhando/);
  });

  test("F05-E2 segunda pessoa não vê os dados da primeira; volta maliciosa vira /", async ({ browser }) => {
    const a = await browser.newPage();
    const ea = `a.${Date.now()}@exemplo.test`;
    await a.goto(`/entrar?volta=${encodeURIComponent(`/p/${PERSON}`)}&seguir=${PERSON}`);
    await login(a, ea);
    await expect(a).toHaveURL(new RegExp(`/p/${PERSON}$`));

    const b = await browser.newPage();
    const eb = `b.${Date.now()}@exemplo.test`;
    await b.goto(`/entrar?volta=${encodeURIComponent("//evil.example/x")}`);
    await login(b, eb);
    await expect(b).toHaveURL(/^http:\/\/localhost:\d+\/$/);
    await b.goto("/acompanhando");
    await expect(b.getByText("Você ainda não acompanha ninguém.")).toBeVisible();
    await expect(b.getByText(ea)).toHaveCount(0);
    await a.close();
    await b.close();
  });

  test("F05-N1 limite de envios e e-mail inválido", async ({ page }) => {
    const email = `limite.${Date.now()}@exemplo.test`;
    await page.goto("/entrar");
    await page.getByLabel("E-mail", { exact: true }).fill("sem-arroba");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Mandar código" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("Confira o e-mail");
    for (let i = 0; i < 4; i++) {
      await page.goto("/entrar");
      await page.getByLabel("E-mail", { exact: true }).fill(email);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Mandar código" }).click();
      if (i < 3) await expect(page).toHaveURL(/etapa=codigo/);
    }
    await expect(page.locator("form [role=alert]")).toContainText("Muitos códigos");
  });
});

test.describe("F08 sugestão e erro", () => {
  test("F08-H1 reportar erro pelo crachá chega com a pessoa; envio válido agradece", async ({ page, axe }) => {
    await page.goto(`/p/${PERSON}`);
    await page.getByRole("link", { name: "Reportar erro" }).click();
    await expect(page).toHaveURL(new RegExp(`/sugestoes\\?tipo=erro&p=${PERSON}`));
    await expect(page.getByText("Sobre:")).toBeVisible();
    await expect(page.getByLabel("Algo está errado")).toBeChecked();
    await axe();
    await page.getByLabel("Mensagem").fill("ok");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("pelo menos 5");
    await page.getByLabel("Mensagem").fill("O valor do patrimônio de 2022 parece trocado com o de 2026. Fonte: divulgacandcontas.tse.jus.br");
    await page.getByLabel("Seu nome").fill("Teste Automatizado");
    await page.getByLabel("E-mail para resposta").fill("teste@exemplo.test");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Recebemos. Obrigado.")).toBeVisible();
  });
});
