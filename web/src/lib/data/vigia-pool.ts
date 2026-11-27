// D358: segura a função da Vercel viva até o pool fechar as conexões ociosas.
//
// Por quê: depois da resposta a Vercel congela a instância. O temporizador de ocioso do postgres.js (idle_timeout) não corre
// congelado, então a conexão fica aberta no pooler do Supabase até a instância morrer, minutos depois. No modo sessão
// (15 vagas no total) as instâncias antigas de um deploy seguram as vagas e as novas recebem EMAXCONNSESSION (D356, D357).
// Mesma ideia do attachDatabasePool da Vercel, que não aceita o postgres.js: cada requisição que consultou o banco registra
// a própria promessa em waitUntil, resolvida quando o pool fica sem nada aberto, abrindo ou na fila, ou quando passa o teto
// desde a última consulta DESSA requisição (uma requisição não fica presa pelo tráfego das outras).
// Lógica pura: o relógio, o contexto da requisição e a contagem do pool vêm de fora (testável sem Vercel nem banco).

export type Contexto = { waitUntil?: (p: Promise<unknown>) => void };

export type VigiaDeps = {
  /** O contexto da requisição atual (o da Vercel); sem ele, nada é registrado (dev local, build, tarefa de fundo). */
  contexto: () => Contexto | undefined;
  /** Conexões abertas, abrindo e consultas na fila, somadas em todos os pools do processo. 0 = nada a fechar. */
  pendentes: () => number;
  /** Teto de espera desde a última consulta da requisição, em ms (o idle_timeout mais uma folga). */
  tetoMs: number;
  agendar: (fn: () => void, ms: number) => unknown;
  cancelar: (t: unknown) => void;
  /** Diagnóstico: chamado quando uma requisição é solta, com o motivo e quanto tempo ficou presa. */
  aoSoltar?: (motivo: "pool_vazio" | "teto", ms: number) => void;
  agora?: () => number;
};

type Espera = { soltar: () => void; timer: unknown; desde: number };

export function criarVigia(d: VigiaDeps) {
  const esperas = new Map<object, Espera>();

  const agora = d.agora ?? (() => Date.now());
  const soltar = (ctx: object, motivo: "pool_vazio" | "teto") => {
    const e = esperas.get(ctx);
    if (!e) return;
    esperas.delete(ctx);
    d.cancelar(e.timer);
    e.soltar();
    d.aoSoltar?.(motivo, agora() - e.desde);
  };

  return {
    /** Uma consulta começou, no contexto de quem consultou. */
    aoConsultar() {
      const ctx = d.contexto();
      if (!ctx?.waitUntil) return;
      const e = esperas.get(ctx);
      if (e) {
        d.cancelar(e.timer);
        e.timer = d.agendar(() => soltar(ctx, "teto"), d.tetoMs);
        return;
      }
      let r!: () => void;
      const p = new Promise<void>((res) => (r = res));
      esperas.set(ctx, { soltar: r, timer: d.agendar(() => soltar(ctx, "teto"), d.tetoMs), desde: agora() });
      ctx.waitUntil(p);
    },
    /** Algo mudou no pool ou uma consulta terminou. Sem nada aberto, abrindo ou na fila, solta todas as requisições. */
    aoMudarPool() {
      if (esperas.size === 0 || d.pendentes() > 0) return;
      for (const ctx of [...esperas.keys()]) soltar(ctx, "pool_vazio");
    },
    /** Para teste e diagnóstico. */
    get segurando() {
      return esperas.size;
    },
  };
}

/** Opções do pool de leitura. PG_POOL_MAX e PG_IDLE_TIMEOUT seguem valendo; valor inválido cai no padrão. */
export function opcoesDoPool(env: Record<string, string | undefined>) {
  const inteiro = (v: string | undefined, padrao: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
  };
  return {
    max: inteiro(env.PG_POOL_MAX, 10, 1, 50),
    idle_timeout: inteiro(env.PG_IDLE_TIMEOUT, 20, 1, 300),
    connect_timeout: 10,
  };
}
