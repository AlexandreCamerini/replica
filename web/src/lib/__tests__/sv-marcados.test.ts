import assert from "node:assert/strict";
import { test } from "node:test";
import { FOLLOW_MAX } from "../../components/sv/follow-shared.ts";
import { fraseMarcados } from "../../components/sv/marcados-frase.ts";

// D327: "Você acompanha N pessoas" conta pessoas que existem nos dados, não slugs do cookie.

test("ninguém marcado: convite, sem número", () => {
  assert.match(fraseMarcados({ guardadas: 0, pessoas: 0 }), /^Você ainda não marcou ninguém\./);
});

test("todas existem: a frase de sempre, no singular e no plural", () => {
  assert.equal(fraseMarcados({ guardadas: 1, pessoas: 1 }), `Você acompanha 1 pessoa. Cabem até ${FOLLOW_MAX}.`);
  assert.equal(fraseMarcados({ guardadas: 3, pessoas: 3 }), `Você acompanha 3 pessoas. Cabem até ${FOLLOW_MAX}.`);
  assert.equal(fraseMarcados({ guardadas: FOLLOW_MAX, pessoas: FOLLOW_MAX }), `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.`);
});

test("slug que não existe ou repete alguém não entra no número, e a sobra é dita", () => {
  const uma = fraseMarcados({ guardadas: 3, pessoas: 2 });
  assert.match(uma, /^Você acompanha 2 pessoas\. Cabem até 12\. Outra marcação guardada não entra na conta/);
  const duas = fraseMarcados({ guardadas: 4, pessoas: 2 });
  assert.match(duas, /^Você acompanha 2 pessoas\./);
  assert.match(duas, /Outras 2 marcações guardadas não entram na conta/);
  assert.match(fraseMarcados({ guardadas: 2, pessoas: 1 }), /^Você acompanha 1 pessoa\./);
});

test("nenhuma das marcadas existe: não diz zero pessoas, diz que não aparecem", () => {
  assert.match(fraseMarcados({ guardadas: 1, pessoas: 0 }), /^A pessoa que você marcou não aparece nos dados de hoje\./);
  const f = fraseMarcados({ guardadas: 3, pessoas: 0 });
  assert.match(f, /^Nenhuma das 3 pessoas que você marcou aparece nos dados de hoje\./);
  assert.doesNotMatch(f, /acompanha 0/);
});

test("limite cheio de marcações com pessoa que sumiu: o número é o das que existem e o limite é dito pelas marcações", () => {
  const f = fraseMarcados({ guardadas: FOLLOW_MAX, pessoas: 10 });
  assert.match(f, /^Você acompanha 10 pessoas\./);
  // a saída é tirar as que não entram na conta (há botão para isso), não "tirar alguém"
  assert.match(f, /As 12 marcações deste navegador estão ocupadas: tire as que não entram na conta para abrir lugar\./);
  assert.doesNotMatch(f, /tire alguém/);
  const mortas = fraseMarcados({ guardadas: FOLLOW_MAX, pessoas: 0 });
  assert.match(mortas, /^Nenhuma das 12 pessoas que você marcou aparece nos dados de hoje\./);
  assert.doesNotMatch(mortas, /tire alguém/);
  assert.doesNotMatch(f, /Cabem até/);
});

test("leitura que falhou: sem número", () => {
  const f = fraseMarcados({ guardadas: 3, pessoas: null });
  assert.match(f, /^Não conseguimos conferir agora quantas pessoas você acompanha\. Cabem até 12\./);
  assert.doesNotMatch(f, /\d+ pessoas?[ .]/);
  assert.match(fraseMarcados({ guardadas: FOLLOW_MAX, pessoas: null }), /estão ocupadas: tire alguém para incluir\./);
});
