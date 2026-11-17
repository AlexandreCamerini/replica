import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

test("SQL_ADMIN_ATIVO só lê adm_admins (email, nome, user_id, ativo) e os insert de pedido gravam a identidade da sessão (AC-23)", () => {
  assert.match(CONSULTAS_PROPRIAS.SQL_ADMIN_ATIVO, /^select email, nome, user_id::text as user_id, ativo from adm_admins where lower\(email\) = lower\(\$1::text\) and ativo limit 1\s*$/);
  assert.match(CONSULTAS_PROPRIAS.SQL_PEDIDO_INSERIR, /\(tipo, parametros, chave_idem, por_user_id, por_email\)/);
  assert.match(CONSULTAS_PROPRIAS.SQL_PEDIDO_DECISAO_INSERIR, /\(pendencia_id, acao, por_nome, justificativa, valor, aplicar, chave_idem, por_user_id, por_email\)/);
  assert.match(CONSULTAS_PROPRIAS.SQL_PEDIDO_DECISAO_INSERIR, /\$8::uuid, \$9::text/);
  // nenhuma consulta de leitura da central toca adm_admins_log nem escreve em adm_admins
  for (const [nome, sql] of Object.entries(CONSULTAS_PROPRIAS)) assert.ok(!/adm_admins_log|(insert into|update)\s+adm_admins\b/i.test(sql), nome);
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

test("chave_idem do pedido de decisão: {tipo: decisao, parametros: {acao, aplicar, pendencia_id, por_nome, valor}}; valor ausente = null; justificativa fica fora", () => {
  const base = { pendencia_id: "11111111-1111-1111-1111-111111111111", acao: "aprovar", por_nome: "Ana", valor: undefined, aplicar: false };
  assert.equal(
    chaveIdemDecisao(base),
    createHash("sha256")
      .update('{"parametros":{"acao":"aprovar","aplicar":false,"pendencia_id":"11111111-1111-1111-1111-111111111111","por_nome":"Ana","valor":null},"tipo":"decisao"}', "utf8")
      .digest("hex"),
  );
  assert.equal(chaveIdemDecisao(base), chaveIdemDecisao({ ...base, valor: null }));
  assert.notEqual(chaveIdemDecisao(base), chaveIdemDecisao({ ...base, por_nome: "Bia" }));
  assert.notEqual(chaveIdemDecisao(base), chaveIdemDecisao({ ...base, aplicar: true }));
});

// Vetores de ouro de etl/civico_etl/admin/executor.py (VETORES_DE_OURO): a central e o executor têm de dar a MESMA chave, senão dois cliques
// (um pela tela, outro pela CLI) viram dois pedidos. Os valores são copiados; o teste seguinte confere contra o próprio Python, se houver.
const VETORES_DE_OURO: ReadonlyArray<[string, Record<string, unknown>, string]> = [
  ["recoleta", { classe: "vinculo_sapl", territorio: { ibge: "11", nivel: "uf" } }, "6b276886cd0c741fb732cb53d09643fc8f20fbbda6744fac12280dce3e43fce9"],
  ["parecer", { pendencia_id: "0a1b2c3d-0000-4000-8000-000000000001" }, "46eb5f9e2f55670c464f227168e637401b9e225b9eb5870ae344d2a7f54ae953"],
  ["rodada", { coletor: "sapl.assembleias", modo: "recoletar", recorte: { ufs: ["RO", "AC"] } }, "cccf3f45b0b24de626d3570f2c10e734b69b7bf833d74b90a7cbdaf3d7248270"],
];

test("chave_idem da central = vetores de ouro do executor (pedidos e decisão), depois de validarPedido/validarDecisao", () => {
  for (const [tipo, parametros, esperado] of VETORES_DE_OURO) {
    const v = validarPedido(tipo, parametros);
    assert.equal(chaveIdemPedido(v.tipo, v.parametros), esperado, tipo);
  }
  const d = validarDecisao({ pendencia_id: "0a1b2c3d-0000-4000-8000-000000000001", acao: "corrigir", valor: "São João", por: "Maria", justificativa: "x", aplicar: true });
  // AC-23: o `por_nome` não vem mais do corpo (validarDecisao o descarta); quem chama põe o nome do admin na tabela `adm_admins`, o mesmo que o gatilho grava e o executor relê.
  assert.equal(chaveIdemDecisao({ ...d, por_nome: "Maria" }), "67c059df8cb2dfea16a5768cb7006727e3d569d07694e1a944062279bf4300d4");
});

test("os vetores de ouro copiados são os do executor.py", () => {
  const fonte = readFileSync(new URL("../../../../etl/civico_etl/admin/executor.py", import.meta.url), "utf8");
  for (const [, , h] of VETORES_DE_OURO) assert.ok(fonte.includes(h), `vetor ${h} não está em executor.py`);
  assert.ok(fonte.includes("67c059df8cb2dfea16a5768cb7006727e3d569d07694e1a944062279bf4300d4"));
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

test("validarPedido: tipo e parâmetros inválidos são recusados; o válido sai normalizado como executor.normalizar", () => {
  const recusa = (t: unknown, p: unknown) => assert.throws(() => validarPedido(t, p), ErroPedidoInvalido);
  recusa("decisao", {});
  recusa("rodada", {});
  recusa("rodada", { coletor: "x y" });
  recusa("rodada", { coletor: "x", modo: "apagar" });
  recusa("rodada", { coletor: "x", argv: ["--rm"] });
  recusa("rodada", { coletor: "x", so_pendencias: true });
  recusa("rodada", { coletor: "x", recorte: { ibges: ["123"] } });
  recusa("rodada", { coletor: "x", recorte: { modo: "descobrir" } });
  recusa("rodada", { repetir: "11111111-1111-1111-1111-111111111111", coletor: "x" });
  recusa("rodada", { repetir: "nao-e-uuid" });
  recusa("recoleta", {});
  recusa("recoleta", { classe: "cobertura" });
  recusa("recoleta", { territorio: { nivel: "uf", ibge: "35" } });
  recusa("recoleta", { classe: "cobertura", territorio: { nivel: "uf", ibge: "3550308" } });
  recusa("recoleta", { classe: "identidade", territorio: { nivel: "uf", ibge: "35" } });
  recusa("recoleta", { classe: "pessoa", territorio: { nivel: "uf", ibge: "35" } });
  recusa("parecer", {});
  recusa("parecer", { pendencia_id: "11111111-1111-1111-1111-111111111111", rodada_id: "22222222-2222-2222-2222-222222222222" });
  recusa("parecer", { pendencia_id: "nao-e-uuid" });
  const r = validarPedido("rodada", { coletor: "tse.x", recorte: { ufs: ["SP", "AC", "SP"], ibges: ["3550308"], anos: [2024, 2022], extras: { b: "2", a: "1" } } });
  assert.deepEqual(r.parametros, { coletor: "tse.x", modo: "recoletar", recorte: { anos: [2022, 2024], ufs: ["AC", "SP"], casas: [], ibges: ["3550308"], extras: { a: "1", b: "2" } } });
  assert.deepEqual(validarPedido("rodada", { repetir: "AAAAAAAA-1111-1111-1111-111111111111" }).parametros, { repetir: "aaaaaaaa-1111-1111-1111-111111111111", so_pendencias: false });
  assert.deepEqual(validarPedido("recoleta", { classe: "cobertura", territorio: { nivel: "uf", ibge: "35" } }).parametros, { classe: "cobertura", territorio: { ibge: "35", nivel: "uf" } });
  assert.deepEqual(validarPedido("parecer", { pendencia_id: "AAAAAAAA-1111-1111-1111-111111111111" }).parametros, { pendencia_id: "aaaaaaaa-1111-1111-1111-111111111111" });
});

test("validarDecisao: justificativa não vazia; corrigir exige valor; só aprovar e corrigir se aplicam; `por` do corpo é aceito e DESCARTADO (AC-23)", () => {
  const ok = { pendencia_id: "11111111-1111-1111-1111-111111111111", acao: "aprovar", por: " Ana ", justificativa: " confere com a fonte " };
  assert.deepEqual(validarDecisao(ok), { pendencia_id: ok.pendencia_id, acao: "aprovar", justificativa: "confere com a fonte", valor: undefined, aplicar: false });
  // sem `por`, com `por` vazio, com `por` de outro tipo ou enorme: o resultado é o mesmo, e nenhuma chave `por`/`por_nome` sai
  const semPor = { pendencia_id: ok.pendencia_id, acao: "aprovar", justificativa: " confere com a fonte " };
  for (const por of [undefined, "", "  ", "Bia", "x".repeat(500), 42, null, { a: 1 }]) {
    const v = validarDecisao({ ...semPor, por });
    assert.deepEqual(v, validarDecisao(semPor));
    assert.ok(!("por" in v) && !("por_nome" in v), `por=${JSON.stringify(por)} vazou para a decisão validada`);
  }
  const recusa = (x: Record<string, unknown>) => assert.throws(() => validarDecisao({ ...ok, ...x }), ErroPedidoInvalido);
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

// Defeito D1 (prova C7): com postgres.js e `prepare: false`, `$n::jsonb` sobre texto JSON grava um jsonb ESCALAR de texto (dupla codificação) e o
// executor recusa o pedido. Toda consulta própria da central passa o JSON como `$n::text::jsonb`.
test("nenhuma consulta própria usa $n::jsonb direto (só $n::text::jsonb)", () => {
  for (const [nome, sql] of Object.entries(CONSULTAS_PROPRIAS)) assert.ok(!/\$\d+::jsonb/.test(sql), `${nome}: use $n::text::jsonb`);
});
