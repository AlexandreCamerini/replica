import assert from "node:assert/strict";
import { test } from "node:test";
import { leisCitadas, noGlossario, type Verbete } from "../../components/sv/glossario-leis.ts";

test("acha leis citadas em formatos diferentes, sem repetir, na ordem do texto", () => {
  const t = "Altera a Lei nº 8.213, de 24 de julho de 1991, e a Lei 9.099/95; revoga a Lei Complementar 101/2000. Cita de novo a Lei 8.213/1991.";
  assert.deepEqual(leisCitadas(t).map((l) => l.chave), ["8213/1991", "9099/1995", "LC 101/2000"]);
});

test("lista plural e Decreto-Lei: 'Leis nºs 1, de..., 2, de... e 3, de...' vira três leis; Decreto-Lei não entra", () => {
  const t = "Altera o Decreto-Lei nº 1.305, de 8 de janeiro de 1974, e as Leis nºs 5.461, de 25 de junho de 1968, 5.989, de 17 de dezembro de 1973, e 12.462, de 4 de agosto de 2011, além da Lei nº 12.933, de 26 de dezembro de 2023.";
  assert.deepEqual(leisCitadas(t).map((l) => l.chave), ["5461/1968", "5989/1973", "12462/2011", "12933/2023"]);
});

test("texto sem lei, vazio ou nulo não cita nada; número solto não é lei", () => {
  assert.deepEqual(leisCitadas(null), []);
  assert.deepEqual(leisCitadas("Dispõe sobre o PL 123/2020 e o artigo 5/2020."), []);
});

test("lei fora do glossário vem com verbete null (lacuna); com verbete, vem o verbete", () => {
  const v: Verbete = { numero: "8213/1991", titulo: "t", resumo: "r", fonte: "Planalto", url: "https://www.planalto.gov.br", lidoEm: "2026-11-26" };
  const r = noGlossario("Altera a Lei 8.213/91 e a Lei 9.099/95.", [v]);
  assert.equal(r[0].verbete?.numero, "8213/1991");
  assert.equal(r[1].verbete, null);
  assert.equal(noGlossario("Lei 8.213/91").every((x) => x.verbete === null), true);
});
