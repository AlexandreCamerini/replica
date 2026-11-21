// Lógica pura do mapa de votos da sv (sem React, sem JSON do mapa): roda no servidor e no teste unitário.
// Base do percentual: Sim ÷ (Sim + Não + Abstenção) dos votos REGISTRADOS da UF. Obstrução, "sem voto" e quem presidia a
// sessão ficam fora da base e nunca contam como voto contra: a fonte publica só quem teve registro, ausência não aparece.
import type { PlacarUf, VoteValue } from "./data/types.ts";

export type ContagemUf = Partial<Record<VoteValue, number>>;

export type DadoUf = {
  uf: string;
  /** Sim, Não e abstenção registrados na UF. */
  sim: number;
  nao: number;
  abs: number;
  /** base do percentual = sim + nao + abs */
  base: number;
  /** % de Sim sobre a base, inteiro de 0 a 100, arredondado para BAIXO (nunca mostra 100% sem que todos tenham votado Sim). null = nenhum voto registrado. */
  pct: number | null;
  /** registros fora da base: obstrução, presidia a sessão e sem voto registrado */
  fora: number;
  cadeiras: number | null;
};

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

/** Percentual inteiro de `sim` sobre `base`; null quando não há base. Entradas inválidas valem 0. */
export function pctSim(sim: number, base: number): number | null {
  const b = n(base);
  if (b === 0) return null;
  return Math.min(100, Math.floor((Math.min(n(sim), b) * 100) / b));
}

export function dadoDaUf(uf: string, contagem: ContagemUf | undefined, cadeiras: number | null = null): DadoUf {
  const c = contagem ?? {};
  const sim = n(c.sim);
  const nao = n(c.nao);
  const abs = n(c.abstencao);
  const base = sim + nao + abs;
  return { uf, sim, nao, abs, base, pct: pctSim(sim, base), fora: n(c.obstrucao) + n(c.art17) + n(c.nao_votou), cadeiras };
}

/**
 * Uma entrada por UF do mapa, em ordem alfabética de sigla (nunca por valor, por tamanho ou por partido).
 * UF do mapa sem linha no placar fica com base 0 (sem registro): nunca vira 0% inventado.
 */
export function dadosDoMapa(placar: readonly PlacarUf[], ufsDoMapa: readonly string[]): DadoUf[] {
  const porUf = new Map(placar.map((r) => [r.uf, r]));
  return [...ufsDoMapa]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((u) => {
      const r = porUf.get(u);
      return dadoDaUf(u, r?.contagem, r?.cadeiras ?? null);
    });
}

/** Soma do país, só sobre as UFs desenhadas: mesma base (Sim, Não, abstenção registrados). */
export function totalDoMapa(dados: readonly DadoUf[]): DadoUf {
  const t = { sim: 0, nao: 0, abs: 0, fora: 0 };
  for (const d of dados) {
    t.sim += d.sim;
    t.nao += d.nao;
    t.abs += d.abs;
    t.fora += d.fora;
  }
  const base = t.sim + t.nao + t.abs;
  return { uf: "BR", ...t, base, pct: pctSim(t.sim, base), cadeiras: null };
}

export const textoPct = (d: Pick<DadoUf, "pct">) => (d.pct === null ? "–" : `${d.pct}%`);

/** Quanto do estado enche (0 a 100), na mesma conta do texto. UF sem registro não enche. */
export const nivelDoEstado = (d: Pick<DadoUf, "pct">) => (d.pct === null ? 0 : Math.max(0, Math.min(100, d.pct)));

const reg = (x: number) => `${x} ${x === 1 ? "registrado" : "registrados"}`;

/** "X de Y registrados": X votaram Sim, Y = Sim + Não + abstenção registrados. */
export function fraseSim(d: Pick<DadoUf, "sim" | "base">) {
  return `${d.sim} de ${reg(d.base)}`;
}

/** Descrição de uma UF para leitor de tela e dica: os números, como a fonte publicou, e nada mais. */
export function descricaoUf(nome: string, d: DadoUf, comLink: boolean) {
  const abrir = comLink ? " Abrir os votos do estado." : "";
  if (d.base === 0) {
    const fora = d.fora > 0 ? ` ${d.fora} ${d.fora === 1 ? "registro" : "registros"} sem voto Sim, Não ou abstenção.` : "";
    return `${nome}: nenhum voto Sim, Não ou abstenção registrado nesta votação.${fora}${abrir}`;
  }
  return `${nome}: ${fraseSim(d)} votaram Sim (${textoPct(d)}). Não: ${d.nao}. Abstenção: ${d.abs}.${abrir}`;
}

export const BASE_DO_PERCENTUAL = "Sim ÷ (Sim + Não + abstenção) dos votos registrados no estado.";
export const FORA_DA_BASE_A = "Obstrução, quem presidia a sessão e quem não registrou voto ficam fora dessa conta.";
export const FORA_DA_BASE_B = "Ausência não conta como voto contra. O percentual é arredondado para baixo.";
export const FORA_DA_BASE = `${FORA_DA_BASE_A} ${FORA_DA_BASE_B}`;
