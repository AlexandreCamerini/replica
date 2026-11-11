import assert from "node:assert/strict";
import { test } from "node:test";
import { anoDe, fmtDate, fmtDayMonthAno } from "../../components/sv/fmt.ts";

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
