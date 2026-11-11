import assert from "node:assert/strict";
import { test } from "node:test";
import { estadoResposta } from "../../components/sv/inicio/semana-resposta.ts";

const AT = "2026-11-10T12:00:00-03:00";

test("semana: 'aguardando' só para item sem resposta publicada", () => {
  assert.equal(estadoResposta(null, undefined), "aguardando");
  assert.equal(estadoResposta(undefined, { ok: false }), "aguardando");
});

test("semana: item com resposta publicada acima do limite de leituras leva à página, nunca 'aguardando'", () => {
  assert.equal(estadoResposta(AT, undefined), "na_pagina");
});

test("semana: leitura que falhou é dita como falha, nunca 'aguardando'", () => {
  assert.equal(estadoResposta(AT, { ok: false }), "falhou");
});

test("semana: lida sem 'o que muda' leva à página; lida com 'o que muda' mostra a resposta", () => {
  assert.equal(estadoResposta(AT, { ok: true, muda: null }), "na_pagina");
  assert.equal(estadoResposta(AT, { ok: true, muda: { x: 1 } }), "lida");
});
