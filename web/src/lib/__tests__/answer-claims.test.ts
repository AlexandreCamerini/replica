import assert from "node:assert/strict";
import { test } from "node:test";
import { claimState, claimsFrom, toClaim } from "../answer-claims.ts";

// Formas exatas que o ETL grava: verification.py `_blank` e `decide`, revisar.py (linhas antigas sem `estado`).
const blank = (estado: string) => ({ diz: false, frase: "", trecho: "", pagina: 0, estado });
const ok = { diz: true, frase: "Crianças até 3 anos entram de graça.", trecho: "gratuidade para crianças menores de três anos", pagina: 2 };

test("`estado` presente manda", () => {
  assert.equal(claimState({ ...ok, estado: "diz" }), "diz");
  assert.equal(claimState(blank("nao_diz")), "nao_diz");
  assert.equal(claimState(blank("nao_conferido")), "nao_conferido");
  // mesmo com diz:true, o árbitro disse que não conferiu
  assert.equal(claimState({ ...ok, estado: "nao_conferido" }), "nao_conferido");
});

test("diz:true sem frase ou sem trecho vira nao_conferido, nunca nao_diz", () => {
  assert.equal(claimState({ ...ok, frase: "" }), "nao_conferido");
  assert.equal(claimState({ ...ok, trecho: "   " }), "nao_conferido");
  assert.equal(claimState({ ...ok, frase: "", estado: "diz" }), "nao_conferido");
  assert.equal(claimState({ ...ok, trecho: undefined, estado: "diz" }), "nao_conferido");
});

test("sem `estado`: diz:false é o revisor marcando 'não diz'; diz:true com frase e trecho é 'diz'", () => {
  assert.equal(claimState({ diz: false, frase: "", trecho: "", pagina: 0 }), "nao_diz");
  assert.equal(claimState(ok), "diz");
});

test("campo ausente, nulo, malformado ou estado desconhecido: nao_conferido", () => {
  assert.equal(claimState(undefined), "nao_conferido");
  assert.equal(claimState(null), "nao_conferido");
  assert.equal(claimState("diz"), "nao_conferido");
  assert.equal(claimState({}), "nao_conferido");
  assert.equal(claimState({ ...ok, estado: "talvez" }), "nao_conferido");
  assert.equal(claimState({ diz: "true", frase: "x", trecho: "y" }), "nao_conferido");
});

test("says acompanha o estado; fora de 'diz' a tela não recebe frase nem trecho", () => {
  const d = toClaim("quem_recebe", { ...ok, estado: "diz" });
  assert.deepEqual(d, { state: "diz", says: true, text: ok.frase, quote: ok.trecho, page: 2 });
  const n = toClaim("quem_recebe", { ...ok, estado: "nao_conferido" });
  assert.deepEqual(n, { state: "nao_conferido", says: false, text: "", quote: "", page: 0 });
});

test("dinheiro: direção só vale quando diz; senão nao_diz", () => {
  assert.equal(toClaim("dinheiro", { ...ok, direcao: "sai", estado: "diz" }).direction, "sai");
  assert.equal(toClaim("dinheiro", { ...ok, direcao: "sai", estado: "nao_conferido" }).direction, "nao_diz");
  assert.equal(toClaim("dinheiro", { ...ok, direcao: "inventada" }).direction, "nao_diz");
  assert.equal(toClaim("quem_paga", { ...ok, direcao: "sai" }).direction, undefined);
});

test("claimsFrom cobre os seis campos; JSON nulo vira seis nao_conferido", () => {
  const all = claimsFrom(null);
  assert.deepEqual(Object.keys(all), ["o_que_propoe", "quem_recebe", "quem_paga", "o_que_muda", "dinheiro", "estimativa_impacto"]);
  assert.ok(Object.values(all).every((c) => c.state === "nao_conferido" && !c.says));
  const mixed = claimsFrom({ o_que_propoe: { ...ok, estado: "diz" }, quem_paga: blank("nao_diz") });
  assert.equal(mixed.o_que_propoe.state, "diz");
  assert.equal(mixed.quem_paga.state, "nao_diz");
  assert.equal(mixed.quem_recebe.state, "nao_conferido");
});
