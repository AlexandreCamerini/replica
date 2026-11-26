import assert from "node:assert/strict";
import { test } from "node:test";
import { centavosDe, diaDe, fmtReais, frasePessoa, janelaDe, lerVisita, proximaVisita, resumir, somarDias, type AtoDesde } from "../../components/sv/inicio/desde.ts";

// F2 do roteiro do eleitor (A1, A2): "O que mudou com seus escolhidos desde a última visita". A data da visita fica só no aparelho.

const HOJE = "2026-11-26";
const voto = (slug: string, nome: string, dia: string, chave: string, v = "Sim"): AtoDesde => ({ slug, nome, kind: "voto", dia, chave, voto: v, centavos: null });
const prop = (slug: string, nome: string, dia: string, chave: string): AtoDesde => ({ slug, nome, kind: "proposta", dia, chave, voto: null, centavos: null });
const gasto = (slug: string, nome: string, dia: string, centavos: number | null): AtoDesde => ({ slug, nome, kind: "gasto", dia, chave: `${dia}-${centavos}`, voto: null, centavos });

test("visita: a primeira vez não tem 'anterior'; no mesmo dia é a mesma visita; em outro dia a última abertura vira a anterior", () => {
  const t0 = new Date("2026-11-20T12:00:00Z");
  const primeira = proximaVisita(null, t0);
  assert.deepEqual(primeira, { atual: t0.toISOString(), anterior: null });
  // mais tarde no mesmo dia (Brasília): o 'anterior' não muda, nem horas depois (voltar à home não zera o "desde")
  const tarde = new Date("2026-11-20T22:30:00Z");
  assert.deepEqual(proximaVisita(primeira, tarde), { atual: tarde.toISOString(), anterior: null });
  // seis dias depois: é outra visita, a última abertura guardada passa a ser a anterior
  const t1 = new Date("2026-11-26T09:00:00Z");
  assert.deepEqual(proximaVisita(primeira, t1), { atual: t1.toISOString(), anterior: t0.toISOString() });
  // e no dia dessa visita nova, abrir de novo mantém essa anterior
  const t2 = new Date("2026-11-26T15:00:00Z");
  assert.deepEqual(proximaVisita(proximaVisita(primeira, t1), t2), { atual: t2.toISOString(), anterior: t0.toISOString() });
});

test("visita: o dia é o de Brasília: 23h50 e 00h10 locais são dias diferentes, mesmo a 20 minutos um do outro", () => {
  const antes = new Date("2026-11-21T02:50:00Z"); // 20/11, 23h50 em Brasília
  const depois = new Date("2026-11-21T03:10:00Z"); // 21/11, 00h10 em Brasília
  const g = proximaVisita(null, antes);
  assert.equal(proximaVisita(g, depois).anterior, antes.toISOString());
  // 22h e 23h50 do mesmo dia local: mesma visita
  assert.equal(proximaVisita(proximaVisita(null, new Date("2026-11-21T01:00:00Z")), antes).anterior, null);
});

test("visita: relógio do aparelho para trás conta como dia novo, sem estourar, e a janela cai no padrão", () => {
  const guardada = { atual: "2026-12-30T12:00:00.000Z", anterior: null };
  const r = proximaVisita(guardada, new Date("2026-11-20T12:00:00Z"));
  assert.equal(r.anterior, guardada.atual);
  assert.equal(janelaDe(r, "2026-11-20").origem, "padrao");
});

test("lerVisita: lixo, JSON quebrado ou data inválida valem como 'nada guardado'", () => {
  assert.equal(lerVisita(null), null);
  assert.equal(lerVisita(""), null);
  assert.equal(lerVisita("não é json"), null);
  assert.equal(lerVisita("42"), null);
  assert.equal(lerVisita('{"atual":"ontem","anterior":null}'), null);
  assert.equal(lerVisita('{"atual":"2026-11-20T12:00:00.000Z","anterior":"quando"}'), null);
  assert.deepEqual(lerVisita('{"atual":"2026-11-20T12:00:00.000Z","anterior":null}'), { atual: "2026-11-20T12:00:00.000Z", anterior: null });
});

test("janela: sem visita anterior, 14 dias (dito na tela); com visita, o dia dela; mais velha que 60 dias, limitada", () => {
  assert.deepEqual(janelaDe(null, HOJE), { desde: "2026-11-12", origem: "padrao", limitada: false });
  assert.deepEqual(janelaDe({ atual: "2026-11-26T09:00:00Z", anterior: null }, HOJE), { desde: "2026-11-12", origem: "padrao", limitada: false });
  assert.deepEqual(janelaDe({ atual: "2026-11-26T09:00:00Z", anterior: "2026-11-20T15:00:00Z" }, HOJE), { desde: "2026-11-20", origem: "visita", limitada: false });
  const velha = janelaDe({ atual: "2026-11-26T09:00:00Z", anterior: "2026-05-01T15:00:00Z" }, HOJE);
  assert.equal(velha.desde, somarDias(HOJE, -60));
  assert.equal(velha.limitada, true);
  // visita no futuro (relógio errado): volta à janela padrão, não inventa um "desde" futuro
  assert.equal(janelaDe({ atual: "2026-12-30T09:00:00Z", anterior: "2026-12-30T09:00:00Z" }, HOJE).origem, "padrao");
});

test("o dia da visita é o de Brasília: 01h UTC de 21/11 ainda é 20/11 à noite", () => {
  assert.equal(diaDe("2026-11-21T01:00:00.000Z"), "2026-11-20");
  assert.equal(diaDe("2026-11-20"), "2026-11-20");
  assert.equal(diaDe("lixo"), null);
});

test("valor em reais: lê o formato da fonte, com espaço comum ou sem quebra; fora dele, null (nunca chute)", () => {
  assert.equal(centavosDe("R$ 1.234,56"), 123456);
  assert.equal(centavosDe("R$ 5,00"), 500);
  assert.equal(centavosDe("R$ 12.345.678,90"), 1234567890);
  assert.equal(centavosDe("-R$ 10,00"), -1000);
  assert.equal(centavosDe("R$ 1.234"), null);
  assert.equal(centavosDe("1234,56"), null);
  assert.equal(centavosDe(null), null);
  assert.equal(fmtReais(123456), "R$ 1.234,56");
});

test("resumo: conta por pessoa e por tipo, só desde o dia pedido, em ordem alfabética", () => {
  const atos = [
    voto("zeca", "Zeca Lima", "2026-11-25", "/votacoes/a"),
    voto("zeca", "Zeca Lima", "2026-11-25", "/votacoes/b", "Não"),
    voto("ana", "Ana Souza", "2026-11-24", "/votacoes/a", "Abstenção"),
    prop("ana", "Ana Souza", "2026-11-23", "PL 1/2026"),
    gasto("ana", "Ana Souza", "2026-11-22", 10000),
    gasto("ana", "Ana Souza", "2026-11-22", 2550),
    // antes do "desde": não conta
    voto("ana", "Ana Souza", "2026-11-10", "/votacoes/velha"),
    gasto("bia", "Bia Reis", "2026-11-05", 99900),
  ];
  const r = resumir(atos, "2026-11-20");
  assert.deepEqual(r.map((x) => x.slug), ["ana", "zeca"]);
  assert.deepEqual(r[0], { slug: "ana", nome: "Ana Souza", votos: 1, semVoto: 0, propostas: 1, gastos: 2, gastoCentavos: 12550 });
  assert.equal(r[1]!.votos, 2);
  // quem não teve registro desde a data não aparece (a tela não diz que "não fez nada")
  assert.equal(r.find((x) => x.slug === "bia"), undefined);
});

test("resumo: o dia da visita conta inclusive (>= desde), e o dia anterior a ele não conta", () => {
  const r = resumir([voto("ana", "Ana", "2026-11-20", "/votacoes/a"), voto("ana", "Ana", "2026-11-19", "/votacoes/b")], "2026-11-20");
  assert.equal(r[0]!.votos, 1);
});

test("resumo: 'Art. 17' (presidente da sessão) e 'Não votou' não viram 'votou'; Obstrução é posição registrada", () => {
  const r = resumir(
    [voto("ana", "Ana", "2026-11-25", "/votacoes/a", "Art. 17"), voto("ana", "Ana", "2026-11-25", "/votacoes/b", "Não votou"), voto("ana", "Ana", "2026-11-25", "/votacoes/c", "Obstrução")],
    "2026-11-20",
  );
  assert.equal(r[0]!.votos, 1);
  assert.equal(r[0]!.semVoto, 2);
});

test("resumo: o mesmo voto lido duas vezes conta uma; 'Não votou' não vira voto", () => {
  const r = resumir(
    [voto("ana", "Ana", "2026-11-25", "/votacoes/a"), voto("ana", "Ana", "2026-11-25", "/votacoes/a"), voto("ana", "Ana", "2026-11-25", "/votacoes/b", "Não votou")],
    "2026-11-20",
  );
  assert.equal(r[0]!.votos, 1);
  assert.equal(r[0]!.semVoto, 1);
});

test("resumo: um gasto sem valor legível tira o valor da soma, mas continua na contagem", () => {
  const r = resumir([gasto("ana", "Ana", "2026-11-25", 1000), gasto("ana", "Ana", "2026-11-25", null)], "2026-11-20");
  assert.equal(r[0]!.gastos, 2);
  assert.equal(r[0]!.gastoCentavos, null);
  assert.match(frasePessoa(r[0]!, false), /teve 2 gastos registrados$/);
});

test("frase: só o que houve, singular e plural, 'e' antes do último, 'pelo menos' quando a leitura parou no limite", () => {
  const base = { slug: "a", nome: "A", votos: 0, semVoto: 0, propostas: 0, gastos: 0, gastoCentavos: 0 };
  assert.equal(frasePessoa({ ...base, votos: 1 }, false), "votou em 1 votação");
  assert.equal(frasePessoa({ ...base, votos: 6, propostas: 2, gastos: 31, gastoCentavos: 1234567 }, false), "votou em 6 votações, consta na autoria de 2 propostas e teve 31 gastos registrados (R$ 12.345,67)");
  assert.equal(frasePessoa({ ...base, votos: 2, gastos: 1, gastoCentavos: 500 }, false), "votou em 2 votações e teve 1 gasto registrado (R$ 5,00)");
  assert.equal(frasePessoa({ ...base, semVoto: 3 }, false), "ficou sem voto registrado em 3 votações");
  assert.equal(frasePessoa({ ...base, votos: 4 }, true), "votou em pelo menos 4 votações");
});
