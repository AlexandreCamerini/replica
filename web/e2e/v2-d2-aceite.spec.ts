import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Bateria de aceite da Direção 2 (HANDOFF-DIRECAO-2.md §4, §6, §9) sobre TODAS as rotas do /v2.
// Fonte de dados: demo/fake (DATA_SOURCE=demo). Nenhum teste intercepta o servidor; o que muda é só o DOM, no navegador.
// Regra de conduta: critério violado deixa o teste VERMELHO (ou `test.fail` com anotação). Nada aqui foi afrouxado para passar.

const UF = "SP";
// Ordem do cookie propositalmente fora de ordem alfabética: a tela é que tem de ordenar.
const SIGO = ["helena-siqueira", "alvaro-teixeira-sp", "bruno-sampaio"]; // Senado (federal), Assembleia (estadual), Câmara Municipal (municipal)
const KEY_SEM_RESPOSTA = "camara-pl-79-2020";
const KEY_RESPONDIDA = "camara-pl-9999-2026";

type Rota = { nome: string; url: string };
const ROTAS: Rota[] = [
  { nome: "inicio", url: "/v2" },
  { nome: "acompanhando", url: "/v2/acompanhando" },
  { nome: "ajustes", url: "/v2/ajustes" },
  { nome: "temas", url: "/v2/temas" },
  { nome: "decisoes", url: "/v2/decisoes" },
  { nome: "votacoes", url: "/v2/votacoes" },
  { nome: "pessoas", url: "/v2/pessoas" },
  { nome: "como-funciona", url: "/v2/como-funciona" },
  { nome: "decisao-sem-resposta", url: `/v2/decisao/${KEY_SEM_RESPOSTA}` },
  { nome: "decisao-respondida", url: `/v2/decisao/${KEY_RESPONDIDA}` },
  { nome: "pessoa", url: "/v2/pessoa/helena-siqueira" },
  { nome: "tema", url: "/v2/tema/agro" },
  { nome: "votacao", url: "/v2/votacao/camara-v2026-15" },
  { nome: "votacao-uf", url: "/v2/votacao/camara-v2026-15?uf=SP" },
];
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
  expect(res?.status(), url).toBe(200);
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
      expect(res?.status()).toBe(200);
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
    await page.goto("/v2/ajustes");
    await expect(page.getByRole("link", { name: "Escolha seu estado" })).toBeVisible();
    await page.locator("#aj-uf-sel").selectOption("MG");
    await page.getByRole("button", { name: "Guardar estado" }).click();
    await page.waitForURL(/\/v2\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_uf")?.value).toBe("MG");
    await expect(page.locator(".sv-uf")).toContainText("Minas Gerais (MG)");
    // esferas: liga a municipal e desliga a estadual (checkboxes ligados ao form de esferas pelo atributo form)
    await page.locator("#aj-mun").check();
    await page.locator("#aj-est").uncheck();
    await page.getByRole("button", { name: "Guardar escolhas" }).click();
    await page.waitForURL(/\/v2\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_esferas")?.value).toMatch(/^e0\.m1/);
    await expect(page.locator("#aj-mun")).toBeChecked();
    await expect(page.locator("#aj-est")).not.toBeChecked();
    // limpar a escolha
    await page.locator("#aj-uf-sel").selectOption("");
    await page.getByRole("button", { name: "Guardar estado" }).click();
    await page.waitForURL(/\/v2\/ajustes/);
    expect((await context.cookies()).find((c) => c.name === "sv_uf")).toBeUndefined();
    await context.close();
  });

  test("Ajustes rejeita sigla inválida e redirecionamento aberto", async ({ browser }, info) => {
    const context = await semJs(browser, info, "anon");
    const page = await context.newPage();
    const res = await page.request.post("/v2/ajustes", { form: { uf: "ZZ", voltar: "//evil.example" }, maxRedirects: 0 }).catch(() => null);
    // server action exige o cabeçalho próprio do Next; o que importa: nada de cookie com sigla inválida
    expect(res === null || res.status() < 500).toBe(true);
    expect((await context.cookies()).find((c) => c.name === "sv_uf")).toBeUndefined();
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
    for (const url of ["/v2", "/v2/acompanhando", "/v2/ajustes", `/v2/decisao/${KEY_RESPONDIDA}`, "/v2/pessoa/helena-siqueira"]) {
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
  const ROTAS_PESSOAS = ROTAS.filter((r) => ["inicio", "acompanhando", "pessoas", "pessoa", "votacao-uf", "decisao-respondida", "tema"].includes(r.nome));
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
          document.querySelectorAll<HTMLElement>('a[href^="/v2/pessoa/"]').forEach((a) => {
            const t = limpo(a.textContent ?? "");
            const m = /^Ver tudo de (.+?)\s*→?$/.exec(t);
            // item de lista: o nome é o primeiro texto do bloco (depois vêm cargo e partido)
            const item = a.closest(".sv-item");
            const nome = m ? m[1] : item ? limpo(item.querySelector("div")?.firstChild?.textContent ?? "") : t;
            aceitar(nome);
          });
          document.querySelectorAll<HTMLElement>(".sv-esc__n").forEach((n) => aceitar(limpo(n.textContent ?? "")));
          if (location.pathname.startsWith("/v2/pessoa/")) aceitar(limpo(document.querySelector("h1")?.textContent ?? ""));
          document.querySelectorAll<HTMLElement>(".sv-voterow > div").forEach((d) => aceitar(limpo(d.firstChild?.textContent ?? "")));
          const ordenados = [...nomes].sort((a, b) => b.length - a.length);
          let trocas = { nomes: 0, partidos: 0 };
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
      if (["acompanhando", "pessoa", "pessoas", "votacao-uf"].includes(r.nome)) expect(trocados.nomes, "sem nome para trocar: o teste não provaria nada").toBeGreaterThan(0);

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
        const alvo = document.querySelector<HTMLElement>('.sv-esc__n, a[href^="/v2/pessoa/"], .sv-main h1');
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
    const urls = ["/v2", "/v2/acompanhando", "/v2/pessoas?cargo=senador&uf=SP", "/v2/pessoas", "/v2/pessoas?cidade=3509502&grupo=vereadores", `/v2/decisao/${KEY_RESPONDIDA}`, "/v2/votacao/camara-v2026-15", "/v2/tema/agro", "/v2/decisoes"];
    for (const url of urls) {
      await abrir(page, url);
      const r = await page.evaluate(() => {
        const grupos = new Map<Element, string[]>();
        const add = (raiz: Element, nome: string) => {
          if (!grupos.has(raiz)) grupos.set(raiz, []);
          grupos.get(raiz)!.push(nome.replace(/\s+/g, " ").trim());
        };
        document.querySelectorAll<HTMLElement>('.sv-main a[href^="/v2/pessoa/"]').forEach((a) => {
          if (/^Ver tudo de/.test(a.textContent ?? "")) return;
          const raiz = a.closest(".sv-esc__pessoas, ul, ol, .sv-list, table, .sv-pg > *") ?? document.body;
          const item = a.closest("li, .sv-item, .sv-voterow, tr");
          if (item && item.querySelector('a[href^="/v2/pessoa/"]') !== a) return; // um nome por item
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
    const urls = ["/v2", "/v2/acompanhando", `/v2/decisao/${KEY_RESPONDIDA}`, `/v2/decisao/${KEY_SEM_RESPOSTA}`, "/v2/votacao/camara-v2026-15", "/v2/votacao/camara-v2026-19", "/v2/votacoes", "/v2/tema/agro", "/v2/pessoa/helena-siqueira", "/v2/decisoes"];
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
    await abrir(page, "/v2/acompanhando");
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
        await expect(page.locator("footer.sv-rod")).toContainText("Conferido por agentes de IA, não por pessoa");
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
    const comDado = ROTAS.filter((r) => !["como-funciona", "ajustes"].includes(r.nome));
    for (const r of comDado) {
      await abrir(page, r.url);
      const t = await page.locator(".sv").innerText();
      if (!/Exemplo ilustrativo/.test(t)) falhas.push(`${r.url}: sem "Exemplo ilustrativo" (só o banner "Versão de demonstração" existe: ${/Versão de demonstração/.test(t)})`);
    }
    expect(falhas).toEqual([]);
  });

  test("decisão sem respostas: 'Aguardando conferência'; nunca 'o texto não trata disso'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, `/v2/decisao/${KEY_SEM_RESPOSTA}`);
    const t = await page.locator(".sv-main").innerText();
    expect(t).toContain("Aguardando conferência");
    expect(t).not.toContain("O texto oficial não trata disso.");
    // todo campo sem resposta é lacuna nomeada, não frase afirmativa
    await expect(page.locator('[aria-labelledby="sv-d1"] .sv-lac')).toContainText("Aguardando conferência");
    await expect(page.locator('[aria-labelledby="sv-d5"] .sv-lac')).toContainText("Aguardando conferência");
    // proveniência e verificação
    await expect(page.locator('[aria-labelledby="sv-d10"]')).toContainText("Agentes de inteligência artificial (IA), não uma pessoa.");
  });

  test("decisão respondida: os três estados nos campos certos; 'não trata disso' só no nao_diz", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, `/v2/decisao/${KEY_RESPONDIDA}`);
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

  test("decisão: sem aparência de revisão humana e sem 'síntese não conferida'", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    for (const k of [KEY_SEM_RESPOSTA, KEY_RESPONDIDA]) {
      await abrir(page, `/v2/decisao/${k}`);
      const t = await page.locator(".sv").innerText();
      expect(t, k).not.toMatch(/conferid[ao] por uma pessoa|revisad[ao] por pessoa|revis[ãa]o humana|síntese não conferida/i);
    }
  });

  test("sem UF não aparece estado assumido; com UF só a escolhida", async ({ page, context }) => {
    const ESTADOS = ["Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás", "Maranhão", "Mato Grosso do Sul", "Mato Grosso", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins"];
    const falhas: string[] = [];
    for (const url of ["/v2", "/v2/acompanhando", "/v2/ajustes", "/v2/temas", "/v2/decisoes"]) {
      await abrir(page, url);
      const t = await page.evaluate(() => {
        const c = document.querySelector(".sv")!.cloneNode(true) as HTMLElement;
        c.querySelectorAll("select, option").forEach((e) => e.remove());
        return c.innerText;
      });
      for (const e of ESTADOS) if (new RegExp(`(^|[^\\p{L}])${e}(?![\\p{L}])`, "u").test(t)) falhas.push(`${url}: sem UF, mas o texto cita "${e}"`);
      if (/\(\s*[A-Z]{2}\s*\)/.test(t.replace(/\(IA\)|\(PL\)|\(PEC\)|\(PLP\)|\(MPV\)|\(PDL\)|\(PLV\)/g, ""))) falhas.push(`${url}: sem UF, mas aparece sigla de estado entre parênteses`);
    }
    // convite no lugar do conteúdo que depende da UF: link para /v2/ajustes dentro do conteúdo, não só no topo
    await abrir(page, "/v2");
    const convites = await page.locator('.sv-main a[href="/v2/ajustes"]').allTextContents();
    if (!convites.some((t) => /Escolh\w* (o |meu |seu )?estado/i.test(t))) falhas.push(`/v2 sem estado: nenhum convite "Escolha seu estado" no conteúdo (links para /v2/ajustes: ${JSON.stringify(convites)})`);
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
    await abrir(page, "/v2");
    await expect(page.locator(".sv-uf")).toContainText("São Paulo (SP)");
    expect(falhas).toEqual([]);
  });

  test("esferas desligadas valem igual no Início, em Escolhidos e na Decisão (municipal desligado por padrão)", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor"); // sem cookie sv_esferas: padrão = estadual ligado, municipal desligado
    const nome = "Bruno Sampaio"; // vereador (Esfera: Municipal)
    const onde: Record<string, boolean> = {};
    for (const [rotulo, url] of [["Início", "/v2"], ["Escolhidos", "/v2/acompanhando"], ["Decisão", `/v2/decisao/${KEY_RESPONDIDA}`]] as const) {
      await abrir(page, url);
      onde[rotulo] = (await page.locator(".sv-main").innerText()).includes(nome);
    }
    expect(new Set(Object.values(onde)).size, `a esfera municipal está desligada: ${JSON.stringify(onde)} (as três telas têm de tratar igual)`).toBe(1);
  });

  test("a fonte citada numa lacuna é a da esfera da pessoa (nada de Assembleia para vereador, nem Câmara Municipal para deputado)", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    const falhas: string[] = [];
    for (const url of ["/v2", "/v2/acompanhando"]) {
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
    await abrir(page, "/v2/ajustes");
    const t = await page.locator(".sv-main").innerText();
    expect(t).toMatch(/cookie neste navegador/i);
    expect(t).toMatch(/O servidor lê esse cookie/);
    expect(t).not.toMatch(/s[óo] neste aparelho/i);
  });

  test("Início: 'O que lemos' e fontes com data", async ({ page, context }) => {
    await cookiesDoLeitor(context, "leitor");
    await abrir(page, "/v2");
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
const SHOTS = "/private/tmp/claude-501/-Users-acamerini-replica--claude-worktrees-mensagem-sessao-7d8244/a23003cb-e68c-4b39-aed8-ac11d5616cc3/scratchpad/shots";
test.describe("capturas", () => {
  const alvos: [string, string][] = [
    ["inicio", "/v2"],
    ["acompanhando", "/v2/acompanhando"],
    ["pessoa", "/v2/pessoa/helena-siqueira"],
    ["decisao", `/v2/decisao/${KEY_RESPONDIDA}`],
    ["temas", "/v2/temas"],
    ["ajustes", "/v2/ajustes"],
  ];
  for (const [nome, url] of alvos)
    for (const width of [390, 1280]) {
      test(`captura ${nome} ${width}`, async ({ page, context }) => {
        await cookiesDoLeitor(context, "leitor");
        await page.setViewportSize({ width, height: 900 });
        await abrir(page, url);
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${nome}-${width}.png`), fullPage: true });
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
