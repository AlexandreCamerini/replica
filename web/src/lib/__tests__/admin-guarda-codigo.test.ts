import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Critério 15 (parte de código): a guarda está NA FRENTE de tudo e o grupo da central não fala com o mundo. Lê o código como texto: não sobe servidor, não toca banco.
// A prova de status HTTP (404 de verdade, inclusive com `next start`) é de outra tarefa; este teste trava a estrutura que a produz.

const WEB = fileURLToPath(new URL("../../../", import.meta.url));
const GRUPO = join(WEB, "src/app/(admin)");
const LIB = join(WEB, "src/lib/admin");

const arquivos = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();

/** Tira os comentários (blocos e linhas //, sem tocar em `://`), para que a prosa não dispare nem esconda uma regra. */
const semComentarios = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const ler = (f: string): string => readFileSync(f, "utf8");
const rel = (f: string): string => relative(WEB, f);

const doGrupo = arquivos(GRUPO);
const doLib = arquivos(LIB).filter((f) => /\.tsx?$/.test(f));
const codigo = [...doGrupo, ...doLib];
const layout = join(GRUPO, "layout.tsx");
const rotas = doGrupo.filter((f) => /\/route\.ts$/.test(f));

test("o grupo (admin) existe: layout e as seis rotas de API", () => {
  assert.ok(doGrupo.includes(layout));
  const esperadas = ["estado", "relatorio/[rodada]", "fila", "ficha/[classe]/[chave]", "pedidos", "decisoes"].map((p) => join(GRUPO, "admin/api", p, "route.ts"));
  assert.deepEqual(rotas, [...esperadas].sort());
});

test("a primeira instrução do layout é exigirAdmin(), antes de qualquer JSX", () => {
  const src = semComentarios(ler(layout));
  assert.match(src, /export default (?:async )?function \w*\([^)]*\)\s*(?::[^{]+)?\{\s*exigirAdmin\(\);/);
  assert.match(src, /import \{ exigirAdmin \} from "@\/lib\/admin\/guarda";/);
  assert.match(src, /export const dynamic = "force-dynamic";/);
  assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.match(src, /title:\s*\{\s*absolute:/);
  assert.match(src, /<div className="admin-central">/);
  assert.match(src, /import "@\/styles\/admin\.css";/);
});

test("não há Suspense, loading nem template no grupo (a trava vem antes do stream)", () => {
  for (const f of doGrupo) {
    assert.ok(!/(^|\/)(loading|template|default)\.(t|j)sx?$/.test(f), `${rel(f)}: loading/template não pode existir no grupo`);
    assert.ok(!/\bSuspense\b/.test(semComentarios(ler(f))), `${rel(f)} usa Suspense`);
    assert.ok(!/\bloading\b/.test(semComentarios(ler(f))), `${rel(f)} menciona loading`);
  }
});

test("todo route handler chama exigirAdminApi() na primeira instrução de cada método exportado", () => {
  assert.ok(rotas.length >= 6);
  for (const f of rotas) {
    const src = semComentarios(ler(f));
    const metodos = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)];
    assert.ok(metodos.length >= 1, `${rel(f)} não exporta método`);
    const comGuarda = [...src.matchAll(/export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\([^)]*\)[^{]*\{\s*const negado = exigirAdminApi\(\);\s*if \(negado\) return negado;/g)];
    assert.equal(comGuarda.length, metodos.length, `${rel(f)}: método sem a guarda na primeira instrução`);
    assert.ok(!/export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(src), `${rel(f)}: handler como const escapa deste teste`);
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel(f)} sem force-dynamic`);
    assert.match(src, /import \{[^}]*\bexigirAdminApi\b[^}]*\} from "@\/lib\/admin\/guarda";/);
  }
});

test("os POST recusam origem externa logo depois da guarda", () => {
  for (const f of rotas.filter((r) => /export\s+async\s+function\s+POST\b/.test(ler(r)))) {
    const src = semComentarios(ler(f));
    assert.match(src, /POST\s*\([^)]*\)\s*\{\s*const negado = exigirAdminApi\(\);\s*if \(negado\) return negado;\s*const recusado = recusarOrigemExterna\(req\);\s*if \(recusado\) return recusado;/, rel(f));
  }
});

test("toda função de consulta exportada começa por exigirAdmin()", () => {
  const src = semComentarios(ler(join(LIB, "consultas.ts")));
  const todas = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
  const guardadas = [...src.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*exigirAdmin\(\);/g)].map((m) => m[1]);
  assert.ok(todas.length >= 9, "esperava as consultas da central");
  assert.deepEqual(guardadas, todas);
  assert.ok(!/export\s+(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(/.test(src), "função exportada como const escapa deste teste");
});

test("sqlAdmin() recusa com a central fechada e só cria o pool dentro da função", () => {
  const src = semComentarios(ler(join(LIB, "db.ts")));
  assert.match(src, /^import "server-only";/);
  assert.match(src, /export function sqlAdmin\(\)[^{]*\{\s*if \(!centralLiberada\(\)\) throw /);
  const i = src.indexOf("postgres(");
  assert.ok(i > 0, "db.ts não cria o pool");
  assert.equal(src.indexOf("postgres(", i + 1), -1, "mais de uma chamada postgres(");
  const antes = src.slice(0, i);
  const aberto = (antes.match(/\{/g) ?? []).length - (antes.match(/\}/g) ?? []).length;
  assert.ok(aberto >= 1, "postgres( está no topo do módulo: o next build do CI tocaria o banco");
  assert.ok(/ADMIN_DATABASE_URL/.test(src) && !/\bDATABASE_(WRITE_)?URL\b/.test(src), "o pool tem de usar só ADMIN_DATABASE_URL");
});

test("guarda, db e consultas são server-only; sql e as regras puras não importam Next", () => {
  for (const n of ["guarda.ts", "db.ts", "consultas.ts"]) assert.match(ler(join(LIB, n)), /^import "server-only";/, n);
  for (const n of ["sql.ts", "guarda-regra.ts", "tipos.ts", "agregacao.ts"]) {
    const src = semComentarios(ler(join(LIB, n)));
    assert.ok(!/server-only|from "next|from "react|from "@\//.test(src), `${n} é puro: não importa server-only, Next, React nem alias`);
  }
});

test("nada do grupo nem de lib/admin importa lib/data, lib/db/writer ou unstable_cache", () => {
  for (const f of codigo) {
    const src = semComentarios(ler(f));
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
      assert.ok(!/(^|\/)data(\/|$)/.test(m[1]) && !/(^|\/)db\/writer/.test(m[1]) && !/lib\/(data|db)\b/.test(m[1]), `${rel(f)} importa ${m[1]}`);
    }
    assert.ok(!/unstable_cache|fonteSemCache|__pgPool|__pgWriter/.test(src), `${rel(f)} usa o cache de dados ou o pool do site`);
  }
});

test("nenhum arquivo do grupo nem de lib/admin faz requisição para fora", () => {
  for (const f of codigo) {
    const src = semComentarios(ler(f));
    assert.ok(!/https?:\/\//i.test(src), `${rel(f)} tem URL absoluta`);
    assert.ok(!/["'`]\s*\/\//.test(src), `${rel(f)} tem string começando com // (URL sem esquema)`);
    assert.ok(!/\bfetch\s*\(/.test(src), `${rel(f)} chama fetch(`);
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon/.test(src), `${rel(f)} abre conexão do navegador`);
    assert.ok(!/<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=\s*["']?https?:|@import\s+url\(|<img[^>]*\bsrc\s*=\s*["']?https?:/i.test(src), `${rel(f)} carrega recurso externo`);
  }
});

test("nada do grupo escreve fora do pedido: sem SQL no grupo (só lib/admin) e sem import de driver nas rotas", () => {
  for (const f of doGrupo) {
    const src = semComentarios(ler(f));
    assert.ok(!/from "postgres"|\bsqlAdmin\b|\bselect\b.+\bfrom\b|\binsert\s+into\b/i.test(src), `${rel(f)} fala com o banco sem passar por consultas.ts`);
  }
});
