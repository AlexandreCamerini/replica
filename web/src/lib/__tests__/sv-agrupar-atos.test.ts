import assert from "node:assert/strict";
import { test } from "node:test";
import { agruparAtos, comDiaCerto, VOTACAO_SEM_PROPOSTA, type Ato } from "../../components/sv/escolhidos/agrupar.ts";

// D328: os casos abaixo são os que duplicavam em produção em 16/11/2026 (lidos de /acompanhando por requisição).

const voto = (slug: string, nome: string, at: string, title: string, detail: string, id: string): Ato => ({ personSlug: slug, personName: nome, kind: "voto", occurredAt: at, title, detail, href: `/votacoes/${id}` });
const gasto = (at: string, title: string, detail: string): Ato => ({ personSlug: "aecio-neves", personName: "Aécio Neves", kind: "gasto", occurredAt: at, title, detail, href: "/p/aecio-neves#gastos" });

test("duas votações da mesma proposta no mesmo dia, com o mesmo voto: uma linha, que conta duas e leva às duas", () => {
  // Alan Rick, 12/11/2026: "votou Não em PLP 299/2026" aparecia duas vezes
  const r = agruparAtos([
    voto("alan-rick", "Alan Rick", "2026-11-12T21:10:00.000Z", "PLP 299/2026", "Não", "dea11897"),
    voto("alan-rick", "Alan Rick", "2026-11-12T20:40:00.000Z", "PLP 299/2026", "Não", "47571de7"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].vezes, 2);
  assert.deepEqual(r[0].hrefs, ["/votacoes/47571de7", "/votacoes/dea11897"]); // da mais antiga à mais recente
});

test("quatro votações de uma PEC no mesmo dia viram uma linha; a de outro dia continua separada, na ordem", () => {
  // Ana Paula Lobato: PLP 299/2026 duas vezes em 12/11 e PEC 18/2025 quatro vezes em 03/11
  const r = agruparAtos([
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-12T21:10:00.000Z", "PLP 299/2026", "Sim", "dea11897"),
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-12T20:40:00.000Z", "PLP 299/2026", "Sim", "47571de7"),
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-03T22:00:00.000Z", "PEC 18/2025", "Sim", "dae36a02"),
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-03T21:30:00.000Z", "PEC 18/2025", "Sim", "4d4c6f2a"),
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-03T21:00:00.000Z", "PEC 18/2025", "Sim", "f4d94fa8"),
    voto("ana-paula-lobato", "Ana Paula Lobato", "2026-11-03T20:30:00.000Z", "PEC 18/2025", "Sim", "227a7129"),
  ]);
  assert.deepEqual(r.map((g) => [g.item.title, g.vezes]), [["PLP 299/2026", 2], ["PEC 18/2025", 4]]);
  assert.equal(r[1].hrefs.length, 4);
});

test("dois gastos da mesma categoria, no mesmo dia e de mesmo valor: uma linha, que conta dois", () => {
  // Aécio Neves, 15/10/2026 (a tela dizia 14/10): "Manutenção de escritório…: R$ 60,26" aparecia duas vezes
  const cat = "Manutenção de escritório de apoio à atividade parlamentar";
  const r = agruparAtos([gasto("2026-10-15T00:00:00.000Z", cat, "R$ 60,26"), gasto("2026-10-15T00:00:00.000Z", cat, "R$ 60,26"), gasto("2026-10-15T00:00:00.000Z", cat, "R$ 120,00")].map(comDiaCerto));
  assert.deepEqual(r.map((g) => [g.item.detail, g.vezes]), [["R$ 60,26", 2], ["R$ 120,00", 1]]);
});

test("o mesmo registro lido duas vezes conta uma vez", () => {
  const v = voto("alan-rick", "Alan Rick", "2026-11-12T21:10:00.000Z", "PLP 299/2026", "Não", "dea11897");
  const r = agruparAtos([v, { ...v }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].vezes, 1);
  assert.deepEqual(r[0].hrefs, ["/votacoes/dea11897"]);
  const p: Ato = { personSlug: "x", personName: "X", kind: "proposta", occurredAt: "2026-11-12", title: "PL 1/2026", detail: null, href: "https://exemplo/pl1" };
  const props = agruparAtos([p, { ...p }]);
  assert.equal(props.length, 1);
  assert.equal(props[0].vezes, 1);
});

test("leitura cortada: os grupos do dia do último registro lido saem como mínimo; os dos dias anteriores ao corte, não", () => {
  const itens = [
    voto("a", "A", "2026-11-12T21:00:00.000Z", "PL 9/2026", "Sim", "1"),
    voto("a", "A", "2026-11-12T20:00:00.000Z", "PL 9/2026", "Sim", "2"),
    voto("a", "A", "2026-11-03T21:00:00.000Z", "PEC 18/2025", "Sim", "3"),
    voto("a", "A", "2026-11-03T20:00:00.000Z", "PEC 18/2025", "Sim", "4"),
  ];
  // a leitura trouxe 4 e o teto era 4: pode haver mais votações da PEC em 03/11 que não vieram
  assert.deepEqual(agruparAtos(itens, 4).map((g) => [g.item.title, g.vezes, g.aoMenos]), [["PL 9/2026", 2, false], ["PEC 18/2025", 2, true]]);
  // o teto era maior que o lido: nada ficou de fora
  assert.ok(agruparAtos(itens, 24).every((g) => !g.aoMenos));
  assert.ok(agruparAtos(itens).every((g) => !g.aoMenos));
});

test("votação sem proposta ligada: junta, e o título avisa quem escreve a frase", () => {
  const r = agruparAtos([voto("a", "A", "2026-11-12T21:00:00.000Z", VOTACAO_SEM_PROPOSTA, "Sim", "1"), voto("a", "A", "2026-11-12T20:00:00.000Z", VOTACAO_SEM_PROPOSTA, "Sim", "2")]);
  assert.equal(r.length, 1);
  assert.equal(r[0].vezes, 2);
  assert.equal(r[0].item.title, "Votação nominal"); // a tela escreve "2 votações nominais", sem "de"
});

test("gasto e proposta com dia sem hora: meia-noite UTC volta a ser o dia, e não a véspera em Brasília", () => {
  // Aécio Neves: gasto de 15/10/2026 aparecia como 14/10/2026
  const g = gasto("2026-10-15T00:00:00.000Z", "Manutenção de escritório", "R$ 60,26");
  assert.equal(comDiaCerto(g).occurredAt, "2026-10-15");
  assert.equal(comDiaCerto({ ...g, kind: "proposta" }).occurredAt, "2026-10-15");
  // voto tem hora de verdade: meia-noite UTC é 21h da véspera em Brasília e fica como está
  const v = voto("a", "A", "2026-10-15T00:00:00.000Z", "PL 1/2026", "Sim", "1");
  assert.equal(comDiaCerto(v).occurredAt, "2026-10-15T00:00:00.000Z");
  // o que já é dia, ou tem hora, não muda
  assert.equal(comDiaCerto(gasto("2026-10-15", "x", "y")).occurredAt, "2026-10-15");
  assert.equal(comDiaCerto(gasto("2026-10-15T03:00:00.000Z", "x", "y")).occurredAt, "2026-10-15T03:00:00.000Z");
  // gasto de 15/10 e gasto de 14/10 não se juntam depois do acerto
  const r = agruparAtos([g, gasto("2026-10-14T00:00:00.000Z", "Manutenção de escritório", "R$ 60,26")].map(comDiaCerto));
  assert.equal(r.length, 2);
});

test("não junta o que é diferente: outro voto, outra pessoa, outro dia, outro tipo", () => {
  const base = voto("alan-rick", "Alan Rick", "2026-11-12T21:10:00.000Z", "PLP 299/2026", "Não", "a");
  const r = agruparAtos([
    base,
    { ...base, detail: "Sim", href: "/votacoes/b" }, // mudou o voto num destaque
    { ...base, personSlug: "beto-faro", personName: "Beto Faro", href: "/votacoes/a" },
    { ...base, occurredAt: "2026-11-11T21:10:00.000Z", href: "/votacoes/c" },
    { ...base, kind: "proposta", href: "/p/alan-rick" },
  ]);
  assert.equal(r.length, 5);
  assert.ok(r.every((g) => g.vezes === 1));
});

test("o dia é o de Brasília: 23h30 de um dia e 0h30 do seguinte não se juntam, mesmo no mesmo dia em UTC", () => {
  const r = agruparAtos([
    voto("a", "A", "2026-11-13T03:30:00.000Z", "PL 1/2026", "Sim", "x"), // 13/11 00h30 em Brasília
    voto("a", "A", "2026-11-13T02:30:00.000Z", "PL 1/2026", "Sim", "y"), // 12/11 23h30 em Brasília
  ]);
  assert.equal(r.length, 2);
});

test("mantém a ordem de chegada e não mexe na lista de entrada", () => {
  const entrada = [voto("a", "A", "2026-11-12T20:00:00.000Z", "PL 2/2026", "Sim", "1"), voto("a", "A", "2026-11-11T20:00:00.000Z", "PL 1/2026", "Sim", "2"), voto("a", "A", "2026-11-12T19:00:00.000Z", "PL 2/2026", "Sim", "3")];
  const copia = JSON.stringify(entrada);
  assert.deepEqual(agruparAtos(entrada).map((g) => g.item.title), ["PL 2/2026", "PL 1/2026"]);
  assert.equal(JSON.stringify(entrada), copia);
});
