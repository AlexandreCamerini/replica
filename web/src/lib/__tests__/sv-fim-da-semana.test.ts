import assert from "node:assert/strict";
import { test } from "node:test";
import { ultimoDiaDaSemana } from "../../components/sv/fim-da-semana.ts";

test("weekEnds exclusivo: o último dia é o anterior, no fuso de Brasília", () => {
  // segunda 16/11/2026 00:00 em Brasília = 03:00Z: a semana termina no domingo 15/11
  assert.equal(ultimoDiaDaSemana("2026-11-16T03:00:00.000Z"), "15/11/2026");
});

test("semana ausente ou data inválida: null, sem lançar", () => {
  assert.equal(ultimoDiaDaSemana(""), null);
  assert.equal(ultimoDiaDaSemana(null), null);
  assert.equal(ultimoDiaDaSemana(undefined), null);
  assert.equal(ultimoDiaDaSemana("não é data"), null);
});
