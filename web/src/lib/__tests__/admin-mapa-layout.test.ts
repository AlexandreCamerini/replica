import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FAIXAS, LADO_HACHURA_PX, LADO_PONTILHADO_PX, OPACIDADE_FAIXA, centroDoCaminho, escalaDoDesenho, faixaDeContagem } from "../../components/admin/mapa-escala.ts";

test("faixas de opacidade 0,35 / 0,6 / 0,8 / 1: degraus de pelo menos 0,2 entre faixas vizinhas, e a faixa 0 não pinta", () => {
  assert.deepEqual(FAIXAS.map((f) => OPACIDADE_FAIXA[f]), [0, 0.35, 0.6, 0.8, 1]);
  const ops = FAIXAS.map((f) => OPACIDADE_FAIXA[f]);
  for (let i = 2; i < ops.length; i++) assert.ok(ops[i] - ops[i - 1] >= 0.2 - 1e-9, `degrau ${i}`);
  assert.equal(faixaDeContagem(1), 1);
});

test("padrão de estado com lado fixo em px de tela: a escala do desenho vem da largura renderizada e do viewBox; dado inválido não compensa", () => {
  assert.equal(LADO_HACHURA_PX, 6);
  assert.equal(LADO_PONTILHADO_PX, 5);
  assert.equal(escalaDoDesenho(500, "0 0 1000 1027.3"), 0.5); // celular: o desenho encolhe, o ladrilho de 6 px precisa de patternTransform scale(2)
  assert.equal(escalaDoDesenho(1000, "0 0 1000 669.5"), 1);
  assert.equal(escalaDoDesenho(0, "0 0 1000 669.5"), 1);
  assert.equal(escalaDoDesenho(300, "lixo"), 1);
  assert.equal(escalaDoDesenho(NaN, "0 0 1000 10"), 1);
});

test("centro do caminho: o 0 escrito vai no meio da caixa envolvente do território (malha real do país)", () => {
  assert.deepEqual(centroDoCaminho("M10,20L30,20L30,60Z"), { x: 20, y: 40 });
  assert.equal(centroDoCaminho("M"), null);
  const br = JSON.parse(readFileSync(new URL("../../../public/geo/br.json", import.meta.url), "utf8")) as { items: { d: string }[] };
  for (const t of br.items) {
    const c = centroDoCaminho(t.d);
    assert.ok(c && c.x >= 0 && c.x <= 1000 && c.y >= 0 && c.y <= 1100);
  }
});

const tsx = readFileSync(new URL("../../components/admin/mapa-admin.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles/admin.css", import.meta.url), "utf8");

test("fonte do mapa: padrão compensado pelo zoom, jogo separado para a legenda, 0 escrito, contagem e estado em camadas, nunca círculo", () => {
  assert.match(tsx, /patternUnits="userSpaceOnUse" patternTransform=\{compensacao\}/);
  assert.match(tsx, /-hachura-leg/);
  assert.match(tsx, /-pontilhado-leg/);
  assert.match(tsx, /className="admin-mapa__zero"/);
  assert.match(tsx, /className="admin-mapa__estado"/);
  assert.match(tsx, /<rect x="1\.8" y="1\.8" width="1\.4" height="1\.4"/); // ponto é retângulo (design v1, critério 24)
  assert.ok(!/<circle/i.test(tsx) && !/<circle/i.test(css));
});

test("css da central: faixa INTERNO, estados críticos por data-estado com barra em --danger/--warning, tracejado fora do erro e do desabilitado", () => {
  assert.match(css, /\.admin-central::before\s*\{[^}]*content:\s*"INTERNO/);
  assert.match(css, /\[data-estado="executor_parado"\],\s*\n\.admin-central \[data-estado="erro_leitura"\]\s*\{[^}]*var\(--danger\)/);
  assert.match(css, /\[data-estado="rodada_interrompida"\]\s*\{[^}]*var\(--warning\)/);
  assert.match(css, /\[data-estado="executor_ok"\]/);
  assert.ok(!/dashed|dotted/.test(css), "tracejado e pontilhado são do mapa");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "cor crua no css da central");
  assert.ok(!/font-family:\s*(?!var\()\S/.test(css), "família de fonte crua");
});
