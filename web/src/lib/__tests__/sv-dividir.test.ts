import assert from "node:assert/strict";
import { test } from "node:test";
import { dividir } from "../../components/sv/pessoa/dividir.ts";

// Comissões da Pessoa (D324): mostra 5 e guarda o resto num <details>. Nenhum item some nem muda de ordem.
const letras = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

test("até o limite: tudo nas primeiras, resto vazio", () => {
  assert.deepEqual(dividir([], 5), [[], []]);
  assert.deepEqual(dividir(letras(3), 5), [["a", "b", "c"], []]);
  assert.deepEqual(dividir(letras(5), 5), [["a", "b", "c", "d", "e"], []]);
});

test("acima do limite: as 5 primeiras e o resto, na mesma ordem", () => {
  assert.deepEqual(dividir(letras(6), 5), [["a", "b", "c", "d", "e"], ["f"]]);
  const [p, r] = dividir(letras(12), 5);
  assert.equal(p.length, 5);
  assert.deepEqual([...p, ...r], letras(12));
});

test("limite inválido não perde item: tudo vai para o resto", () => {
  for (const n of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(dividir(letras(3), n), [[], ["a", "b", "c"]]);
});

test("não altera a lista de entrada", () => {
  const entrada = letras(7);
  dividir(entrada, 5);
  assert.deepEqual(entrada, letras(7));
});
