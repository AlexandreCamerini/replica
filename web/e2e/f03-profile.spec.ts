import type { Page as PWPage } from "@playwright/test";
import { expect, test } from "./fixtures";

async function federalDeputy(page: PWPage) {
  await page.goto("/quem?cargo=deputado_federal");
  const first = page.locator('a[href^="/p/"]').first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(href!));
  return href!;
}

test.describe("F03 ler o crachá a fundo", () => {
  test("F03-H1 ano, filtros, links oficiais e fontes", async ({ page, axe }) => {
    test.slow(); // cenário longo: 6 navegações
    await federalDeputy(page);
    await expect(page.getByRole("heading", { name: /Propostas/ })).toBeVisible();
    // ano
    const years = page.getByRole("navigation", { name: "Período dos números" }).getByRole("link");
    const second = years.nth(1);
    const year = (await second.textContent())!.trim();
    await second.click();
    await expect(page).toHaveURL(new RegExp(`ano=${year}`));
    await expect(page.getByText(new RegExp(`propostas em ${year}`))).toBeVisible();
    // filtro de tema
    const tema = page.locator("#propostas").getByLabel("Tema");
    await tema.selectOption("saude");
    await page.getByRole("button", { name: "Filtrar" }).first().click();
    await expect(page).toHaveURL(/tema=saude/);
    await page.waitForLoadState("networkidle"); // formulários GET: esperar a página nova hidratar antes de mexer nos campos
    const items = page.locator("#propostas ol li");
    if ((await items.count()) > 0) await expect(items.first().getByRole("link", { name: "Saúde" })).toBeVisible();
    else await expect(page.locator("#propostas")).toContainText(/Nenhuma proposta/);
    // links oficiais abrem em nova aba com rel seguro
    const ext = page.locator('#propostas a[target="_blank"]').first();
    if (await ext.count()) await expect(ext).toHaveAttribute("rel", /noopener/);
    // voto "Não": só badges "Não"
    const voto = page.locator('#votos select[name="voto"]');
    await voto.selectOption("nao");
    await expect(voto).toHaveValue("nao");
    await page.locator("#votos").getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/voto=nao/);
    await expect(page).toHaveURL(/tema=saude/); // F03-E3: o filtro de propostas sobreviveu
    const badges = page.locator("#votos ol li").locator("text=/^(Sim|Não|Abstenção|Obstrução|Art\\. 17|Não votou)$/");
    const n = await badges.count();
    for (let i = 0; i < Math.min(n, 10); i++) await expect(badges.nth(i)).toHaveText("Não");
    // seções R2: presentes, com estado vazio explicado quando a fonte não tem registro
    for (const h of [/Leis que vieram de propostas/, /^Comissões/, /^Discursos/, /Contato oficial/, /Quanto custou/, /Ainda não está aqui/])
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    await expect(page.locator("#custo")).toContainText(/aproximado/);
    // fontes em todo bloco
    for (const id of ["propostas", "votos", "gastos", "patrimonio", "eleicoes", "leis", "comissoes", "discursos", "contato"]) await expect(page.locator(`#${id}`).getByText(/^Fonte:/)).toBeVisible();
    await axe();
  });

  test("F03-H2 ver mais cresce a lista e guarda na URL", async ({ page }) => {
    await federalDeputy(page);
    const items = page.locator("#propostas ol li");
    const before = await items.count();
    const more = page.locator("#propostas").getByRole("link", { name: /^Ver mais/ });
    test.skip(before === 0 || !(await more.count()), "pessoa sem propostas suficientes");
    await more.click();
    await expect(page).toHaveURL(/np=40/);
    expect(await items.count()).toBeGreaterThan(before);
  });

  test("F03-E1 vereador: — com motivo, nunca 0; teto do salário", async ({ page, axe }) => {
    await page.goto("/representantes?cidade=3509502");
    await page.locator("#vereadores a[href^='/p/']").first().click();
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByText(/dados? ainda não est/)).toBeVisible();
    const tiles = page.locator("section[aria-labelledby='numeros-h'] > div > div");
    const texts = await tiles.allInnerTexts();
    for (const t of texts) {
      if (/propostas|votos em plenário|gastos do gabinete|presença/.test(t)) expect(t, t).not.toMatch(/^0\n/);
    }
    // demo traz o teto constitucional; no dado real o salário municipal ainda não foi carregado e aparece "—"
    const salaryTile = page.locator("section[aria-labelledby='numeros-h'] > div > div").first();
    await expect(salaryTile).toContainText(/teto do salário|salário por mês/);
    const tileText = await salaryTile.innerText();
    if (tileText.includes("teto do salário")) await expect(salaryTile).toContainText("até");
    else expect(tileText).toMatch(/^—/);
    await expect(page.getByRole("heading", { name: /Propostas/ })).toHaveCount(0);
    await axe();
  });

  test("F03-E4 tema escuro sem violações", async ({ page, axe }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await federalDeputy(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await axe();
  });

  test("F03-E5 ano sem mandato cai para carreira", async ({ page }) => {
    const href = await federalDeputy(page);
    await page.goto(`${href}?ano=1999`);
    await expect(page.getByText(/propostas (na carreira|desde \d{4})/)).toBeVisible(); // D02: a carreira diz a janela carregada
  });

  test("F03-E2 nome de 60 caracteres sem overflow @mobile", async ({ page }) => {
    const r = await page.goto("/p/maria-aparecida-dos-santos-albuquerque-de-vasconcelos-filha");
    test.skip(r?.status() === 404, "nome longo só existe na demonstração");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Vasconcelos Filha");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - 390)).toBeLessThanOrEqual(0);
  });

  test("F03-N1 APIs do crachá validam parâmetros", async ({ page, request }) => {
    const href = await federalDeputy(page);
    const slug = href.split("/").pop()!;
    for (const [u, code] of [
      [`/api/people/${slug}/votes?year=abc`, 400],
      [`/api/people/${slug}/votes?cursor=-1`, 400],
      [`/api/people/${slug}/votes?value=x`, 400],
      [`/api/people/${slug}/proposals?limit=999`, 400],
      [`/api/people/${slug}/proposals?type=lei&role=autor`, 200],
      [`/api/people/${slug}/expenses?year=2025`, 200],
      [`/api/people/nao-existe/votes`, 404],
    ] as const) {
      const r = await request.get(u);
      expect(r.status(), u).toBe(code);
      if (code === 400) expect((await r.json()).errors.length).toBeGreaterThan(0);
    }
  });
});
