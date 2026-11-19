import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Catalogo, coletorDoCatalogo, recortesDoColetor, validarRodada, OPCOES_ESCOPO, RECORTES_NA_TELA } from "../admin/catalogo.ts";
import { confirmacaoDeRodada } from "../admin/confirmacao.ts";
import { catalogoDoPython } from "../../../e2e-admin/gerar-catalogo.mjs";

// O catálogo de coletores mora em Python (etl/civico_etl/catalogo). web/src/lib/admin/catalogo.json é gerado por web/e2e-admin/gerar-catalogo.mjs e é o que o build usa.
// Este teste compara o arquivo com a saída do Python (pula, com o motivo, se não houver uv/python3 que importem o pacote), do mesmo modo que admin-sql.test.ts.

const ARQUIVO = fileURLToPath(new URL("../admin/catalogo.json", import.meta.url));
const cat = JSON.parse(readFileSync(ARQUIVO, "utf8")) as Catalogo;
const py = catalogoDoPython() as { ok: boolean; json?: unknown; motivo?: string };
const semPython = py.ok ? false : (py.motivo ?? "python indisponível");

test("catalogo.json é igual à saída do Python (regenere com: node e2e-admin/gerar-catalogo.mjs)", { skip: semPython }, () => {
  assert.deepEqual(cat, py.json);
});

test("catalogo.json: forma, ids únicos, modos e recortes dentro do vocabulário", () => {
  assert.ok(cat.coletores.length >= 20);
  assert.equal(new Set(cat.coletores.map((c) => c.id)).size, cat.coletores.length);
  for (const c of cat.coletores) {
    assert.ok(c.modos.length >= 1, `${c.id}: sem modo suportado`);
    for (const m of c.modos) assert.ok(["descobrir", "recoletar", "reprocessar"].includes(m));
    for (const m of Object.keys(c.modos_recusados)) assert.ok(!c.modos.includes(m) && c.modos_recusados[m].length > 0, `${c.id}: ${m}`);
    assert.equal(c.modos.length + Object.keys(c.modos_recusados).length, 3, `${c.id}: os três modos são suportados ou têm motivo`);
    for (const r of c.recortes) assert.ok((RECORTES_NA_TELA as readonly string[]).includes(r), `${c.id}: recorte "${r}" sem campo na tela`);
  }
});

const vazio = { coletor: "", modo: "recoletar", anos: "", ufs: [] as string[], casas: "", ibges: "", escopo: "" };

test("validarRodada: coletor tem de ser do catálogo; modo só o que ele suporta", () => {
  assert.equal(validarRodada(cat, vazio).ok, false);
  assert.equal(validarRodada(cat, { ...vazio, coletor: "nao.existe" }).ok, false);
  const sapl = coletorDoCatalogo(cat, "sapl.camaras");
  assert.ok(sapl);
  const r = validarRodada(cat, { ...vazio, coletor: "sapl.camaras", modo: "reprocessar" });
  assert.deepEqual(r.ok, false);
  assert.match(r.ok ? "" : r.erro, /incremental por cursor/);
  assert.deepEqual(validarRodada(cat, { ...vazio, coletor: "sapl.camaras", modo: "descobrir" }), { ok: true, parametros: { coletor: "sapl.camaras", modo: "descobrir" } });
});

test("validarRodada: só monta recorte que o coletor aceita, na forma que validarPedido espera", () => {
  // sapl.assembleias aceita uf; camara.equipe não aceita nenhum
  const ok = validarRodada(cat, { ...vazio, coletor: "sapl.assembleias", ufs: ["SP", "AC"] });
  assert.deepEqual(ok, { ok: true, parametros: { coletor: "sapl.assembleias", modo: "recoletar", recorte: { ufs: ["AC", "SP"] } } });
  assert.equal(validarRodada(cat, { ...vazio, coletor: "camara.equipe", ufs: ["SP"] }).ok, false);
  assert.equal(validarRodada(cat, { ...vazio, coletor: "camara.equipe", anos: "2024" }).ok, false);
  const ano = validarRodada(cat, { ...vazio, coletor: "camara.diario", anos: "2025, 2024 2025" });
  assert.deepEqual(ano.ok && ano.parametros.recorte, { anos: [2024, 2025] });
  assert.equal(validarRodada(cat, { ...vazio, coletor: "camara.diario", anos: "24" }).ok, false);
  assert.equal(validarRodada(cat, { ...vazio, coletor: "sapl.assembleias", ufs: ["XX"] }).ok, false);
});

test("validarRodada: escopo (capitais ou todas) só onde o catálogo declara, e nunca junto com município por código", () => {
  assert.deepEqual([...OPCOES_ESCOPO], ["capitais", "todas"]);
  const comEscopo = cat.coletores.find((c) => c.recortes.includes("escopo"));
  assert.ok(comEscopo, "nenhum coletor aceita escopo: o catálogo mudou?");
  const ok = validarRodada(cat, { ...vazio, coletor: comEscopo.id, modo: comEscopo.modos[0], escopo: "todas" });
  assert.deepEqual(ok.ok && ok.parametros.recorte, { extras: { escopo: "todas" } });
  assert.equal(validarRodada(cat, { ...vazio, coletor: comEscopo.id, modo: comEscopo.modos[0], escopo: "tudo" }).ok, false);
  if (comEscopo.recortes.includes("ibge")) assert.equal(validarRodada(cat, { ...vazio, coletor: comEscopo.id, modo: comEscopo.modos[0], escopo: "todas", ibges: "3500105" }).ok, false);
  assert.equal(validarRodada(cat, { ...vazio, coletor: "camara.equipe", escopo: "todas" }).ok, false);
});

test("recortesDoColetor separa o que a tela desenha do que fica de fora", () => {
  for (const c of cat.coletores) {
    const { naTela, foraDaTela } = recortesDoColetor(c);
    assert.deepEqual([...naTela, ...foraDaTela].sort(), [...c.recortes].sort());
    assert.deepEqual(foraDaTela, [], `${c.id}: recorte sem campo na tela`);
  }
});

test("confirmação de rodada: coletor, modo, recorte pelo nome, aviso de chave de API", () => {
  const p = validarRodada(cat, { ...vazio, coletor: "sapl.assembleias", ufs: ["PB"] });
  assert.ok(p.ok);
  const c = confirmacaoDeRodada(cat, p.parametros);
  assert.equal(c.botao, "Abrir rodada de sapl.assembleias");
  assert.equal(c.itens.find((i) => i.rotulo === "Recorte")?.valor, "estado: Paraíba");
  assert.equal(c.itens.find((i) => i.rotulo === "Modo")?.valor, "Recoletar fontes conhecidas");
  const comChave = cat.coletores.find((x) => x.exige_chave);
  assert.ok(comChave);
  assert.equal(confirmacaoDeRodada(cat, { coletor: comChave.id, modo: comChave.modos[0] }).avisos.length, 1);
});
