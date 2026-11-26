import assert from "node:assert/strict";
import { test } from "node:test";
import { avisosDe, dobrar, escapar, haLeitura, lerCasa, montarCalendario, type Leituras } from "../../components/sv/calendario-pauta.ts";
import type { PautaEntry } from "../data/types.ts";

// F5b do roteiro do eleitor: calendário .ics da pauta do plenário.
const e = (o: Partial<PautaEntry>): PautaEntry => ({ key: "camara-pl-79-2020", body: "camara", type: "PL", number: 79, year: 2020, summary: "Dispõe sobre X, Y; e Z.", stage: "plenario", committee: null, scheduledFor: "2026-12-02T17:00:00.000Z", regime: null, rapporteur: null, reason: { theme: null, term: "t" }, ...o });
const LIDAS: Leituras = { camara: { readAt: "2026-11-26T09:00:00.000Z", failed: 0, total: 9 }, senado: { readAt: "2026-11-25T10:30:00.000Z", failed: 0, total: 4 } };
const OPTS = { base: "https://www.segueovoto.com.br/", geradoEm: "2026-11-26T12:00:00.000Z", leituras: LIDAS };
const plano = (ics: string) => ics.replace(/\r\n /g, "");

test("casa: ausente = as duas; camara/senado valem; qualquer outra coisa é null (400 na rota)", () => {
  assert.equal(lerCasa(null), "todas");
  assert.equal(lerCasa(""), "todas");
  assert.equal(lerCasa("camara"), "camara");
  assert.equal(lerCasa("senado"), "senado");
  assert.equal(lerCasa("CAMARA"), null);
  assert.equal(lerCasa("camara,senado"), null);
});

test("escapar: barra, ponto e vírgula, vírgula, quebra de linha; sem caractere de controle", () => {
  assert.equal(escapar("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(escapar("x\u0000y\u0007z"), "xyz");
});

test("dobrar: linha curta fica inteira; longa quebra em até 75 octetos sem cortar caractere; CRLF", () => {
  assert.equal(dobrar("ABC"), "ABC\r\n");
  const longa = "DESCRIPTION:" + "ação ".repeat(60);
  const linhas = dobrar(longa).split("\r\n").filter(Boolean);
  assert.ok(linhas.length > 1);
  for (const l of linhas) assert.ok(new TextEncoder().encode(l).length <= 75, l);
  for (const l of linhas.slice(1)) assert.ok(l.startsWith(" "));
  assert.equal(linhas.map((l, i) => (i ? l.slice(1) : l)).join(""), longa);
});

test("calendário: estrutura, UTC, URL da decisão, fonte com a data da leitura DA CASA, aviso de que não se atualiza e do que o horário significa", () => {
  const ics = montarCalendario([e({})], OPTS);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(ics), "toda quebra de linha é CRLF");
  const txt = plano(ics);
  assert.match(txt, /DTSTART:20261202T170000Z/);
  assert.match(txt, /DTEND:20261202T180000Z/);
  assert.match(txt, /URL:https:\/\/www\.segueovoto\.com\.br\/decisao\/camara-pl-79-2020\r\n/);
  assert.match(txt, /SUMMARY:PL 79\/2020 no plenário da Câmara dos Deputados\r\n/);
  assert.match(txt, /não se atualiza sozinho/);
  assert.match(txt, /lida em 26\/11\/2026\\, 06:00/);
  assert.match(txt, /Dispõe sobre X\\, Y\\; e Z\./);
  assert.match(txt, /início da sessão do plenário\\, segundo a fonte\. A hora em que esta proposta será votada não é informada\\, e a duração/);
  assert.ok(!txt.includes("[Exemplo]"));
});

test("Senado: gramática certa ('do Senado Federal') e a data de leitura é a do Senado, não a da Câmara", () => {
  const txt = plano(montarCalendario([e({ key: "senado-pl-1-2026", body: "senado", number: 1, year: 2026 }), e({})], OPTS));
  assert.match(txt, /SUMMARY:PL 1\/2026 no plenário do Senado Federal\r\n/);
  assert.match(txt, /Fonte: pauta do plenário do Senado Federal\\, lida em 25\/11\/2026\\, 07:30\./);
  assert.match(txt, /Fonte: pauta do plenário da Câmara dos Deputados\\, lida em 26\/11\/2026\\, 06:00\./);
  assert.ok(!/da Senado|do Câmara/.test(txt));
});

test("casa filtra; comissão não entra; duplicata some; ordem por data", () => {
  const ics = montarCalendario([e({ key: "b", scheduledFor: "2026-12-03T17:00:00.000Z" }), e({ key: "a" }), e({ key: "a" }), e({ key: "c", stage: "comissao", committee: "CCJ" }), e({ key: "s", body: "senado" })], OPTS);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.ok(ics.indexOf("decisao/a") < ics.indexOf("decisao/b"));
  assert.ok(!ics.includes("decisao/c"));
  const so = plano(montarCalendario([e({ key: "a" }), e({ key: "s", body: "senado" })], { ...OPTS, casa: "senado" }));
  assert.equal((so.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  assert.ok(!so.includes("plenário da Câmara dos Deputados"));
});

test("o que já passou e o que está além de 14 dias não vai para a agenda", () => {
  const ics = montarCalendario([e({ key: "passou", scheduledFor: "2026-11-24T17:00:00.000Z" }), e({ key: "hoje", scheduledFor: "2026-11-26T15:00:00.000Z" }), e({ key: "longe", scheduledFor: "2026-12-20T17:00:00.000Z" })], OPTS);
  assert.ok(ics.includes("decisao/hoje") && !ics.includes("decisao/passou") && !ics.includes("decisao/longe"));
});

test("data inválida da fonte não vira evento; lista vazia é calendário válido com os avisos no cabeçalho", () => {
  assert.ok(!montarCalendario([e({ scheduledFor: "lixo" })], OPTS).includes("BEGIN:VEVENT"));
  const vazio = plano(montarCalendario([], OPTS));
  assert.ok(vazio.includes("BEGIN:VCALENDAR") && vazio.includes("END:VCALENDAR"));
  assert.match(vazio, /X-WR-CALDESC:Propostas que acompanhamos no plenário/);
});

test("Casa não lida e leitura incompleta aparecem no arquivo (cabeçalho e cada evento); nunca silêncio", () => {
  const l: Leituras = { camara: { readAt: "2026-11-26T09:00:00.000Z", failed: 2, total: 9 }, senado: { readAt: null, failed: 0, total: 0 } };
  const txt = plano(montarCalendario([e({})], { ...OPTS, leituras: l }));
  assert.match(txt, /X-WR-CALDESC:[^\r]*ainda não foi lida/);
  assert.match(txt, /A pauta do Senado Federal ainda não foi lida: pode haver propostas marcadas que não estão neste arquivo\./);
  assert.match(txt, /Leitura incompleta da Câmara dos Deputados: 2 de 9 reuniões não carregaram/);
  assert.deepEqual(avisosDe(l, "camara"), ["Leitura incompleta da Câmara dos Deputados: 2 de 9 reuniões não carregaram, pode haver mais propostas do que as listadas."]);
  assert.deepEqual(avisosDe(LIDAS, "todas"), []);
});

test("sem nenhuma leitura da Casa pedida não há calendário (a rota responde 503): haLeitura", () => {
  const nada: Leituras = { camara: { readAt: null, failed: 0, total: 0 }, senado: { readAt: null, failed: 0, total: 0 } };
  assert.equal(haLeitura(nada, "todas"), false);
  assert.equal(haLeitura({ ...nada, camara: LIDAS.camara }, "senado"), false);
  assert.equal(haLeitura({ ...nada, camara: LIDAS.camara }, "todas"), true);
  assert.equal(haLeitura(LIDAS, "senado"), true);
});

test("demonstração: o evento diz que é exemplo (a proposta é inventada e não pode ir para uma agenda real como se fosse a pauta)", () => {
  const txt = plano(montarCalendario([e({})], { ...OPTS, demo: true }));
  assert.match(txt, /SUMMARY:\[Exemplo\] PL 79\/2020/);
  assert.match(txt, /Exemplo ilustrativo: proposta inventada para a demonstração/);
});
