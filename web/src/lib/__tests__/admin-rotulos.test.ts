import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { abreviarId, descreverRecorte, nomeComSigla, nomeDaUf, nomeDeMunicipioNaMalha, nomeDoTerritorio, statusDaRodada, statusDoPedido, tipoDoPedido, UFS, ufDe } from "../admin/rotulos.ts";
import { dataBrasilia, dataComRelativo, horaBrasilia, segundosDesde, tempoRelativo } from "../admin/tempo.ts";

const geo = (p: string) => JSON.parse(readFileSync(new URL(`../../../public/geo/${p}`, import.meta.url), "utf8"));

test("a tabela de UFs confere com a malha br.json: mesmo código, sigla e nome, nas 27", () => {
  const br = geo("br.json") as { items: { ibge: string; uf: string; name: string }[] };
  assert.equal(UFS.length, 27);
  assert.equal(br.items.length, 27);
  for (const i of br.items) {
    const u = ufDe(i.ibge);
    assert.ok(u, `UF ${i.ibge} fora da tabela`);
    assert.deepEqual({ sigla: u.sigla, nome: u.nome }, { sigla: i.uf, nome: i.name });
  }
});

test("UF pelo nome, por código ou sigla; desconhecida nunca vira 'Estado 35'", () => {
  assert.equal(nomeDaUf("35"), "São Paulo");
  assert.equal(nomeDaUf("sp"), "São Paulo");
  assert.equal(nomeComSigla("53"), "Distrito Federal (DF)");
  assert.equal(nomeDaUf("99"), "UF 99");
  assert.equal(nomeDaUf(null), "UF desconhecida");
});

test("município pelo nome da malha da UF; sem malha mantém o código visível", () => {
  const sp = geo("uf/35.json") as { items: { ibge: string; name: string }[] };
  assert.equal(nomeDeMunicipioNaMalha("3500105", sp.items), "Adamantina");
  assert.equal(nomeDeMunicipioNaMalha("3500105", null), "município 3500105");
  assert.equal(nomeDeMunicipioNaMalha("0000000", sp.items), "município 0000000");
  assert.equal(nomeDoTerritorio({ nivel: "municipio", ibge: "3500105" }, "Adamantina"), "Adamantina (SP)");
  assert.equal(nomeDoTerritorio({ nivel: "municipio", ibge: "3500105" }), "município 3500105 (SP)");
  assert.equal(nomeDoTerritorio({ nivel: "uf", ibge: "35" }), "São Paulo");
  assert.equal(nomeDoTerritorio({ nivel: "pais", ibge: "BR" }), "Brasil");
  assert.equal(nomeDoTerritorio(null), "sem território");
});

test("status traduzidos: pedido, rodada e tipo; desconhecido degrada sem sublinhado", () => {
  assert.equal(statusDoPedido("na_fila"), "na fila");
  assert.equal(statusDoPedido("em_execucao"), "em execução");
  assert.equal(statusDoPedido("interrompido"), "interrompido");
  assert.equal(statusDoPedido("novo_status"), "novo status");
  assert.equal(statusDaRodada("falhou"), "com falha");
  assert.equal(statusDaRodada("concluida"), "concluída");
  assert.equal(tipoDoPedido("recoleta"), "Recoleta");
  assert.equal(tipoDoPedido("pedir_confirmacao"), "Decisão: pedir confirmação");
});

test("UUID abreviado (8) para a tela; id curto e texto livre ficam como estão", () => {
  assert.equal(abreviarId("3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab"), "3f2b8c1e");
  assert.equal(abreviarId("123"), "123");
  assert.equal(abreviarId(null), "");
  assert.equal(abreviarId("x".repeat(30)), "xxxxxxxxxxxx…");
});

test("recorte em frases, UF pelo nome", () => {
  assert.equal(descreverRecorte({ ufs: ["PB", "AM"], anos: [], casas: [], ibges: [], extras: {} }), "estados: Paraíba, Amazonas");
  assert.equal(descreverRecorte({ anos: [2024], extras: { escopo: "capitais" } }), "ano: 2024; escopo: capitais");
  assert.equal(descreverRecorte({}), "sem recorte (tudo o que o coletor cobre)");
  assert.equal(descreverRecorte(null), "sem recorte (tudo o que o coletor cobre)");
});

test("datas em horário de Brasília (UTC-3), com tempo relativo contra um 'agora' dado", () => {
  assert.equal(dataBrasilia("2026-11-17T10:30:00Z"), "17/11/2026 07:30");
  assert.equal(horaBrasilia("2026-11-17T02:05:00Z"), "23:05"); // ainda 16/11 em Brasília
  assert.equal(dataBrasilia("2026-11-17T02:05:00Z"), "16/11/2026 23:05");
  assert.equal(dataBrasilia(null), "sem data");
  assert.equal(dataBrasilia("lixo"), "data inválida");
  const agora = "2026-11-17T10:30:00Z";
  assert.equal(tempoRelativo("2026-11-17T10:29:55Z", agora), "agora há pouco");
  assert.equal(tempoRelativo("2026-11-17T10:29:30Z", agora), "há 30 s");
  assert.equal(tempoRelativo("2026-11-17T10:27:00Z", agora), "há 3 min");
  assert.equal(tempoRelativo("2026-11-17T08:30:00Z", agora), "há 2 h");
  assert.equal(tempoRelativo("2026-11-15T10:30:00Z", agora), "há 2 dias");
  assert.equal(tempoRelativo("2026-11-18T10:30:00Z", agora), "em 1 dia");
  assert.equal(tempoRelativo("2026-11-17T10:30:00Z", null), "");
  assert.equal(dataComRelativo("2026-11-17T10:27:00Z", agora), "17/11/2026 07:27 (há 3 min)");
  assert.equal(dataComRelativo("2026-11-17T10:27:00Z"), "17/11/2026 07:27");
  assert.equal(segundosDesde("2026-11-17T10:27:00Z", agora), 180);
  assert.equal(segundosDesde("lixo", agora), null);
});
