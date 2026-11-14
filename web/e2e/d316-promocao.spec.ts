import { expect, test } from "@playwright/test";

// D316: a Direção 2 é o desenho do site. A raiz é a tela "O que está rolando?", o prefixo /v2 leva ao mesmo lugar sem
// prefixo (307, com a consulta e a lista de escolhidos do protótipo), e o desenho anterior segue no ar onde a D2 não cobre.

test("a raiz é a Direção 2 e pode ser indexada", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator(".sv h1")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Perguntas" })).toBeVisible();
  await expect(page.locator("header.sticky")).toHaveCount(0);
  await expect(page).toHaveTitle(/Segue o Voto/);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.getByRole("main")).toHaveCount(1);
});

test("páginas pessoais seguem fora da busca", async ({ page }) => {
  for (const url of ["/acompanhando", "/ajustes"]) {
    await page.goto(url);
    await expect(page.locator('meta[name="robots"]'), url).toHaveAttribute("content", /noindex/);
  }
});

test("/v2 redireciona com 307 e preserva caminho e consulta", async ({ request }) => {
  for (const [de, para] of [
    ["/v2", "/"],
    ["/v2/pessoas?cargo=senador&uf=SP", "/pessoas?cargo=senador&uf=SP"],
    ["/v2/pessoa/helena-siqueira/votos", "/pessoa/helena-siqueira/votos"],
    ["/v2/nao-existe", "/nao-existe"],
  ]) {
    const res = await request.get(de, { maxRedirects: 0 });
    expect(res.status(), de).toBe(307);
    const loc = new URL(res.headers()["location"], "http://localhost");
    expect(loc.pathname + loc.search, de).toBe(para);
  }
});

test("/v2 não vira redirecionamento aberto", async ({ request, baseURL }) => {
  for (const de of ["/v2//evil.example", "/v2/%2F%2Fevil.example", "/v2/https:%2F%2Fevil.example"]) {
    const res = await request.get(de, { maxRedirects: 0 });
    if (res.status() < 300 || res.status() >= 400) continue; // sem redirecionamento, sem risco
    const loc = new URL(res.headers()["location"], baseURL);
    expect(loc.host, de).toBe(new URL(baseURL!).host);
  }
});

test("a lista de escolhidos do protótipo (cookie em /v2) chega à raiz", async ({ page, context }) => {
  await context.addCookies([{ name: "sv_sigo", value: "bruno-sampaio.helena-siqueira", domain: "localhost", path: "/v2" }]);
  await page.goto("/v2/acompanhando");
  await expect(page).toHaveURL(/\/acompanhando$/);
  const sigo = (await context.cookies()).filter((c) => c.name === "sv_sigo");
  expect(sigo, "um só cookie sv_sigo").toHaveLength(1);
  expect(sigo[0].path).toBe("/");
  await expect(page.locator(".sv-esc__pessoas .sv-esc__n")).toHaveText(["Bruno Sampaio", "Helena Siqueira"]);
});

test("desenho anterior: entrada em /no-seu-bolso, aviso com o caminho para a página nova, e canonical para a gêmea", async ({ page }) => {
  await page.goto("/no-seu-bolso");
  await expect(page.locator("header.sticky")).toBeVisible();
  await expect(page.locator(".sv")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ir para a página inicial nova" })).toHaveAttribute("href", "/");
  await page.goto("/p/helena-siqueira");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/pessoa\/helena-siqueira$/);
});

test("o rodapé da Direção 2 leva às páginas do desenho anterior", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Páginas do desenho anterior" }).click();
  await expect(page).toHaveURL(/\/no-seu-bolso$/);
});

test("lista na raiz e lista do protótipo: a rota /v2 junta as duas, sem repetir", async ({ page, context }) => {
  await context.addCookies([
    { name: "sv_sigo", value: "bruno-sampaio.helena-siqueira", domain: "localhost", path: "/v2" },
    { name: "sv_sigo", value: "helena-siqueira", domain: "localhost", path: "/" },
  ]);
  await page.goto("/v2/acompanhando");
  await expect(page).toHaveURL(/\/acompanhando$/);
  const sigo = (await context.cookies()).filter((c) => c.name === "sv_sigo");
  expect(sigo, "um só cookie sv_sigo").toHaveLength(1);
  expect(sigo[0].path).toBe("/");
  expect(sigo[0].value.split(".")).toEqual(["helena-siqueira", "bruno-sampaio"]);
  expect(sigo[0].httpOnly, "httpOnly").toBe(true);
});

// D317: a lista é gravada pelo servidor, por formulário. Funciona sem JavaScript e o cookie é httpOnly.
test("marcar e desmarcar em quem votei sem JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/pessoa/helena-siqueira");
  await page.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(page.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  const sigo = (await context.cookies()).filter((c) => c.name === "sv_sigo");
  expect(sigo).toHaveLength(1);
  // secure: false em http://localhost (segue o protocolo da requisição); em https é true
  expect(sigo[0]).toMatchObject({ value: "helena-siqueira", path: "/", httpOnly: true, sameSite: "Lax", secure: false });
  await page.getByRole("button", { name: "Você acompanha" }).click();
  await expect(page.getByRole("button", { name: /Votei nesta pessoa/ })).toHaveAttribute("aria-pressed", "false");
  expect((await context.cookies()).filter((c) => c.name === "sv_sigo")).toHaveLength(0);
  await context.close();
});

test("com a lista cheia, o botão de quem não está nela fica desligado e diz o limite", async ({ page, context }) => {
  const doze = Array.from({ length: 12 }, (_, i) => `pessoa-ficticia-${i}`).join(".");
  await context.addCookies([{ name: "sv_sigo", value: doze, domain: "localhost", path: "/" }]);
  await page.goto("/pessoa/helena-siqueira");
  await expect(page.getByRole("button", { name: /Votei nesta pessoa/ })).toBeDisabled();
  await expect(page.getByText("Você já acompanha 12 pessoas, o limite.")).toBeVisible();
});

test("a action recebe a intenção: outra aba com o estado antigo não desmarca", async ({ page, context }) => {
  await page.goto("/pessoa/helena-siqueira");
  const outra = await context.newPage();
  await outra.goto("/pessoa/helena-siqueira");
  await page.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(page.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  // a outra aba ainda mostra "Votei nesta pessoa": clicar ali pede para incluir, e a pessoa continua na lista
  await outra.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(outra.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  expect((await context.cookies()).find((c) => c.name === "sv_sigo")?.value).toBe("helena-siqueira");
});
