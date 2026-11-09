import assert from "node:assert/strict";
import { test } from "node:test";
import { sortTaxesAZ, sortUfsAZ, taxBlurb } from "../impostos.ts";

test("estados saem A–Z pelo nome, não pelo valor", () => {
  const rows = [
    { uf: "SP", ufName: "São Paulo", totalCents: 9e12 },
    { uf: "AC", ufName: "Acre", totalCents: 1 },
    { uf: "DF", ufName: "Distrito Federal", totalCents: 5e12 },
    { uf: "AM", ufName: "Amazonas", totalCents: 3 },
    { uf: "ES", ufName: "Espírito Santo", totalCents: 2 },
  ];
  const out = sortUfsAZ(rows).map((r) => r.uf);
  assert.deepEqual(out, ["AC", "AM", "DF", "ES", "SP"]);
  assert.equal(rows[0]!.uf, "SP", "não muta a entrada");
});

test("tributos A–Z", () => {
  const out = sortTaxesAZ([{ tax: "IRPJ - DEMAIS EMPRESAS" }, { tax: "COFINS - DEMAIS" }, { tax: "CSLL" }]).map((t) => t.tax);
  assert.deepEqual(out, ["COFINS - DEMAIS", "CSLL", "IRPJ - DEMAIS EMPRESAS"]);
});

test("descrição por tributo; desconhecido vira null", () => {
  for (const n of ["IRPF", "IRPJ - DEMAIS EMPRESAS", "COFINS - DEMAIS", "CONTRIBUIÇÃO PARA O PIS/PASEP - FINANCEIRAS", "IPI - BEBIDAS", "IOF", "RECEITA PREVIDENCIÁRIA - PRÓPRIA", "CSLL - FINANCEIRAS", "IMPOSTO SOBRE IMPORTAÇÃO"]) {
    assert.ok(taxBlurb(n), n);
  }
  assert.equal(taxBlurb("XYZ"), null);
});

// Nomes como a Receita publica (w4_tax_revenue, 2025): todo tributo da página tem linha explicativa.
const RECEITA_2025 = ["ADMINISTRADAS POR OUTROS ÓRGÃOS", "CIDE-COMBUSTÍVEIS", "COFINS - DEMAIS", "COFINS - FINANCEIRAS", "CONTRIBUIÇÃO PARA O PIS/PASEP - DEMAIS", "CONTRIBUIÇÃO PARA O PIS/PASEP - FINANCEIRAS", "CPSSS - Contrib. p/ o Plano de Segurid. Social Serv. Público", "CSLL - DEMAIS", "CSLL - FINANCEIRAS", "IMPOSTO S/ OPERAÇÕES FINANCEIRAS", "IMPOSTO SOBRE EXPORTAÇÃO", "IMPOSTO SOBRE IMPORTAÇÃO", "IMPOSTO TERRITORIAL RURAL", "IPI - AUTOMÓVEIS", "IPI - BEBIDAS", "IPI - FUMO", "IPI - OUTROS", "IPI - VINCULADO À IMPORTACAO", "IRPF", "IRPJ - DEMAIS EMPRESAS", "IRPJ - ENTIDADES FINANCEIRAS", "IRRF - OUTROS RENDIMENTOS", "IRRF - REMESSAS P/ EXTERIOR", "IRRF - RENDIMENTOS DO CAPITAL", "IRRF - RENDIMENTOS DO TRABALHO", "OUTRAS RECEITAS ADMINISTRADAS", "RECEITA PREVIDENCIÁRIA"];
test("todo tributo publicado pela Receita em 2025 tem descrição", () => {
  assert.deepEqual(RECEITA_2025.filter((t) => !taxBlurb(t)), []);
});
