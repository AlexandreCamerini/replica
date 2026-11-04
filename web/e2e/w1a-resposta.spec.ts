import postgres from "postgres";
import { CAMPINAS, expect, test } from "./fixtures";

const ADMIN = process.env.E2E_ADMIN_DB_URL ?? "postgres://postgres@localhost:54329/civico";

test.describe("W1a · direito de resposta", () => {
  test("RESP-H1 link no fim do crachá leva à S25 com a pessoa e aponta a política", async ({ page, axe }) => {
    await page.goto(CAMPINAS);
    const href = await page.locator("#vereadores a[href^='/p/']").first().getAttribute("href");
    const slug = href!.split("/").pop()!;
    await page.goto(href!);
    const footer = page.locator("footer[aria-labelledby=resposta-h]");
    const link = footer.getByRole("link", { name: "Direito de resposta", exact: true });
    await expect(link).toHaveAttribute("href", `/sugestoes?tipo=resposta&p=${slug}`);
    await expect(footer.locator('a[href="/sobre#s-resposta"]')).toHaveCount(1);
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direito de resposta");
    await expect(page.getByText("Sobre:")).toBeVisible();
    await expect(page.getByLabel("Direito de resposta", { exact: true })).toBeChecked();
    await axe();
  });

  test("RESP-E1 sem pessoa na URL, o formulário explica e não oferece o tipo", async ({ page }) => {
    await page.goto("/sugestoes?tipo=resposta");
    await expect(page.getByLabel("Direito de resposta", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/é sobre uma pessoa/)).toBeVisible();
    await expect(page.getByLabel("Algo está errado")).toBeChecked();
  });

  test("RESP-H2 envio guarda tipo, pessoa e data", async ({ page }) => {
    test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");
    await page.goto(CAMPINAS);
    const href = await page.locator("#vereadores a[href^='/p/']").first().getAttribute("href");
    const slug = href!.split("/").pop()!;
    const marker = `Resposta de teste ${Date.now()}`;
    const before = Date.now() - 5000;
    await page.goto(`/sugestoes?tipo=resposta&p=${slug}`);
    await page.getByLabel("Mensagem").fill(`${marker}: o valor exibido contradiz a fonte oficial.`);
    await page.getByLabel("Seu nome").fill("W1a Teste");
    await page.getByLabel("E-mail para resposta").fill("w1a@exemplo.test");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Recebemos. Obrigado.")).toBeVisible();
    const sql = postgres(ADMIN, { max: 1 });
    try {
      const rows = await sql`select s.kind, s.created_at, p.slug from suggestions s join people p on p.id = s.person_id where s.body like ${marker + "%"}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("direito_resposta");
      expect(rows[0].slug).toBe(slug);
      expect(rows[0].created_at.getTime()).toBeGreaterThan(before);
    } finally {
      await sql`delete from suggestions where name = 'W1a Teste'`; // não deixa lixo e devolve o limite de envios por hora
      await sql.end();
    }
  });
});
