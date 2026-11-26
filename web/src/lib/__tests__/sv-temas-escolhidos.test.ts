import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMAS_COOKIE, TEMAS_MAX, parseTemas, serializeTemas } from "../../components/sv/temas-escolhidos.ts";

// F5: assuntos escolhidos pelo leitor (cookie sv_temas). Só slugs; o que não é slug ou não existe no contrato é descartado, sem lançar.

const VALIDOS = ["saude", "trabalho", "educacao", "meio-ambiente", "seguranca", "economia", "transporte"];

test("o cookie é uma lista de slugs separada por ponto, na ordem em que foi escolhida", () => {
  assert.equal(TEMAS_COOKIE, "sv_temas");
  assert.deepEqual(parseTemas("saude.trabalho", VALIDOS), ["saude", "trabalho"]);
  assert.deepEqual(parseTemas("trabalho.saude", VALIDOS), ["trabalho", "saude"]);
  assert.equal(serializeTemas(["saude", "trabalho"]), "saude.trabalho");
});

test("descarta o que não é slug, o que não existe no contrato e as repetições", () => {
  assert.deepEqual(parseTemas("saude.saude.nao-existe.TRABALHO.<script>.a b..", VALIDOS), ["saude"]);
  assert.deepEqual(parseTemas("saude.nao-existe", VALIDOS), ["saude"]);
  // sem a lista do contrato (leitura falhou), só o formato vale: a página não filtra por isso, mas o parse não lança
  assert.deepEqual(parseTemas("saude.nao-existe"), ["saude", "nao-existe"]);
});

test("corta em TEMAS_MAX e guarda os primeiros", () => {
  assert.equal(TEMAS_MAX, 5);
  assert.deepEqual(parseTemas("saude.trabalho.educacao.meio-ambiente.seguranca.economia.transporte", VALIDOS), ["saude", "trabalho", "educacao", "meio-ambiente", "seguranca"]);
});

test("ausente, vazio ou malformado valem como nenhum assunto, sem lançar", () => {
  for (const v of [undefined, null, "", ".", "...", "%E0%A4%A", "%00", "x".repeat(200)]) assert.deepEqual(parseTemas(v as string | null | undefined, VALIDOS), [], String(v));
});

test("aceita a lista de campos do formulário (um 'tema' por caixa marcada) com a mesma validação", () => {
  assert.deepEqual(parseTemas(["trabalho", "saude", "saude", "x/y"], VALIDOS), ["trabalho", "saude"]);
  assert.deepEqual(parseTemas([], VALIDOS), []);
});

test("serializar não deixa passar lixo nem passa do limite", () => {
  assert.equal(serializeTemas(["saude", "<x>", "trabalho"]), "saude.trabalho");
  assert.equal(serializeTemas(["a", "b", "c", "d", "e", "f", "g"]).split(".").length, TEMAS_MAX);
});
