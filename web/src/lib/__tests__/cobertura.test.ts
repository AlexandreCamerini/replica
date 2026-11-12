import assert from "node:assert/strict";
import { test } from "node:test";
import { FAMILIAS_CARIMBO, coberturaDe, fonteDoConjunto, type EntradaCobertura } from "../data/cobertura.ts";
import { CONJUNTOS_PESSOA, ESTADOS_COBERTURA, type AssemblyInfo, type CoberturaConjunto, type EstadoCobertura } from "../data/types.ts";

const k = (nome: string) => ({ nome, url: "https://exemplo.gov.br", em: "2026-11-10T20:00:00Z" });
const todos = Object.fromEntries(FAMILIAS_CARIMBO.map((f) => [f, k(f)]));
const base: EntradaCobertura = { office: null, status: null, faltaFederal: null, coberturaLugar: [], carimbos: {}, assembleia: null, sapl: null, casa: null };
const estado = (cs: CoberturaConjunto[], c: string) => cs.find((x) => x.conjunto === c)!.estado;

test("um item por conjunto, na ordem fixa; data só em `lido`", () => {
  const cs = coberturaDe({ ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: [], carimbos: todos });
  assert.deepEqual(cs.map((x) => x.conjunto), [...CONJUNTOS_PESSOA]);
  for (const x of cs) {
    assert.equal(x.estado, "lido", x.conjunto);
    assert.ok(x.lidoEm && x.fonte, x.conjunto);
  }
  const sem = coberturaDe({ ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: ["presenca"], carimbos: {} });
  for (const x of sem) assert.equal(x.lidoEm, null, x.conjunto);
});

test("deputado federal: missing_datasets e falta de carimbo são `nao_carregado`, nunca lido", () => {
  const cs = coberturaDe({ ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: ["presenca", "votos"], carimbos: { ...todos, "camara.equipe": null } });
  assert.equal(estado(cs, "presenca"), "nao_carregado");
  assert.equal(estado(cs, "votos"), "nao_carregado");
  assert.equal(estado(cs, "equipe"), "nao_carregado");
  assert.equal(estado(cs, "gastos"), "lido");
});

test("conjunto carregado sem ligação com a pessoa não é `lido`", () => {
  const cs = coberturaDe({ ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: [], carimbos: todos, semVinculo: { emendas: "sem autor casado" } });
  assert.equal(estado(cs, "emendas"), "nao_carregado");
  assert.equal(cs.find((x) => x.conjunto === "emendas")!.motivo, "sem autor casado");
  assert.equal(estado(cs, "votos"), "lido");
});

test("senador: comissões citam o Senado, não a fonte com que a carga foi carimbada", () => {
  const cs = coberturaDe({ ...base, office: "senador", status: "em_exercicio", carimbos: todos });
  assert.match(cs.find((x) => x.conjunto === "comissoes")!.fonte!.nome, /Senado/);
});

test("senador: presença é `sem_fonte`; leis e equipe não são lidas", () => {
  const cs = coberturaDe({ ...base, office: "senador", status: "em_exercicio", faltaFederal: ["presenca"], carimbos: todos });
  assert.equal(estado(cs, "presenca"), "sem_fonte");
  assert.equal(estado(cs, "leis"), "nao_carregado");
  assert.equal(estado(cs, "equipe"), "nao_carregado");
  assert.equal(estado(cs, "votos"), "lido");
});

test("Executivo: plenário, cota, comissões e emendas não se aplicam; patrimônio é lido", () => {
  const cs = coberturaDe({ ...base, office: "governador", status: "em_exercicio", carimbos: todos });
  for (const c of ["presenca", "votos", "gastos", "comissoes", "emendas"]) assert.equal(estado(cs, c), "nao_se_aplica", c);
  assert.equal(estado(cs, "propostas"), "nao_carregado");
  assert.equal(estado(cs, "patrimonio"), "lido");
});

test("fora do exercício (licenciado, encerrado): presença, votos, gastos, equipe e comissões não viram 'não há'", () => {
  for (const status of ["licenciado", "encerrado", "afastado"] as const) {
    const cs = coberturaDe({ ...base, office: "deputado_federal", status, faltaFederal: [], carimbos: todos });
    for (const c of ["presenca", "votos", "gastos", "equipe", "comissoes"]) assert.equal(estado(cs, c), "fora_do_mandato", `${status} ${c}`);
    assert.equal(estado(cs, "propostas"), "lido");
  }
});

test("Assembleia lida pelo SAPL: carregado, fora desta página (nunca 'não carregamos' ao lado de 'lida do SAPL')", () => {
  const asm: AssemblyInfo = {
    uf: "RO", houseName: "Assembleia Legislativa de Rondônia", read: true, source: { name: "SAPL da Assembleia Legislativa", url: "https://sapl.al.ro.leg.br" },
    items: [
      { dataset: "presenca", label: "", status: "carregando", reason: "lida do SAPL", evidenceUrl: null, checkedOn: null, refreshedAt: "2026-11-09T09:29:45Z", stampDataset: "sapl-ale.presenca" },
      // o carimbo do SAPL é da casa: gastos, que o SAPL não traz, seguem com o status próprio
      { dataset: "gastos_gabinete", label: "", status: "desconhecido", reason: "não lida", evidenceUrl: null, checkedOn: null, refreshedAt: "2026-11-09T09:29:45Z", stampDataset: "sapl-ale.despesas" },
    ],
  };
  const cs = coberturaDe({ ...base, office: "deputado_estadual", status: "em_exercicio", assembleia: asm });
  assert.equal(estado(cs, "presenca"), "carregado_fora_da_pagina");
  assert.equal(estado(cs, "gastos"), "nao_conferido");
});

test("aguardando posse: fora do mandato (patrimônio continua lido)", () => {
  const cs = coberturaDe({ ...base, office: "deputado_federal", status: "eleito_aguardando_posse", carimbos: todos });
  assert.equal(estado(cs, "presenca"), "fora_do_mandato");
  assert.equal(estado(cs, "patrimonio"), "lido");
});

test("Assembleia e Câmara Municipal: data_coverage vira estado; `no_site` sem carimbo não é lido", () => {
  const asm: AssemblyInfo = {
    uf: "SP",
    houseName: "Assembleia Legislativa de SP",
    read: true,
    source: { name: "ALESP · Dados Abertos", url: "https://www.al.sp.gov.br/dados-abertos/" },
    items: [
      { dataset: "presenca", label: "", status: "nao_publica", reason: "não publica", evidenceUrl: null, checkedOn: null, refreshedAt: null, stampDataset: null },
      { dataset: "votos", label: "", status: "so_portal", reason: "só no portal", evidenceUrl: null, checkedOn: null, refreshedAt: null, stampDataset: null },
      { dataset: "propostas", label: "", status: "no_site", reason: "lido", evidenceUrl: null, checkedOn: null, refreshedAt: "2026-11-09T12:00:00Z", stampDataset: "alesp.proposicoes" },
      { dataset: "gastos_gabinete", label: "", status: "carregando", reason: "na fila", evidenceUrl: null, checkedOn: null, refreshedAt: null, stampDataset: null },
    ],
  };
  const cs = coberturaDe({ ...base, office: "deputado_estadual", status: "em_exercicio", assembleia: asm, carimbos: todos, casa: asm.houseName });
  assert.equal(estado(cs, "presenca"), "sem_fonte");
  assert.equal(estado(cs, "votos"), "fonte_sem_adaptador");
  assert.equal(estado(cs, "propostas"), "lido");
  assert.equal(estado(cs, "gastos"), "nao_carregado");
  assert.equal(estado(cs, "emendas"), "nao_carregado");
  // Assembleia que não pôde ser lida: não conferido, nunca "lido"
  assert.equal(estado(coberturaDe({ ...base, office: "deputado_estadual", status: "em_exercicio" }), "presenca"), "nao_conferido");

  const ver = coberturaDe({
    ...base,
    office: "vereador",
    status: "em_exercicio",
    casa: "Câmara Municipal de Campinas (SP)",
    coberturaLugar: [
      { dataset: "presenca", status: "desconhecido", reason: "ainda não conferimos", evidenceUrl: null },
      { dataset: "votos", status: "no_site", reason: "publica", evidenceUrl: null },
    ],
  });
  assert.equal(estado(ver, "presenca"), "nao_conferido");
  assert.equal(estado(ver, "votos"), "nao_carregado"); // no_site sem carimbo
  assert.equal(estado(ver, "propostas"), "nao_conferido"); // sem linha
  // SAPL casado: o dado está nas tabelas do SAPL, fora das leituras da página; não vira "lido" (lista vazia não é "não há")
  const sapl = coberturaDe({ ...base, office: "vereador", status: "em_exercicio", sapl: k("SAPL"), coberturaLugar: [] });
  assert.equal(estado(sapl, "propostas"), "carregado_fora_da_pagina");
  assert.equal(sapl.find((x) => x.conjunto === "propostas")!.fonte?.nome, "SAPL");
  assert.equal(estado(sapl, "gastos"), "nao_conferido");
});

test("os casos acima emitem todos os estados do contrato", () => {
  const vistos = new Set<EstadoCobertura>();
  const casos: EntradaCobertura[] = [
    { ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: [], carimbos: todos },
    { ...base, office: "senador", status: "em_exercicio", carimbos: todos },
    { ...base, office: "prefeito", status: "em_exercicio" },
    { ...base, office: "deputado_federal", status: "eleito_aguardando_posse" },
    { ...base, office: "vereador", status: "em_exercicio", coberturaLugar: [{ dataset: "votos", status: "so_portal", reason: "x", evidenceUrl: null }] },
    { ...base, office: "vereador", status: "em_exercicio", sapl: k("SAPL") },
  ];
  for (const e of casos) for (const x of coberturaDe(e)) vistos.add(x.estado);
  assert.deepEqual([...vistos].sort(), [...ESTADOS_COBERTURA].sort());
});

test("C1: com dado na tela, a fonte cita o carimbo da leitura qualquer que seja o estado (licenciado, encerrado…)", () => {
  const s = { dataset: "camara.presenca", source: "Câmara dos Deputados", sourceUrl: "https://dadosabertos.camara.leg.br", refreshedAt: "2026-11-09T10:00:00Z" };
  for (const status of ["licenciado", "encerrado", "afastado", "eleito_aguardando_posse"] as const) {
    const cs = coberturaDe({ ...base, office: "deputado_federal", status, faltaFederal: [], carimbos: todos });
    const pres = cs.find((x) => x.conjunto === "presenca")!;
    assert.equal(pres.estado, "fora_do_mandato", status);
    // com dado: o carimbo existe e aparece (nunca "data da leitura não registrada")
    assert.deepEqual(fonteDoConjunto(pres, s, true), { tipo: "carimbo", s }, status);
    // sem dado: a frase é da lacuna; sem fonte do motivo, nenhum carimbo
    assert.deepEqual(fonteDoConjunto(pres, s, false), { tipo: "carimbo", s: null }, status);
  }
  // lido: a data da carga da família, não a do carimbo antigo
  const lidoP = coberturaDe({ ...base, office: "deputado_federal", status: "em_exercicio", faltaFederal: [], carimbos: todos }).find((x) => x.conjunto === "presenca")!;
  const f = fonteDoConjunto(lidoP, s, true);
  assert.equal(f.tipo === "carimbo" && f.s?.refreshedAt, lidoP.lidoEm);
  // lacuna com fonte do motivo e sem dado: cita a fonte, sem data
  const sen = coberturaDe({ ...base, office: "senador", status: "em_exercicio", carimbos: todos }).find((x) => x.conjunto === "presenca")!;
  assert.deepEqual(fonteDoConjunto(sen, null, false), { tipo: "lacuna", nome: "Senado Federal" });
  // cobertura não lida: o carimbo da leitura
  assert.deepEqual(fonteDoConjunto(null, s, true), { tipo: "carimbo", s });
});
