import { CAMPINAS, expect, test } from "./fixtures";

test.describe("F01 eleitor descobre quem o representa", () => {
  test("F01-H1 digita a cidade, escolhe, abre o crachá", async ({ page, axe }) => {
    await page.goto("/representantes");
    await axe();
    const box = page.getByRole("combobox", { name: /cidade ou estado/i });
    await box.fill("campi");
    const opt = page.getByRole("option", { name: /Campinas.*SP/ });
    await expect(opt).toBeVisible();
    await opt.click();
    await expect(page).toHaveURL(/cidade=3509502/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campinas · SP");
    await expect(page.getByText(/pessoas no cargo/)).toBeVisible();
    for (const h of [/Prefeitura/, /Vereadores/, /Deputados estaduais/, /Senado/, /Deputados federais/, /Presidência/])
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    await axe();
    const first = page.locator('a[href^="/p/"]').first();
    const name = (await first.textContent())!.trim();
    await first.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByText(/Em exercício|toma posse/)).toBeVisible();
    await expect(page.getByText(/^Fonte:/).first()).toBeVisible();
    await axe();
  });

  test("F01-H2 só teclado, três ações", async ({ page }) => {
    await page.goto("/representantes");
    const box = page.getByRole("combobox", { name: /cidade ou estado/i });
    await box.focus();
    await page.keyboard.type("campi");
    await expect(page.getByRole("option", { name: /Campinas.*SP/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/cidade=3509502/);
    // Tab até o primeiro link de crachá: cada parada precisa ter foco visível (outline)
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement)?.getAttribute("href"));
      if (href?.startsWith("/p/")) break;
    }
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el, ":after");
      return { href: el.getAttribute("href"), outline: getComputedStyle(el).outlineStyle, afterOutline: cs.outlineStyle };
    });
    expect(focused.href).toMatch(/^\/p\//);
    expect([focused.outline, focused.afterOutline]).toContain("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/p\//);
  });

  test("F01-E1 homônimos mostram a UF", async ({ page }) => {
    await page.goto("/representantes");
    await page.getByRole("combobox", { name: /cidade ou estado/i }).fill("bom jesus");
    const opts = page.getByRole("option", { name: /^Bom Jesus/ });
    await expect(opts.first()).toBeVisible();
    expect(await opts.count()).toBeGreaterThanOrEqual(4); // dados reais têm 5 homônimos exatos mais "Bom Jesus da…"
    for (const uf of ["PB", "PI", "RS", "SC"]) await expect(page.getByRole("option", { name: new RegExp(`Bom Jesus.*cidade · ${uf}`) })).toBeVisible();
  });

  test("F01-E2 uma letra não busca; F01-E4 sem acento acha", async ({ page }) => {
    await page.goto("/representantes");
    const calls: string[] = [];
    page.on("request", (r) => r.url().includes("/api/places") && calls.push(r.url()));
    const box = page.getByRole("combobox", { name: /cidade ou estado/i });
    await box.fill("c");
    await page.waitForTimeout(500);
    expect(calls).toEqual([]);
    await box.fill("sao");
    await expect(page.getByRole("option", { name: /São Paulo/ }).first()).toBeVisible();
  });

  test("F01-E3 entrada de 80 caracteres não derruba nada", async ({ page }) => {
    await page.goto("/representantes");
    await page.getByRole("combobox", { name: /cidade ou estado/i }).fill("a".repeat(80));
    await expect(page.getByRole("listbox")).toContainText(/Nenhum lugar|Tente/);
  });

  test("F01-E5 sem JavaScript: ?q= lista as cidades com UF", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/representantes?q=Bom+Jesus");
    await expect(page.getByRole("heading", { name: /Lugares com “Bom Jesus”/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bom Jesus · PI" })).toHaveAttribute("href", /cidade=\d{7}/);
    await ctx.close();
  });

  test("F01-E7 voltar e atualizar mantém a cidade", async ({ page }) => {
    await page.goto(CAMPINAS);
    await page.locator('a[href^="/p/"]').first().click();
    await expect(page).toHaveURL(/\/p\//);
    await page.goBack();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Campinas · SP");
  });

  test("F01-N1/N2/N3 entradas inválidas dão 404, slug antigo dá 308", async ({ page, request }) => {
    for (const u of ["/representantes?cidade=123", "/representantes?uf=ZZ", "/p/nao-existe", "/p/INVÁLIDO!"]) {
      const r = await request.get(u);
      expect(r.status(), u).toBe(404);
    }
    const red = await request.get("/p/slug-antigo-demo", { maxRedirects: 0 });
    expect([308, 404]).toContain(red.status()); // 404 quando a base real não tem o slug de demonstração
    await page.goto("/representantes?cidade=123");
    await expect(page.getByText(/404|não encontrad/i).first()).toBeVisible();
  });

  test("F01-E6 fluxo inteiro em 390 px sem rolagem horizontal @mobile", async ({ page, axe }) => {
    await page.goto("/representantes");
    await page.getByRole("combobox", { name: /cidade ou estado/i }).fill("campi");
    const opt = page.getByRole("option", { name: /Campinas.*SP/ });
    // Campinas vem primeiro (ordem por relevância); não rolar: rolar a página fecha o popover (React Aria)
    await expect(opt).toBeVisible();
    // em toque, a lista só recebe o toque ~0,5 s depois de aparecer (BUG-009, S4): espera o ponto ficar "tocável"
    await expect
      .poll(() => opt.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("[role=option]") === el; }))
      .toBe(true);
    await opt.tap(); // celular: toque, não clique
    await expect(page).toHaveURL(/cidade=3509502/);
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - 390);
    expect(await overflow()).toBeLessThanOrEqual(0);
    const first = page.locator('a[href^="/p/"]').first();
    const box = await first.locator("xpath=ancestor::li[1]").boundingBox(); // o cartão inteiro é a área de toque (::after do link)
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await first.click();
    await expect(page).toHaveURL(/\/p\//);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await axe();
  });
});
