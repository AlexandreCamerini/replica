import assert from "node:assert/strict";
import { test } from "node:test";
import { SINAIS_INICIAIS, chaveDeOrdem, compararNomes } from "../ordem-nomes.ts";

// D329. Os dois primeiros nomes são os que abriam a lista nacional de /pessoas em produção em 16/11/2026.
const ordenar = (nomes: string[]) => [...nomes].sort(compararNomes);

test("nome que começa por sinal entra na letra dele, e não antes do A", () => {
  const r = ordenar(["Zuleide Prado", "´rondiney Topógrafo", "Aarão Neto", "´`vando do Caroá", "Roberto Lima", "Rosana Esteves", "Valter Dias", "Vera Cruz"]);
  assert.deepEqual(r, ["Aarão Neto", "Roberto Lima", "´rondiney Topógrafo", "Rosana Esteves", "Valter Dias", "´`vando do Caroá", "Vera Cruz", "Zuleide Prado"]);
});

// Já era assim antes da D329 (a comparação do idioma trata acento e forma decomposta): o teste fixa o que não pode mudar.
test("continua valendo: Á fica com A, composto ou decomposto, e a letra sozinha vem antes do nome maior", () => {
  const decomposto = "Álvaro Barros".normalize("NFD");
  assert.notEqual(decomposto, "Álvaro Barros"); // o caso existe: A + acento agudo combinante
  const r = ordenar(["Bruno Dias", "Alvaro Zanin", decomposto, "Á", "Abel Arantes", "Álvaro Aguiar", "A", "Zé"]);
  assert.deepEqual(r, ["A", "Á", "Abel Arantes", "Álvaro Aguiar", decomposto, "Alvaro Zanin", "Bruno Dias", "Zé"]);
});

test("acento solto antes da letra (agudo combinante ou espaçado) não tira o nome do lugar", () => {
  const r = ordenar(["Bia", "́Ana", "´Carla", "Ana", "Carla", "Dora"]);
  assert.deepEqual(r, ["Ana", "́Ana", "Bia", "´Carla", "Carla", "Dora"]); // qual dos dois iguais vem antes é fixo: o desempate é o nome como veio
});

test("travessão, aspas angulares, ponto mediano e cedilha solta no começo também não contam", () => {
  const r = ordenar(["Ana", "Zé", "–Rui", "—Zélia", "·Lia", "«Bia»", "¸Caio"]);
  assert.deepEqual(r, ["Ana", "«Bia»", "¸Caio", "·Lia", "–Rui", "Zé", "—Zélia"]);
});

test("aspas, parênteses e espaço no começo não contam; no meio do nome, o sinal continua valendo", () => {
  assert.equal(chaveDeOrdem("  \"Tio\" Chico"), "Tio\" Chico");
  assert.equal(chaveDeOrdem("(Dr.) Beto"), "Dr.) Beto");
  assert.deepEqual(ordenar(["Tia Nena", "“Tio” Chico", "Tiago", "Ana-Maria", "Ana Maria"]).slice(-3), ["Tia Nena", "Tiago", "“Tio” Chico"]);
});

test("nome feito só de sinais fica como veio e não quebra a comparação", () => {
  assert.equal(chaveDeOrdem("´`"), "´`");
  assert.equal(chaveDeOrdem(""), "");
  assert.doesNotThrow(() => ordenar(["´`", "", "Ana", "--"]));
});

test("a ordem é total e estável: o mesmo nome com e sem sinal tem ordem fixa; comparar é antissimétrico", () => {
  const nomes = ["´Ana", "Ana", "ana", "ANA", "Aná", "`Ana"];
  const r1 = ordenar(nomes);
  const r2 = ordenar([...nomes].reverse());
  assert.deepEqual(r1, r2);
  for (const a of nomes) for (const b of nomes) assert.equal(Math.sign(compararNomes(a, b)), -Math.sign(compararNomes(b, a)) || 0);
  assert.equal(compararNomes("Ana", "Ana"), 0);
});

test("a lista de sinais não contém letra nem número (não pode comer o começo de um nome)", () => {
  for (const c of SINAIS_INICIAIS) assert.ok(!/[\p{L}\p{N}]/u.test(c), `caractere ${JSON.stringify(c)} é letra ou número`);
  assert.equal(chaveDeOrdem("Álvaro"), "Álvaro");
  assert.equal(chaveDeOrdem("Ñico"), "Ñico");
  assert.equal(chaveDeOrdem("3 Irmãos"), "3 Irmãos");
});
