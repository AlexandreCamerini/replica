import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHealth } from "../data/health.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const src = (slug: string, datasets: [string, number][]) => {
  const ds = datasets.map(([dataset, h]) => ({ dataset, refreshedAt: ago(h) }));
  return { slug, name: slug, url: "", datasets: ds, lastRefreshedAt: ds.map((d) => d.refreshedAt).reduce((a, b) => (b > a ? b : a)) };
};
// camara, senado e pauta em dia: o que muda nos testes é só o sapl
const base = () => [src("camara", [["camara.deputados", 5]]), src("senado", [["senado.senadores", 5], ["pauta.camara", 1]])];

test("sapl em dia: ok continua true", () => {
  const r = buildHealth([...base(), src("sapl", [["sapl.descoberta", 2], ["sapl.sp-saopaulo", 30]])], NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.essenciaisComProblema, []);
  assert.equal(r.fontes.find((f) => f.fonte === "sapl")?.essencial, true);
});

test("carimbos sapl.* além da régua (8 dias): ok=false e sapl listada", () => {
  const r = buildHealth([...base(), src("sapl", [["sapl.sp-saopaulo", 8 * 24 + 1], ["sapl.rj-riodejaneiro", 9 * 24]])], NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(r.essenciaisComProblema, ["sapl"]);
});

test("sapl.descoberta recente não mascara carga parada", () => {
  const r = buildHealth([...base(), src("sapl", [["sapl.descoberta", 1], ["sapl.sp-saopaulo", 10 * 24]])], NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(r.essenciaisComProblema, ["sapl"]);
});

test("sapl sem nenhum carimbo de carga derruba (nunca carregou não é em dia)", () => {
  assert.deepEqual(buildHealth([...base(), src("sapl", [["sapl.descoberta", 1]])], NOW).essenciaisComProblema, ["sapl"]);
  assert.deepEqual(buildHealth(base(), NOW).essenciaisComProblema, ["sapl"]);
});

test("fonte que aguarda chave de API (cgu, transparencia) não vira alerta", () => {
  const r = buildHealth([...base(), src("sapl", [["sapl.sp-saopaulo", 3]])], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.fontes.find((f) => f.fonte === "cgu")?.essencial, false);
  assert.equal(r.fontes.find((f) => f.fonte === "transparencia")?.estado, "sem_dado");
});

test("sapl-ale vencida não derruba o vigia (fonte própria, não essencial)", () => {
  const r = buildHealth([...base(), src("sapl", [["sapl.sp-saopaulo", 3]]), src("sapl-ale", [["sapl-ale.ro", 20 * 24]])], NOW);
  assert.equal(r.ok, true);
});
