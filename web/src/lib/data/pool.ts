import "server-only";
import dc from "node:diagnostics_channel";
import postgres from "postgres";
import { criarVigia, opcoesDoPool, type Contexto } from "./vigia-pool";

// O pool de leitura do site (role web_reader), um por processo. pg.ts e pg-w4.ts importam daqui: antes cada um criava o
// seu com `globalThis.__pgPool ??=`, e valia a configuração de quem carregasse primeiro (D358).
type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __pgPool?: Sql; __pgWriter?: Sql; __pgAdminCentral?: Sql; __pgVigia?: boolean };

const o = opcoesDoPool(process.env);
export const sql: Sql = (g.__pgPool ??= postgres(process.env.DATABASE_URL ?? "", {
  max: o.max,
  idle_timeout: o.idle_timeout,
  connect_timeout: o.connect_timeout,
  prepare: false, // o pooler do Supabase em modo transação não aceita prepared statements
  transform: { undefined: null },
}));

// Contexto da requisição que a Vercel põe no processo (o mesmo que @vercel/functions lê). Fora da Vercel não existe.
const CONTEXTO = Symbol.for("@vercel/request-context");
const contexto = (): Contexto | undefined =>
  (globalThis as unknown as Record<symbol, { get?: () => Contexto } | undefined>)[CONTEXTO]?.get?.();

if (!g.__pgVigia) {
  g.__pgVigia = true;
  // abertas + abrindo + na fila: com o pool frio, o evento 'wait' chega antes de a conexão começar a abrir (achado da revisão)
  const pendentes = () =>
    [g.__pgPool, g.__pgWriter, g.__pgAdminCentral].reduce((n, p) => {
      const s = p?.stats as { connections?: number; opening?: number; waiting?: number } | undefined;
      return n + (s?.connections ?? 0) + (s?.opening ?? 0) + (s?.waiting ?? 0);
    }, 0);
  const vigia = criarVigia({
    contexto,
    pendentes,
    tetoMs: o.idle_timeout * 1000 + 10_000,
    agendar: (fn, ms) => setTimeout(fn, ms),
    cancelar: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    // prova da D358 fora da produção: o Supavisor troca o application_name, então o banco não diz qual instância segura conexão
    aoSoltar:
      process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
        ? (motivo, ms) => console.info(`[D358] pool solto: ${motivo} em ${ms} ms`)
        : undefined,
  });
  // `start` roda no contexto assíncrono de quem fez a consulta (README do postgres.js, Tracing), por isso o waitUntil é o da requisição certa.
  dc.subscribe("tracing:postgres:query:start", () => vigia.aoConsultar());
  dc.subscribe("postgres:pool", () => vigia.aoMudarPool());
  // falha de conexão não publica evento do pool; o fim da consulta (com erro ou não) confere de novo
  dc.subscribe("tracing:postgres:query:asyncEnd", () => queueMicrotask(() => vigia.aoMudarPool()));
}
