import { expect, test } from "@playwright/test";

// Protótipo "Segue o Voto" em /v2: critérios de aceite do redesign aprovado em 10/11/2026.
// As páginas atuais não podem mudar: o shell antigo some só sob /v2.

const PAGES = [
  "/v2",
  "/v2?cidade=3509502",
  "/v2/decisoes",
  "/v2/decisoes?aba=leis",
  "/v2/decisao/camara-pl-79-2020",
  "/v2/votacoes",
  "/v2/votacao/camara-v2025-0?uf=SP",
  "/v2/pessoas",
  "/v2/pessoas?cidade=3509502&grupo=vereadores",
  "/v2/como-funciona",
  "/v2/temas",
  "/v2/acompanhando",
  "/v2/decisao/camara-pl-4567-2024",
];

// Mesmas palavras vetadas do teste de neutralidade das páginas atuais.
const FORBIDDEN = /\b(ranking|melhor|pior|recomend\w*|nota (final|geral)|pontuação)\b/i;

for (const width of [390, 768, 1280]) {
  test(`v2 a ${width}px: abre, sem rolagem horizontal, com o shell novo`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const url of PAGES) {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(200);
      await expect(page.locator(".sv h1").first(), url).toBeVisible();
      // o cabeçalho antigo não aparece no protótipo
      await expect(page.locator("header.sticky"), url).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} tem rolagem horizontal`).toBeLessThanOrEqual(0);
      const text = await page.locator(".sv-main").innerText();
      expect(text, url).not.toMatch(FORBIDDEN);
    }
  });
}

test("v2: escolher a cidade mostra quem decide e leva às pessoas", async ({ page }) => {
  await page.goto("/v2?q=campinas");
  await page.getByRole("link", { name: /Campinas, SP/ }).first().click();
  await expect(page).toHaveURL(/cidade=3509502/);
  await expect(page.getByText("Na cidade")).toBeVisible();
  await page.getByRole("link", { name: /Vereadores/ }).click();
  await expect(page.locator(".sv h1")).toHaveText("Vereadores");
  // lista de pessoas em ordem alfabética
  const names = await page.locator(".sv-item > div").evaluateAll((els) => els.map((e) => (e.firstChild?.textContent ?? "").trim()));
  expect(names.length).toBeGreaterThan(1);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
});

test("v2: voto é forma mais palavra, nunca cor", async ({ page }) => {
  await page.goto("/v2/votacao/camara-v2025-0?uf=SP");
  const marks = page.locator(".sv-voterow .sv-vote");
  await expect(marks.first()).toBeVisible();
  // toda marca vem com a palavra ao lado
  const words = await marks.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(words.every((w) => w.length > 0)).toBe(true);
  // a tinta de Sim e de Não é a mesma: só a forma muda
  const inks = await page.locator(".sv-voterow .sv-mark").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).borderTopColor))]);
  expect(inks).toHaveLength(1);
});

test("v2: menu abre e fecha em tela estreita", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/v2");
  const btn = page.getByRole("button", { name: "Menu" });
  await btn.click();
  await expect(page.locator("#sv-menu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar" })).toHaveAttribute("aria-expanded", "true");
  await page.locator("#sv-menu").getByRole("link", { name: /Decisões/ }).click();
  await expect(page).toHaveURL(/\/v2\/decisoes/);
  await expect(page.locator("#sv-menu")).toBeHidden();
});

test("v2: página inexistente responde 404 dentro do shell novo", async ({ page }) => {
  const res = await page.goto("/v2/decisao/nao-existe");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".sv h1")).toHaveText("Não consta");
});

test("páginas atuais continuam com o shell atual", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header.sticky")).toBeVisible();
  await expect(page.locator(".sv")).toHaveCount(0);
});

test("v2: marcar em quem votei põe a pessoa em destaque na entrada", async ({ page }) => {
  await page.goto("/v2/pessoas?cargo=senador&uf=SP");
  const first = page.locator(".sv-item").first();
  const name = ((await first.locator("div").first().evaluate((e) => e.firstChild?.textContent)) ?? "").trim();
  await first.click();
  await page.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(page.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/v2");
  await expect(page.getByRole("heading", { name: "O que fez quem você votou" })).toBeVisible();
  await expect(page.locator(".sv-band").getByRole("link", { name })).toBeVisible();
  await page.goto("/v2/acompanhando");
  await expect(page.locator(".sv-main").getByRole("link", { name })).toBeVisible();
});

test("v2: a decisão explica o impacto em linguagem simples, com o tipo de cada afirmação", async ({ page }) => {
  await page.goto("/v2/decisao/camara-pl-4567-2024");
  const box = page.locator(".sv-impact");
  await expect(box.getByRole("heading", { name: "Como isso mexe com a sua vida" })).toBeVisible();
  await expect(box.locator(".sv-q")).toHaveCount(4);
  // toda resposta diz que tipo de afirmação é
  await expect(box.locator(".sv-q .sv-kind")).toHaveCount(4);
  // na demonstração, o exemplo vem marcado como exemplo
  await expect(page.getByText("Exemplo ilustrativo: redação de demonstração")).toBeVisible();
  await box.getByText("Ver o trecho do texto oficial").first().click();
  await expect(box.locator(".sv-quote").first()).toBeVisible();
  // a página diz como foi verificada e não promete revisão humana
  await box.getByText("Como esta página é conferida").click();
  await expect(box.locator(".sv-checks li")).toHaveCount(5);
  await expect(box.getByText("Nenhuma pessoa lê esta explicação antes de publicarmos")).toBeVisible();
  await expect(page.locator(".sv-main")).not.toContainText(/conferid[ao] por uma pessoa|revisad[ao] por pessoa/i);
});

test("v2: a visão por temas leva às votações de cada tema", async ({ page }) => {
  await page.goto("/v2/temas");
  await expect(page.locator(".sv h1")).toHaveText("Os temas que o Congresso está decidindo");
  const tema = page.locator('a.sv-item[href^="/v2/tema/"]').first();
  await tema.click();
  await expect(page).toHaveURL(/\/v2\/tema\//);
  await expect(page.locator('a.sv-item[href^="/v2/votacao/"]').first()).toBeVisible();
});
