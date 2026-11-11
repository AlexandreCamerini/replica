import assert from "node:assert/strict";
import { test } from "node:test";
import { lista } from "../data/lista.ts";

test("lista: total da fonte e página; truncado só quando há mais do que o devolvido", () => {
  assert.deepEqual(lista([1, 2, 3, 4, 5], 37), { itens: [1, 2, 3, 4, 5], total: 37, truncado: true });
  assert.deepEqual(lista([1, 2], 2), { itens: [1, 2], total: 2, truncado: false });
  assert.deepEqual(lista([], 0), { itens: [], total: 0, truncado: false });
});

test("lista: total nunca menor que a página (consulta sem linhas devolve total 0)", () => {
  assert.deepEqual(lista(["a"], 0), { itens: ["a"], total: 1, truncado: false });
  assert.deepEqual(lista(["a"], Number.NaN), { itens: ["a"], total: 1, truncado: false });
});
