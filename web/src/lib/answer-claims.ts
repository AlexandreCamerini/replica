// Contrato dos três estados de uma afirmação (diz | nao_diz | nao_conferido). Puro: sem banco, sem Next.
// O ETL grava por campo `estado` (etl/civico_etl/verification.py, `_blank` e `decide`). Linhas antigas, da revisão
// humana (etl/civico_etl/jobs/revisar.py), não têm `estado`: lá `diz:false` é o revisor marcando "não diz".
// Falha fechada: na dúvida, `nao_conferido`, que não afirma nada sobre a lei.
import type { AnswerClaim, AnswerField, AnswerState } from "./data/types.ts";

// Repetido de ANSWER_FIELDS (data/types.ts) para o teste rodar em Node puro; o `satisfies` garante que não divergem.
const FIELDS = ["o_que_propoe", "quem_recebe", "quem_paga", "o_que_muda", "dinheiro", "estimativa_impacto"] as const satisfies readonly AnswerField[];

type RawClaim = { diz?: unknown; frase?: unknown; trecho?: unknown; pagina?: unknown; direcao?: unknown; estado?: unknown };

const STATES: readonly AnswerState[] = ["diz", "nao_diz", "nao_conferido"];
const DIRECTIONS = ["entra", "sai", "dividido", "nao_diz"] as const;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Estado de um campo. Campo ausente, `estado` desconhecido ou "diz" sem frase e trecho: `nao_conferido`. */
export function claimState(raw: unknown): AnswerState {
  if (!raw || typeof raw !== "object") return "nao_conferido";
  const a = raw as RawClaim;
  const backed = str(a.frase) !== "" && str(a.trecho) !== "";
  if (a.estado !== undefined && a.estado !== null) {
    if (!STATES.includes(a.estado as AnswerState)) return "nao_conferido";
    if (a.estado === "diz") return backed ? "diz" : "nao_conferido";
    return a.estado as AnswerState;
  }
  // linha antiga, sem `estado`
  if (a.diz === true) return backed ? "diz" : "nao_conferido";
  if (a.diz === false) return "nao_diz";
  return "nao_conferido";
}

/** Um campo do JSON gravado pelo ETL para o tipo da tela. Fora de `diz`, frase e trecho saem vazios. */
export function toClaim(field: AnswerField, raw: unknown): AnswerClaim {
  const state = claimState(raw);
  const a = (raw && typeof raw === "object" ? raw : {}) as RawClaim;
  const says = state === "diz";
  const page = Number(a.pagina ?? 0);
  const c: AnswerClaim = { state, says, text: says ? str(a.frase) : "", quote: says ? str(a.trecho) : "", page: says && Number.isFinite(page) ? page : 0 };
  if (field === "dinheiro") {
    const d = DIRECTIONS.find((x) => x === a.direcao);
    c.direction = says && d ? d : "nao_diz";
  }
  return c;
}

/** Todos os campos de uma resposta publicada. `raw` nulo ou malformado: todos `nao_conferido`. */
export function claimsFrom(raw: unknown): Record<AnswerField, AnswerClaim> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(FIELDS.map((f) => [f, toClaim(f, src[f])])) as Record<AnswerField, AnswerClaim>;
}
