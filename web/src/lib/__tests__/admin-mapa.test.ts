import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ESTADOS_COLETA,
  ESTADOS_REVISAO,
  FAIXAS,
  OPACIDADE_FAIXA,
  PADROES,
  apresentar,
  estadoVazio,
  estadosDaVisao,
  faixaDeContagem,
  legenda,
  padraoDoEstado,
  rotuloDaFaixa,
  textoDoEstado,
} from "../../components/admin/mapa-escala.ts";
import type { Visao } from "../../components/admin/mapa-escala.ts";

const VISOES: Visao[] = ["coleta", "revisao"];

test("faixas: zero é vazio, limites fixos, monotonia", () => {
  assert.equal(faixaDeContagem(0), 0);
  assert.deepEqual([1, 2, 4, 5, 9, 10, 999].map(faixaDeContagem), [1, 2, 2, 3, 3, 4, 4]);
  let anterior = 0;
  for (let n = 0; n <= 50; n++) {
    const f = faixaDeContagem(n);
    assert.ok(f >= anterior, `faixa não pode cair em n=${n}`);
    anterior = f;
  }
  const ops = FAIXAS.map((f) => OPACIDADE_FAIXA[f]);
  assert.equal(ops[0], 0);
  for (let i = 1; i < ops.length; i++) assert.ok(ops[i] > ops[i - 1]);
});

test("faixas: entrada inválida levanta erro", () => {
  for (const n of [-1, 1.5, NaN]) assert.throws(() => faixaDeContagem(n), RangeError);
});

test("todo estado tem padrão E palavra, e o padrão é um dos quatro", () => {
  for (const v of VISOES) {
    for (const e of estadosDaVisao(v)) {
      assert.ok(PADROES.includes(padraoDoEstado(v, e)));
      assert.ok(textoDoEstado(v, e).length > 0);
    }
  }
  assert.equal(estadosDaVisao("coleta").length, ESTADOS_COLETA.length);
  assert.equal(estadosDaVisao("revisao").length, ESTADOS_REVISAO.length);
});

test("nenhum estado depende só de cor: padrões distintos e palavras distintas dentro de cada visão", () => {
  for (const v of VISOES) {
    const es = estadosDaVisao(v);
    assert.equal(new Set(es.map((e) => padraoDoEstado(v, e))).size, es.length);
    assert.equal(new Set(es.map((e) => textoDoEstado(v, e))).size, es.length);
  }
});

test("estado de outra visão ou desconhecido: erro na função pura, degradação em apresentar()", () => {
  assert.throws(() => padraoDoEstado("revisao", "falhou"), RangeError);
  assert.throws(() => textoDoEstado("coleta", "reaberta"), RangeError);
  assert.deepEqual(apresentar("coleta", "xyz"), { padrao: "vazio", palavra: "estado desconhecido", destaque: false });
  for (const v of VISOES) assert.ok(estadosDaVisao(v).includes(estadoVazio(v)));
});

test("pendência reaberta é destaque; os demais não", () => {
  assert.equal(apresentar("revisao", "reaberta").destaque, true);
  for (const e of ["decidida", "pendente", "sem_pendencia"]) assert.equal(apresentar("revisao", e).destaque, false);
});

test("legenda: número escrito nas faixas, palavra+padrão nos estados, própria por visão", () => {
  const c = legenda("coleta", 12);
  const r = legenda("revisao", 12);
  assert.deepEqual(c.faixas.map((f) => f.rotulo), ["0 fichas", "1 ficha", "2 a 4 fichas", "5 a 9 fichas", "10 ou mais fichas"]);
  for (const f of c.faixas) assert.match(f.rotulo, /\d/);
  assert.notDeepEqual(c.estados.map((e) => e.palavra), r.estados.map((e) => e.palavra));
  assert.notEqual(c.explicacao, r.explicacao);
  for (const e of [...c.estados, ...r.estados]) assert.ok(e.palavra && e.padrao);
  assert.equal(rotuloDaFaixa(0), "0 fichas");
});

test("legenda: faixas acima do máximo não aparecem; a faixa 0 sempre aparece", () => {
  assert.deepEqual(legenda("coleta", 0).faixas.map((f) => f.faixa), [0]);
  assert.deepEqual(legenda("coleta", 3).faixas.map((f) => f.faixa), [0, 1, 2]);
});

// Critério 24: o markup do mapa não tem <circle> nem cluster; território com nome e contagem em texto.
const dir = new URL("../../components/admin/", import.meta.url);
const tsx = readFileSync(new URL("mapa-admin.tsx", dir), "utf8");
const css = readFileSync(new URL("../../styles/admin.css", import.meta.url), "utf8");

test("código-fonte do mapa: sem círculo, elipse, cluster, sombra, raio, URL absoluta ou rede", () => {
  for (const proibido of ["<circle", "circle", "ellipse", "<marker", "cluster", "pin", "box-shadow", "border-radius", "rounded", "http://", "https://", "//cdn", "<script", "<img", "@import"]) {
    if (proibido === "pin") {
      assert.ok(!/\bpin\b/i.test(tsx), "alfinete (pin) no markup");
      continue;
    }
    assert.ok(!tsx.toLowerCase().includes(proibido), `mapa-admin.tsx contém "${proibido}"`);
  }
  assert.ok(!/components\/map\/brazil-map/.test(tsx), "importa o mapa público");
  assert.ok(!/lib\/data/.test(tsx), "importa lib/data");
  assert.ok(!/fetch\(\s*["'`]https?:/.test(tsx));
});

test("código-fonte do mapa: cada território tem aria-label com formatarContagem e <title>", () => {
  assert.match(tsx, /aria-label=\{texto\}/);
  assert.match(tsx, /formatarContagem\(c\.total\)/);
  assert.match(tsx, /<title>\{texto\}<\/title>/);
  assert.match(tsx, /aria-live="polite"/);
});

test("css da central: tudo com escopo .admin-central, raio 0, sem sombra", () => {
  assert.ok(!/box-shadow\s*:(?!\s*none)/.test(css));
  for (const m of css.matchAll(/border-radius\s*:\s*([^;]+);/g)) assert.equal(m[1].trim(), "0");
  const seletores = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  for (const s of seletores) {
    if (s.startsWith("@media")) continue;
    for (const parte of s.split(",")) assert.ok(parte.trim().startsWith(".admin-central"), `seletor fora do escopo: ${parte}`);
  }
});
