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
const layout = join(GRUPO, "layout.admin.tsx");
const todasAsRotas = doGrupo.filter((f) => /\/route\.admin\.ts$/.test(f));
// F3-C1: as rotas da ENTRADA (/admin/api/entrar (subcaminhos)) não têm sessão no início; a guarda delas é `rotaDeEntrada`/`exigirEntradaApi` (testada mais abaixo). As demais seguem a regra de sempre.
const ehDaEntrada = (f: string): boolean => f.includes("/admin/api/entrar/");
const rotas = todasAsRotas.filter((f) => !ehDaEntrada(f));
const rotasDeEntrada = todasAsRotas.filter(ehDaEntrada);

test("o grupo (admin) existe: layout e as sete rotas de API", () => {
  assert.ok(doGrupo.includes(layout));
  const esperadas = ["estado", "relatorio/[rodada]", "fila", "ficha/[classe]/[chave]", "pedidos", "decisoes", "sair"].map((p) => join(GRUPO, "admin/api", p, "route.admin.ts"));
  assert.deepEqual(rotas, [...esperadas].sort());
  // F3-C1: mais as quatro rotas de API da entrada (as server actions de entrada.ts deixaram de existir)
  assert.deepEqual(rotasDeEntrada, ["codigo", "fator/confirmar", "fator/iniciar", "verificar"].map((p) => join(GRUPO, "admin/api/entrar", p, "route.admin.ts")).sort());
});

test("F3-C1: as rotas da entrada só exportam POST real (via rotaDeEntrada, guarda na primeira instrução) e 404 nos outros métodos; nenhuma server action na central", () => {
  for (const f of rotasDeEntrada) {
    const src = semComentarios(ler(f));
    assert.match(src, /export async function POST\(req: Request\) \{\s*return rotaDeEntrada\(req, /, rel(f));
    assert.match(src, /export \{ naoUsado as GET, naoUsado as PUT, naoUsado as PATCH, naoUsado as DELETE, naoUsado as OPTIONS, naoUsado as HEAD \};/, rel(f));
    assert.match(src, /export const dynamic = "force-dynamic";/, rel(f));
  }
  const casca = semComentarios(ler(join(LIB, "rota-entrada.ts")));
  assert.match(casca, /export async function rotaDeEntrada\([^)]*\)[^{]*\{\s*const negado = await exigirEntradaApi\(req\);\s*if \(negado\) return negado;/);
  const guarda = semComentarios(ler(join(LIB, "guarda.ts")));
  assert.match(guarda, /export async function exigirEntradaApi\(req: Request\)[^{]*\{\s*if \(decidirAcesso\(process\.env\)\.modo !== "producao"\) return new Response\(null, \{ status: 404 \}\);\s*if \(\(await headers\(\)\)\.get\(MARCA_ENTRADA\) !== "1"\) return new Response\(null, \{ status: 404 \}\);\s*return recusarOrigemExterna\(req\);/);
  for (const f of codigo) assert.ok(!/["']use server["']/.test(ler(f)), `${rel(f)}: nenhuma server action na central (o id da action vale sob qualquer caminho)`);
  for (const f of arquivos(join(WEB, "src/components/admin-entrada")).filter((x) => /\.tsx?$/.test(x))) assert.ok(!/["']use server["']|useActionState/.test(ler(f)), `${rel(f)}: formulário com server action`);
});

test("a primeira instrução do layout é `await exigirAdminOuEntrada()` (AC-23: guarda assíncrona, com await), antes de qualquer JSX", () => {
  const src = semComentarios(ler(layout));
  // sem o `await`, o notFound() vira promessa rejeitada solta e o layout renderiza: o await é parte da regra, não opcional
  assert.match(src, /export default async function \w*\([^)]*\)\s*(?::[^{]+)?\{\s*await exigirAdminOuEntrada\(\);/);
  assert.match(src, /import \{ exigirAdminOuEntrada \} from "@\/lib\/admin\/guarda";/);
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
    const comGuarda = [...src.matchAll(/export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\([^)]*\)[^{]*\{\s*const negado = await exigirAdminApi\(\);\s*if \(negado\) return negado;/g)];
    assert.equal(comGuarda.length, metodos.length, `${rel(f)}: método sem a guarda na primeira instrução`);
    assert.ok(!/export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(src), `${rel(f)}: handler como const escapa deste teste`);
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel(f)} sem force-dynamic`);
    assert.match(src, /import \{[^}]*\bexigirAdminApi\b[^}]*\} from "@\/lib\/admin\/guarda";/);
  }
});

test("os POST recusam origem externa logo depois da guarda", () => {
  // os stubs de "método não usado" (405) agora são `async` por causa do await da guarda: um POST que NÃO é o stub exato de 405 tem de recusar a origem
  const stub405 = /POST\s*\([^)]*\)\s*\{\s*const negado = await exigirAdminApi\(\);\s*if \(negado\) return negado;\s*return new Response\(null, \{ status: 405 \}\);\s*\}/;
  const comPost = rotas.filter((r) => /export\s+async\s+function\s+POST\b/.test(ler(r)));
  assert.ok(comPost.some((r) => !stub405.test(semComentarios(ler(r)))), "esperava ao menos um POST real (pedidos, decisoes)");
  for (const f of comPost.filter((r) => !stub405.test(semComentarios(ler(r))))) {
    const src = semComentarios(ler(f));
    assert.match(src, /POST\s*\([^)]*\)\s*\{\s*const negado = await exigirAdminApi\(\);\s*if \(negado\) return negado;\s*const recusado = recusarOrigemExterna\(req\);\s*if \(recusado\) return recusado;/, rel(f));
  }
});

test("toda função de consulta exportada começa por exigirAdmin()", () => {
  const src = semComentarios(ler(join(LIB, "consultas.ts")));
  const todas = [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
  const guardadas = [...src.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{\s*await exigirAdmin\(\);/g)].map((m) => m[1]);
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
  for (const n of ["guarda.ts", "db.ts", "consultas.ts", "sessao.ts", "login.ts", "provedores.ts", "entrada.ts"]) assert.match(ler(join(LIB, n)), /^import "server-only";/, n);
  for (const n of ["sql.ts", "guarda-regra.ts", "tipos.ts", "agregacao.ts", "cabecalhos.ts", "tempo-minimo.ts", "totp.ts", "sessao-cookie.ts", "login-core.ts", "login-store.ts"]) {
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

test("a central não importa as páginas públicas (AC-23): nada de @/app/, nada fora de (admin) por caminho relativo", () => {
  for (const f of codigo) {
    const src = semComentarios(ler(f));
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
      assert.ok(!/^@\/app\//.test(m[1]), `${rel(f)} importa ${m[1]}`);
      if (m[1].startsWith(".")) {
        const alvo = join(f, "..", m[1]);
        assert.ok(alvo.startsWith(GRUPO) || alvo.startsWith(LIB), `${rel(f)} importa ${m[1]}, que sai de (admin) e de lib/admin`);
      }
      // o que a central pode pedir ao resto do código: React, Next, o driver, os módulos próprios, os componentes admin* e o widget Turnstile do site (sem dado)
      if (m[1].startsWith("@/")) assert.ok(/^@\/(lib\/admin\/|components\/admin\/|components\/admin-entrada\/|components\/account\/turnstile$|styles\/admin\.css$)/.test(m[1]), `${rel(f)} importa ${m[1]}`);
    }
  }
  for (const f of arquivos(join(WEB, "src/components/admin-entrada")).filter((x) => /\.tsx?$/.test(x))) {
    for (const m of semComentarios(ler(f)).matchAll(/(?:from\s+)["']([^"']+)["']/g)) {
      if (m[1].startsWith("@/")) assert.ok(/^@\/(lib\/admin\/|components\/account\/turnstile$)/.test(m[1]), `${rel(f)} importa ${m[1]}`);
    }
  }
});

test("a central inteira (menos o widget Turnstile) não carrega nada de fora: nenhum domínio absoluto em lib/admin, no grupo e em components/admin-entrada", () => {
  for (const f of arquivos(join(WEB, "src/components/admin-entrada")).filter((x) => /\.tsx?$/.test(x))) {
    const src = semComentarios(ler(f));
    assert.ok(!/https?:\/\//i.test(src), `${rel(f)} tem URL absoluta`);
    // F3-C1: os formulários da entrada usam `fetch` (o desenho antigo usava server actions): só para a API relativa da própria central, por constante literal em `postar("/admin/api/entrar/...")`
    for (const m of src.matchAll(/\bpostar\(\s*(["'][^,)]*)/g)) assert.match(m[1].trim(), /^"\/admin\/api\/entrar\/[a-z/]+"$/, `${rel(f)}: postar com destino fora da API da entrada: ${m[1]}`);
    for (const m of src.matchAll(/\bfetch\s*\(\s*([^,)]*)/g)) assert.equal(m[1].trim(), "url", `${rel(f)}: fetch só com o parâmetro url de postar()`);
  }
});

test("nenhum arquivo do grupo nem de lib/admin faz requisição para fora, exceto provedores.ts (D335: e-mail do código e Turnstile, pelo servidor)", () => {
  const SAIDA = join(LIB, "provedores.ts");
  for (const f of codigo) {
    const src = semComentarios(ler(f));
    assert.ok(!/["'`]\s*\/\//.test(src), `${rel(f)} tem string começando com // (URL sem esquema)`);
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon/.test(src), `${rel(f)} abre conexão do navegador`);
    assert.ok(!/<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=\s*["']?https?:|@import\s+url\(|<img[^>]*\bsrc\s*=\s*["']?https?:/i.test(src), `${rel(f)} carrega recurso externo`);
    if (f === SAIDA) continue;
    assert.ok(!/https?:\/\//i.test(src), `${rel(f)} tem URL absoluta`);
    assert.ok(!/\bfetch\s*\(/.test(src), `${rel(f)} chama fetch(`);
  }
  // a única saída: dois endereços fixos, em constante, e `fetch` só com essas constantes
  assert.ok(codigo.includes(SAIDA), "provedores.ts tem de estar entre os arquivos conferidos");
  const src = semComentarios(ler(SAIDA));
  assert.match(src, /^import "server-only";/);
  assert.deepEqual([...src.matchAll(/https?:\/\/[^"'`\s]+/g)].map((m) => m[0]).sort(), ["https://api.resend.com/emails", "https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
  assert.deepEqual([...src.matchAll(/\bfetch\s*\(\s*([^,)]*)/g)].map((m) => m[1].trim()).sort(), ["URL_RESEND", "URL_TURNSTILE"]);
  assert.deepEqual([...src.matchAll(/^import .*$/gm)].map((m) => m[0]), ['import "server-only";', 'import { HOST_CENTRAL_PRODUCAO } from "./guarda-regra.ts";'], "provedores.ts só importa a constante do host: nem banco, nem sessão, nem cookie");
  // quem pode chamar a saída: só a entrada (captcha) e a ligação do login (e-mail)
  for (const f of codigo) {
    if (/from "(?:\.\/|@\/lib\/admin\/)provedores(?:\.ts)?"/.test(semComentarios(ler(f)))) assert.ok(["entrada.ts", "login.ts"].some((n) => f === join(LIB, n)), `${rel(f)} importa provedores.ts`);
  }
});

test("nada do grupo escreve fora do pedido: sem SQL no grupo (só lib/admin) e sem import de driver nas rotas", () => {
  for (const f of doGrupo) {
    const src = semComentarios(ler(f));
    assert.ok(!/from "postgres"|\bsqlAdmin\b|\bselect\b.+\bfrom\b|\binsert\s+into\b/i.test(src), `${rel(f)} fala com o banco sem passar por consultas.ts`);
  }
});

test("toda página do grupo chama exigirAdmin() na primeira instrução, antes de qualquer await", () => {
  const paginas = doGrupo.filter((f) => /\/page\.admin\.tsx$/.test(f));
  const esperadas = ["", "uf/[uf]", "fila", "ficha/[classe]/[chave]", "rodadas", "rodadas/[id]", "registros"].map((p) => join(GRUPO, "admin", p, "page.admin.tsx"));
  const entrada = ["entrar", "entrar/fator"].map((p) => join(GRUPO, "admin", p, "page.admin.tsx"));
  assert.deepEqual(paginas, [...esperadas, ...entrada].sort());
  for (const f of entrada) {
    // as duas páginas de entrada são as ÚNICAS sem exigirAdmin (quem entra ainda não tem sessão): a guarda delas é exigirEntrada(), na primeira instrução, com await
    const src = semComentarios(ler(f));
    assert.match(src, /export default async function \w+\([^)]*\)\s*(?::[^{]+)?\{\s*await exigirEntrada\(\);/, `${rel(f)}: primeira instrução não é await exigirEntrada()`);
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel(f)} sem force-dynamic`);
    assert.ok(!/\bsqlAdmin\b|from "postgres"/.test(src), `${rel(f)} fala com o banco sem passar por lib/admin`);
  }
  for (const f of paginas.filter((p) => !entrada.includes(p))) {
    const src = semComentarios(ler(f));
    assert.match(src, /export default async function \w+\([^)]*\)\s*(?::[^{]+)?\{\s*await exigirAdmin\(\);/, `${rel(f)}: primeira instrução não é await exigirAdmin()`);
    assert.match(src, /import \{ exigirAdmin \} from "@\/lib\/admin\/guarda";/, rel(f));
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel(f)} sem force-dynamic`);
    const corpo = src.slice(src.search(/export default async function/));
    assert.equal(corpo.indexOf("await"), corpo.indexOf("await exigirAdmin();"), `${rel(f)}: há await antes da guarda`);
    assert.ok(!/\bsqlAdmin\b|from "postgres"/.test(src), `${rel(f)} fala com o banco sem passar por consultas.ts`);
  }
});

test("componentes da central: URL só relativa, sem recurso externo, e nada importa o site público", () => {
  const COMP = join(WEB, "src/components/admin");
  for (const f of arquivos(COMP).filter((x) => /\.tsx?$/.test(x))) {
    const src = semComentarios(ler(f));
    assert.ok(!/https?:\/\//i.test(src), `${rel(f)} tem URL absoluta`);
    assert.ok(!/<script[^>]*\bsrc\s*=|<link[^>]*\bhref\s*=\s*["']?https?:|@import\s+url\(|<img[^>]*\bsrc\s*=\s*["']?https?:/i.test(src), `${rel(f)} carrega recurso externo`);
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      assert.ok(!/(^|\/)(votos|data|db)(\/|$)|brazil-map|@\/components\/(?!admin)/.test(m[1]), `${rel(f)} importa ${m[1]}`);
    }
    for (const m of src.matchAll(/\bfetch\s*\(\s*([^,)]*)/g)) {
      assert.ok(/^(["'`]\/(?!\/)|endpoint\b|url\b)/.test(m[1].trim()), `${rel(f)}: fetch com destino que não é relativo: ${m[1]}`);
    }
  }
});
