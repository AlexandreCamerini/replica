import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Bateria de aceite da Direção 2 (HANDOFF-DIRECAO-2.md §4, §6, §9) sobre TODAS as rotas dela (na raiz desde a D316; era /v2).
// Fonte de dados: demo/fake (DATA_SOURCE=demo). Nenhum teste intercepta o servidor; o que muda é só o DOM, no navegador.
// Regra de conduta: critério violado deixa o teste VERMELHO (ou `test.fail` com anotação). Nada aqui foi afrouxado para passar.

const UF = "SP";
// Ordem do cookie propositalmente fora de ordem alfabética: a tela é que tem de ordenar.
const SIGO = ["helena-siqueira", "alvaro-teixeira-sp", "bruno-sampaio"]; // Senado (federal), Assembleia (estadual), Câmara Municipal (municipal)
const KEY_SEM_RESPOSTA = "camara-pl-79-2020";
const KEY_RESPONDIDA = "camara-pl-9999-2026";

/** `status`: o esperado da resposta (padrão 200). Só o 404 muda. */
type Rota = { nome: string; url: string; status?: number };
// Rotas da Pessoa (gastos, equipe, votos): bloco da PR "gastos, equipe e votos da Pessoa no /". Entram em todas as baterias.
const ROTAS_PESSOA_SUB: Rota[] = [
  { nome: "pessoa-gastos", url: "/pessoa/helena-siqueira/gastos" },
  { nome: "pessoa-gastos-vereador", url: "/pessoa/alvaro-coutinho-sp/gastos" },
  { nome: "pessoa-equipe", url: "/pessoa/helena-siqueira/equipe" },
  { nome: "pessoa-votos", url: "/pessoa/helena-siqueira/votos" },
];
const ROTAS: Rota[] = [
  { nome: "inicio", url: "/" },
  { nome: "acompanhando", url: "/acompanhando" },
  { nome: "ajustes", url: "/ajustes" },
  { nome: "temas", url: "/temas" },
  { nome: "decisoes", url: "/decisoes" },
  { nome: "votacoes", url: "/votacoes" },
  { nome: "pessoas", url: "/pessoas" },
  { nome: "como-funciona", url: "/como-funciona" },
  { nome: "decisao-sem-resposta", url: `/decisao/${KEY_SEM_RESPOSTA}` },
  { nome: "decisao-respondida", url: `/decisao/${KEY_RESPONDIDA}` },
  { nome: "pessoa", url: "/pessoa/helena-siqueira" },
  ...ROTAS_PESSOA_SUB,
  { nome: "tema", url: "/tema/agro" },
  { nome: "votacao", url: "/votacao/camara-v2026-15" },
  { nome: "votacao-uf", url: "/votacao/camara-v2026-15?uf=SP" },
  // recortes das sete telas redesenhadas depois da PR #22, e o 404 (notFound() de uma tela)
  { nome: "votacoes-senado-tudo", url: "/votacoes?casa=senado&tudo=1" },
  { nome: "votacao-sem-votos", url: "/votacao/camara-demo-sem-votos?uf=SP" },
  { nome: "decisoes-leis", url: "/decisoes?aba=leis" },
  { nome: "pessoas-grupo", url: "/pessoas?cidade=3509502&grupo=vereadores" },
  { nome: "pessoas-filtro", url: "/pessoas?cargo=senador&uf=SP" },
  { nome: "404-decisao", url: "/decisao/nao-existe", status: 404 },
];
const STATUS = new Map(ROTAS.map((r) => [r.url, r.status ?? 200]));
type Leitor = "anon" | "leitor";
const LEITORES: Leitor[] = ["anon", "leitor"];

async function cookiesDoLeitor(context: BrowserContext, leitor: Leitor) {
  if (leitor === "anon") return;
  await context.addCookies([
    { name: "sv_uf", value: UF, domain: "localhost", path: "/" },
    { name: "sv_sigo", value: SIGO.join("."), domain: "localhost", path: "/" },
  ]);
}

async function abrir(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: "load" });
  expect(res?.status(), url).toBe(STATUS.get(url) ?? 200);
  await expect(page.locator(".sv h1").first()).toBeVisible();
}

/** Anexa texto ao relatório do teste (aparece no HTML report e na saída). */
const nota = (info: TestInfo, tipo: string, descricao: string) => info.annotations.push({ type: tipo, description: descricao.slice(0, 1500) });

const TEXT_SPACING = `
  *{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}
  p{margin-bottom:2em !important}
`;

// ---------------------------------------------------------------------------------------------------------------------
// Acessibilidade
// ---------------------------------------------------------------------------------------------------------------------
test.describe("a11y", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      test(`axe, h1 único e link "pular": ${r.nome} [${leitor}]`, async ({ page, context }) => {
        await cookiesDoLeitor(context, leitor);
        await abrir(page, r.url);
        await expect(page).toHaveTitle(/\S/);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
        expect(res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`)).toEqual([]);

        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("main")).toHaveCount(1); // o layout tem um <main>; a tela não cria outro

        // "Pular para o conteúdo": primeiro elemento focável, aparece no foco e leva ao conteúdo
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
        await expect(skip).toBeFocused();
        const box = await skip.boundingBox();
        expect(box && box.y >= 0 && box.height >= 44, "link pular visível e ≥ 44 px no foco").toBe(true);
        const alvo = await skip.getAttribute("href");
        expect(alvo).toMatch(/^#/);
        await expect(page.locator(alvo!)).toHaveCount(1);
        // só um link "pular" (o shell v1 não pode vazar)
        await expect(page.getByRole("link", { name: /Pular para o conteúdo/i })).toHaveCount(1);
        await expect(page.locator("header.sticky")).toHaveCount(0);
      });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Rolagem horizontal: 320, 390, 900, 1024, 1100, 1280; com e sem espaçamento de texto WCAG 1.4.12
// ---------------------------------------------------------------------------------------------------------------------
const LARGURAS = [320, 390, 900, 1024, 1100, 1280];
test.describe("reflow", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      test(`sem rolagem horizontal (normal e com espaçamento de texto): ${r.nome} [${leitor}]`, async ({ page, context }) => {
        await cookiesDoLeitor(context, leitor);
        await page.setViewportSize({ width: 1280, height: 900 });
        await abrir(page, r.url);
        const medir = () =>
          page.evaluate(() => {
            const w = window.innerWidth;
            const doc = document.documentElement;
            const filhos: string[] = [];
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sv, .sv *"))) {
              const rc = el.getBoundingClientRect();
              if (rc.width === 0 || rc.height === 0) continue;
              if (getComputedStyle(el).position === "fixed" || el.closest(".sv-vh")) continue;
              if (rc.right > w + 1 && filhos.length < 4) filhos.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/).join(".") : ""} direita=${Math.round(rc.right)}`);
            }
            return { sobra: doc.scrollWidth - w, filhos };
          });
        const falhas: string[] = [];
        for (const espacamento of [false, true]) {
          if (espacamento) await page.addStyleTag({ content: TEXT_SPACING });
          for (const width of LARGURAS) {
            await page.setViewportSize({ width, height: 900 });
            const m = await medir();
            if (m.sobra > 0) falhas.push(`${espacamento ? "com espaçamento" : "normal"} a ${width}px: sobra ${m.sobra}px; ${m.filhos.join("; ")}`);
          }
        }
        expect(falhas, `${r.url} [${leitor}]`).toEqual([]);
      });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Alvos ≥ 44×44 e texto ≥ 13 px
// ---------------------------------------------------------------------------------------------------------------------
type Alvo = { sel: string; texto: string; w: number; h: number };
test.describe("alvos e texto", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      for (const width of [390, 1280]) {
        test(`alvos ≥ 44×44 e texto ≥ 13px a ${width}px: ${r.nome} [${leitor}]`, async ({ page, context }, info) => {
          await cookiesDoLeitor(context, leitor);
          await page.setViewportSize({ width, height: 900 });
          await abrir(page, r.url);
          const res = await page.evaluate(() => {
            const desc = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.trim().split(/\s+/).join(".") : ""}`;
            const escondido = (el: Element) => {
              const cs = getComputedStyle(el);
              return cs.display === "none" || cs.visibility === "hidden" || !!el.closest(".sv-vh, [hidden], [inert]");
            };
            const alvos: { sel: string; texto: string; w: number; h: number }[] = [];
            const emLinha: { sel: string; texto: string; w: number; h: number }[] = [];
            const pequenos: { sel: string; texto: string; px: number }[] = [];
            // o link "pular" fica fora da tela até receber foco: mede-se focado
            (document.querySelector(".sv-skip") as HTMLElement | null)?.focus();
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sv a[href], .sv button, .sv summary, .sv input:not([type=hidden]), .sv select, .sv textarea, .sv [role=button], .sv [tabindex]:not([tabindex='-1'])"))) {
              if (escondido(el)) continue;
              const rc = el.getBoundingClientRect();
              if (rc.width === 0 && rc.height === 0) continue;
              const item = { sel: desc(el), texto: (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().slice(0, 50), w: Math.round(rc.width), h: Math.round(rc.height) };
              if (rc.width >= 44 - 0.5 && rc.height >= 44 - 0.5) continue;
              // exceção da WCAG 2.5.8 (frase): link em linha dentro de parágrafo/lista. Registrado, não ignorado em massa.
              const bloco = el.closest("p, li, dd, td, div");
              const disp = getComputedStyle(el).display;
              const textoAoRedor = !!bloco && (bloco.textContent ?? "").replace(/\s+/g, " ").trim().length > (el.textContent ?? "").replace(/\s+/g, " ").trim().length + 8;
              if (el.tagName === "A" && ["inline", "inline-block", "inline-flex"].includes(disp) && textoAoRedor) emLinha.push(item);
              else alvos.push(item);
            }
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(".sv *"))) {
              if (["SCRIPT", "STYLE", "OPTION", "OPTGROUP", "PATH", "SVG", "POLYGON"].includes(el.tagName.toUpperCase()) || escondido(el)) continue;
              if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0)) continue;
              const px = parseFloat(getComputedStyle(el).fontSize);
              if (px < 13) pequenos.push({ sel: desc(el), texto: (el.textContent ?? "").trim().slice(0, 40), px });
            }
            return { alvos, emLinha, pequenos };
          });
          if (res.emLinha.length) nota(info, "links em linha (exceção 2.5.8)", `${res.emLinha.length}: ${res.emLinha.slice(0, 8).map((a: Alvo) => `${a.sel} "${a.texto}" ${a.w}x${a.h}`).join(" | ")}`);
          expect(res.alvos.map((a: Alvo) => `${a.sel} "${a.texto}" ${a.w}x${a.h}`), "alvos menores que 44×44").toEqual([]);
          expect(res.pequenos.map((p) => `${p.sel} "${p.texto}" ${p.px}px`), "texto menor que 13px").toEqual([]);
        });
      }
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Ordem do DOM = ordem visual nos blocos principais
// ---------------------------------------------------------------------------------------------------------------------
test.describe("ordem", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      test(`DOM = ordem visual (390, 900, 1280): ${r.nome} [${leitor}]`, async ({ page, context }) => {
        await cookiesDoLeitor(context, leitor);
        const falhas: string[] = [];
        for (const width of [390, 900, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await abrir(page, r.url);
          const f = await page.evaluate(() => {
            const raiz = document.querySelector(".sv-pg") ?? document.querySelector(".sv-main");
            const blocos = Array.from(raiz?.children ?? []).filter((el) => {
              const rc = el.getBoundingClientRect();
              return rc.width > 0 && rc.height > 0 && getComputedStyle(el).display !== "none";
            });
            const out: string[] = [];
            const nome = (el: Element) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(/\s+/).join(".")}${el.id ? "#" + el.id : ""}`;
            for (let i = 1; i < blocos.length; i++) {
              const a = blocos[i - 1].getBoundingClientRect();
              const b = blocos[i].getBoundingClientRect();
              const acima = b.bottom <= a.top + 2;
              const mesmaFaixa = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
              const aEsquerda = b.right <= a.left + 2;
              if (acima || (mesmaFaixa && aEsquerda)) out.push(`${nome(blocos[i - 1])} -> ${nome(blocos[i])} (a: ${Math.round(a.left)},${Math.round(a.top)} b: ${Math.round(b.left)},${Math.round(b.top)})`);
            }
            // blocos da grade não podem se sobrepor (grid-area sem template cai tudo na mesma célula)
            for (let i = 0; i < blocos.length; i++)
              for (let j = i + 1; j < blocos.length; j++) {
                const a = blocos[i].getBoundingClientRect();
                const b = blocos[j].getBoundingClientRect();
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 2 && h > 2) out.push(`SOBREPOSIÇÃO ${nome(blocos[i])} x ${nome(blocos[j])}: ${Math.round(w)}x${Math.round(h)}px`);
              }
            return out;
          });
          for (const x of f) falhas.push(`${width}px: ${x}`);
        }
        expect(falhas).toEqual([]);
      });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Sem JavaScript: conteúdo visível e formulário de Ajustes grava UF e esferas
// ---------------------------------------------------------------------------------------------------------------------
async function semJs(browser: Browser, info: TestInfo, leitor: Leitor) {
  const baseURL = info.project.use.baseURL as string;
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "onb", value: "1", domain: "localhost", path: "/" }]);
  await cookiesDoLeitor(context, leitor);
  return context;
}

test.describe("sem JavaScript", () => {
  for (const r of ROTAS) {
    test(`mostra o conteúdo: ${r.nome}`, async ({ browser }, info) => {
      const context = await semJs(browser, info, "leitor");
      const page = await context.newPage();
      const res = await page.goto(r.url);
      expect(res?.status()).toBe(r.status ?? 200);
      if (r.status === 404) {
        // DÍVIDA registrada (todo notFound() do site, v1 inclusive): no Next 15.5 o 404 sai como documento de erro
        // (<html id="__next_error__">) com o corpo vazio, e o 404 da D2 só aparece com JavaScript. Este teste afirma a dívida
        // exata: fica VERMELHO quando o Next (ou uma correção na raiz) passar a entregar o 404 no HTML. Aí, troque-o pelo
        // ramo normal abaixo.
        await expect(page.locator("html#__next_error__")).toHaveCount(1);
        await expect(page.locator(".sv h1")).toHaveCount(0);
        expect((await page.locator("body").innerText()).trim(), "corpo sem conteúdo sem JavaScript").toBe("");
        await context.close();
        return;
      }
      await expect(page.locator(".sv h1")).toHaveCount(1);
      await expect(page.locator(".sv h1")).toBeVisible();
      expect((await page.locator(".sv-main").innerText()).length, "conteúdo do main").toBeGreaterThan(200);
      await expect(page.getByRole("navigation", { name: "Perguntas" })).toBeVisible();
      await context.close();
    });
  }

  test("Ajustes grava a UF e as esferas só com o formulário", async ({ browser }, info) => {
    const context = await semJs(browser, info, "anon");
    const page = await context.newPage();
    await page.goto("/ajustes");
    await expect(page.getByRole("link", { name: "Escolha seu estado" })).toBeVisible();
    await page.locator("#aj-uf-sel").selectOption("MG");
    await page.getByRole("button", { name: "Guardar estado" }).click();
    await page.waitForURL(/\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_uf")?.value).toBe("MG");
    await expect(page.locator(".sv-uf")).toContainText("Minas Gerais (MG)");
    // esferas: liga a municipal e desliga a estadual (checkboxes ligados ao form de esferas pelo atributo form)
    await page.locator("#aj-mun").check();
    await page.locator("#aj-est").uncheck();
    await page.getByRole("button", { name: "Guardar escolhas" }).click();
    await page.waitForURL(/\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_esferas")?.value).toMatch(/^e0\.m1/);
    await expect(page.locator("#aj-mun")).toBeChecked();
    await expect(page.locator("#aj-est")).not.toBeChecked();
    // limpar a escolha
    await page.locator("#aj-uf-sel").selectOption("");
    await page.getByRole("button", { name: "Guardar estado" }).click();
    await page.waitForURL(/\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_uf")).toBeUndefined();
    await context.close();
  });

  // A action roda de verdade: o formulário é enviado (POST nativo, sem JavaScript) com os campos adulterados no DOM.
  for (const caso of [
    { nome: "sigla inválida e destino //evil.example", uf: "ZZ", voltar: "//evil.example", cookie: undefined },
    { nome: "sigla válida e destino https://evil.example", uf: "MG", voltar: "https://evil.example/", cookie: "MG" },
    { nome: "sigla válida e destino //evil.example", uf: "RJ", voltar: "//evil.example", cookie: "RJ" },
  ])
    test(`Ajustes rejeita redirecionamento aberto: ${caso.nome}`, async ({ browser }, info) => {
      const context = await semJs(browser, info, "anon");
      const page = await context.newPage();
      await page.goto("/ajustes");
      const form = page.locator("form#trocar-estado");
      await form.evaluate((f, c) => {
        const sel = f.querySelector<HTMLSelectElement>("select[name=uf]")!;
        if (![...sel.options].some((o) => o.value === c.uf)) sel.add(new Option(c.uf, c.uf));
        sel.value = c.uf;
        f.querySelector<HTMLInputElement>("input[name=voltar]")!.value = c.voltar;
      }, caso);
      await Promise.all([page.waitForLoadState("load"), form.getByRole("button", { name: "Guardar estado" }).click()]);
      const final = new URL(page.url());
      expect(final.host, "o destino final fica no próprio site").toBe(new URL(info.project.use.baseURL as string).host);
      expect(final.pathname).toBe("/ajustes"); // destino adulterado cai no padrão
      // a action rodou: a sigla válida foi gravada; a inválida não
      expect((await context.cookies()).find((c) => c.name === "sv_uf")?.value).toBe(caso.cookie);
      await context.close();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Cor (§4): só tinta, tinta2, papel (e transparente) + agora/agora-luz/vida/vida-luz nos usos listados
// ---------------------------------------------------------------------------------------------------------------------
const NEUTRAS = ["20,20,20", "74,72,68", "242,238,229"]; // tinta, tinta2, papel
const AGORA = ["138,74,46", "239,221,208"];
const VIDA = ["11,63,77", "217,232,230"];
// seletores onde o §4 permite cada matiz (d2.css v7, linhas 688–698)
const USO_AGORA = [".sv-agora", ".sv-tl--e", ".sv-d--hoje", ".sv-d--hoje .sv-d__c", ".sv-d--hoje .sv-d__q"];
const USO_VIDA = [".sv-vida", ".sv-n.sv-n--vida", ".sv-hs__m--se .sv-hs__t", ".sv-hs__m--se .sv-muda"];
// onde nunca pode haver cor de destaque
const PROIBIDO = ["a", "a *", ".sv-voto", ".sv-voto *", ".sv-m", ".sv-mark", ".sv-vote", ".sv-vote *", ".sv-pes", ".sv-pes *", ".sv-esf", ".sv-esc__e", ".sv-cont", ".sv-cont *", ".sv-lac", ".sv-lac *", ".sv-vf", ".sv-bar", ".sv-bar *", ".sv-quadro", ".sv-quadro--lacuna", ".sv-etq", ".sv-tag", ".sv-esc__n", ".sv-esc__c"];

type UsoCor = { sel: string; prop: string; valor: string; matiz: "agora" | "vida" | "outra"; permitido: boolean; proibidoEm: string | null; naDobra: boolean };

async function coletarCores(page: Page): Promise<UsoCor[]> {
  return page.evaluate(
    ({ neutras, agora, vida, usoAgora, usoVida, proibido }) => {
      const out: UsoCor[] = [];
      const alturaDobra = window.innerHeight;
      const rgb = (v: string): { k: string; a: number } | null => {
        const m = /rgba?\(([^)]+)\)/.exec(v);
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { k: `${p[0]},${p[1]},${p[2]}`, a: p.length > 3 ? p[3] : 1 };
      };
      const todas = (v: string) => (v.match(/rgba?\([^)]+\)/g) ?? []).map((x) => rgb(x)).filter((x): x is { k: string; a: number } => !!x);
      const desc = (el: Element) => `${el.tagName.toLowerCase()}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.trim().split(/\s+/).join(".") : ""}`;
      const registrar = (el: Element, prop: string, valor: string, ctx: string) => {
        for (const c of todas(valor)) {
          if (c.a === 0 || neutras.includes(c.k)) continue;
          const matiz = agora.includes(c.k) ? "agora" : vida.includes(c.k) ? "vida" : "outra";
          const lista = matiz === "agora" ? usoAgora : matiz === "vida" ? usoVida : [];
          const permitido = lista.some((s: string) => el.matches(s));
          const proib = proibido.find((s: string) => el.matches(s)) ?? null;
          const rc = el.getBoundingClientRect();
          out.push({ sel: desc(el) + ctx, prop, valor: c.k, matiz, permitido, proibidoEm: proib, naDobra: rc.top < alturaDobra && rc.bottom > 0 });
        }
      };
      const lados = ["Top", "Right", "Bottom", "Left"] as const;
      for (const el of Array.from(document.querySelectorAll(".sv, .sv *"))) {
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        const pai = el.parentElement ? getComputedStyle(el.parentElement) : null;
        const temTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
        // `color` é herdado: conta onde o elemento a define (difere do pai) ou onde há texto próprio com cor de destaque
        if ((temTexto || /^(svg|path|polygon|circle|rect|line)$/i.test(el.tagName)) && (!pai || pai.color !== cs.color || temTexto)) registrar(el, "color", cs.color, "");
        registrar(el, "background-color", cs.backgroundColor, "");
        for (const l of lados) {
          const w = parseFloat(cs.getPropertyValue(`border-${l.toLowerCase()}-width`));
          const st = cs.getPropertyValue(`border-${l.toLowerCase()}-style`);
          if (w > 0 && st !== "none" && st !== "hidden") registrar(el, `border-${l.toLowerCase()}-color`, cs.getPropertyValue(`border-${l.toLowerCase()}-color`), "");
        }
        if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) registrar(el, "outline-color", cs.outlineColor, "");
        if (cs.textDecorationLine !== "none") registrar(el, "text-decoration-color", cs.textDecorationColor, "");
        if (cs.boxShadow !== "none") registrar(el, "box-shadow", cs.boxShadow, "");
        if (cs.backgroundImage.includes("gradient")) registrar(el, "background-image", cs.backgroundImage, "");
        if (el instanceof SVGElement && /^(path|polygon|polyline|circle|rect|line|ellipse|text)$/i.test(el.tagName)) {
          if (cs.fill !== "none") registrar(el, "fill", cs.fill, "");
          if (cs.stroke !== "none") registrar(el, "stroke", cs.stroke, "");
        }
        for (const pe of ["::before", "::after"] as const) {
          const p = getComputedStyle(el, pe);
          if (p.content === "none" || p.content === "normal") continue;
          registrar(el, "color", p.color, pe);
          registrar(el, "background-color", p.backgroundColor, pe);
          for (const l of lados) {
            const w = parseFloat(p.getPropertyValue(`border-${l.toLowerCase()}-width`));
            if (w > 0 && p.getPropertyValue(`border-${l.toLowerCase()}-style`) !== "none") registrar(el, `border-${l.toLowerCase()}-color`, p.getPropertyValue(`border-${l.toLowerCase()}-color`), pe);
          }
        }
      }
      return out;
    },
    { neutras: NEUTRAS, agora: AGORA, vida: VIDA, usoAgora: USO_AGORA, usoVida: USO_VIDA, proibido: PROIBIDO },
  );
}

test.describe("cor", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      test(`só os 4 tokens e só nos usos do §4: ${r.nome} [${leitor}]`, async ({ page, context }) => {
        await cookiesDoLeitor(context, leitor);
        await page.setViewportSize({ width: 1280, height: 900 });
        await abrir(page, r.url);
        const falhas: string[] = [];
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const usos = await coletarCores(page);
          for (const u of usos) {
            if (u.matiz === "outra") falhas.push(`${width}px: cor fora da paleta rgb(${u.valor}) em ${u.sel} (${u.prop})`);
            else if (!u.permitido) falhas.push(`${width}px: ${u.matiz} fora dos usos do §4 em ${u.sel} (${u.prop})`);
            if (u.proibidoEm) falhas.push(`${width}px: ${u.matiz} em elemento proibido (${u.proibidoEm}): ${u.sel} (${u.prop})`);
          }
        }
        expect([...new Set(falhas)]).toEqual([]);
      });

      test(`≤ 3 ocorrências de cada matiz na primeira dobra (390 e 1280): ${r.nome} [${leitor}]`, async ({ page, context }, info) => {
        await cookiesDoLeitor(context, leitor);
        const falhas: string[] = [];
        for (const [width, height] of [[390, 844], [1280, 800]]) {
          await page.setViewportSize({ width, height });
          await abrir(page, r.url);
          const usos = (await coletarCores(page)).filter((u) => u.naDobra && u.matiz !== "outra");
          for (const m of ["agora", "vida"] as const) {
            // §4 lista a coluna "Hoje" (fio, fundo do cabeçalho) como UM uso de AGORA: os elementos dela contam uma vez.
            const doMatiz = usos.filter((u) => u.matiz === m);
            const hoje = doMatiz.filter((u) => /sv-d--hoje|sv-d__c/.test(u.sel));
            const n = doMatiz.length - hoje.length + (hoje.length ? 1 : 0);
            nota(info, `dobra ${width}`, `${m}=${n}`);
            if (n > 3) falhas.push(`${width}x${height}: ${n} ocorrências de ${m} na primeira dobra (máx. 3): ${usos.filter((u) => u.matiz === m).map((u) => u.sel + "/" + u.prop).join(", ")}`);
          }
        }
        expect(falhas).toEqual([]);
      });
    }

  test("foco: contorno em tinta (papel sobre fundo tinta), nunca colorido", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    for (const url of ["/", "/acompanhando", "/ajustes", `/decisao/${KEY_RESPONDIDA}`, "/pessoa/helena-siqueira"]) {
      await abrir(page, url);
      const falhas: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return { sel: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).join(".")}`, cor: cs.outlineColor, w: parseFloat(cs.outlineWidth), st: cs.outlineStyle };
        });
        if (!f) continue;
        if (f.st === "none" || f.w < 3) falhas.push(`${url}: sem contorno de 3px em ${f.sel} (${f.st} ${f.w}px)`);
        else if (!["rgb(20, 20, 20)", "rgb(242, 238, 229)"].includes(f.cor)) falhas.push(`${url}: contorno de foco ${f.cor} em ${f.sel}`);
      }
      expect([...new Set(falhas)]).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Neutralidade
// ---------------------------------------------------------------------------------------------------------------------
const PARTIDOS_FAKE = ["AUR", "BRI", "CER", "DEL", "ENS", "FAR", "GAR", "HOR"]; // PARTIES de src/lib/data/fake.ts
const PARTIDOS_TESTE = ["PT", "PL", "PSOL", "NOVO", "União Brasil"];
const NOMES_TESTE = ["Zé Lo", "Maria Antonieta de Albuquerque Montenegro Filho", "Ricardo Alves"];
// propriedades de geometria resolvida: mudam com o comprimento do texto sem ser estilo
const GEOMETRIA = new Set(["width", "height", "inline-size", "block-size", "perspective-origin", "transform-origin", "grid-template-columns", "grid-template-rows", "min-width", "min-height", "min-inline-size", "min-block-size", "max-width", "max-height", "inset", "inset-block", "inset-inline", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "top", "right", "bottom", "left", "d", "x", "y", "cx", "cy", "r", "rx", "ry", "margin-inline-start", "margin-inline-end", "margin-left", "margin-right", "margin-block-start", "margin-block-end", "margin-top", "margin-bottom"]);

type Snap = { chave: string; props: Record<string, string> }[];

test.describe("neutralidade", () => {
  const ROTAS_PESSOAS = ROTAS.filter((r) => ["inicio", "acompanhando", "pessoas", "pessoa", "votacao-uf", "decisao-respondida", "tema", "pessoas-grupo", "pessoas-filtro"].includes(r.nome) || ROTAS_PESSOA_SUB.includes(r));
  for (const r of ROTAS_PESSOAS) {
    test(`trocar nomes e siglas: 0 diferenças de estilo, pseudo-elementos e ordem: ${r.nome} [leitor]`, async ({ page, context }, info) => {
      await cookiesDoLeitor(context, "leitor");
      await page.setViewportSize({ width: 1280, height: 900 });
      await abrir(page, r.url);

      const snapshot = () =>
        page.evaluate((geo) => {
          const skip = new Set(geo);
          const lido = (cs: CSSStyleDeclaration) => {
            const o: Record<string, string> = {};
            for (let i = 0; i < cs.length; i++) {
              const p = cs[i];
              if (!skip.has(p)) o[p] = cs.getPropertyValue(p);
            }
            return o;
          };
          const out: { chave: string; props: Record<string, string> }[] = [];
          document.querySelectorAll(".sv, .sv *").forEach((el, i) => {
            const base = `${i}:${el.tagName}.${String((el as HTMLElement).className ?? "")}`;
            out.push({ chave: base, props: lido(getComputedStyle(el)) });
            for (const pe of ["::before", "::after"] as const) {
              const cs = getComputedStyle(el, pe);
              if (cs.content !== "none" && cs.content !== "normal") out.push({ chave: `${base}${pe}`, props: lido(cs) });
            }
          });
          return out;
        }, [...GEOMETRIA]) as Promise<Snap>;

      const antes = await snapshot();

      const trocados = await page.evaluate(
        ({ partidos, novosPartidos, novosNomes }) => {
          const nomes = new Set<string>();
          const limpo = (t: string) => t.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
          const aceitar = (nome: string) => {
            if (nome.length >= 5 && /^[\p{L}][\p{L}' .-]+$/u.test(nome)) nomes.add(nome);
          };
          document.querySelectorAll<HTMLElement>('a[href^="/pessoa/"]').forEach((a) => {
            const t = limpo(a.textContent ?? "");
            const m = /^Ver tudo de (.+?)\s*→?$/.exec(t);
            // item de lista: o nome é o primeiro texto do bloco (depois vêm cargo e partido)
            const item = a.closest(".sv-item");
            const nome = m ? m[1] : item ? limpo(item.querySelector("div")?.firstChild?.textContent ?? "") : t;
            aceitar(nome);
          });
          document.querySelectorAll<HTMLElement>(".sv-esc__n").forEach((n) => aceitar(limpo(n.textContent ?? "")));
          if (location.pathname.startsWith("/pessoa/")) aceitar(limpo(document.querySelector("h1")?.textContent ?? ""));
          document.querySelectorAll<HTMLElement>(".sv-voterow > div").forEach((d) => aceitar(limpo(d.firstChild?.textContent ?? "")));
          const ordenados = [...nomes].sort((a, b) => b.length - a.length);
          const trocas = { nomes: 0, partidos: 0 };
          const walker = document.createTreeWalker(document.querySelector(".sv")!, NodeFilter.SHOW_TEXT);
          const nos: Text[] = [];
          while (walker.nextNode()) nos.push(walker.currentNode as Text);
          for (const n of nos) {
            if (n.parentElement?.closest("script, style")) continue;
            let t = n.data;
            const orig = t;
            ordenados.forEach((nome) => {
              const idx = [...nomes].indexOf(nome);
              if (t.includes(nome)) {
                t = t.split(nome).join(novosNomes[idx % novosNomes.length]);
                trocas.nomes++;
              }
            });
            partidos.forEach((sig: string, i: number) => {
              const re = new RegExp(`(^|[^\\p{L}\\p{N}])${sig}(?![\\p{L}\\p{N}])`, "gu");
              if (re.test(t)) {
                t = t.replace(re, (_m, p1) => `${p1}${novosPartidos[i % novosPartidos.length]}`);
                trocas.partidos++;
              }
            });
            if (t !== orig) n.data = t;
          }
          return { ...trocas, nomesEncontrados: [...nomes] };
        },
        { partidos: PARTIDOS_FAKE, novosPartidos: PARTIDOS_TESTE, novosNomes: NOMES_TESTE },
      );
      nota(info, "trocas", JSON.stringify({ nomes: trocados.nomes, partidos: trocados.partidos, encontrados: trocados.nomesEncontrados.slice(0, 6) }));
      // o teste só vale se houve o que trocar (rotas com pessoa)
      if (["acompanhando", "pessoa", "pessoas", "votacao-uf", "pessoas-grupo", "pessoas-filtro"].includes(r.nome) || ROTAS_PESSOA_SUB.includes(r)) expect(trocados.nomes, "sem nome para trocar: o teste não provaria nada").toBeGreaterThan(0);

      const depois = await snapshot();
      const dif: string[] = [];
      if (antes.length !== depois.length) dif.push(`número de caixas/pseudo-elementos ${antes.length} -> ${depois.length}`);
      for (let i = 0; i < Math.min(antes.length, depois.length); i++) {
        if (antes[i].chave !== depois[i].chave) {
          dif.push(`ordem/estrutura: ${antes[i].chave} -> ${depois[i].chave}`);
          break;
        }
        for (const p of Object.keys(antes[i].props))
          if (antes[i].props[p] !== depois[i].props[p]) dif.push(`${antes[i].chave} ${p}: ${antes[i].props[p]} -> ${depois[i].props[p]}`);
      }
      expect(dif.slice(0, 15), `diferenças (${dif.length})`).toEqual([]);

      // controle positivo: o detector precisa pegar uma diferença induzida (senão "0 diferenças" não prova nada)
      await page.evaluate(() => {
        const alvo = document.querySelector<HTMLElement>('.sv-esc__n, a[href^="/pessoa/"], .sv-main h1');
        if (alvo) alvo.style.fontWeight = "100";
      });
      const controle = await snapshot();
      let pegou = 0;
      for (let i = 0; i < Math.min(depois.length, controle.length); i++) for (const p of Object.keys(depois[i].props)) if (depois[i].props[p] !== controle[i].props[p]) pegou++;
      expect(pegou, "controle positivo: diferença induzida de estilo detectada").toBeGreaterThan(0);
    });
  }

  test("pessoas em ordem alfabética onde listadas, e a frase que declara isso", async ({ page, context }, info) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    const urls = ["/", "/acompanhando", "/pessoas?cargo=senador&uf=SP", "/pessoas", "/pessoas?cidade=3509502&grupo=vereadores", `/decisao/${KEY_RESPONDIDA}`, "/votacao/camara-v2026-15", "/tema/agro", "/decisoes"];
    for (const url of urls) {
      await abrir(page, url);
      const r = await page.evaluate(() => {
        const grupos = new Map<Element, string[]>();
        const add = (raiz: Element, nome: string) => {
          if (!grupos.has(raiz)) grupos.set(raiz, []);
          grupos.get(raiz)!.push(nome.replace(/\s+/g, " ").trim());
        };
        document.querySelectorAll<HTMLElement>('.sv-main a[href^="/pessoa/"]').forEach((a) => {
          if (/^Ver tudo de/.test(a.textContent ?? "")) return;
          const raiz = a.closest(".sv-esc__pessoas, ul, ol, .sv-list, table, .sv-pg > *") ?? document.body;
          const item = a.closest("li, .sv-item, .sv-voterow, tr");
          if (item && item.querySelector('a[href^="/pessoa/"]') !== a) return; // um nome por item
          add(raiz, a.textContent ?? "");
        });
        document.querySelectorAll<HTMLElement>(".sv-esc__pessoas .sv-esc__n").forEach((n) => add(n.closest(".sv-esc__pessoas")!, n.textContent ?? ""));
        return { grupos: [...grupos.values()], texto: (document.querySelector(".sv-main") as HTMLElement).innerText };
      });
      let temLista = false;
      for (const g of r.grupos) {
        if (g.length < 2) continue;
        temLista = true;
        const ord = [...g].sort((a, b) => a.localeCompare(b, "pt-BR"));
        if (JSON.stringify(ord) !== JSON.stringify(g)) falhas.push(`${url}: fora de ordem alfabética: ${g.slice(0, 8).join(" | ")}`);
      }
      if (temLista && !/(ordem alfab[ée]tica|de A a Z|A–Z|A-Z)/i.test(r.texto)) falhas.push(`${url}: lista de pessoas sem a frase que declara a ordem alfabética`);
      nota(info, "listas", `${url}: ${r.grupos.map((g) => g.length).join(",")}`);
    }
    expect(falhas).toEqual([]);
  });

  test("placar: sempre Sim, Não, Abstenção, Sem voto; Sem voto vem com 'não é voto contra'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    const urls = ["/", "/acompanhando", `/decisao/${KEY_RESPONDIDA}`, `/decisao/${KEY_SEM_RESPOSTA}`, "/votacao/camara-v2026-15", "/votacao/camara-v2026-19", "/votacoes", "/tema/agro", "/pessoa/helena-siqueira", "/decisoes"];
    let tabelas = 0;
    for (const url of urls) {
      await abrir(page, url);
      const r = await page.evaluate(() => {
        const ordens = Array.from(document.querySelectorAll<HTMLElement>("table.sv-cont tbody")).map((tb) => Array.from(tb.querySelectorAll("tr th")).map((t) => (t.textContent ?? "").trim()));
        const barras = Array.from(document.querySelectorAll<HTMLElement>(".sv-bar")).map((b) => (b.querySelector("b")?.textContent ?? "").trim());
        const texto = (document.querySelector(".sv-main") as HTMLElement).innerText;
        return { ordens, barras, semVoto: /Sem voto/.test(texto), naoContra: /não é voto contra/i.test(texto) };
      });
      for (const o of r.ordens) {
        tabelas++;
        if (o.join(",") !== "Sim,Não,Abstenção,Sem voto") falhas.push(`${url}: placar em ordem ${o.join(",")}`);
      }
      if (r.barras.length) {
        const idx = ["Sim", "Não", "Abstenção"].map((w) => r.barras.findIndex((b) => new RegExp(w, "i").test(b)));
        const achados = idx.filter((i) => i >= 0);
        if (JSON.stringify(achados) !== JSON.stringify([...achados].sort((a, b) => a - b))) falhas.push(`${url}: barras do placar em ordem ${r.barras.join(",")}`);
      }
      if (r.semVoto && !r.naoContra) falhas.push(`${url}: "Sem voto" sem "não é voto contra"`);
    }
    expect(tabelas, "nenhum placar encontrado: o teste não provaria nada").toBeGreaterThan(0);
    expect(falhas).toEqual([]);
  });

  test("esfera em palavra, sem estilo próprio; blocos de pessoa em Escolhidos com a mesma estrutura", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/acompanhando");
    const blocos = page.locator(".sv-esc__pessoas > section");
    expect(await blocos.count(), "três escolhidos de esferas diferentes").toBe(SIGO.length);
    const r = await blocos.evaluateAll((els) =>
      els.map((el) => {
        const e = el.querySelector(".sv-esc__e");
        const cs = e ? getComputedStyle(e) : null;
        const perguntas = Array.from(el.querySelectorAll(".sv-r3l")).map((l) => (l.querySelector(":scope > h3")?.textContent ?? "").trim());
        const esqueleto = (n: Element): string => `${n.tagName.toLowerCase()}.${String((n as HTMLElement).className)}`;
        const caixas = Array.from(el.querySelectorAll(":scope .sv-esc__h > *, :scope .sv-esc__h h2 > *")).map(esqueleto);
        const rc = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          nome: (el.querySelector(".sv-esc__n")?.textContent ?? "").trim(),
          esfera: (e?.textContent ?? "").trim(),
          estiloEsfera: cs ? [cs.color, cs.fontWeight, cs.fontSize, cs.backgroundColor, cs.borderTopWidth, cs.textTransform, cs.fontStretch].join("|") : "",
          perguntas,
          caixas,
          moldura: [s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.backgroundColor, Math.round(rc.width)].join("|"),
        };
      }),
    );
    for (const b of r) expect(b.esfera, `${b.nome}: esfera em palavra`).toMatch(/^Esfera: (Federal|Estadual|Municipal) · /);
    expect(new Set(r.map((b) => b.esfera)).size, "esferas diferentes entre as três pessoas").toBe(3);
    expect(new Set(r.map((b) => b.estiloEsfera)).size, "estilo da esfera igual para todas").toBe(1);
    expect(new Set(r.map((b) => b.moldura)).size, "moldura igual").toBe(1);
    expect(new Set(r.map((b) => b.caixas.join(","))).size, "cabeçalho com as mesmas caixas").toBe(1);
    expect(r[0].perguntas, "as 5 perguntas fixas").toEqual(["Foi trabalhar?", "Como votou?", "Quanto gastou o gabinete?", "O patrimônio declarado mudou?", "O que propôs?"]);
    for (const b of r) expect(b.perguntas, `perguntas de ${b.nome}`).toEqual(r[0].perguntas);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Conteúdo e estados
// ---------------------------------------------------------------------------------------------------------------------
const PROIBIDOS: [string, RegExp][] = [
  ["só neste aparelho", /s[óo] neste aparelho/i],
  ["Ouvir esta página", /ouvir esta p[áa]gina/i],
  ["etapa N de 6", /etapa\s+\d+\s+de\s+6/i],
  ["valor fictício da maquete: 3775/2025", /3775\s*\/\s*2025/],
  ["valor fictício da maquete: Pessoa de exemplo", /Pessoa de exemplo/i],
  ["valor fictício da maquete: R$ 312", /R\$\s*312/],
  ["Pessoa A/B/C da maquete", /\bPessoa [ABC]\b/],
];

test.describe("conteúdo", () => {
  for (const r of ROTAS)
    for (const leitor of LEITORES) {
      test(`frases proibidas ausentes, rodapé de verificação e lacuna nunca zero: ${r.nome} [${leitor}]`, async ({ page, context }) => {
        await cookiesDoLeitor(context, leitor);
        await abrir(page, r.url);
        const texto = await page.evaluate(() => document.body.innerText);
        const html = await page.content();
        const falhas: string[] = [];
        for (const [nome, re] of PROIBIDOS) {
          if (re.test(texto)) falhas.push(`texto contém ${nome}`);
          if (re.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) falhas.push(`HTML contém ${nome}`);
        }
        // o rodapé vale em toda página: diz a regra, nunca afirma quem conferiu ESTA página
        await expect(page.locator("footer.sv-rod")).toContainText("Cada resposta diz quem conferiu e quando. Votos, presença e gastos vêm da fonte oficial, com a data da leitura quando a fonte a registra.");
        await expect(page.locator("footer.sv-rod")).not.toContainText(/agentes de IA|por pessoa|não uma pessoa/i);
        const desc = await page.locator('meta[name="description"]').getAttribute("content");
        expect(desc ?? "", "description").not.toMatch(/Conferido por agentes|agentes de IA/i);
        // lacuna renderizada como 0 / R$ 0 (placar com contagem real fica de fora: 0 votos é dado, não lacuna)
        const zeros = await page.evaluate(() => {
          const out: string[] = [];
          document.querySelectorAll<HTMLElement>(".sv-main *").forEach((el) => {
            if (el.closest("table.sv-cont, .sv-bar, caption")) return;
            if (el.children.length > 0 && !/^(P|B|SPAN|TD|LI|DD)$/.test(el.tagName)) return;
            const t = (el.textContent ?? "").trim();
            if (/^(R\$\s*0([.,]00)?|0|0,0+|-|—|–)$/.test(t) && el.children.length === 0) out.push(`${el.tagName.toLowerCase()}.${el.className}: "${t}"`);
          });
          return out;
        });
        for (const z of zeros) falhas.push(`possível lacuna como zero: ${z}`);
        if (/R\$\s*0(?:,00)?(?![\d,.])/.test(texto)) falhas.push("texto contém 'R$ 0'");
        expect(falhas).toEqual([]);
      });
    }

  test("'Exemplo ilustrativo' presente no modo demo nas telas com dado fictício", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    const comDado = ROTAS.filter((r) => !["como-funciona", "ajustes", "404-decisao"].includes(r.nome));
    for (const r of comDado) {
      await abrir(page, r.url);
      const t = await page.locator(".sv").innerText();
      if (!/Exemplo ilustrativo/.test(t)) falhas.push(`${r.url}: sem "Exemplo ilustrativo" (só o banner "Versão de demonstração" existe: ${/Versão de demonstração/.test(t)})`);
    }
    expect(falhas).toEqual([]);
  });

  test("decisão sem respostas: 'Aguardando conferência'; nunca 'o texto não trata disso'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, `/decisao/${KEY_SEM_RESPOSTA}`);
    const t = await page.locator(".sv-main").innerText();
    expect(t).toContain("Aguardando conferência");
    expect(t).not.toContain("O texto oficial não trata disso.");
    // todo campo sem resposta é lacuna nomeada, não frase afirmativa
    await expect(page.locator('[aria-labelledby="sv-d1"] .sv-lac')).toContainText("Aguardando conferência");
    await expect(page.locator('[aria-labelledby="sv-d5"] .sv-lac')).toContainText("Aguardando conferência");
    // sem resposta publicada, o selo não afirma quem conferiu
    const selo = page.locator('[aria-labelledby="sv-d10"]');
    await expect(selo).toContainText("Esta proposta ainda não tem resposta publicada.");
    await expect(selo).not.toContainText(/agentes de IA|por pessoa|não uma pessoa|Conferido com o texto oficial/i);
  });

  test("decisão respondida: os três estados nos campos certos; 'não trata disso' só no nao_diz", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, `/decisao/${KEY_RESPONDIDA}`);
    const main = page.locator(".sv-main");
    // diz: o_que_propoe, quem_recebe, o_que_muda; frase + trecho + "Conferido ... por agentes de IA em dd/mm"
    await expect(page.locator('[aria-labelledby="sv-d1"]')).toContainText("Obriga a conta de luz a mostrar");
    await expect(page.locator('[aria-labelledby="sv-d1"]')).toContainText(/Conferido com o texto oficial por agentes de IA em \d{2}\/\d{2}/);
    await expect(page.locator('[aria-labelledby="sv-d1"] .sv-t').first()).toContainText("a fatura discriminará");
    await expect(page.locator('[aria-labelledby="sv-d5"]')).toContainText("Quem paga conta de luz em casa");
    await expect(page.locator('[aria-labelledby="sv-d3"] .sv-hs__m--se')).toContainText("A mudança é na forma de mostrar a conta");
    await expect(page.locator('[aria-labelledby="sv-d3"] .sv-hs__m--se .sv-hs__t')).toHaveText("Se aprovado");
    // nao_conferido: quem_paga e estimativa_impacto
    const quemPaga = page.locator(".sv-nc__l", { has: page.getByRole("heading", { name: "Quem paga?" }) });
    await expect(quemPaga).toContainText("Ainda não conseguimos conferir esta resposta.");
    await expect(quemPaga).not.toContainText("O texto oficial não trata disso.");
    const conta = page.locator(".sv-nc__l", { has: page.getByRole("heading", { name: "Quanto muda na conta?" }) });
    // dinheiro = nao_diz  -> frase de "não trata"; estimativa_impacto = nao_conferido -> "não conseguimos conferir"
    await expect(conta).toContainText("O texto oficial não trata disso.");
    await expect(conta).toContainText("Ainda não conseguimos conferir esta resposta.");
    expect(((await main.innerText()).match(/O texto oficial não trata disso\./g) ?? []).length, "a frase só pode aparecer 1× (campo nao_diz)").toBe(1);
    // "Hoje" nunca é afirmação: é lacuna
    await expect(page.locator('[aria-labelledby="sv-d3"] .sv-hs__m--hoje .sv-lac')).toContainText("Ainda não conseguimos conferir como é hoje.");
    // 'Aguardando conferência' é para proposta SEM respostas: não pode aparecer numa proposta respondida
    expect(await main.innerText()).not.toContain("Aguardando conferência");
  });

  // Quem conferiu bate com `verifiedBy` da resposta publicada da página, nos três ramos (fake: agentes, pessoa, sem registro).
  const QUEM: { key: string; por: string; frase: RegExp; nunca: RegExp }[] = [
    { key: KEY_RESPONDIDA, por: "agentes", frase: /Conferido com o texto oficial por agentes de IA em \d{2}\/\d{2}/, nunca: /revisad[ao] por pessoa|conferid[ao] por (uma )?pessoa/i },
    { key: "camara-pl-9998-2026", por: "pessoa", frase: /Revisado por pessoa em \d{2}\/\d{2}/, nunca: /agentes de IA|não uma pessoa|não por pessoa/i },
    { key: "camara-pl-9997-2026", por: "sem registro", frase: /Conferido com o texto oficial em \d{2}\/\d{2}/, nunca: /agentes de IA|por pessoa|não uma pessoa/i },
  ];
  for (const q of QUEM)
    test(`decisão: quem conferiu bate com o dado (${q.por}) na resposta e no selo`, async ({ page, context }) => {
      await cookiesDoLeitor(context, "leitor");
      await abrir(page, `/decisao/${q.key}`);
      await expect(page.locator('[aria-labelledby="sv-d1"] .sv-conf')).toHaveText(q.frase);
      await expect(page.locator('[aria-labelledby="sv-d10"] .sv-a')).toHaveText(q.frase);
      const t = await page.locator(".sv").innerText();
      expect(t, q.key).not.toMatch(q.nunca);
      expect(t, q.key).not.toMatch(/revis[ãa]o humana|síntese não conferida/i);
    });

  test("v1: quem conferiu continua com a data completa (dd/mm/aaaa)", async ({ page }) => {
    await page.goto(`/proposta/${KEY_RESPONDIDA}`);
    const t = await page.locator("main").innerText();
    expect(t).toMatch(/Conferido com o texto oficial por agentes de IA em \d{2}\/\d{2}\/\d{4}/);
    expect(t).not.toMatch(/Conferido com o texto oficial por agentes de IA em \d{2}\/\d{2}(?!\/\d{4})/);
  });

  test("selo de página sem resposta própria diz a regra e não afirma quem conferiu", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    for (const url of ["/", "/acompanhando", "/ajustes", "/temas", "/pessoa/helena-siqueira"]) {
      await abrir(page, url);
      const selo = page.locator("section.sv-quadro", { has: page.getByRole("heading", { name: "Quem conferiu isso?" }) });
      await expect(selo, url).toContainText("Cada resposta diz quem conferiu e quando.");
      await expect(selo, url).not.toContainText(/agentes de IA|por pessoa|não uma pessoa/i);
    }
  });

  test("sem UF não aparece estado assumido; com UF só a escolhida", async ({ page }) => {
    const ESTADOS = ["Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás", "Maranhão", "Mato Grosso do Sul", "Mato Grosso", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins"];
    const falhas: string[] = [];
    for (const url of ["/", "/acompanhando", "/ajustes", "/temas", "/decisoes"]) {
      await abrir(page, url);
      const t = await page.evaluate(() => {
        const c = document.querySelector(".sv")!.cloneNode(true) as HTMLElement;
        c.querySelectorAll("select, option").forEach((e) => e.remove());
        return c.innerText;
      });
      for (const e of ESTADOS) if (new RegExp(`(^|[^\\p{L}])${e}(?![\\p{L}])`, "u").test(t)) falhas.push(`${url}: sem UF, mas o texto cita "${e}"`);
      if (/\(\s*[A-Z]{2}\s*\)/.test(t.replace(/\(IA\)|\(PL\)|\(PEC\)|\(PLP\)|\(MPV\)|\(PDL\)|\(PLV\)/g, ""))) falhas.push(`${url}: sem UF, mas aparece sigla de estado entre parênteses`);
    }
    // convite no lugar do conteúdo que depende da UF: link para /ajustes dentro do conteúdo, não só no topo
    await abrir(page, "/");
    const convites = await page.locator('.sv-main a[href="/ajustes"]').allTextContents();
    if (!convites.some((t) => /Escolh\w* (o |meu |seu )?estado/i.test(t))) falhas.push(`início sem estado: nenhum convite "Escolha seu estado" no conteúdo (links para /ajustes: ${JSON.stringify(convites)})`);
    await expect(page.locator(".sv-topo").getByRole("link", { name: "Escolha seu estado" })).toBeVisible();
    expect(falhas).toEqual([]);
  });

  test("com UF: topo mostra a UF; pauta da Assembleia nunca é 'nada marcado'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    for (const r of ROTAS) {
      await abrir(page, r.url);
      const blocos = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".sv-main p, .sv-main li, .sv-main dd, .sv-main h3")).map((e) => e.innerText.replace(/\s+/g, " ")));
      for (const b of blocos) {
        if (/Assembleia/.test(b) && /(nada|nenhum[ao]?)[^.]{0,40}(marcad[ao]|na pauta|prevista)|sem pauta/i.test(b)) falhas.push(`${r.url}: descreve a pauta da Assembleia como vazia: "${b.slice(0, 120)}"`);
        if (/pauta da Assembleia/i.test(b) && !/n[ãa]o faz parte do que lemos hoje/i.test(b)) falhas.push(`${r.url}: fala da pauta da Assembleia sem dizer que não faz parte do que lemos: "${b.slice(0, 120)}"`);
      }
    }
    await abrir(page, "/");
    await expect(page.locator(".sv-uf")).toContainText("São Paulo (SP)");
    expect(falhas).toEqual([]);
  });

  // Decisão declarada na PR: quem o leitor marcou continua aparecendo mesmo de esfera desligada. O que o municipal
  // desligado tira da tela é a esfera em si: prefeito e vereadores em "Quem mais me representa?" e o "O que lemos".
  for (const caso of [
    { nome: "municipal desligado (padrão)", esferas: null, municipal: false },
    { nome: "municipal ligado, com cidade", esferas: "e1.m1.c3550308", municipal: true },
  ])
    test(`esferas: ${caso.nome}; escolhidos de esfera desligada continuam no Início, em Escolhidos e na Decisão`, async ({ page, context }) => {
      await cookiesDoLeitor(context, "leitor");
      if (caso.esferas) await context.addCookies([{ name: "sv_esferas", value: caso.esferas, domain: "localhost", path: "/" }]);
      const nome = "Bruno Sampaio"; // vereador (Esfera: Municipal)
      for (const url of ["/", "/acompanhando", `/decisao/${KEY_RESPONDIDA}`]) {
        await abrir(page, url);
        await expect(page.locator(".sv-main"), `${url}: a pessoa marcada aparece com qualquer esfera`).toContainText(nome);
      }
      await abrir(page, "/");
      const representa = page.locator('[aria-labelledby="inicio-representa"]');
      const lemos = page.locator(".sv-lemos");
      if (caso.municipal) {
        await expect(representa).toContainText(/\d+ vereador(es)?\b/);
        await expect(representa).not.toContainText("Prefeito e vereadores: desligado.");
        await expect(lemos).toContainText("Municipal: ligado.");
      } else {
        await expect(representa).toContainText("Prefeito e vereadores: desligado.");
        await expect(representa).not.toContainText(/\b(vereador(es)?|prefeitos?)\b[^:]/);
        await expect(lemos).toContainText("Municipal: desligado.");
      }
      // a Decisão não esconde ninguém nem fala de "esferas desligadas"
      await abrir(page, `/decisao/${KEY_RESPONDIDA}`);
      await expect(page.locator('[aria-labelledby="sv-d8"]')).not.toContainText(/esferas? desligadas?|não aparecem?/i);
    });

  test("a fonte citada numa lacuna é a da esfera da pessoa (nada de Assembleia para vereador, nem Câmara Municipal para deputado)", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    for (const url of ["/", "/acompanhando"]) {
      await abrir(page, url);
      const todos = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".sv-esc__pessoas > section, ul.sv-esc > li")).map((e) => e.innerText.replace(/\s+/g, " ")));
      expect(todos.length, `${url}: blocos de pessoa encontrados`).toBeGreaterThanOrEqual(3);
      for (const b of todos) {
        const esfera = /Esfera: (Federal|Estadual|Municipal)/.exec(b)?.[1];
        if (esfera === "Municipal" && /Assembleia Legislativa/.test(b)) falhas.push(`${url}: pessoa municipal com fonte "Assembleia Legislativa": ${b.slice(0, 160)}`);
        if (esfera === "Federal" && /(Assembleia Legislativa|Câmara Municipal|Câmara de Vereadores)/.test(b.replace(/Esfera: Federal · [^.]*/, ""))) falhas.push(`${url}: pessoa federal com fonte de outra esfera: ${b.slice(0, 160)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  test("Ajustes: texto de cookie sem 'só neste aparelho' e com o servidor explicado", async ({ page }) => {
    await abrir(page, "/ajustes");
    const t = await page.locator(".sv-main").innerText();
    expect(t).toMatch(/cookie neste navegador/i);
    expect(t).toMatch(/O servidor lê esse cookie/);
    expect(t).not.toMatch(/s[óo] neste aparelho/i);
  });

  test("Início: 'O que lemos' e fontes com data", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/");
    const t = await page.locator(".sv-main").innerText();
    expect(t).toMatch(/lid[ao]s? em \d{2}\/\d{2}\/\d{4}|Leitura das fontes/);
    // toda "Fonte:" de afirmação traz data de leitura; a fonte de uma lacuna ("Ainda não temos esse dado.") só nomeia a fonte (§6)
    const fontes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".sv-main .sv-fonte, .sv-main .sv-prova, .sv-main .sv-src"))
        .filter((e) => /^Fonte/.test(e.innerText.trim()) && !e.previousElementSibling?.matches(".sv-lac"))
        .map((e) => e.innerText.replace(/\s+/g, " ").trim())
        .filter((x) => !/\d{2}\/\d{2}|lida|lido|leitura/i.test(x)),
    );
    expect(fontes, "afirmações com fonte sem data").toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Leitura que falhou vira lacuna nomeada, nunca fato ("ninguém", "nenhum", "aguardando"). `?simular=` só vale na demo.
// ---------------------------------------------------------------------------------------------------------------------
const FALHOU = "Não conseguimos ler esta fonte agora.";

test.describe("leitura que falhou", () => {
  test("Escolhidos: a leitura das pessoas falha -> lacuna nomeada, nunca 'você ainda não marcou ninguém'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/acompanhando?simular=erro");
    const main = page.locator(".sv-main");
    await expect(main).toContainText(FALHOU);
    await expect(main).toContainText(`${SIGO.length} pessoas que você marcou não puderam ser lidas.`);
    await expect(main).not.toContainText("Você ainda não marcou ninguém.");
  });

  test("Escolhidos: cada conjunto e a atividade falham -> 'não conseguimos ler', nunca 'ainda não temos' nem 'sem registro'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/acompanhando?simular=erro_dados");
    const blocos = page.locator(".sv-esc__pessoas > section");
    await expect(blocos).toHaveCount(SIGO.length);
    for (const b of await blocos.all()) {
      const nome = (await b.locator(".sv-esc__n").innerText()).trim();
      for (const q of ["Foi trabalhar?", "Como votou?", "Quanto gastou o gabinete?", "O patrimônio declarado mudou?", "O que propôs?"]) {
        const linha = b.locator(".sv-r3l", { has: page.getByRole("heading", { name: q, exact: true }) });
        await expect(linha, `${nome}: ${q}`).toContainText(FALHOU);
        await expect(linha, `${nome}: ${q}`).not.toContainText("Ainda não temos esse dado.");
      }
    }
    const recentes = page.locator('[aria-labelledby="esc-recentes"]');
    await expect(recentes).toContainText(FALHOU);
    await expect(recentes).not.toContainText("Ainda não temos registro recente");
  });

  test("Decisão: a leitura dos escolhidos falha -> lacuna por pessoa, nunca 'você ainda não escolheu ninguém'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, `/decisao/${KEY_RESPONDIDA}?simular=erro`);
    const q = page.locator('[aria-labelledby="sv-d8"]');
    await expect(q.locator(".sv-pes > li")).toHaveCount(SIGO.length);
    for (const li of await q.locator(".sv-pes > li").all()) await expect(li).toContainText("Não conseguimos ler os dados desta pessoa agora.");
    await expect(q).not.toContainText("Você ainda não escolheu ninguém.");
  });

  test("Decisão: sem cookie, e só sem cookie, 'você ainda não escolheu ninguém'", async ({ page }) => {
    await abrir(page, `/decisao/${KEY_RESPONDIDA}`);
    await expect(page.locator('[aria-labelledby="sv-d8"]')).toContainText("Você ainda não escolheu ninguém.");
  });

  test("Início: pauta da Câmara não lida -> lacuna, nunca 'nenhuma proposta traz tema oficial'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/?simular=camara_nao_lida");
    const q = page.locator('[aria-labelledby="inicio-congresso"]');
    await expect(q).toContainText("A pauta da Câmara desta semana ainda não foi lida.");
    await expect(q).not.toContainText(/Nenhuma proposta/);
    // sem a simulação, a mesma tela tem o tema oficial da pauta lida
    await abrir(page, "/");
    await expect(page.locator('[aria-labelledby="inicio-congresso"]')).toContainText("Na pauta do Congresso desta semana:");
  });

  test("Início: leituras falham -> escolhidos, resposta da semana e representantes viram lacuna nomeada", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/?simular=erro");
    const esc = page.locator('[aria-labelledby="inicio-escolhidos"]');
    await expect(esc).toContainText(FALHOU);
    await expect(esc).not.toContainText("Marque as pessoas em quem você votou.");
    // o item com resposta publicada cuja leitura falhou não vira "Aguardando conferência"
    const item = page.locator(".sv-dec", { has: page.locator(`a[href="/decisao/${KEY_RESPONDIDA}"]`) });
    await expect(item).toContainText("Não conseguimos ler esta resposta agora.");
    await expect(item).not.toContainText("Aguardando conferência");
    // e quem não tem resposta publicada continua "Aguardando conferência"
    await expect(page.locator(".sv-dec", { has: page.locator(`a[href="/decisao/${KEY_SEM_RESPOSTA}"]`) })).toContainText("Aguardando conferência.");
    const rep = page.locator('[aria-labelledby="inicio-representa"]');
    await expect(rep).toContainText(FALHOU);
    await expect(rep).not.toContainText("Ainda não temos esse dado");
  });

  test("Início: sem simulação, o item respondido mostra a resposta lida", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/");
    const item = page.locator(".sv-dec", { has: page.locator(`a[href="/decisao/${KEY_RESPONDIDA}"]`) });
    await expect(item).toContainText("A mudança é na forma de mostrar a conta");
    await expect(item).not.toContainText(/Aguardando conferência|Não conseguimos ler/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Cookie sv_sigo: path=/ desde a D316 (a Direção 2 saiu do /v2); quem leva a cópia do protótipo para a raiz é a rota /v2
// ---------------------------------------------------------------------------------------------------------------------
test("sv_sigo: gravado em path=/, um cookie só", async ({ page, context }) => {
  await context.addCookies([{ name: "sv_sigo", value: "bruno-sampaio", domain: "localhost", path: "/" }]);
  await abrir(page, "/pessoa/helena-siqueira");
  await page.getByRole("button", { name: /Votei nesta pessoa/ }).click();
  await expect(page.getByRole("button", { name: "Você acompanha" })).toHaveAttribute("aria-pressed", "true");
  const sigo = (await context.cookies()).filter((c) => c.name === "sv_sigo");
  expect(sigo, "um só cookie sv_sigo").toHaveLength(1);
  expect(sigo[0].path).toBe("/");
  expect(sigo[0].value.split(".").sort()).toEqual(["bruno-sampaio", "helena-siqueira"]);
  // D317: o cookie antigo (legível por script) vira httpOnly no primeiro toque, e a página não o enxerga
  expect(sigo[0].httpOnly, "httpOnly").toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("sv_sigo");
  await abrir(page, "/acompanhando");
  await expect(page.locator(".sv-esc__pessoas .sv-esc__n")).toHaveText(["Bruno Sampaio", "Helena Siqueira"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// prefers-reduced-motion
// ---------------------------------------------------------------------------------------------------------------------
test.describe("movimento", () => {
  for (const r of ROTAS) {
    test(`reduced-motion: sem animação nem transição ativa: ${r.nome}`, async ({ page, context }) => {
      await cookiesDoLeitor(context, "leitor");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await abrir(page, r.url);
      const res = await page.evaluate(() => {
        const dur = (s: string) => s.split(",").reduce((m, x) => Math.max(m, parseFloat(x) * (x.trim().endsWith("ms") ? 0.001 : 1)), 0);
        const out: string[] = [];
        document.querySelectorAll(".sv, .sv *").forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.animationName !== "none" && dur(cs.animationDuration) > 0) out.push(`animação ${cs.animationName} em ${el.tagName}.${(el as HTMLElement).className}`);
          if (dur(cs.transitionDuration) > 0 && cs.transitionProperty !== "none") out.push(`transição ${cs.transitionProperty} ${cs.transitionDuration} em ${el.tagName}.${(el as HTMLElement).className}`);
          if (cs.scrollBehavior === "smooth") out.push(`scroll suave em ${el.tagName}.${(el as HTMLElement).className}`);
        });
        return { out: out.slice(0, 10), ativas: document.getAnimations().length };
      });
      expect(res.out).toEqual([]);
      expect(res.ativas, "document.getAnimations()").toBe(0);
    });

    test(`movimento normal só com transform e opacity: ${r.nome}`, async ({ page, context }) => {
      await cookiesDoLeitor(context, "leitor");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await abrir(page, r.url);
      const out = await page.evaluate(() => {
        const dur = (s: string) => s.split(",").reduce((m, x) => Math.max(m, parseFloat(x) * (x.trim().endsWith("ms") ? 0.001 : 1)), 0);
        const falhas: string[] = [];
        document.querySelectorAll(".sv, .sv *").forEach((el) => {
          const cs = getComputedStyle(el);
          if (dur(cs.transitionDuration) > 0) {
            const props = cs.transitionProperty.split(",").map((p) => p.trim());
            if (props.some((p) => p !== "transform" && p !== "opacity")) falhas.push(`transição de ${cs.transitionProperty} em ${el.tagName}.${(el as HTMLElement).className}`);
          }
        });
        return falhas.slice(0, 8);
      });
      expect(out).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Capturas de página inteira para inspeção visual (390 e 1280, com os cookies de leitor)
// ---------------------------------------------------------------------------------------------------------------------
test.describe("capturas", () => {
  const alvos: [string, string][] = [
    ["inicio", "/"],
    ["acompanhando", "/acompanhando"],
    ["pessoa", "/pessoa/helena-siqueira"],
    ["decisao", `/decisao/${KEY_RESPONDIDA}`],
    ["temas", "/temas"],
    ["ajustes", "/ajustes"],
    ["votacoes", "/votacoes"],
    ["votacao-uf", "/votacao/camara-v2026-15?uf=SP"],
    ["decisoes", "/decisoes"],
    ["pessoas", "/pessoas"],
    ["tema", "/tema/agro"],
    ["como-funciona", "/como-funciona"],
    ["404", "/decisao/nao-existe"],
  ];
  for (const [nome, url] of alvos)
    for (const width of [390, 1280]) {
      test(`captura ${nome} ${width}`, async ({ page, context }, info) => {
        await cookiesDoLeitor(context, "leitor");
        await page.setViewportSize({ width, height: 900 });
        await abrir(page, url);
        // pasta de saída do próprio teste (test-results/…): vale em qualquer máquina, inclusive no CI em Linux
        await page.screenshot({ path: info.outputPath(`${nome}-${width}.png`), fullPage: true });
      });
    }
});

// ---------------------------------------------------------------------------------------------------------------------
// Perfil de celular de verdade (Pixel 7, toque, UA móvel): blocos em coluna única, sem sobreposição nem rolagem horizontal
// ---------------------------------------------------------------------------------------------------------------------
test.describe("celular @mobile", () => {
  for (const r of ROTAS) {
    test(`coluna única, sem sobreposição e sem rolagem horizontal @mobile: ${r.nome}`, async ({ page, context }) => {
      await cookiesDoLeitor(context, "leitor");
      await abrir(page, r.url);
      const res = await page.evaluate(() => {
        const raiz = document.querySelector(".sv-pg") ?? document.querySelector(".sv-main");
        const blocos = Array.from(raiz?.children ?? []).filter((el) => el.getBoundingClientRect().height > 0);
        const out: string[] = [];
        for (let i = 0; i < blocos.length; i++)
          for (let j = i + 1; j < blocos.length; j++) {
            const a = blocos[i].getBoundingClientRect();
            const b = blocos[j].getBoundingClientRect();
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`${(blocos[i] as HTMLElement).className} x ${(blocos[j] as HTMLElement).className}`);
          }
        return { out: out.slice(0, 5), sobra: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(res.out, "sobreposição de blocos").toEqual([]);
      expect(res.sobra).toBeLessThanOrEqual(0);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Contrato de cobertura, cadeiras por UF e listas sem truncar (fonte demo: casos fixos de fake.ts)
// ---------------------------------------------------------------------------------------------------------------------
test.describe("cobertura por pessoa", () => {
  // um caso da demonstração por estado de lacuna; `lido` aparece como fonte com a data da carga
  const CASOS: { slug: string; quem: string; estados: string[] }[] = [
    { slug: "alvaro-teixeira-sp", quem: "deputado estadual (Assembleia não simulada)", estados: ["nao_conferido", "nao_carregado"] },
    { slug: "carlos-machado-sp", quem: "governador (Executivo)", estados: ["nao_se_aplica"] },
    { slug: "alvaro-cardoso-rj", quem: "eleito aguardando posse", estados: ["fora_do_mandato"] },
    { slug: "alvaro-coutinho-sp", quem: "vereador", estados: ["sem_fonte", "fonte_sem_adaptador"] },
    // vereador da capital paulista: a demo marca a câmara como lida pelo SAPL (DEMO_SAPL_IBGE)
    { slug: "alvaro-teixeira-sp-2", quem: "vereador com câmara lida pelo SAPL", estados: ["carregado_fora_da_pagina"] },
  ];
  for (const c of CASOS)
    test(`Pessoa: ${c.quem} mostra ${c.estados.join(", ")} com frase e motivo, nunca zero`, async ({ page }) => {
      await abrir(page, `/pessoa/${c.slug}`);
      for (const e of c.estados) {
        const lac = page.locator(`.sv-lac[data-cobertura="${e}"]`);
        await expect(lac.first(), e).toBeVisible();
        // toda lacuna de cobertura traz um motivo legível
        for (const l of await lac.all()) await expect(l.locator(".sv-sm"), e).not.toBeEmpty();
      }
      const lacunas = await page.locator(".sv-lac[data-cobertura]").allInnerTexts();
      for (const t of lacunas) expect(t, "lacuna não vira número").not.toMatch(/^\s*0\b/);
    });

  test("Pessoa: os estados de cobertura têm frases distintas (não carregamos x a fonte não publica x não se aplica…)", async ({ page }) => {
    const frases = new Map<string, string>();
    for (const c of CASOS) {
      await abrir(page, `/pessoa/${c.slug}`);
      for (const l of await page.locator(".sv-lac[data-cobertura]").all()) {
        const e = (await l.getAttribute("data-cobertura"))!;
        const t = (await l.locator(".sv-lac__liso").evaluate((n) => n.firstChild?.textContent ?? "")).trim();
        if (!frases.has(e)) frases.set(e, t);
        else expect(t, e).toBe(frases.get(e));
      }
    }
    expect([...frases.keys()].sort()).toEqual(["carregado_fora_da_pagina", "fonte_sem_adaptador", "fora_do_mandato", "nao_carregado", "nao_conferido", "nao_se_aplica", "sem_fonte"]);
    expect(new Set(frases.values()).size, "uma frase por estado").toBe(frases.size);
  });

  test("Pessoa: conjunto lido cita a fonte com a data da carga; conjunto não carregado não ganha data", async ({ page }) => {
    await abrir(page, "/pessoa/alvaro-aguiar-sp"); // deputado federal
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Foi trabalhar?" }) });
    await expect(sec.locator(".sv-fonte")).toContainText(/Câmara dos Deputados.*lida em \d{2}\/\d{2}\/\d{4}/);
    // equipe e comissões não são simuladas: "não carregamos", e a fonte não ganha data
    for (const q of ["Quem trabalha no gabinete?", "Em que comissões está?"]) {
      const s = page.locator("section", { has: page.getByRole("heading", { name: q }) });
      await expect(s.locator('.sv-lac[data-cobertura="nao_carregado"]'), q).toBeVisible();
      await expect(s.locator(".sv-fonte"), q).not.toContainText(/lida em/);
    }
  });

  test("Escolhidos: o estado de cada conjunto vem do contrato; leitura que falha não afirma estado", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/acompanhando");
    const est = page.locator(".sv-esc__pessoas > section", { hasText: "Esfera: Estadual" });
    await expect(est.locator('.sv-lac[data-cobertura="nao_conferido"]').first()).toBeVisible();
    await abrir(page, "/acompanhando?simular=erro_dados");
    await expect(page.locator(".sv-lac[data-cobertura]")).toHaveCount(0);
  });

  test("Pessoa: salário sem carimbo de carga diz que a data não está registrada (não inventa 'lida em')", async ({ page }) => {
    await abrir(page, "/pessoa/alvaro-aguiar-sp");
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Quanto recebe?" }) });
    await expect(sec.locator(".sv-fonte")).toContainText("Data da carga não registrada.");
    await expect(sec.locator(".sv-fonte")).not.toContainText(/lida em/);
  });
});

test.describe("placar por UF na votação", () => {
  test("UF escolhida: contagem por voto ao lado das cadeiras legais da UF (SP = 70)", async ({ page }) => {
    await abrir(page, "/votacao/camara-v2026-15?uf=SP");
    const p = page.locator('[data-placar-uf="SP"]');
    await expect(p).toContainText(/SP: \d+ registros? nesta votação, de 70 cadeiras de SP na Câmara\./);
    await expect(p).toContainText("Lei Complementar 78/1993");
    await expect(p).toContainText("não quer dizer ausência");
    // a soma das contagens mostradas fecha com os registros da UF
    const t = (await p.locator("p").first().innerText()).replace(/\s+/g, " ");
    const reg = Number(/SP: (\d+) registro/.exec(t)![1]);
    const soma = [...t.matchAll(/[a-zãíç ]: (\d+)\./gi)].map((m) => Number(m[1])).reduce((s, n) => s + n, 0);
    expect(soma).toBe(reg);
  });

  test("votação sem voto individual: placar por UF é lacuna com motivo, nunca tabela de zeros", async ({ page }) => {
    await abrir(page, "/votacao/camara-demo-sem-votos?uf=SP");
    await expect(page.locator("body")).toContainText("não há placar por estado");
    await expect(page.locator("[data-placar-uf]")).toHaveCount(0);
    // nem o placar geral vira barras de zeros: lacuna nomeada no lugar
    await expect(page.locator("[data-sem-voto-individual]")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("0 registros nesta votação");
    await expect(page.locator('[role="img"][aria-label^="Sim 0"]')).toHaveCount(0);
    // a demo não publicou o placar total (nulo): nada de "0 sim e 0 não" inventado
    await expect(page.locator("body")).not.toContainText("Placar total publicado pela fonte");
  });
});

test.describe("listas sem truncar em silêncio", () => {
  test("Decisão: '5 de 7' votações e '20 de 23' autores", async ({ page }) => {
    await abrir(page, "/decisao/camara-pl-9996-2026");
    const q = page.locator('[aria-labelledby="sv-d8"]');
    await expect(q).toContainText("Mostrando as 5 mais recentes de 7 votações que lemos desta proposta.");
    await expect(q.locator(".sv-vt")).toHaveCount(5);
    const aut = page.locator(".sv-aut > li");
    await expect(aut).toHaveCount(20);
    await expect(page.locator("body")).toContainText("Mostrando 20 de 23 autores que lemos");
    // autoria principal primeiro, depois ordem alfabética. No fixture o campo legado `authors` (ordem de assinatura) tem
    // outra ordem e outros 20: se a tela voltar a listá-lo sob esta nota, as duas conferências abaixo falham.
    await expect(aut.first()).toContainText("autoria principal");
    const resto = (await aut.allInnerTexts()).slice(1).map((t) => t.replace(/\s*coautoria\s*$/, "").trim());
    expect(resto, "a lista segue a ordem que a nota declara").toEqual([...resto].sort((a, b) => a.localeCompare(b, "pt-BR")));
    // o v1 segue lendo o campo legado: lá os coautores vêm na ordem inversa, e os primeiros por nome ficam de fora
    const v1 = await page.goto("/proposta/camara-pl-9996-2026");
    expect(v1?.status(), "o v1 da proposta responde").toBe(200);
    const legado = (await page.locator("li", { hasText: "· coautoria" }).allInnerTexts()).map((t) => t.replace(/\s*·\s*coautoria\s*$/, "").trim());
    expect(legado, "o v1 lista 19 coautores").toHaveLength(19);
    expect(legado, "o v1 segue na ordem do campo legado").toEqual([...legado].sort((a, b) => b.localeCompare(a, "pt-BR")));
    expect(resto.filter((n) => !legado.includes(n)).length, "os 20 do campo legado não são os 20 da lista alfabética").toBeGreaterThan(0);
  });

  test("Decisão: lista que cabe inteira não diz 'mostrando'", async ({ page }) => {
    await abrir(page, `/decisao/${KEY_RESPONDIDA}`);
    await expect(page.locator("body")).not.toContainText(/Mostrando \d+ (de|as)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 404 do site: endereço inexistente e notFound() de uma tela caem no mesmo 404, dentro do casco novo, sem afirmar que o registro não existe
// ---------------------------------------------------------------------------------------------------------------------
test.describe("404 do site", () => {
  for (const url of ["/decisao/nao-existe", "/votacao/nao-existe", "/tema/nao-existe"])
    test(`404 no casco D2: ${url}`, async ({ page }) => {
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(404);
      await expect(page.locator(".sv h1")).toHaveText("Não consta");
      await expect(page.getByRole("navigation", { name: "Perguntas" })).toBeVisible();
      await expect(page.locator("header.sticky")).toHaveCount(0);
      const q = page.locator('[aria-labelledby="nf-1"]');
      await expect(q).toContainText("Não encontramos esta página.");
      await expect(q).toContainText("não quer dizer que a pessoa, a proposta ou a votação não existam");
      await expect(page.locator('[aria-labelledby="nf-2"] a[href="/"]')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Estados das sete telas redesenhadas depois da PR #22 (fonte demo): truncado dito, janela dita, leitura que falha
// ---------------------------------------------------------------------------------------------------------------------
test.describe("estados das sete telas", () => {
  test("endereço inexistente: 404 legível sem JavaScript (sai no HTML, dentro do casco da D2)", async ({ browser }, info) => {
    const context = await semJs(browser, info, "anon");
    const page = await context.newPage();
    const res = await page.goto("/nao-existe");
    expect(res?.status()).toBe(404);
    expect((await page.locator("body").innerText()).trim().length, "corpo legível sem JavaScript").toBeGreaterThan(20);
    await context.close();
  });

  test("Votações: lista truncada dita como truncada e teto de 200 dito", async ({ page }) => {
    await abrir(page, "/votacoes");
    const lista = page.locator('[aria-labelledby="vts-2"]');
    await expect(lista).toContainText(/Mostrando 30 de \d+\./);
    await expect(lista.getByRole("link", { name: /^Mostrar mais \d+$/ })).toBeVisible();
    await expect(lista.locator(".sv-vl")).toHaveCount(30);
    // pedido acima do teto: o teto dito é o número de itens DEVOLVIDOS pela fonte, e não há "Mostrar mais" que nada acrescenta
    await abrir(page, "/votacoes?n=200");
    const q2 = page.locator('[aria-labelledby="vts-2"]');
    const teto = /Esta lista vai até (\d+): as mais antigas ficam fora desta página\./.exec(await q2.innerText())?.[1];
    expect(teto, "frase do teto").toBeTruthy();
    await expect(q2.locator(".sv-vl")).toHaveCount(Number(teto));
    expect(Number(teto)).toBeLessThanOrEqual(100);
    await expect(page.locator('[aria-labelledby="vts-2"]').getByRole("link", { name: /^Mostrar mais/ })).toHaveCount(0);
  });

  test("Votações: placar total que a fonte não publicou vira lacuna, nunca 'Sim: 0'", async ({ page }) => {
    await abrir(page, "/votacoes");
    const lista = page.locator('[aria-labelledby="vts-2"]');
    // a 2ª votação da Câmara na demo sai com placarFonte nulo (fake.ts)
    const item = lista.locator(".sv-vl").nth(1);
    await expect(item.locator(".sv-lac")).toContainText("A fonte não publicou o placar total desta votação.");
    await expect(item.locator(".sv-pl")).toHaveCount(0);
    await expect(item).not.toContainText(/Sim: 0|Não: 0/);
  });

  test("leitura que falha vira lacuna nomeada (Votações, Decisões nas duas abas, Pessoas)", async ({ page }) => {
    for (const url of ["/votacoes?simular=erro", "/decisoes?simular=erro", "/decisoes?aba=leis&simular=erro", "/pessoas?simular=erro"]) {
      await abrir(page, url);
      const main = page.locator(".sv-main");
      await expect(main, url).toContainText(FALHOU);
      await expect(main, url).not.toContainText(/Nenhuma votação|Nada do que acompanhamos|Nenhuma pessoa encontrada|Ainda não temos esse dado/);
    }
    // Votação e Tema: a leitura principal falha -> lacuna nomeada na tela (200), nunca erro 500 nem 404
    for (const url of ["/votacao/camara-v2026-15?simular=erro", "/tema/agro?simular=erro"]) {
      await abrir(page, url);
      await expect(page.locator('[aria-labelledby="falha-1"]'), url).toContainText(FALHOU);
      await expect(page.locator(".sv-main"), url).toContainText("Isso não quer dizer que o registro não existe");
    }
    await abrir(page, "/pessoas?cidade=3509502&grupo=vereadores&simular=erro");
    await expect(page.locator('[aria-labelledby="pp-lugar"]')).toContainText(FALHOU);
    await expect(page.locator(".sv h1")).toHaveText("Quem está no cargo?");
  });

  test("Decisões: o último dia da semana é o anterior a weekEnds; 'Aguardando conferência' só sem resposta publicada", async ({ page }) => {
    await abrir(page, "/decisoes");
    const titulo = await page.locator('[aria-labelledby="dc-plen"] h2').innerText();
    const resposta = await page.locator('[aria-labelledby="dc-1"] .sv-a').innerText();
    // esperado a partir do fixture: a semana da demo (fake.ts demoWeek) vai de segunda 00:00 em Brasília (03:00Z) a
    // weekEnds = segunda seguinte (exclusivo). O último dia é o domingo, weekEnds menos um dia.
    const agora = new Date();
    const dow = (agora.getUTCDay() + 6) % 7;
    const weekEnds = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() - dow, 3) + 7 * 86400e3;
    const esperado = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(weekEnds - 86400e3));
    expect(titulo).toContain(`até ${esperado}?`);
    expect(resposta).toContain(`até ${esperado}.`);
    const semResposta = page.locator(".sv-pi", { has: page.locator(`a[href="/decisao/${KEY_SEM_RESPOSTA}"]`) });
    await expect(semResposta.first()).toContainText("Aguardando conferência");
    const respondida = page.locator(".sv-pi", { has: page.locator(`a[href="/decisao/${KEY_RESPONDIDA}"]`) });
    await expect(respondida.first()).not.toContainText("Aguardando conferência");
  });

  test("Decisões: com só uma Casa lida, a prova nomeia a Casa e o selo fica sem data; com as duas, prova e selo dizem a mesma data", async ({ page }) => {
    await abrir(page, "/decisoes?simular=camara_nao_lida");
    await expect(page.locator('[aria-labelledby="dc-1"]')).toContainText("A pauta da Câmara dos Deputados ainda não foi lida.");
    await expect(page.locator('[aria-labelledby="dc-1"]')).toContainText(/só a pauta do Senado Federal foi lida, em \d{2}\/\d{2}\/\d{4}/);
    await expect(page.locator('[aria-labelledby="dc-selo"]')).not.toContainText("Leitura das fontes");
    await abrir(page, "/decisoes");
    await expect(page.locator('[aria-labelledby="dc-1"]')).not.toContainText(/ainda não foi lida/);
    const selo = /Leitura das fontes: (\d{2}\/\d{2}\/\d{4}[^.]*)\./.exec(await page.locator('[aria-labelledby="dc-selo"]').innerText());
    expect(selo, "selo com data").not.toBeNull();
    await expect(page.locator('[aria-labelledby="dc-1"]')).toContainText(`lida em ${selo![1]}`);
  });

  test("Pessoas: página truncada dita; Tema diz a janela de leitura", async ({ page }) => {
    await abrir(page, "/pessoas");
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText(/Esta página mostra 60 de [\d.]+\./);
    await expect(page.locator(".sv-pp > li")).toHaveCount(60);
    await abrir(page, "/tema/agro");
    await expect(page.locator('[aria-labelledby="tm1-1"]')).toContainText(/Contamos entre as [\d.]+ votações mais recentes que lemos das duas Casas, de um total de [\d.]+\./);
  });

  test("Pessoas: página inválida é entrada inválida, não falha da fonte", async ({ page }) => {
    for (const p of ["Infinity", "1e308", "1.5", "-3", "abc", "1234567"]) {
      await abrir(page, `/pessoas?pagina=${encodeURIComponent(p)}`);
      const q = page.locator('[aria-labelledby="pp-2"]');
      await expect(q, p).not.toContainText(FALHOU);
      await expect(q, p).toContainText("O endereço pedia uma página que não existe. Mostramos o começo da lista.");
      await expect(page.locator(".sv-pp > li"), p).toHaveCount(60);
    }
    await abrir(page, "/pessoas?pagina=999999");
    await expect(page.locator('[aria-labelledby="pp-2"]')).toContainText("Esta página fica depois do fim da lista.");
  });

  test("Como funciona: as âncoras que outras telas usam existem", async ({ page }) => {
    await abrir(page, "/como-funciona");
    for (const id of ["verificacao", "fontes", "regras", "correcoes"]) await expect(page.locator(`#${id}`), id).toHaveCount(1);
  });

  test("CSS da tela chega também por navegação do cliente (rodapé → Votações)", async ({ page }) => {
    await abrir(page, "/");
    await page.locator("footer.sv-rod").getByRole("link", { name: "Votações" }).click();
    await expect(page).toHaveURL(/\/votacoes$/);
    // regra que só existe em sv-votacoes.css (importado pela página, não pelo layout)
    await expect(page.locator(".sv-pg--vts > .sv-abas")).toHaveCSS("margin-top", "2px");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Rotas da Pessoa: gastos, equipe e votos (bloco próprio da PR "gastos, equipe e votos da Pessoa no /")
// ---------------------------------------------------------------------------------------------------------------------
const dataBR = (t: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

test.describe("rotas da Pessoa", () => {
  test("nenhum link da Pessoa na D2 vai para o perfil v1 (/p/)", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    for (const url of ["/pessoa/helena-siqueira", "/pessoa/alvaro-aguiar-sp", "/pessoa/alvaro-coutinho-sp", ...ROTAS_PESSOA_SUB.map((r) => r.url)]) {
      await abrir(page, url);
      const v1 = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => new URL(a.href, location.href).pathname.startsWith("/p/")).map((a) => a.getAttribute("href")));
      expect(v1, url).toEqual([]);
    }
    // os três links da Pessoa levam às rotas novas
    await abrir(page, "/pessoa/helena-siqueira");
    await expect(page.getByRole("link", { name: "Ver nota por nota" })).toHaveAttribute("href", "/pessoa/helena-siqueira/gastos");
    await expect(page.getByRole("link", { name: "Ver todos os votos" })).toHaveAttribute("href", "/pessoa/helena-siqueira/votos");
  });

  test("gastos: notas da mais recente para a mais antiga, categorias A–Z, nunca por valor", async ({ page }) => {
    await abrir(page, "/pessoa/helena-siqueira/gastos");
    const datas = (await page.locator(".sv-notas .sv-notas__d").allInnerTexts()).map(dataBR);
    expect(datas.length).toBeGreaterThan(5);
    expect(datas.every(Boolean), "toda nota tem data").toBe(true);
    expect(datas, "ordem cronológica, mais recente primeiro").toEqual([...datas].sort().reverse());
    const opcoes = (await page.locator("#g-cat option").allInnerTexts()).slice(1);
    expect(opcoes.length).toBeGreaterThan(1);
    expect(opcoes, "categorias do filtro em ordem alfabética").toEqual([...opcoes].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const linhas = await page.locator("table.sv-g tbody th").allInnerTexts();
    expect(linhas, "tabela por categoria em ordem alfabética").toEqual([...linhas].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await expect(page.locator(".sv-main")).toContainText(/Fonte: .*lida em \d{2}\/\d{2}\/\d{4}/);
    await expect(page.locator(".sv-main")).toContainText(/(Mostrando 1 a 50 de \d+|\d+) notas, da mais recente para a mais antiga\./);
  });

  test("gastos: filtro por ano e categoria e paginação funcionam sem JavaScript", async ({ browser }, info) => {
    const context = await semJs(browser, info, "anon");
    const page = await context.newPage();
    await page.goto("/pessoa/helena-siqueira/gastos?ano=2024"); // ano da demo com mais de 50 notas
    await expect(page.locator(".sv-main")).toContainText(/Mostrando 1 a 50 de \d+ notas/);
    const ultimaP1 = dataBR(await page.locator(".sv-notas .sv-notas__d").last().innerText());
    await page.getByRole("link", { name: /Próxima página/ }).click();
    await page.waitForURL(/pagina=2/);
    const primeiraP2 = dataBR(await page.locator(".sv-notas .sv-notas__d").first().innerText());
    expect(primeiraP2! <= ultimaP1!, "a página 2 continua a ordem").toBe(true);
    // filtro: ano anterior e uma categoria
    const anos = await page.locator("#g-ano option").allInnerTexts();
    const cat = (await page.locator("#g-cat option").allInnerTexts())[1];
    await page.locator("#g-ano").selectOption(anos[1]);
    await page.locator("#g-cat").selectOption(cat);
    await page.getByRole("button", { name: "Filtrar" }).click();
    await page.waitForURL(/categoria=/);
    const notas = await page.locator(".sv-notas .sv-notas__d").allInnerTexts();
    expect(notas.length).toBeGreaterThan(0);
    for (const n of notas) expect(n).toContain(`/${anos[1]} · ${cat}`);
    await context.close();
  });

  test("gastos: vereador sem cota lida tem lacuna nomeada, nunca zero; parâmetros inválidos caem no padrão", async ({ page }) => {
    await abrir(page, "/pessoa/alvaro-coutinho-sp/gastos");
    await expect(page.locator(".sv-main .sv-lac").first()).toBeVisible();
    await expect(page.locator(".sv-notas")).toHaveCount(0);
    await expect(page.locator(".sv-main")).not.toContainText(/R\$\s*0(,00)?(?![\d,.])/);
    const res = await page.goto("/pessoa/helena-siqueira/gastos?ano=abc&categoria=%3Cscript%3E&pagina=-1");
    expect(res?.status()).toBe(200);
    await expect(page.locator(".sv-notas li").first()).toBeVisible();
    // página acima do teto de 4 dígitos cai na primeira (o offset gigante não chega ao banco)
    for (const url of ["/pessoa/helena-siqueira/gastos?ano=2024&pagina=99999", "/pessoa/helena-siqueira/votos?pagina=99999"]) {
      const r = await page.goto(url);
      expect(r?.status(), url).toBe(200);
      await expect(page.locator(".sv-main"), url).toContainText(/Mostrando 1 a 50 de \d+/);
    }
  });

  test("equipe: só agregado, sem nome de assessor, e lacuna nomeada quando não lida", async ({ page }) => {
    await abrir(page, "/pessoa/helena-siqueira/equipe");
    await expect(page.locator(".sv-main")).toContainText("nunca o nome de cada um");
    await expect(page.locator(".sv-main .sv-lac[data-cobertura]").first()).toBeVisible();
    await expect(page.locator(".sv-main")).not.toContainText(/R\$\s*0(,00)?(?![\d,.])/);
    await abrir(page, "/pessoa/helena-siqueira");
    await expect(page.locator(".sv-main")).not.toContainText("Ver nomes e salários");
  });

  test("votos: só o que muda lei por padrão, tudo sem JavaScript, voto em forma e palavra, link para a votação no /", async ({ browser }, info) => {
    const context = await semJs(browser, info, "anon");
    const page = await context.newPage();
    await page.goto("/pessoa/helena-siqueira/votos");
    await expect(page.getByRole("link", { name: "Só o que muda lei" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".sv-main")).toContainText(/votaç(ão|ões) de procedimento (está|estão) escondidas?/);
    const itens = page.locator(".sv-votos > li");
    expect(await itens.count()).toBe(50);
    for (const li of (await itens.all()).slice(0, 10)) {
      await expect(li.locator(".sv-voto .sv-m")).toHaveCount(1);
      await expect(li.locator(".sv-voto")).toHaveText(/^(Sim|Não|Abstenção|Sem voto|Obstrução|Presidia)$/);
      await expect(li.locator('a[href^="/votacao/"]')).toHaveCount(1);
    }
    const datas = (await page.locator(".sv-votos .sv-votos__q").allInnerTexts()).map(dataBR);
    expect(datas, "mais recente primeiro").toEqual([...datas].sort().reverse());
    const leiTotal = Number(/de (\d+) votos/.exec(await page.locator(".sv-main").innerText())![1]);
    await page.getByRole("link", { name: "Tudo", exact: true }).click();
    await page.waitForURL(/tipo=tudo/);
    await expect(page.getByRole("link", { name: "Tudo", exact: true })).toHaveAttribute("aria-current", "page");
    const tudoTotal = Number(/de (\d+) votos/.exec(await page.locator(".sv-main").innerText())![1]);
    expect(tudoTotal, "tudo inclui o procedimento").toBeGreaterThan(leiTotal);
    await expect(page.locator(".sv-votos")).toContainText("votação de procedimento");
    await context.close();
  });

  test("votos: cargo do Executivo é lacuna nomeada, não lista vazia", async ({ page }) => {
    await abrir(page, "/pessoa/carlos-machado-sp/votos");
    await expect(page.locator('.sv-main .sv-lac[data-cobertura="nao_se_aplica"]')).toBeVisible();
    await expect(page.locator(".sv-votos")).toHaveCount(0);
  });

  test("Pessoa: resumo do ano em frases (sem média) e trajetória em ordem cronológica", async ({ page }) => {
    await abrir(page, "/pessoa/alvaro-aguiar-sp");
    const ano = page.locator("section#ano");
    await expect(ano.getByRole("heading", { name: /^Como foi \d{4}\?$/ })).toBeVisible();
    await expect(ano).toContainText(/Esteve em \d+ das \d+ sessões de votação de \d{4}\./);
    await expect(ano).not.toContainText(/média dos|ranking|acima da|abaixo da/i);
    await abrir(page, "/pessoa/alvaro-coutinho-sp");
    // conjunto não lido: lacuna nomeada com o rótulo do conjunto, nunca zero
    await expect(page.locator("section#ano")).toContainText(/Presença em \d{4}: /);
    const traj = page.locator("section#trajetoria .sv-trj > li");
    expect(await traj.count()).toBeGreaterThan(1);
    const anos = (await page.locator("section#trajetoria .sv-trj__a").allInnerTexts()).map(Number);
    expect(anos, "ordem cronológica").toEqual([...anos].sort((a, b) => a - b));
    await expect(page.locator("section#trajetoria")).toContainText(/Candidatura a .*: eleit[oa]\./);
    await expect(page.locator("section#trajetoria")).not.toContainText(/trocou|infiel|traidor|vira-casaca/i);
  });
});
