// Acompanhamento de pedido e anúncios da região viva (funções puras). O pedido é acompanhado pela MESMA consulta periódica que já existe (GET /admin/api/estado,
// campo `pedidosRecentes`: os 20 mais recentes). Texto sempre em linguagem de operador; id só abreviado.
import { abreviarId, statusDoPedido } from "./rotulos.ts";
import { PROMESSA_EXECUTOR } from "./executor-tela.ts";

export type PedidoRecenteApi = { origem?: string; id: string; tipo?: string; status: string; rodada_id?: string | null; andamento?: unknown; erro?: string | null };

export type FaseAcompanhamento = "na_fila" | "em_execucao" | "concluido" | "falhou" | "interrompido" | "aguardando" | "perdido";

export type Acompanhamento = {
  fase: FaseAcompanhamento;
  /** frase para a tela, no estilo "Na fila. Com o executor ativo, um pedido começa em até ~5 s." */
  texto: string;
  /** não há mais o que acompanhar (acabou ou o pedido sumiu da lista) */
  terminal: boolean;
  /** falhou ou foi interrompido: o erro registrado pelo executor, se houver */
  erro: string | null;
  /** terminou com problema (falhou, interrompido ou perdido) */
  problema: boolean;
};

/** Tentativas da consulta periódica sem achar o pedido nos 20 mais recentes antes de desistir. */
export const TENTATIVAS_SEM_VER = 4;

const mensagemDoAndamento = (a: unknown): string | null => {
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const m = (a as Record<string, unknown>).mensagem;
    if (typeof m === "string" && m.trim() !== "") return m.trim();
  }
  return null;
};

export function acompanharPedido(id: string, recentes: readonly PedidoRecenteApi[] | null | undefined, tentativasSemVer = 0): Acompanhamento {
  const p = recentes?.find((x) => x.id === id);
  if (!p) {
    if (tentativasSemVer >= TENTATIVAS_SEM_VER) {
      return { fase: "perdido", texto: `Não achei o pedido ${abreviarId(id)} entre os 20 mais recentes. Confira em Rodadas ou na ficha.`, terminal: true, erro: null, problema: true };
    }
    return { fase: "aguardando", texto: "Aguardando a fila confirmar o pedido…", terminal: false, erro: null, problema: false };
  }
  const erro = typeof p.erro === "string" && p.erro.trim() !== "" ? p.erro.trim() : null;
  switch (p.status) {
    case "na_fila":
      return { fase: "na_fila", texto: `Na fila. ${PROMESSA_EXECUTOR}`, terminal: false, erro: null, problema: false };
    case "em_execucao": {
      const m = mensagemDoAndamento(p.andamento);
      return { fase: "em_execucao", texto: m ? `Em execução: ${m}` : "Em execução.", terminal: false, erro: null, problema: false };
    }
    case "concluido":
      return { fase: "concluido", texto: "Concluído pelo executor.", terminal: true, erro: null, problema: false };
    case "falhou":
      return { fase: "falhou", texto: `Falhou${erro ? `: ${erro}` : "."}`, terminal: true, erro, problema: true };
    case "interrompido":
      return { fase: "interrompido", texto: `Interrompido${erro ? `: ${erro}` : "."}`, terminal: true, erro, problema: true };
    default:
      return { fase: "aguardando", texto: `Situação do pedido: ${statusDoPedido(p.status)}.`, terminal: false, erro, problema: false };
  }
}

// ------------------------------------------------------------------------------------------------------------------------ anúncio da região viva

/** O que a região viva compara entre uma consulta e a seguinte. Só mudança de ESTADO conta; contagem que oscila não é anunciada. */
export type ResumoVivo = { parado: boolean; emCurso: readonly string[]; naFila: number };

export function resumoVivo(e: { executor: { parado: boolean; naFila: number }; rodadasEmCurso: readonly { id: string }[] }): ResumoVivo {
  return { parado: e.executor.parado, emCurso: e.rodadasEmCurso.map((r) => r.id).sort(), naFila: e.executor.naFila };
}

/** Mensagem a anunciar a leitor de tela entre duas consultas, ou null (a maioria das vezes). Sem consulta anterior: null (a primeira leitura não é mudança). */
export function anunciarMudanca(antes: ResumoVivo | null, agora: ResumoVivo): string | null {
  if (!antes) return null;
  if (!antes.parado && agora.parado) return "Executor parado: há pedido esperando além do limite.";
  if (antes.parado && !agora.parado) return "Executor voltou a consumir a fila.";
  const entrou = agora.emCurso.filter((x) => !antes.emCurso.includes(x));
  const saiu = antes.emCurso.filter((x) => !agora.emCurso.includes(x));
  if (entrou.length > 0) return entrou.length === 1 ? "Uma rodada entrou em andamento." : `${entrou.length} rodadas entraram em andamento.`;
  if (saiu.length > 0) return saiu.length === 1 ? "Uma rodada saiu de andamento. Atualize a página para ver o resultado." : `${saiu.length} rodadas saíram de andamento.`;
  return null;
}
