import assert from "node:assert/strict";
import { test } from "node:test";
import { fraseOrientacao } from "../../components/sv/orientacao.ts";

// F4: a orientação da bancada é fato da fonte, escrito ao lado do voto; nunca vira nota, divergência ou alinhamento (D82, D342).

test("partido que orientou: a frase diz quem orientou e o quê", () => {
  assert.equal(fraseOrientacao({ valor: "sim", quem: "PT", tipo: "partido" }), "A bancada do PT orientou Sim.");
  assert.equal(fraseOrientacao({ valor: "nao", quem: "PL", tipo: "partido" }), "A bancada do PL orientou Não.");
  assert.equal(fraseOrientacao({ valor: "abstencao", quem: "PSD", tipo: "partido" }), "A bancada do PSD orientou Abstenção.");
  assert.equal(fraseOrientacao({ valor: "obstrucao", quem: "NOVO", tipo: "partido" }), "A bancada do NOVO orientou Obstrução.");
});

test("bloco: o nome do bloco vem como a fonte o escreve, sem 'bancada do' na frente", () => {
  assert.equal(fraseOrientacao({ valor: "sim", quem: "Bloco PP, UNIÃO, PSDB", tipo: "bloco" }), "Bloco PP, UNIÃO, PSDB orientou Sim.");
});

test("liberado: a frase diz que a bancada foi liberada, e só isso (não há orientação para comparar)", () => {
  assert.equal(fraseOrientacao({ valor: "liberado", quem: "PT", tipo: "partido" }), "A bancada do PT foi liberada.");
  assert.equal(fraseOrientacao({ valor: "liberado", quem: "Bloco PP, UNIÃO", tipo: "bloco" }), "Bloco PP, UNIÃO liberou a bancada.");
});

test("sem orientação ligada ao partido: lacuna nomeada, que não afirma que a fonte não registrou", () => {
  assert.equal(fraseOrientacao(null), "Orientação da bancada: não identificada para este partido nesta votação.");
  assert.equal(fraseOrientacao(undefined), "Orientação da bancada: não identificada para este partido nesta votação.");
});

test("nenhuma frase compara, classifica ou rotula divergência", () => {
  const todas = (["sim", "nao", "abstencao", "obstrucao", "liberado"] as const).flatMap((valor) => (["partido", "bloco"] as const).map((tipo) => fraseOrientacao({ valor, quem: "X", tipo })));
  for (const f of [...todas, fraseOrientacao(null)]) assert.doesNotMatch(f, /contra o partido|divergi|rebelde|alinha|fiel|desobed|ranking|média|%/i, f);
});

test("a lacuna não diz que a fonte não registrou (pode ter orientado por bloco)", () => {
  assert.doesNotMatch(fraseOrientacao(null), /n[ãa]o registrad|sem orienta/i);
});
