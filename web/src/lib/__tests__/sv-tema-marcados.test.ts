import assert from "node:assert/strict";
import { test } from "node:test";
import { cobre, diaDaVotacao, situacaoNoTema, temMandatoNoCongresso, type MandatoDaPessoa, type VotacaoDoTema } from "../../components/sv/tema-marcados-regra.ts";

// D352: o que a tela do tema mostra para cada pessoa marcada. O cruzamento é pelo mandato que valia na data de cada votação.

const vC1: VotacaoDoTema = { id: "c1", body: "camara", occurredAt: "2026-03-10T15:00:00-03:00" };
const vC2: VotacaoDoTema = { id: "c2", body: "camara", occurredAt: "2026-12-15T20:00:00-03:00" };
const vS1: VotacaoDoTema = { id: "s1", body: "senado", occurredAt: "2026-05-20T18:00:00-03:00" };
const dep = (startedOn = "2023-02-01", endsOn: string | null = "2027-01-31", status = "em_exercicio"): MandatoDaPessoa => ({ office: "deputado_federal", status, startedOn, endsOn });
const sen = (startedOn = "2019-02-01", endsOn: string | null = "2027-01-31", status = "em_exercicio"): MandatoDaPessoa => ({ office: "senador", status, startedOn, endsOn });
const gov: MandatoDaPessoa = { office: "governador", status: "em_exercicio", startedOn: "2027-01-01", endsOn: "2030-12-31" };
const ver: MandatoDaPessoa = { office: "vereador", status: "em_exercicio", startedOn: "2025-01-01", endsOn: "2028-12-31" };

test("deputado com voto: votos da mais recente para a mais antiga, só da lista do tema", () => {
  const s = situacaoNoTema([dep()], [vC1, vC2, vS1], [
    { eventId: "c1", voto: "sim" },
    { eventId: "c2", voto: "nao" },
    { eventId: "fora-do-tema", voto: "sim" },
  ]);
  assert.equal(s.tipo, "votou");
  if (s.tipo !== "votou") return;
  assert.deepEqual(s.votos.map((v) => v.votacao.id), ["c2", "c1"]);
  assert.deepEqual(s.casas, ["camara"]);
  assert.equal(s.semRegistroEmOutras, false);
});

test("votação coberta pelo mandato sem voto vira nota, não some", () => {
  const s = situacaoNoTema([dep()], [vC1, vC2], [{ eventId: "c2", voto: "sim" }]);
  assert.equal(s.tipo === "votou" && s.semRegistroEmOutras, true);
});

test("deputado que virou governador: o voto de quando era deputado continua dele (virada de mandato)", () => {
  // hoje o cargo principal é governador; as votações do tema são de 2026, no mandato de deputado
  const s = situacaoNoTema([gov, dep("2023-02-01", "2026-12-31", "encerrado")], [vC1, vC2], [{ eventId: "c1", voto: "sim" }, { eventId: "c2", voto: "abstencao" }]);
  assert.equal(s.tipo, "votou");
});

test("deputado que virou senador: votos da Câmara e do Senado aparecem, cada um com a sua Casa", () => {
  const s = situacaoNoTema([sen("2027-02-01", "2035-01-31"), dep("2023-02-01", "2027-01-31", "encerrado")], [vC1, vS1], [{ eventId: "c1", voto: "sim" }]);
  assert.equal(s.tipo, "votou");
  if (s.tipo === "votou") assert.deepEqual(s.casas, ["camara"]);
});

test("posse no meio da janela: votação de antes da posse não conta como 'sem registro'", () => {
  const s = situacaoNoTema([dep("2026-06-01", "2027-01-31")], [vC1, vC2], [{ eventId: "c2", voto: "sim" }]);
  assert.equal(s.tipo === "votou" && s.semRegistroEmOutras, false);
});

test("mandato na Casa que não cobria nenhuma data: lacuna 'fora do mandato'", () => {
  const s = situacaoNoTema([dep("2019-02-01", "2023-01-31", "encerrado")], [vC1, vC2], []);
  assert.deepEqual(s, { tipo: "lacuna", motivo: "fora_do_mandato", casas: ["camara"] });
});

test("votações secretas ou sem voto individual nas datas do mandato: lacuna própria, não 'sem registro'", () => {
  const sec = { ...vC1, isSecret: true };
  const sv = { ...vC2, openNoVotes: true };
  assert.deepEqual(situacaoNoTema([dep()], [sec, sv], []), { tipo: "lacuna", motivo: "sem_voto_individual", casas: ["camara"] });
  // uma secreta e uma com voto: a secreta não entra na nota de "sem voto"
  const s = situacaoNoTema([dep()], [sec, vC2], [{ eventId: "c2", voto: "sim" }]);
  assert.equal(s.tipo === "votou" && s.semRegistroEmOutras, false);
});

test("lacunas com nome: quem não vota no Congresso, outra Casa, sem posse, sem registro, sem mandato, leitura que falhou", () => {
  assert.deepEqual(situacaoNoTema([ver], [vC1], []), { tipo: "lacuna", motivo: "nao_vota_no_congresso", casas: [] });
  assert.deepEqual(situacaoNoTema([sen()], [vC1, vC2], []), { tipo: "lacuna", motivo: "outra_casa", casas: ["senado"] });
  assert.deepEqual(situacaoNoTema([dep("2027-02-01", "2031-01-31", "eleito_aguardando_posse")], [vC1], []), { tipo: "lacuna", motivo: "aguarda_posse", casas: ["camara"] });
  assert.deepEqual(situacaoNoTema([dep()], [vC1], []), { tipo: "lacuna", motivo: "sem_registro", casas: ["camara"] });
  assert.deepEqual(situacaoNoTema([], [vC1], []), { tipo: "lacuna", motivo: "sem_mandato", casas: [] });
  assert.deepEqual(situacaoNoTema([dep()], [vC1], null), { tipo: "lacuna", motivo: "leitura_falhou", casas: ["camara"] });
  // quem não vota no Congresso não depende da leitura dos votos
  assert.equal(situacaoNoTema([ver], [vC1], null).tipo, "lacuna");
  assert.equal((situacaoNoTema([ver], [vC1], null) as { motivo: string }).motivo, "nao_vota_no_congresso");
});

test("data do mandato: início e fim inclusive, no dia de Brasília", () => {
  assert.equal(diaDaVotacao("2027-02-01T01:30:00Z"), "2027-01-31"); // 22h30 em Brasília
  assert.equal(cobre(dep("2023-02-01", "2027-01-31"), "2027-01-31"), true);
  assert.equal(cobre(dep("2023-02-01", "2027-01-31"), "2027-02-01"), false);
  assert.equal(cobre(dep("2023-02-01", null), "2030-01-01"), true);
  assert.equal(cobre({ ...dep(), startedOn: "" }, "2026-01-01"), false);
  assert.equal(temMandatoNoCongresso([ver, gov]), false);
  assert.equal(temMandatoNoCongresso([gov, dep()]), true);
});

test("licença, afastamento, renúncia e cassação: a falta de voto diz a situação do mandato, não só 'sem registro'", () => {
  for (const st of ["licenciado", "afastado", "renunciou", "cassado"] as const) {
    assert.deepEqual(situacaoNoTema([dep("2023-02-01", "2027-01-31", st)], [vC1], []), { tipo: "lacuna", motivo: "fora_do_exercicio", casas: ["camara"], statusFora: st });
    const s = situacaoNoTema([dep("2023-02-01", "2027-01-31", st)], [vC1, vC2], [{ eventId: "c1", voto: "sim" }]);
    assert.equal(s.tipo === "votou" && s.statusFora, st);
  }
  // em exercício ou encerrado no prazo: sem situação especial
  const s = situacaoNoTema([dep()], [vC1, vC2], [{ eventId: "c1", voto: "sim" }]);
  assert.equal(s.tipo === "votou" && s.statusFora, null);
});

test("votos iguais na mesma proposta e no mesmo dia viram uma linha; voto diferente não junta", async () => {
  const { agruparVotos } = await import("../../components/sv/tema-marcados-regra.ts");
  const v = (id: string, hora: string, prop: string, kind = "texto") => ({ id, body: "camara" as const, occurredAt: `2025-12-09T${hora}:00-03:00`, kind, prop });
  const votos = [
    { votacao: v("d", "22:00", "PL 1"), voto: "sim" },
    { votacao: v("c", "21:00", "PL 1"), voto: "sim" },
    { votacao: v("b", "20:00", "PL 1"), voto: "nao" },
    { votacao: v("a", "19:00", "PL 1", "destaque"), voto: "sim" },
    { votacao: v("z", "18:00", "PL 2"), voto: "sim" },
  ];
  const g = agruparVotos(votos, (x) => x.prop);
  assert.deepEqual(g.map((x) => x.votacoes.map((y) => y.id)), [["c", "d"], ["b"], ["a"], ["z"]]);
  assert.equal(g[0].votacao.id, "d"); // a linha leva a data e o voto do mais recente
});
