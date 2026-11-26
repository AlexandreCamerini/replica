import assert from "node:assert/strict";
import { test } from "node:test";
import { serieMensal, tetoDe, type TetoCota } from "../../components/sv/pessoa/serie-mensal.ts";

test("série mensal: 12 meses, mês sem nota é null (nunca zero), fecha com o total do ano", () => {
  const s = serieMensal([{ mes: "2026-01", cents: 1000, notas: 2 }, { mes: "2026-03", cents: -200, notas: 1 }], 2026, 800);
  assert.ok(s);
  assert.equal(s.linhas.length, 12);
  assert.equal(s.linhas[1].cents, null);
  assert.equal(s.linhas[2].cents, -200);
  assert.equal(s.totalCents, 800);
});

test("série mensal: não fecha com o total => null; mês de outro ano é ignorado", () => {
  assert.equal(serieMensal([{ mes: "2026-01", cents: 1000, notas: 1 }], 2026, 999), null);
  const s = serieMensal([{ mes: "2025-12", cents: 5, notas: 1 }, { mes: "2026-01", cents: 10, notas: 1 }], 2026, 10);
  assert.equal(s?.totalCents, 10);
});

test("teto: tabela vazia = lacuna nomeada; com item, vale só dentro da vigência e da UF", () => {
  assert.equal(tetoDe("SP", "2026-05-01").estado, "nao_carregado");
  assert.equal(tetoDe(null, "2026-05-01").estado, "nao_carregado");
  const tab: TetoCota[] = [{ uf: "SP", de: "2025-01-01", ate: null, cents: 1, fonte: "f", lidoEm: "2026-11-26" }];
  assert.equal(tetoDe("SP", "2026-05-01", tab).estado, "lido");
  assert.equal(tetoDe("SP", "2024-12-31", tab).estado, "nao_carregado");
  assert.equal(tetoDe("RJ", "2026-05-01", tab).estado, "nao_carregado");
});
