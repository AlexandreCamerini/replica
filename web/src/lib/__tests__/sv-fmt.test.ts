import assert from "node:assert/strict";
import { test } from "node:test";
import { anoDe, fmtDate, fmtDateTime, fmtDateTimeOuDia, fmtDayMonthAno } from "../../components/sv/fmt.ts";

test("anoDe: ano no fuso de Brasília (virada de ano em UTC ainda é o ano anterior)", () => {
  assert.equal(anoDe("2026-11-11"), 2026);
  assert.equal(anoDe("2027-01-01T02:00:00Z"), 2026); // 23h de 31/12 em Brasília
  assert.equal(anoDe("2027-01-01T04:00:00Z"), 2027);
  assert.equal(anoDe(null), null);
  assert.equal(anoDe("não é data"), null);
});

test("fmtDayMonthAno: dd/mm no ano de referência, dd/mm/aaaa em outro ano", () => {
  assert.equal(fmtDayMonthAno("2026-11-05T15:00:00-03:00", 2026), "05/11");
  assert.equal(fmtDayMonthAno("2025-11-05T15:00:00-03:00", 2026), "05/11/2025");
  assert.equal(fmtDayMonthAno("2025-03-02", 2026), "02/03/2025");
  assert.equal(fmtDayMonthAno("2026-03-02", 2026), "02/03");
});

test("fmtDate: v1 sempre com o ano", () => {
  assert.equal(fmtDate("2026-11-05T15:00:00-03:00"), "05/11/2026");
  assert.equal(fmtDate("2026-03-02"), "02/03/2026");
});

test("clip: curto fica inteiro; longo corta no limite de palavra, nunca no meio, e não deixa pontuação solta", async () => {
  const { clip } = await import("../../components/sv/fmt.ts");
  assert.equal(clip("curto", 10), "curto");
  const e = "Altera as Leis nºs 5.461, de 25 de junho de 1968, 5.989, de 17 de dezembro de 1973, 7.573, de 23 de dezembro de 1986";
  const c = clip(e, 80);
  assert.ok(c.endsWith("…") && c.length <= 80, c);
  assert.ok(e.startsWith(c.slice(0, -1)), c);
  assert.ok(e[c.length - 1] === " " || e[c.length - 1] === undefined || /\s/.test(e[c.length - 1]), `corta no espaço: ${c}`);
  assert.ok(!/[,;:]…$/.test(c), c);
  assert.equal(clip("a".repeat(50), 20), `${"a".repeat(19)}…`); // sem espaço nenhum: corte duro
});

test("fmtDateTimeOuDia: meia-noite de Brasília (só dia na fonte) mostra a data; com hora real mostra a hora", () => {
  assert.equal(fmtDateTimeOuDia("2026-11-18T03:00:00Z"), "18/11/2026"); // 00:00 em Brasília: o Senado só entrega dataSessao
  assert.equal(fmtDateTimeOuDia("2026-11-18T03:01:00Z"), fmtDateTime("2026-11-18T03:01:00Z")); // 00:01 já é hora real
  assert.match(fmtDateTimeOuDia("2026-11-18T17:30:00Z"), /14:30/);
  assert.equal(fmtDateTimeOuDia(null), "—");
  assert.equal(fmtDateTimeOuDia("lixo"), "—");
});
