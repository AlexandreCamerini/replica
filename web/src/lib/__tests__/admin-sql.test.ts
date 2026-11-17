import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONSULTAS_PROPRIAS,
  COPIADAS_DO_ETL,
  ErroPedidoInvalido,
  chaveIdemDecisao,
  chaveIdemPedido,
  jsonCanonico,
  validarDecisao,
  validarPedido,
} from "../admin/sql.ts";

// Critério 19: o painel da central é igual ao relatório da CLI. As consultas de sql.ts são CÓPIAS das constantes do ETL; este teste extrai cada constante
// do Python (só `ast` + exec dos nós de atribuição: não importa o pacote, então não precisa de psycopg), troca `%(nome)s` por `$n` na ordem declarada
// em COPIADAS_DO_ETL, normaliza o espaço e exige igualdade. Se o ETL mudar uma consulta e a central não acompanhar, quebra aqui.

const RAIZ = fileURLToPath(new URL("../../../../", import.meta.url));
const EXTRATOR = String.raw`
import ast, json, re, sys
from pathlib import Path

raiz = Path(sys.argv[1])

def nos(arq):
    return ast.parse((raiz / arq).read_text(encoding="utf-8")).body

def literal(arq, nome):
    for n in nos(arq):
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            return ast.literal_eval(n.value)
    raise SystemExit(nome + " não achado em " + arq)

def avalia(arq, pre, padrao):
    ns = dict(pre)
    for n in nos(arq):
        if isinstance(n, ast.FunctionDef) and n.name in ("_com", "_lista_sql"):
            exec(compile(ast.Module([n], []), arq, "exec"), ns)
        elif isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and re.fullmatch(padrao, n.targets[0].id):
            exec(compile(ast.Module([n], []), arq, "exec"), ns)
    return {k: v for k, v in ns.items() if re.fullmatch(r"SQL_\w+", k) and isinstance(v, str)}

REL = "etl/civico_etl/admin/relatorio.py"
PEN = "etl/civico_etl/admin/pendencias.py"
CLS = "etl/civico_etl/admin/classes.py"
out = {}
for k, v in avalia(REL, {}, r"_[A-Z_]+|SQL_\w+").items():
    out[k] = {"arquivo": REL, "sql": v}
pre = {"ORDEM_CLASSES": literal(CLS, "ORDEM_CLASSES"), "ORDEM_TIPOS": literal(CLS, "ORDEM_TIPOS")}
for k, v in avalia(PEN, pre, r"SQL_FILA").items():
    out[k] = {"arquivo": PEN, "sql": v}
print(json.dumps(out, ensure_ascii=False))
`;

const py = spawnSync("python3", ["-I", "-c", EXTRATOR, RAIZ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const python3Existe = py.error === undefined;
const semPython = python3Existe ? false : "python3 não encontrado no PATH: sem ele a paridade com o ETL não é conferida";
const ETL: Record<string, { arquivo: string; sql: string }> = python3Existe && py.status === 0 ? JSON.parse(py.stdout) : {};

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const trocaParametros = (sql: string, params: readonly string[]): string => params.reduce((s, p, i) => s.split(`%(${p})s`).join(`$${i + 1}`), sql);

test("o extrator do Python rodou", { skip: semPython }, () => {
  assert.equal(py.status, 0, `extrator falhou: ${py.stderr}`);
  assert.ok(Object.keys(ETL).length >= 20, "extrator devolveu poucas constantes");
});

for (const c of COPIADAS_DO_ETL) {
  test(`${c.python} é igual à do ETL (${c.arquivo})`, { skip: semPython }, () => {
    const o = ETL[c.python];
    assert.ok(o, `${c.python} não existe mais no ETL`);
    assert.equal(o.arquivo, c.arquivo);
    const esperado = trocaParametros(o.sql, c.params);
    assert.ok(!/%\(|%s/.test(esperado), `sobrou parâmetro Python em ${c.python}: ${c.params.join(", ")} não cobre todos`);
    assert.equal(norm(c.sql), norm(esperado));
    // só a sintaxe do parâmetro mudou: todos os $n declarados aparecem
    c.params.forEach((_, i) => assert.ok(c.sql.includes(`$${i + 1}`), `$${i + 1} ausente em ${c.python}`));
  });
}

test("toda constante SQL_* do ETL (relatório e fila) está copiada: nenhuma fica de fora", { skip: semPython }, () => {
  const copiadas = new Set(COPIADAS_DO_ETL.map((c) => c.python));
  const faltam = Object.keys(ETL).filter((k) => !copiadas.has(k));
  assert.deepEqual(faltam, [], `constante do ETL sem cópia na central: ${faltam.join(", ")}`);
});

test("nenhuma consulta da central escreve fora de adm_pedidos e adm_pedidos_decisao", () => {
  const todas: Record<string, string> = { ...CONSULTAS_PROPRIAS, ...Object.fromEntries(COPIADAS_DO_ETL.map((c) => [c.python, c.sql])) };
  assert.ok(Object.keys(todas).length > 40);
  for (const [nome, sql] of Object.entries(todas)) {
    const sem = sql.replace(/'(?:[^']|'')*'/g, "''"); // sem literais: 'update' dentro de texto não conta
    assert.ok(!/\b(update|delete|truncate|alter|drop|create|grant|revoke|copy|call|do|merge|lock|vacuum)\b/i.test(sem), `${nome} tem comando que não é leitura`);
    for (const m of sem.matchAll(/\binsert\s+into\s+([a-z_]+)/gi)) assert.ok(["adm_pedidos", "adm_pedidos_decisao"].includes(m[1].toLowerCase()), `${nome} insere em ${m[1]}`);
    if (/\binsert\b/i.test(sem)) assert.match(sem, /where not exists/, `${nome}: o insert de pedido precisa do where not exists`);
    assert.ok(!/\bfor\s+(update|share)\b/i.test(sem), `${nome}: bloqueio de linha exige privilégio de escrita`);
  }
});

test("a fila ordena só por classe, tipo, vencimento, cobertura e id (restrição 7)", () => {
  const sql = COPIADAS_DO_ETL.find((c) => c.python === "SQL_FILA")!.sql;
  const ordem = norm(sql.slice(sql.indexOf("order by")));
  assert.ok(!/\b(pessoa|partido|people|party|vot|popular|mandat)/i.test(ordem));
  assert.ok(!/\b(people|parties|mandates|votes|persons)\b/i.test(sql));
});

test("as fichas não leem nome de pessoa, partido nem voto", () => {
  for (const k of ["SQL_FICHAS", "SQL_FICHA_BASE", "SQL_FICHAS_POR_CHAVES"]) assert.ok(!/\b(people|parties|votes|persons|profiles)\b/i.test(CONSULTAS_PROPRIAS[k]), k);
});

test("jsonCanonico: chaves ordenadas em todos os níveis, sem espaços, sem escape de acento", () => {
  assert.equal(jsonCanonico({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "ç" } }), '{"a":{"c":"ç","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.throws(() => jsonCanonico({ a: undefined }), TypeError);
});

test("chave_idem do pedido: sha256 do JSON canônico de {tipo, parametros}; independe da ordem das chaves", () => {
  const a = chaveIdemPedido("rodada", { coletor: "x", modo: "recoletar" });
  const b = chaveIdemPedido("rodada", { modo: "recoletar", coletor: "x" });
  assert.equal(a, b);
  assert.equal(a, createHash("sha256").update('{"parametros":{"coletor":"x","modo":"recoletar"},"tipo":"rodada"}', "utf8").digest("hex"));
  assert.notEqual(a, chaveIdemPedido("recoleta", { coletor: "x", modo: "recoletar" }));
});

test("chave_idem do pedido de decisão: {acao, pendencia_id, por_nome, valor}; valor ausente = null; justificativa fica fora", () => {
  const base = { pendencia_id: "11111111-1111-1111-1111-111111111111", acao: "aprovar", por_nome: "Ana", valor: undefined };
  assert.equal(
    chaveIdemDecisao(base),
    createHash("sha256").update('{"acao":"aprovar","pendencia_id":"11111111-1111-1111-1111-111111111111","por_nome":"Ana","valor":null}', "utf8").digest("hex"),
  );
  assert.equal(chaveIdemDecisao(base), chaveIdemDecisao({ ...base, valor: null }));
  assert.notEqual(chaveIdemDecisao(base), chaveIdemDecisao({ ...base, por_nome: "Bia" }));
});

// A forma canônica é a de `classes.canonico` do ETL (sort_keys, ensure_ascii=False, separators=(",", ":")): confere contra o próprio Python, se houver.
test("jsonCanonico é igual a classes.canonico do Python", { skip: semPython }, () => {
  const amostra = { z: [1, 2, { b: "ã", a: null }], a: { y: true, x: "ç\n" }, n: -3 };
  const r = spawnSync(
    "python3",
    ["-I", "-c", "import json,sys;print(json.dumps(json.loads(sys.argv[1]), sort_keys=True, ensure_ascii=False, separators=(',', ':')))", JSON.stringify(amostra)],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trimEnd(), jsonCanonico(amostra));
});

test("validarPedido: tipo e parâmetros inválidos são recusados; o válido sai normalizado", () => {
  const recusa = (t: unknown, p: unknown) => assert.throws(() => validarPedido(t, p), ErroPedidoInvalido);
  recusa("decisao", {});
  recusa("rodada", {});
  recusa("rodada", { coletor: "x y" });
  recusa("rodada", { coletor: "x", modo: "apagar" });
  recusa("rodada", { coletor: "x", argv: ["--rm"] });
  recusa("rodada", { coletor: "x", so_pendencias: true });
  recusa("rodada", { coletor: "x", ibges: ["123"] });
  recusa("recoleta", {});
  recusa("recoleta", { territorio: { nivel: "uf", ibge: "3550308" } });
  recusa("recoleta", { classe: "pessoa" });
  recusa("parecer", {});
  recusa("parecer", { pendencia_id: "11111111-1111-1111-1111-111111111111", rodada_id: "22222222-2222-2222-2222-222222222222" });
  recusa("parecer", { pendencia_id: "nao-e-uuid" });
  const r = validarPedido("rodada", { coletor: "tse.x", ufs: ["SP", "AC", "SP"], ibges: ["3550308"], anos: [2024, 2022], extras: { b: "2", a: "1" } });
  assert.deepEqual(r.parametros, { coletor: "tse.x", ufs: ["AC", "SP"], ibges: ["3550308"], anos: [2022, 2024], extras: { a: "1", b: "2" } });
  assert.deepEqual(validarPedido("recoleta", { classe: "cobertura", territorio: { nivel: "uf", ibge: "35" } }).parametros, { classe: "cobertura", territorio: { nivel: "uf", ibge: "35" } });
  assert.deepEqual(validarPedido("parecer", { pendencia_id: "AAAAAAAA-1111-1111-1111-111111111111" }).parametros, { pendencia_id: "aaaaaaaa-1111-1111-1111-111111111111" });
});

test("validarDecisao: por e justificativa não vazios; corrigir exige valor; só aprovar e corrigir se aplicam", () => {
  const ok = { pendencia_id: "11111111-1111-1111-1111-111111111111", acao: "aprovar", por: " Ana ", justificativa: " confere com a fonte " };
  assert.deepEqual(validarDecisao(ok), { pendencia_id: ok.pendencia_id, acao: "aprovar", por_nome: "Ana", justificativa: "confere com a fonte", valor: undefined, aplicar: false });
  const recusa = (x: Record<string, unknown>) => assert.throws(() => validarDecisao({ ...ok, ...x }), ErroPedidoInvalido);
  recusa({ por: "  " });
  recusa({ por: undefined });
  recusa({ justificativa: "" });
  recusa({ justificativa: "   " });
  recusa({ acao: "apagar" });
  recusa({ acao: "corrigir" });
  recusa({ acao: "descartar", aplicar: true });
  recusa({ pendencia_id: "x" });
  recusa({ extra: 1 });
  assert.equal(validarDecisao({ ...ok, acao: "corrigir", valor: "texto", aplicar: true }).aplicar, true);
  assert.throws(() => validarDecisao(null), ErroPedidoInvalido);
});
