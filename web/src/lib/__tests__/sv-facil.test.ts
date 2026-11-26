import assert from "node:assert/strict";
import { test } from "node:test";
import { FACIL_COOKIE, parseFacil, voltarSeguro } from "../../components/sv/prefs-shared.ts";

// F12: modo leitura fácil. O cookie só liga com "1"; o destino de volta nunca vira redirecionamento aberto.

test("o cookie só liga com '1'; ausente ou qualquer outra coisa desliga, sem lançar", () => {
  assert.equal(FACIL_COOKIE, "sv_facil");
  assert.equal(parseFacil("1"), true);
  for (const v of [undefined, null, "", "0", "true", "on", "sim", " 1", "11", "1 ", "<script>"]) assert.equal(parseFacil(v as string | null | undefined), false, String(v));
});

test("o destino de volta do botão é só caminho interno (a ação usa voltarSeguro com a raiz como padrão)", () => {
  assert.equal(voltarSeguro("/votacoes?uf=SP#vt-3", "/"), "/votacoes?uf=SP#vt-3");
  assert.equal(voltarSeguro("https://outro.example/", "/"), "/");
  assert.equal(voltarSeguro("//outro.example", "/"), "/");
  assert.equal(voltarSeguro("/\\outro", "/"), "/");
  assert.equal(voltarSeguro(undefined, "/"), "/");
  assert.equal(voltarSeguro(null, "/"), "/");
});
