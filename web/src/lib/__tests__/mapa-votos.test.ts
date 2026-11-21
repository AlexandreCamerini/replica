import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_DO_PERCENTUAL, FORA_DA_BASE, dadoDaUf, dadosDoMapa, descricaoUf, fraseSim, nivelDoEstado, pctSim, textoPct, totalDoMapa } from "../mapa-votos.ts";

const linha = (uf: string, contagem: Record<string, number>, cadeiras = 10) => ({
  uf,
  cadeiras,
  registros: Object.values(contagem).reduce((a, b) => a + b, 0),
  contagem: { sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0, ...contagem },
});

test("base do percentual: Sim ÷ (Sim + Não + Abstenção); fora da base não conta como voto contra", () => {
  const d = dadoDaUf("SP", { sim: 30, nao: 10, abstencao: 10, nao_votou: 40, art17: 1, obstrucao: 5 }, 70);
  assert.equal(d.base, 50);
  assert.equal(d.pct, 60);
  assert.equal(d.fora, 46);
  assert.equal(fraseSim(d), "30 de 50 registrados");
});

test("arredondamento para baixo: 2/3 é 66%, 199/200 é 99% e só 100% quando todos votaram Sim", () => {
  assert.equal(pctSim(2, 3), 66);
  assert.equal(pctSim(199, 200), 99);
  assert.equal(pctSim(200, 200), 100);
  assert.equal(pctSim(1, 1000), 0);
});

test("votos zero: sem base não há percentual e o estado não enche (nunca 0% inventado)", () => {
  const d = dadoDaUf("AC", { nao_votou: 3 });
  assert.equal(d.base, 0);
  assert.equal(d.pct, null);
  assert.equal(textoPct(d), "–");
  assert.equal(nivelDoEstado(d), 0);
  assert.equal(pctSim(0, 0), null);
  assert.match(descricaoUf("Acre", d, true), /nenhum voto Sim, Não ou abstenção registrado/);
  assert.match(descricaoUf("Acre", d, true), /3 registros sem voto/);
  assert.doesNotMatch(descricaoUf("Acre", d, false), /Abrir/);
});

test("zero Sim com votos registrados é 0% de verdade e a frase usa o singular", () => {
  const d = dadoDaUf("RR", { nao: 1 });
  assert.equal(d.pct, 0);
  assert.equal(textoPct(d), "0%");
  assert.equal(fraseSim(d), "0 de 1 registrado");
});

test("UF do mapa sem linha no placar: base 0, ordem alfabética de sigla, nunca por valor", () => {
  const placar = [linha("SP", { sim: 9, nao: 1 }), linha("AC", { sim: 1 })];
  const out = dadosDoMapa(placar, ["SP", "RJ", "AC"]);
  assert.deepEqual(
    out.map((d) => d.uf),
    ["AC", "RJ", "SP"],
  );
  assert.equal(out[1]!.base, 0);
  assert.equal(out[1]!.pct, null);
  assert.equal(out[1]!.cadeiras, null);
  assert.equal(out[2]!.pct, 90);
});

test("placar vazio (estado vazio): todas as UFs sem registro, total sem percentual", () => {
  const out = dadosDoMapa([], ["MG", "BA"]);
  assert.ok(out.every((d) => d.pct === null && d.base === 0));
  const t = totalDoMapa(out);
  assert.equal(t.base, 0);
  assert.equal(t.pct, null);
});

test("entradas inválidas valem 0 (negativo, NaN, undefined)", () => {
  const d = dadoDaUf("PA", { sim: -4, nao: Number.NaN, abstencao: 2 });
  assert.equal(d.sim, 0);
  assert.equal(d.nao, 0);
  assert.equal(d.pct, 0);
  assert.equal(dadoDaUf("PA", undefined).base, 0);
  assert.equal(pctSim(5, 3), 100, "sim maior que a base é limitado a 100");
});

test("total do país soma só Sim, Não e abstenção das UFs desenhadas", () => {
  const out = dadosDoMapa([linha("SP", { sim: 3, nao: 1 }), linha("RJ", { sim: 1, abstencao: 2, nao_votou: 9 })], ["SP", "RJ"]);
  const t = totalDoMapa(out);
  assert.equal(t.sim, 4);
  assert.equal(t.base, 7);
  assert.equal(t.pct, 57);
  assert.equal(t.fora, 9);
});

test("descrição traz os números e a base escrita; copy sem juízo", () => {
  const d = dadoDaUf("SP", { sim: 30, nao: 10, abstencao: 10 });
  assert.equal(descricaoUf("São Paulo", d, true), "São Paulo: 30 de 50 registrados votaram Sim (60%). Não: 10. Abstenção: 10. Abrir os votos do estado.");
  assert.match(BASE_DO_PERCENTUAL, /Sim \+ Não \+ abstenção/);
  assert.match(FORA_DA_BASE, /ausência não conta como voto contra/);
  for (const proibida of [/benefici/i, /polêmic/i, /prejudic/i, /ranking/i]) {
    assert.doesNotMatch(BASE_DO_PERCENTUAL + FORA_DA_BASE + descricaoUf("X", d, true), proibida);
  }
});
