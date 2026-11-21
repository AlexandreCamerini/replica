import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommitteeItem, MandateSpend, YearStats } from "../data/types.ts";
import { comissoesNaJanela, custoMandato, frasePeriodo, janelaMandato, mesesEntre, somaAnual, vmGastoMandato } from "../mandato-visao.ts";

const HOJE = "2026-11-21";

test("janelaMandato: mandato que começou antes do primeiro ano carregado é truncado e diz 'desde' o ano carregado", () => {
  const j = janelaMandato({ inicio: "2015-02-01", primeiraNotaEm: "2019-03-12", hojeIso: HOJE })!;
  assert.equal(j.truncada, true);
  assert.equal(j.inicio, "2019-01-01");
  assert.equal(j.desdeAno, 2019);
  assert.equal(j.fim, null);
  assert.equal(frasePeriodo(2019, j), "no que está carregado desde 2019");
  assert.ok(!frasePeriodo(2019, j).includes("total do mandato"));
});

test("janelaMandato: mandato dentro do que está carregado começa na posse, sem truncar", () => {
  const j = janelaMandato({ inicio: "2023-02-01", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!;
  assert.equal(j.truncada, false);
  assert.equal(j.inicio, "2023-02-01");
  assert.equal(j.desdeAno, 2023);
  assert.equal(frasePeriodo(2023, j), "no mandato, desde 2023");
});

test("janelaMandato: número que só começa depois da posse não diz 'no mandato'", () => {
  const j = janelaMandato({ inicio: "2019-02-01", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!;
  assert.equal(frasePeriodo(2022, j), "no que está carregado desde 2022");
});

test("janelaMandato: primeira nota no mesmo ano da posse, antes ou depois, não trunca", () => {
  assert.equal(janelaMandato({ inicio: "2019-02-01", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!.truncada, false);
  // nota em 2019 e posse em 2019-02: o corte (1º de janeiro) é anterior à posse
  assert.equal(janelaMandato({ inicio: "2019-02-01", primeiraNotaEm: "2019-11-05", hojeIso: HOJE })!.truncada, false);
});

test("janelaMandato: sem nota carregada, a janela é só o mandato e o ano carregado é null", () => {
  const j = janelaMandato({ inicio: "2023-02-01", primeiraNotaEm: null, hojeIso: HOJE })!;
  assert.equal(j.truncada, false);
  assert.equal(j.primeiroAnoCarregado, null);
  assert.equal(j.inicio, "2023-02-01");
});

test("janelaMandato: fim só vale para mandato já terminado; data inválida = null", () => {
  assert.equal(janelaMandato({ inicio: "2019-02-01", fim: "2027-01-31", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!.fim, null);
  assert.equal(janelaMandato({ inicio: "2015-02-01", fim: "2018-12-31", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!.fim, "2018-12-31");
  assert.equal(janelaMandato({ inicio: "lixo", primeiraNotaEm: null, hojeIso: HOJE }), null);
});

test("mesesEntre: inclusivo, atravessa o ano, e entrada ruim vira lista vazia", () => {
  assert.deepEqual(mesesEntre("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(mesesEntre("2026-03", "2026-03"), ["2026-03"]);
  assert.deepEqual(mesesEntre("2026-03", "2026-01"), []);
  assert.deepEqual(mesesEntre("x", "2026-01"), []);
});

const spend = (o: Partial<MandateSpend> = {}): MandateSpend => ({
  primeiraNotaEm: "2019-02-05",
  ultimaNotaEm: "2026-10-20",
  notas: 5,
  totalCents: 100_000,
  porCategoria: [
    { label: "Telefonia", cents: 30_000, notas: 2 },
    { label: "Divulgação", cents: 90_000, notas: 2 },
    { label: "Passagens", cents: -20_000, notas: 1 },
  ],
  porMes: [
    { mes: "2024-01", cents: 50_000, notas: 3 },
    { mes: "2024-04", cents: 50_000, notas: 2 },
  ],
  ...o,
});
const janela = janelaMandato({ inicio: "2023-02-01", primeiraNotaEm: "2019-02-05", hojeIso: HOJE })!;

test("vmGastoMandato: categorias A–Z (nunca por valor) e meses cronológicos", () => {
  const vm = vmGastoMandato(spend(), janela)!;
  assert.deepEqual(vm.categorias.map((c) => c.label), ["Divulgação", "Passagens", "Telefonia"]);
  // a maior categoria (Divulgação, 90 mil) é a primeira só por ser A–Z: troque os valores e a ordem não muda
  const vm2 = vmGastoMandato(spend({ porCategoria: [{ label: "Telefonia", cents: 900_000, notas: 2 }, { label: "Divulgação", cents: 1, notas: 1 }] }), janela)!;
  assert.deepEqual(vm2.categorias.map((c) => c.label), ["Divulgação", "Telefonia"]);
  const ms = vm.meses.map((m) => m.mes);
  assert.deepEqual(ms, [...ms].sort());
});

test("vmGastoMandato: mês sem nota entre dois com nota é null ('—'), nunca R$ 0", () => {
  const vm = vmGastoMandato(spend(), janela)!;
  assert.deepEqual(vm.meses.map((m) => [m.mes, m.cents]), [["2024-01", 50_000], ["2024-02", null], ["2024-03", null], ["2024-04", 50_000]]);
  assert.equal(vm.mesesSemNota, 2);
  assert.ok(vm.meses.every((m) => m.cents !== 0));
});

test("vmGastoMandato: estorno negativo fica como a fonte publica e entra na soma", () => {
  const vm = vmGastoMandato(spend(), janela)!;
  assert.equal(vm.temEstorno, true);
  assert.equal(vm.categorias.find((c) => c.label === "Passagens")!.cents, -20_000);
  assert.equal(vm.totalCents, 100_000);
});

test("vmGastoMandato: nenhuma nota na janela é lacuna (null), nunca zero", () => {
  assert.equal(vmGastoMandato(spend({ notas: 0, totalCents: 0, porCategoria: [], porMes: [] }), janela), null);
});

test("custoMandato: só soma salário e cota quando os dois existem", () => {
  const sal = { cents: 1_000_000, months: 12, coveredMonths: 12, firstMonth: "2025-01-01", coveredFrom: "2025-01-01" };
  const c = custoMandato({ salario: sal, cotaCents: 400_000, mesesSemNotaCota: 0 });
  assert.equal(c.estado, "soma");
  if (c.estado === "soma") {
    assert.equal(c.totalCents, 1_400_000);
    assert.deepEqual(c.fora, []);
  }
});

test("custoMandato: falta uma parte = sem soma; a parte que existe aparece, a outra é lacuna", () => {
  const sal = { cents: 1_000_000, months: 12, coveredMonths: 12, firstMonth: "2025-01-01", coveredFrom: "2025-01-01" };
  const semCota = custoMandato({ salario: sal, cotaCents: null, mesesSemNotaCota: 0 });
  assert.equal(semCota.estado, "sem_soma");
  if (semCota.estado === "sem_soma") {
    assert.deepEqual(semCota.faltam, ["cota"]);
    assert.equal(semCota.salarioCents, 1_000_000);
    assert.equal(semCota.cotaCents, null);
  }
  const semSal = custoMandato({ salario: null, cotaCents: 400_000, mesesSemNotaCota: 0 });
  assert.equal(semSal.estado, "sem_soma");
  if (semSal.estado === "sem_soma") assert.deepEqual(semSal.faltam, ["salário"]);
  const nenhum = custoMandato({ salario: null, cotaCents: null, mesesSemNotaCota: 0 });
  if (nenhum.estado === "sem_soma") assert.deepEqual(nenhum.faltam, ["salário", "cota"]);
});

test("custoMandato: diz quais meses ficaram fora da soma", () => {
  const sal = { cents: 800_000, months: 10, coveredMonths: 7, firstMonth: "2023-02-01", coveredFrom: "2023-05-01" };
  const c = custoMandato({ salario: sal, cotaCents: 400_000, mesesSemNotaCota: 1 });
  assert.equal(c.estado, "soma");
  assert.deepEqual(c.fora, ["3 meses sem valor de salário carregado, antes de 05/2023.", "1 mês sem nota de cota na fonte, entre o primeiro e o último com nota."]);
});

const ano = (year: number, o: Partial<YearStats> = {}): YearStats => ({
  year,
  presencePresent: null,
  presenceTotal: null,
  proposalsPrincipal: null,
  proposalsCosigned: null,
  votesRegistered: null,
  expensesCents: null,
  ...o,
});

test("somaAnual: ano com fonte não carregada (null) não entra e não vira zero; 'desde' é o primeiro ano com valor", () => {
  const rows = [ano(2019, { votesRegistered: null }), ano(2020, { votesRegistered: 10 }), ano(2021, { votesRegistered: 0 }), ano(2022, { votesRegistered: 5 })];
  assert.deepEqual(somaAnual(rows, "votesRegistered", 2019, 2026), { valor: 15, desde: 2020, ate: 2022 });
  // zero lido é zero: o ano 2021 conta, com valor 0
  assert.deepEqual(somaAnual(rows, "votesRegistered", 2021, 2026), { valor: 5, desde: 2021, ate: 2022 });
});

test("somaAnual: nenhum ano com valor na janela = null ('—')", () => {
  assert.equal(somaAnual([ano(2019, { votesRegistered: 3 })], "votesRegistered", 2023, 2026), null);
  assert.equal(somaAnual([], "votesRegistered", 2019, 2026), null);
  assert.equal(somaAnual([ano(2024)], "proposalsPrincipal", 2019, 2026), null);
});

const com = (name: string, from: string, to: string | null, role = "Titular"): CommitteeItem => ({ acronym: null, name, role, from, to, body: "camara" });

test("comissoesNaJanela: só as que tocam a janela, em ordem A–Z", () => {
  const lista = [com("Saúde", "2024-03-01", null), com("Educação", "2019-03-01", "2020-12-31"), com("Agricultura", "2021-03-01", "2023-06-30"), com("Defesa", "2027-03-01", null)];
  const r = comissoesNaJanela(lista, "2023-02-01", "2026-12-31");
  assert.deepEqual(r.map((c) => c.name), ["Agricultura", "Saúde"]);
});

test("custoMandato: a soma diz o intervalo comum de salário e cota (primeiro ao último mês com nota)", () => {
  const sal = { cents: 800_000, months: 10, coveredMonths: 10, firstMonth: "2023-03-01", coveredFrom: "2023-03-01" };
  const c = custoMandato({ salario: sal, cotaCents: 400_000, mesesSemNotaCota: 0, intervalo: { de: "2023-03", ate: "2023-12" } });
  assert.equal(c.estado, "soma");
  assert.ok(c.fora.some((f) => f.startsWith("A soma cobre de 03/2023 a 12/2023")));
});

test("custoMandato: sem uma das partes não há intervalo nem soma, mesmo com intervalo informado", () => {
  const c = custoMandato({ salario: null, cotaCents: 400_000, mesesSemNotaCota: 0, intervalo: { de: "2023-03", ate: "2023-12" } });
  assert.equal(c.estado, "sem_soma");
  assert.ok(!c.fora.some((f) => f.startsWith("A soma cobre")));
});
