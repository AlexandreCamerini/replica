import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { STATUS_CURADOS, chaveStatus, statusDeProposta } from "../../components/sv/status-proposta.ts";

test("termo da tabela vira frase; fora da tabela mostra o original; vazio é ausente", () => {
  assert.equal(statusDeProposta("Em Tramitação ").origem, "tabela");
  assert.equal(statusDeProposta("  arquivada").origem, "tabela");
  const novo = statusDeProposta("Pronta para pauta no Plenário");
  assert.deepEqual(novo, { origem: "fonte", original: "Pronta para pauta no Plenário" });
  assert.equal(statusDeProposta(null).origem, "ausente");
  assert.equal(statusDeProposta("   ").origem, "ausente");
});

test("a tabela não tem chave repetida e toda chave está normalizada", () => {
  const chaves = STATUS_CURADOS.map((c) => c.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  for (const c of chaves) assert.equal(c, chaveStatus(c));
});

test("acusa termo novo: todo status que a demonstração conhece (fake.ts) tem entrada na tabela", () => {
  const src = readFileSync(new URL("../data/fake.ts", import.meta.url), "utf8");
  const linha = src.split("\n").filter((l) => /status: law \?/.test(l));
  assert.ok(linha.length > 0, "linha de status da demonstração não encontrada");
  const termos = new Set(linha.flatMap((l) => [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1])));
  const faltam = [...termos].filter((t) => statusDeProposta(t).origem !== "tabela");
  assert.deepEqual(faltam, [], `termo novo sem entrada em STATUS_CURADOS: ${faltam.join(", ")}`);
});
