import assert from "node:assert/strict";
import { test } from "node:test";
import { haQuantoTempo, LIMITE_HORAS, pautasVelhas } from "../../components/sv/pauta-velha.ts";
import { fraseResultado } from "../../components/sv/resultado.ts";

// F6 do roteiro do eleitor: frase de resultado por votação e aviso de pauta velha.
const v = (result: "aprovado" | "rejeitado" | null, sim: number | null, nao: number | null, isSecret = false) => ({ result, isSecret, placarFonte: { sim, nao } }) as Parameters<typeof fraseResultado>[0];

test("resultado: sempre rotulado Sim/Não, em qualquer sentido (sem ordem convencional dos números)", () => {
  assert.equal(fraseResultado(v("aprovado", 312, 144)), "Aprovada, com 312 Sim e 144 Não.");
  assert.equal(fraseResultado(v("rejeitado", 144, 312)), "Rejeitada, com 144 Sim e 312 Não.");
  assert.equal(fraseResultado(v("aprovado", 1234, 2)), "Aprovada, com 1.234 Sim e 2 Não.");
});

test("resultado: sem placar (secreta ou não publicado) só diz o resultado; sem resultado, que a fonte não publicou", () => {
  assert.equal(fraseResultado(v("aprovado", null, null)), "Aprovada.");
  assert.equal(fraseResultado(v("rejeitado", 10, null)), "Rejeitada.");
  assert.equal(fraseResultado(v("aprovado", 200, 100, true)), "Aprovada.");
  assert.equal(fraseResultado(v(null, 200, 100)), "Resultado não publicado pela fonte.");
});

test("resultado: resultado e placar em desacordo (quórum de outro tipo) não afirmam maioria; o zero publicado é dado", () => {
  assert.equal(fraseResultado(v("aprovado", 100, 200)), "Aprovada, com 100 Sim e 200 Não.");
  assert.equal(fraseResultado(v("aprovado", 100, 100)), "Aprovada, com 100 Sim e 100 Não.");
  assert.equal(fraseResultado(v("aprovado", 300, 0)), "Aprovada, com 300 Sim e 0 Não.");
});

const AGORA = new Date("2026-11-26T12:00:00Z").getTime();
const lida = (h: number | null) => ({ readAt: h === null ? null : new Date(AGORA - h * 3_600_000).toISOString() });

test("pauta velha: só passa do limite de 24 h; 24 h exatas ainda não; Casa sem leitura é outro estado e não entra", () => {
  assert.equal(LIMITE_HORAS, 24);
  assert.deepEqual(pautasVelhas({ camara: lida(1), senado: lida(23) }, AGORA), []);
  assert.deepEqual(pautasVelhas({ camara: lida(24), senado: lida(2) }, AGORA), []);
  const r = pautasVelhas({ camara: lida(24.5), senado: lida(80) }, AGORA);
  assert.deepEqual(r.map((x) => x.casa), ["camara", "senado"]);
  assert.deepEqual(pautasVelhas({ camara: lida(null), senado: lida(2) }, AGORA), []);
  assert.deepEqual(pautasVelhas({ camara: lida(null), senado: lida(null) }, AGORA), []);
});

test("pauta velha: data ilegível não afirma idade; leitura no futuro (relógio errado) não é velha", () => {
  assert.deepEqual(pautasVelhas({ camara: { readAt: "lixo" }, senado: lida(-5) }, AGORA), []);
});

test("há quanto tempo: dias inteiros, 'mais de 1 dia' de 24 h a 48 h", () => {
  assert.equal(haQuantoTempo(25), "há mais de 1 dia");
  assert.equal(haQuantoTempo(47.9), "há mais de 1 dia");
  assert.equal(haQuantoTempo(48), "há mais de 2 dias");
  assert.equal(haQuantoTempo(80), "há mais de 3 dias");
});
