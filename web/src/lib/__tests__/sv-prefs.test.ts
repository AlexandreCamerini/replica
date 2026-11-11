import assert from "node:assert/strict";
import { test } from "node:test";
import { ESFERAS_PADRAO, parseCidade, parseEsferas, parseUf, serializeEsferas, voltarSeguro } from "../../components/sv/prefs-shared.ts";

const UFS = ["AC", "SP", "RJ"];

test("UF: só sigla da lista do contrato; sem cookie não há UF padrão", () => {
  assert.equal(parseUf("SP", UFS), "SP");
  assert.equal(parseUf(" sp ", UFS), "SP");
  assert.equal(parseUf("ZZ", UFS), null);
  assert.equal(parseUf("SPX", UFS), null);
  assert.equal(parseUf(undefined, UFS), null);
  assert.equal(parseUf("", UFS), null);
});

test("esferas: ida e volta; desligado explícito; malformado = ausente", () => {
  const e = { estadual: false, municipal: true, cidade: "3509502" };
  assert.equal(serializeEsferas(e), "e0.m1.c3509502");
  assert.deepEqual(parseEsferas(serializeEsferas(e)), e);
  assert.deepEqual(parseEsferas("e1.m0"), { estadual: true, municipal: false, cidade: null });
  assert.deepEqual(parseEsferas("e0.m0"), { estadual: false, municipal: false, cidade: null });
  for (const bad of [undefined, "", "e2.m0", "e1.m0.c123", "e1", "%E0%A4%A", "e1.m0;x"]) assert.equal(parseEsferas(bad), null, String(bad));
  assert.deepEqual(ESFERAS_PADRAO, { estadual: true, municipal: false, cidade: null });
  assert.equal(serializeEsferas({ estadual: true, municipal: false, cidade: "123" }), "e1.m0");
});

test("cidade: 7 dígitos e do prefixo da UF", () => {
  assert.equal(parseCidade("3509502", "35"), "3509502");
  assert.equal(parseCidade("3509502", "33"), null);
  assert.equal(parseCidade("3509502", null), "3509502");
  assert.equal(parseCidade("350950", "35"), null);
});

test("voltar: só caminhos do /v2, sem redirecionamento aberto", () => {
  assert.equal(voltarSeguro("/v2"), "/v2");
  assert.equal(voltarSeguro("/v2/acompanhando?x=1"), "/v2/acompanhando?x=1");
  for (const bad of ["https://exemplo.com", "//exemplo.com", "/v2//exemplo.com", "/v20", "/", "/v2\\..", null, 42]) assert.equal(voltarSeguro(bad), "/v2/ajustes", String(bad));
});
