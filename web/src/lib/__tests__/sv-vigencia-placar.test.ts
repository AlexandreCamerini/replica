import assert from "node:assert/strict";
import { test } from "node:test";
import { PLACAR_MOTIVO, placarDe } from "../../components/sv/placar.ts";
import { reuniaoTexto, vigenciaDe } from "../../components/sv/vigencia.ts";

const zero = { sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0 };

test("vigência: MPV e PLV já valem, por enquanto", () => {
  for (const t of ["MPV", "PLV", "mpv"]) {
    const v = vigenciaDe(t);
    assert.equal(v.estado, "ja");
    assert.equal(v.frase, "Já vale, por enquanto.");
    assert.match(v.explicacao, /medida provisória: vale desde a publicação e perde a validade/);
  }
});

test("vigência: PEC e PDL sem sanção, terminam na promulgação pelo Congresso", () => {
  for (const t of ["PEC", "PDL"]) {
    const v = vigenciaDe(t);
    assert.equal(v.estado, "ainda");
    assert.match(v.falta, /promulgação pelo Congresso\.$/);
    assert.doesNotMatch(v.falta, /sanção do presidente\)|assinatura do presidente|pela sanção do presidente/);
  }
  assert.doesNotMatch(vigenciaDe("PRC").falta, /outra Casa|pela sanção/);
});

test("vigência: PL não afirma a outra Casa nem o plenário como certos", () => {
  const v = vigenciaDe("PL");
  assert.equal(v.estado, "ainda");
  assert.equal(v.falta, "Depois ainda pode passar pelo plenário e pela outra Casa do Congresso, e pela sanção do presidente. Só então vale.");
  assert.doesNotMatch(v.falta, /513|assinatura/);
});

test("vigência: tipo desconhecido não afirma etapas", () => {
  const v = vigenciaDe("XYZ");
  assert.equal(v.estado, "ainda");
  assert.doesNotMatch(v.falta, /plenário|outra Casa|sanção|promulgação/);
  assert.equal(vigenciaDe("").estado, "ainda");
});

test("reunião: só na_pauta fala no presente", () => {
  assert.deepEqual(reuniaoTexto({ kind: "na_pauta" }, "quarta, 11/11"), { presente: true, frase: "A reunião é quarta, 11/11." });
  for (const s of [
    { kind: "saiu", at: "2026-11-09T12:00:00Z" },
    { kind: "reuniao_cancelada", at: "2026-11-09T12:00:00Z" },
    { kind: "reuniao_encerrada", at: "2026-11-09T12:00:00Z" },
    { kind: "sem_leitura", lastSeenAt: "2026-11-09T12:00:00Z" },
  ] as const) {
    const r = reuniaoTexto(s, "quarta, 11/11");
    assert.equal(r.presente, false, s.kind);
    assert.doesNotMatch(r.frase, /A reunião é/, s.kind);
  }
});

test("placar: secreta, aberta sem votos e soma zero viram lacuna; nunca zeros", () => {
  assert.deepEqual(placarDe({ isSecret: true, openNoVotes: false, isNominal: true, counts: zero }), { kind: "lacuna", motivo: PLACAR_MOTIVO.secreta });
  assert.deepEqual(placarDe({ isSecret: false, openNoVotes: true, isNominal: true, counts: zero }), { kind: "lacuna", motivo: PLACAR_MOTIVO.semVotos });
  assert.deepEqual(placarDe({ isSecret: false, openNoVotes: false, isNominal: true, counts: zero }), { kind: "lacuna", motivo: null });
  assert.deepEqual(placarDe({ isSecret: false, openNoVotes: false, isNominal: false, counts: { ...zero, sim: 3 } }), { kind: "lacuna", motivo: null });
});

test("placar: sem voto soma não votou + presidia; obstrução à parte", () => {
  const p = placarDe({ isSecret: false, openNoVotes: false, isNominal: true, counts: { sim: 300, nao: 100, abstencao: 5, obstrucao: 7, art17: 1, nao_votou: 100 } });
  assert.deepEqual(p, { kind: "placar", sim: 300, nao: 100, abs: 5, sem: 101, obstrucao: 7, total: 513 });
});

import { aguardaPosse, casaDoMandato, cobreLeis, fraseDesde, mandatoPrincipal, rotuloGastos } from "../../components/sv/mandato.ts";

test("mandato: em exercício primeiro, depois aguardando posse", () => {
  const a = { status: "encerrado", office: "vereador", startedOn: "2021-01-01" } as const;
  const b = { status: "eleito_aguardando_posse", office: "deputado_federal", startedOn: "2027-02-01" } as const;
  const c = { status: "em_exercicio", office: "deputado_estadual", startedOn: "2023-02-01" } as const;
  assert.equal(mandatoPrincipal([a, b, c]), c);
  assert.equal(mandatoPrincipal([a, b]), b);
  assert.equal(mandatoPrincipal([a]), a);
  assert.equal(mandatoPrincipal([]), null);
  assert.equal(mandatoPrincipal(null), null);
});

test("mandato: quem não tomou posse nunca está 'no cargo desde'", () => {
  const b = { status: "eleito_aguardando_posse", office: "deputado_federal", startedOn: "2027-02-01" } as const;
  assert.equal(fraseDesde(b), "eleito(a), toma posse em 02/2027");
  assert.equal(fraseDesde(b, true), "eleita, toma posse em 02/2027");
  assert.ok(aguardaPosse(b));
  assert.equal(fraseDesde({ status: "em_exercicio", office: "senador", startedOn: "2023-02-01" }), "no cargo desde 02/2023");
  assert.equal(fraseDesde({ status: "encerrado", office: "senador", startedOn: "2019-02-01" }), "mandato desde 02/2019");
});

test("mandato: cobertura de leis, casa e rótulo de gastos", () => {
  assert.ok(cobreLeis("deputado_federal") && cobreLeis("senador"));
  assert.ok(!cobreLeis("deputado_estadual") && !cobreLeis("vereador") && !cobreLeis(null));
  assert.equal(casaDoMandato("deputado_estadual", "SP", "São Paulo"), "Assembleia Legislativa de SP");
  assert.equal(casaDoMandato("vereador", "SP", "Campinas"), "Câmara Municipal de Campinas");
  assert.equal(rotuloGastos("deputado_federal"), "cota parlamentar");
  assert.equal(rotuloGastos("deputado_estadual"), "gastos do gabinete");
});
