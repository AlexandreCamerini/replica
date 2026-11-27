import assert from "node:assert/strict";
import { test } from "node:test";
import { criarVigia, opcoesDoPool, type Contexto } from "../data/vigia-pool.ts";

// D358: a função da Vercel só pode congelar depois que o pool fechou as conexões (ou passou o teto).

function montar() {
  let pendentes = 0;
  let agora = 0;
  const timers = new Map<number, { quando: number; fn: () => void }>();
  let seq = 0;
  let ctx: Contexto | undefined;
  const vigia = criarVigia({
    contexto: () => ctx,
    pendentes: () => pendentes,
    tetoMs: 30_000,
    agendar: (fn, ms) => (timers.set(++seq, { quando: agora + ms, fn }), seq),
    cancelar: (t) => void timers.delete(t as number),
  });
  const novoContexto = () => {
    const c: Contexto & { promessas: Promise<unknown>[] } = { promessas: [], waitUntil: (p) => void c.promessas.push(p) };
    ctx = c;
    return c;
  };
  const passar = (ms: number) => {
    agora += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].quando - b[1].quando))
      if (t.quando <= agora && timers.has(id)) {
        timers.delete(id);
        t.fn();
      }
  };
  const resolvida = async (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise((r) => setImmediate(() => r(false)))]);
  return { vigia, novoContexto, passar, resolvida, setPendentes: (n: number) => (pendentes = n), semContexto: () => (ctx = undefined), timers };
}

test("consulta numa requisição registra uma espera; o pool vazio solta a função", async () => {
  const m = montar();
  const c = m.novoContexto();
  m.setPendentes(1);
  m.vigia.aoConsultar();
  m.vigia.aoConsultar(); // a mesma requisição não registra de novo
  assert.equal(c.promessas.length, 1);
  m.vigia.aoMudarPool(); // conexão ociosa, ainda aberta
  assert.equal(await m.resolvida(c.promessas[0]), false);
  m.setPendentes(0);
  m.vigia.aoMudarPool(); // o idle_timeout fechou a última
  assert.equal(await m.resolvida(c.promessas[0]), true);
  assert.equal(m.vigia.segurando, 0);
  assert.equal(m.timers.size, 0);
});

test("pool frio: o evento 'wait' com a consulta na fila não solta a espera (achado da revisão)", async () => {
  const m = montar();
  const c = m.novoContexto();
  m.vigia.aoConsultar(); // query:start, pool sem conexão
  m.setPendentes(1); // waiting: 1, ainda sem conexão abrindo
  m.vigia.aoMudarPool(); // evento 'wait'
  assert.equal(await m.resolvida(c.promessas[0]), false);
  m.vigia.aoMudarPool(); // 'open', depois 'idle': conexão aberta
  assert.equal(await m.resolvida(c.promessas[0]), false);
  m.setPendentes(0);
  m.vigia.aoMudarPool(); // 'close' pelo idle_timeout
  assert.equal(await m.resolvida(c.promessas[0]), true);
});

test("cada requisição tem a própria espera; o pool vazio solta todas", async () => {
  const m = montar();
  m.setPendentes(1);
  const a = m.novoContexto();
  m.vigia.aoConsultar();
  const b = m.novoContexto();
  m.vigia.aoConsultar();
  assert.equal(m.vigia.segurando, 2);
  m.setPendentes(0);
  m.vigia.aoMudarPool();
  assert.equal(await m.resolvida(a.promessas[0]), true);
  assert.equal(await m.resolvida(b.promessas[0]), true);
});

test("teto por requisição: conta da última consulta dela, não do tráfego das outras", async () => {
  const m = montar();
  m.setPendentes(1);
  const a = m.novoContexto();
  m.vigia.aoConsultar();
  m.passar(20_000);
  const b = m.novoContexto();
  m.vigia.aoConsultar(); // tráfego de outra requisição não estende a de 'a'
  m.vigia.aoMudarPool();
  m.passar(10_000);
  assert.equal(await m.resolvida(a.promessas[0]), true);
  assert.equal(await m.resolvida(b.promessas[0]), false);
  m.passar(20_000);
  assert.equal(await m.resolvida(b.promessas[0]), true);
});

test("depois de soltar, uma consulta nova registra outra espera na mesma requisição", async () => {
  const m = montar();
  const c = m.novoContexto();
  m.vigia.aoConsultar();
  m.vigia.aoMudarPool();
  m.setPendentes(1);
  m.vigia.aoConsultar();
  assert.equal(c.promessas.length, 2);
  assert.equal(await m.resolvida(c.promessas[1]), false);
});

test("sem contexto da Vercel (dev, build, fundo) nada é registrado e nada quebra", () => {
  const m = montar();
  m.semContexto();
  m.vigia.aoConsultar();
  m.vigia.aoMudarPool();
  assert.equal(m.vigia.segurando, 0);
  assert.equal(m.timers.size, 0);
});

test("opções do pool: padrões de hoje, env válida vale, env inválida cai no padrão", () => {
  assert.deepEqual(opcoesDoPool({}), { max: 10, idle_timeout: 20, connect_timeout: 10 });
  const o = opcoesDoPool({ PG_POOL_MAX: "3", PG_IDLE_TIMEOUT: "5" });
  assert.deepEqual([o.max, o.idle_timeout], [3, 5]);
  for (const v of ["0", "-1", "2.5", "abc", "", "999"]) assert.equal(opcoesDoPool({ PG_POOL_MAX: v }).max, 10);
  assert.equal(opcoesDoPool({ PG_IDLE_TIMEOUT: "0" }).idle_timeout, 20);
});

test("diagnóstico: diz o motivo e quanto tempo a requisição ficou presa", () => {
  const ditos: string[] = [];
  let t = 1000;
  let ctx: Contexto | undefined = { waitUntil: () => {} };
  const timers: (() => void)[] = [];
  const v = criarVigia({ contexto: () => ctx, pendentes: () => 0, tetoMs: 30_000, agora: () => t, agendar: (fn) => timers.push(fn), cancelar: () => {}, aoSoltar: (m, ms) => ditos.push(`${m}:${ms}`) });
  v.aoConsultar();
  t = 1250;
  v.aoMudarPool();
  ctx = { waitUntil: () => {} };
  v.aoConsultar();
  t = 31_250;
  timers.at(-1)!();
  assert.deepEqual(ditos, ["pool_vazio:250", "teto:30000"]);
});
