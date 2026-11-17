import assert from "node:assert/strict";
import { test } from "node:test";
import { escolherPartido, opcoesDePartido, partidoNaoAplicado, rotuloPartido } from "../../components/sv/partidos.ts";

// D331: o partido do endereço só vale se estiver na lista lida; nada de fora chega à consulta.
const LISTA = [
  { id: "p-novo", acronym: "NOVO", name: "Partido Novo" },
  { id: "p-pt", acronym: "PT", name: "Partido dos Trabalhadores" },
  { id: "p-avante", acronym: "AVANTE", name: "AVANTE" },
];

test("partido da lista vale", () => {
  assert.equal(escolherPartido("p-pt", LISTA)?.acronym, "PT");
});

test("fora da lista, fora do padrão, repetido ou sem lista: null", () => {
  for (const raw of ["p-xx", "", "1;drop", "a".repeat(65), ["p-pt", "p-novo"], undefined, null, 7]) assert.equal(escolherPartido(raw, LISTA), null, String(raw));
  assert.equal(escolherPartido("p-pt", null), null);
});

test("opções em ordem alfabética da sigla, sem id repetido", () => {
  assert.deepEqual(
    opcoesDePartido([...LISTA, LISTA[1]]).map((p) => p.acronym),
    ["AVANTE", "NOVO", "PT"],
  );
});

test("rótulo: sigla e nome; só a sigla quando o nome repete a sigla", () => {
  assert.equal(rotuloPartido(LISTA[1]), "PT (Partido dos Trabalhadores)");
  assert.equal(rotuloPartido(LISTA[2]), "AVANTE");
  assert.equal(rotuloPartido({ id: "x", acronym: "X", name: "" }), "X");
});

test("partido do endereço não aplicado: sem lista lida ou fora dela; pedido fora do padrão não gera aviso", () => {
  assert.equal(partidoNaoAplicado("p-pt", LISTA), null);
  assert.equal(partidoNaoAplicado("p-pt", null), "sem-lista");
  assert.equal(partidoNaoAplicado("p-xx", LISTA), "fora-da-lista");
  for (const raw of ["", "1;drop", "a".repeat(65), ["p-pt", "p-novo"], undefined, null, 7]) assert.equal(partidoNaoAplicado(raw, LISTA), null, String(raw));
});
