import { expect, test } from "@playwright/test";

// D331: na escolha de político, o partido é sempre um dos filtros e a lista só aparece depois que o eleitor filtra.
// Regra do dono (16/11/2026), depois de abandonar a página na primeira escolha. Fonte de dados: demonstração.

const SP = { name: "sv_uf", value: "SP", domain: "localhost", path: "/" };
const TELAS = [
  { nome: "passo 2 do começo", url: "/comecar?passo=2", partido: "#cm-partido", pede: "#cm-pede" },
  { nome: "/pessoas", url: "/pessoas", partido: "#pp-partido", pede: "#pp-pede" },
] as const;

for (const t of TELAS)
  test.describe(t.nome, () => {
    test("abre sem lista: o total, o pedido do filtro e o partido como primeiro campo", async ({ page, context }) => {
      for (const comEstado of [false, true]) {
        await context.clearCookies();
        if (comEstado) await context.addCookies([SP]);
        await page.goto(t.url);
        await expect(page.locator(".sv-pp > li"), `com estado: ${comEstado}`).toHaveCount(0);
        await expect(page.locator(".sv-pp__f button")).toHaveCount(0);
        await expect(page.locator(t.pede)).toBeVisible();
        await expect(page.locator(".sv-main")).toContainText(comEstado ? /[\d.]+ pessoas no cargo hoje em São Paulo\./ : /[\d.]+ pessoas no cargo hoje no país\./);
        await expect(page.getByRole("link", { name: /Próximas/ })).toHaveCount(0);
        // o partido é o primeiro campo do filtro, com as siglas em ordem alfabética e a opção de todos
        await expect(page.locator(".sv-filtro label").first()).toHaveText("Partido");
        const opcoes = await page.locator(`${t.partido} option`).allInnerTexts();
        expect(opcoes[0]).toBe("Todos os partidos");
        const siglas = opcoes.slice(1).map((o) => o.split(" ")[0]);
        expect(siglas.length).toBeGreaterThan(1);
        expect(siglas).toEqual([...siglas].sort((a, b) => a.localeCompare(b, "pt-BR")));
      }
    });

    test("escolher o partido mostra só as pessoas dele, em ordem alfabética, com o botão de marcar", async ({ page, context }) => {
      await context.addCookies([SP]);
      await page.goto(t.url);
      await page.locator(t.partido).selectOption("aur");
      await page.getByRole("button", { name: "Procurar" }).click();
      await expect(page).toHaveURL(/partido=aur/);
      const linhas = page.locator(".sv-pp > li");
      expect(await linhas.count()).toBeGreaterThan(0);
      for (const c of await page.locator(".sv-pp__c").allInnerTexts()) expect(c).toMatch(/· AUR$/);
      const nomes = await page.locator(".sv-pp > li > a").allInnerTexts();
      expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
      await expect(page.locator(".sv-pp > li .sv-follow")).toHaveCount(await linhas.count());
      await expect(page.locator(t.pede)).toHaveCount(0);
      // o campo guarda o partido escolhido, e "Limpar os filtros" volta à tela sem lista
      await expect(page.locator(t.partido)).toHaveValue("aur");
      await page.getByRole("link", { name: "Limpar os filtros" }).click();
      await expect(page.locator(".sv-pp > li")).toHaveCount(0);
    });

    test("cargo ou nome também abrem a lista; partido e cargo juntos estreitam", async ({ page, context }) => {
      await context.addCookies([SP]);
      const base = t.url.includes("?") ? `${t.url}&` : `${t.url}?`;
      await page.goto(`${base}cargo=vereador`);
      const soCargo = await page.locator(".sv-pp > li").count();
      expect(soCargo).toBeGreaterThan(0);
      await page.goto(`${base}cargo=vereador&partido=aur`);
      const juntos = await page.locator(".sv-pp > li").count();
      expect(juntos).toBeGreaterThan(0);
      expect(juntos).toBeLessThan(soCargo);
      for (const c of await page.locator(".sv-pp__c").allInnerTexts()) expect(c).toMatch(/^Vereador.*· AUR$/);
      await page.goto(`${base}nome=Helena`);
      expect(await page.locator(".sv-pp > li").count()).toBeGreaterThan(0);
    });

    test("partido fora da lista, repetido ou fora do padrão é ignorado: sem lista e sem erro", async ({ page, context }) => {
      await context.addCookies([SP]);
      const base = t.url.includes("?") ? `${t.url}&` : `${t.url}?`;
      for (const q of ["partido=zzz", "partido=aur&partido=bri", "partido=%27%3Bdrop", `partido=${"a".repeat(80)}`]) {
        const res = await page.goto(`${base}${q}`);
        expect(res?.status(), q).toBe(200);
        await expect(page.locator(".sv-pp > li"), q).toHaveCount(0);
        await expect(page.locator(t.pede), q).toBeVisible();
        await expect(page.locator(t.partido), q).toHaveValue("");
        // pedido de forma válida que não está na lista: a tela diz que não aplicou, em vez de sumir com o filtro em silêncio
        const aviso = page.getByText("O partido pedido no endereço não está na lista de partidos de hoje.");
        if (q === "partido=zzz") await expect(aviso, q).toBeVisible();
        else await expect(aviso, q).toHaveCount(0);
      }
    });
  });

test("a paginação leva o partido junto", async ({ page }) => {
  // o partido AUR no país inteiro tem mais de 60 pessoas na demonstração
  await page.goto("/pessoas?partido=aur&uf=");
  const proximas = page.getByRole("link", { name: /Próximas 60/ });
  await expect(proximas).toHaveAttribute("href", /partido=aur/);
  await proximas.click();
  await expect(page).toHaveURL(/partido=aur.*pagina=\d+|pagina=\d+.*partido=aur/);
  for (const c of await page.locator(".sv-pp__c").allInnerTexts()) expect(c).toMatch(/· AUR$/);
});

test("sem JavaScript: no passo 2, escolher o partido, ver a lista e marcar", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR" });
  await context.addCookies([SP]);
  const page = await context.newPage();
  await page.goto("/comecar?passo=2");
  await expect(page.locator(".sv-pp > li")).toHaveCount(0);
  await page.locator("#cm-partido").selectOption("bri");
  await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Procurar" }).click()]);
  await expect(page).toHaveURL(/\/comecar\?passo=2&partido=bri/);
  const primeira = page.locator(".sv-pp > li").first();
  const slug = (await primeira.locator("a").first().getAttribute("href"))!.replace("/pessoa/", "");
  await Promise.all([page.waitForLoadState("load"), primeira.getByRole("button").click()]);
  // continua na mesma lista filtrada, com a pessoa marcada
  await expect(page).toHaveURL(/partido=bri/);
  await expect(page.locator(".sv-pp > li").first().getByRole("button")).toHaveAttribute("aria-pressed", "true");
  const c = (await context.cookies()).find((x) => x.name === "sv_sigo");
  expect(c?.value).toBe(slug);
  expect(c?.httpOnly).toBe(true);
  await context.close();
});

test("a lista de um grupo vindo de um lugar continua aberta (o lugar já é a escolha do eleitor)", async ({ page }) => {
  await page.goto("/pessoas?cidade=3509502&grupo=vereadores");
  expect(await page.locator(".sv-pp > li").count()).toBeGreaterThan(1);
});

test("os caminhos da home para a escolha não prometem uma lista que espera o filtro", async ({ page, context }) => {
  await context.addCookies([SP]);
  await page.goto("/");
  // quem não marcou ninguém: o texto pede o partido (ou cargo, ou nome) antes de marcar
  await expect(page.locator(".sv-vazio")).toContainText("escolha o partido (ou o cargo, ou procure pelo nome)");
  await expect(page.getByRole("link", { name: "Ver todas, de A a Z" })).toHaveCount(0);
  const procurar = page.getByRole("link", { name: "Procurar por partido ou cargo" });
  await expect(procurar).toHaveAttribute("href", "/pessoas?uf=SP");
  await procurar.click();
  await expect(page.locator("#pp-pede")).toBeVisible();
  await expect(page.locator(".sv-filtro label").first()).toHaveText("Partido");
});
