import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F2 do roteiro do eleitor (A1 e A2): "O que mudou com seus escolhidos desde a última visita". A data da visita fica só no aparelho
// (localStorage) e nunca vai ao servidor. Fonte de dados: demonstração. Os testes não dependem das datas dos dados de demonstração:
// conferem o título (a janela dita na tela), o que se guarda no aparelho e o que sai da página.

const sigo = { name: "sv_sigo", value: "helena-siqueira", domain: "localhost", path: "/" };
const QUADRO = "[data-mudou-desde]";
const dd = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

test.describe("F2 · o que mudou desde a última visita", () => {
  test("primeira visita: janela padrão de 14 dias dita na tela, e o aparelho guarda a visita sem 'anterior'", async ({ page, context }) => {
    await context.addCookies([sigo]);
    await page.goto("/");
    const q = page.locator(QUADRO);
    await expect(q).toBeVisible();
    await expect(q).toHaveAttribute("data-origem", "padrao");
    await expect(q.getByRole("heading", { level: 3 })).toHaveText("O que mudou nos últimos 14 dias");
    await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("sv_visita"))).not.toBeNull();
    const v = JSON.parse((await page.evaluate(() => window.localStorage.getItem("sv_visita"))) ?? "{}") as { atual: string; anterior: string | null };
    expect(v.anterior).toBeNull();
    expect(Number.isNaN(new Date(v.atual).getTime())).toBe(false);
  });

  test("com visita anterior guardada, o título diz 'desde' o dia dela (Brasília); abrir de novo no mesmo dia não zera o 'desde'", async ({ page, context }) => {
    await context.addCookies([sigo]);
    // ontem (sempre outro dia que o de hoje, a qualquer hora): a guardada vira a anterior e o título diz desde ontem
    const ontem = new Date(Date.now() - 30 * 3600e3);
    const antes = new Date(Date.now() - 5 * 86400e3);
    // só semeia se ainda não há nada guardado: o recarregamento abaixo tem de ver o que a própria página gravou
    await page.addInitScript(([a, b]) => {
      if (!window.localStorage.getItem("sv_visita")) window.localStorage.setItem("sv_visita", JSON.stringify({ atual: a, anterior: b }));
    }, [ontem.toISOString(), antes.toISOString()] as const);
    await page.goto("/");
    const q = page.locator(QUADRO);
    // a origem só vira "visita" depois que o navegador lê o aparelho (a primeira pintura é a do servidor, janela padrão)
    await expect(q).toHaveAttribute("data-origem", "visita");
    await expect(q.getByRole("heading", { level: 3 })).toHaveText(`O que mudou desde ${dd.format(ontem)}`);
    const guardado = async () => JSON.parse((await page.evaluate(() => window.localStorage.getItem("sv_visita"))) ?? "{}") as { atual: string; anterior: string | null };
    expect((await guardado()).anterior).toBe(ontem.toISOString());
    // abrir de novo no mesmo dia é a mesma visita: o 'anterior' fica onde está e o título é o mesmo
    await page.reload();
    await expect(q).toHaveAttribute("data-origem", "visita");
    await expect(q.getByRole("heading", { level: 3 })).toHaveText(`O que mudou desde ${dd.format(ontem)}`);
    expect((await guardado()).anterior).toBe(ontem.toISOString());
  });

  test("a data da visita nunca sai do aparelho: nem cookie, nem URL, nem corpo ou cabeçalho de pedido", async ({ page, context }) => {
    await context.addCookies([sigo]);
    const marca = "2026-03-14T09:26:53.000Z";
    await page.addInitScript((m) => {
      if (!window.localStorage.getItem("sv_visita")) window.localStorage.setItem("sv_visita", JSON.stringify({ atual: m, anterior: m }));
    }, marca);
    const pedidos: Promise<string>[] = [];
    page.on("request", (r) => pedidos.push(r.allHeaders().then((h) => [r.url(), r.postData() ?? "", JSON.stringify(h)].join("\n"))));
    await page.goto("/");
    await expect(page.locator(QUADRO)).toHaveAttribute("data-origem", "visita");
    await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Votações", exact: true }).click();
    await expect(page).toHaveURL(/\/votacoes$/);
    // o que o navegador gravou depois de a página rodar: a marca semeada e a data real desta abertura
    const guardado = JSON.parse((await page.evaluate(() => window.localStorage.getItem("sv_visita"))) ?? "{}") as { atual: string; anterior: string | null };
    const segredos = ["2026-03-14", "sv_visita", guardado.atual];
    for (const p of await Promise.all(pedidos)) for (const x of segredos) expect(p, `pedido leva "${x}"`).not.toContain(x);
    for (const c of await context.cookies()) for (const x of segredos) expect(`${c.name}=${c.value}`, `cookie leva "${x}"`).not.toContain(x);
  });

  test("sem escolhidos o quadro não existe: a home abre pelo convite", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(QUADRO)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Primeira vez aqui?" })).toBeVisible();
  });

  test("armazenamento bloqueado: o quadro segue na janela padrão, sem erro", async ({ page, context }) => {
    await context.addCookies([sigo]);
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("bloqueado"); } });
    });
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message));
    await page.goto("/");
    await expect(page.locator(QUADRO)).toHaveAttribute("data-origem", "padrao");
    expect(erros).toEqual([]);
  });

  test("sem JavaScript o quadro aparece com a janela padrão", async ({ browser }, info) => {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL as string, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    await context.addCookies([sigo]);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(QUADRO)).toHaveAttribute("data-origem", "padrao");
    await expect(page.locator(QUADRO).getByRole("heading", { level: 3 })).toHaveText("O que mudou nos últimos 14 dias");
    await context.close();
  });

  test("o quadro passa no axe, sem termos de ranking, e os links que houver têm 44 px", async ({ page, context }) => {
    await context.addCookies([sigo]);
    await page.addInitScript(() => {
      if (!window.localStorage.getItem("sv_visita")) window.localStorage.setItem("sv_visita", JSON.stringify({ atual: "2026-09-30T12:00:00.000Z", anterior: "2026-01-01T12:00:00.000Z" }));
    });
    await page.goto("/");
    const q = page.locator(QUADRO);
    await expect(q).toHaveAttribute("data-origem", "visita");
    // com a visita de janeiro, a janela é a máxima (60 dias): o quadro tem linhas ou a lacuna nomeada, nunca fica vazio
    await expect(q.locator("li, .sv-lac")).not.toHaveCount(0);
    const r = await new AxeBuilder({ page }).include(QUADRO).analyze();
    expect(r.violations).toEqual([]);
    expect(await q.innerText()).not.toMatch(/\b(ranking|média|na média|acima da média|abaixo da média|mais gastou|menos gastou|maior gasto|menor gasto|beneficia|polêmic)/i);
    // os registros de demonstração saem da janela de 60 dias com o tempo: sem linhas, não há links para medir, e a lacuna acima já provou o estado
    for (const a of await q.getByRole("link").all()) {
      const b = await a.boundingBox();
      expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(44);
    }
  });
});
