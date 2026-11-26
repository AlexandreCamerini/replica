import { expect, test } from "@playwright/test";

// F4 do roteiro do eleitor (eixo A, pergunta 5): o voto aparece ao lado da orientação oficial da bancada. Fato da fonte, sem soma,
// percentual, "alinhamento" nem rótulo de divergência (D82, D342). Fonte de dados: demonstração (a mesma orientação que gera o voto,
// com parte das votações liberadas).

const SLUG = "helena-siqueira";
// a demonstração só tem orientação de partido; as frases de bloco e a lacuna estão no teste unitário (sv-orientacao.test.ts)
const FRASE = /^(A bancada do \S+ orientou (Sim|Não|Abstenção|Obstrução)\.|A bancada do \S+ foi liberada\.|Orientação da bancada: não identificada para este partido nesta votação\.)$/;
const PROIBIDO = /contra o partido|divergi|rebelde|alinha|fiel|desobed|ranking|média|\d\s*%/i;

test.describe("F4 · orientação da bancada ao lado do voto", () => {
  test("cada votação da lista da pessoa traz a orientação (ou a lacuna nomeada), em frase fechada", async ({ page }) => {
    await page.goto(`/pessoa/${SLUG}/votos`);
    const itens = page.locator(".sv-votos > li");
    expect(await itens.count(), "há votos de demonstração").toBeGreaterThan(0);
    const orientacoes = page.locator(".sv-votos [data-orientacao]");
    expect(await orientacoes.count(), "uma orientação por votação").toBe(await itens.count());
    for (const t of await orientacoes.allInnerTexts()) {
      expect(t.trim(), "frase da orientação").toMatch(FRASE);
      expect(t, "sem comparação nem rótulo de divergência").not.toMatch(PROIBIDO);
    }
  });

  test("a orientação 'liberado' vira 'foi liberada' e nunca uma divergência", async ({ page }) => {
    await page.goto(`/pessoa/${SLUG}/votos`);
    const liberadas = page.locator('.sv-votos [data-orientacao="liberado"]');
    // a demonstração libera parte das votações de cada partido: com 50 votos há linhas liberadas (dado fixo, não depende da data)
    expect(await liberadas.count(), "há votação liberada na demonstração").toBeGreaterThan(0);
    for (const t of await liberadas.allInnerTexts()) expect(t.trim()).toMatch(/^A bancada do \S+ foi liberada\.$/);
  });

  test("a home mostra a orientação junto de cada voto recente das pessoas marcadas", async ({ page, context }) => {
    await context.addCookies([{ name: "sv_sigo", value: SLUG, domain: "localhost", path: "/" }]);
    await page.goto("/");
    const ori = page.locator("#inicio-escolhidos, [aria-labelledby='inicio-escolhidos']").locator("[data-orientacao]");
    expect(await ori.count(), "pelo menos um voto recente com orientação").toBeGreaterThan(0);
    for (const t of await ori.allInnerTexts()) expect(t.trim()).toMatch(FRASE);
  });

  test("o texto da orientação tem 13px ou mais e cor de texto (não de alerta)", async ({ page }) => {
    await page.goto(`/pessoa/${SLUG}/votos`);
    const o = page.locator(".sv-votos__o").first();
    const css = await o.evaluate((el) => ({ px: parseFloat(getComputedStyle(el).fontSize), cor: getComputedStyle(el).color }));
    expect(css.px).toBeGreaterThanOrEqual(13);
    expect(css.cor, "tinta do site").toBe("rgb(20, 20, 20)");
  });
});
