// Escolhas puras das telas da central (Parte C, C5). Sem I/O, sem React, sem Next, sem `server-only`.
// Importável pelos testes (node --test): imports com extensão `.ts`.
import { chaveDaFicha } from "./agregacao.ts";
import type { Ficha } from "./tipos.ts";

/** Os estados de tela. Cada um vira `data-estado="<nome>"` no elemento raiz do bloco. */
export const ESTADOS_TELA = [
  "carregando",
  "vazio",
  "erro_leitura",
  "executor_parado",
  "rodada_em_andamento",
  "rodada_interrompida",
  "rodada_concluida",
  "pedido_existente",
  "territorio_sem_ficha",
  "ficha_sem_evidencia",
] as const;
export type EstadoTela = (typeof ESTADOS_TELA)[number];

export type EntradaEstadoTela = {
  /** antes da primeira resposta da consulta periódica */
  carregando?: boolean;
  /** a leitura do banco falhou */
  erroLeitura?: boolean;
  totalRodadas: number;
  /** status da rodada exibida (adm_rodadas.status) */
  statusRodada?: string | null;
};

/** Estado principal da página: erro > carregando > vazio > estado da rodada exibida. */
export function estadoDaTela(e: EntradaEstadoTela): EstadoTela {
  if (e.erroLeitura) return "erro_leitura";
  if (e.carregando) return "carregando";
  if (e.totalRodadas === 0) return "vazio";
  return estadoDaRodada(e.statusRodada ?? null);
}

/** aberta e em_andamento = em andamento; interrompida e falhou = interrompida (pedem "Repetir"); concluida = concluída. Desconhecido: interrompida (o aviso é o lado seguro). */
export function estadoDaRodada(status: string | null): "rodada_em_andamento" | "rodada_interrompida" | "rodada_concluida" {
  if (status === "aberta" || status === "em_andamento") return "rodada_em_andamento";
  if (status === "concluida") return "rodada_concluida";
  return "rodada_interrompida";
}

export const estadoDoExecutor = (parado: boolean): "executor_parado" | "executor_ok" => (parado ? "executor_parado" : "executor_ok");
export const estadoDoTerritorio = (total: number): "territorio_sem_ficha" | "territorio_com_ficha" => (total === 0 ? "territorio_sem_ficha" : "territorio_com_ficha");
export const estadoDoPedido = (novo: boolean): "pedido_existente" | "pedido_novo" => (novo ? "pedido_novo" : "pedido_existente");

type PropostaEvidencia = { url?: unknown; trecho?: unknown; conteudo_sha256?: unknown };
const preenchido = (x: unknown): boolean => typeof x === "string" && x.trim() !== "";
/** Evidência válida = URL, trecho e hash, os três (a mesma regra de entrada da Parte B). */
export const temEvidenciaValida = (propostas: readonly PropostaEvidencia[]): boolean =>
  propostas.some((p) => preenchido(p.url) && preenchido(p.trecho) && preenchido(p.conteudo_sha256));
export const estadoDaFicha = (propostas: readonly PropostaEvidencia[]): "ficha_sem_evidencia" | "ficha_com_evidencia" =>
  temEvidenciaValida(propostas) ? "ficha_com_evidencia" : "ficha_sem_evidencia";

// ------------------------------------------------------------------------------------------------------------------------ formatação

/** "3 de 10"; denominador desconhecido: "3 (denominador não conhecido)"; valor nulo: "não medido". */
export function formatarDe(valor: number | null, de: number | null): string {
  if (valor === null) return "não medido";
  if (de === null) return `${valor} (denominador não conhecido)`;
  return `${valor} de ${de}`;
}

export function formatarDuracao(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m} min ${t % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Data determinística (igual no servidor e no navegador): "2026-11-17 10:30:00 UTC". */
export function textoData(v: unknown): string {
  if (v === null || v === undefined || v === "") return "sem data";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "data inválida" : `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** Valor de jsonb para a tela: texto como está, nulo como "sem valor", o resto como JSON. */
export function mostrarValor(v: unknown): string {
  if (v === null || v === undefined) return "sem valor";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export type EstadoExecutorTela = {
  agora?: unknown;
  parado: boolean;
  motivoParado: string | null;
  filaMaisAntigaS: number | null;
  batimentoMaisAntigoS: number | null;
};

/** Quanto tempo o executor está parado, pelo pedido mais velho que motivou o aviso (relógio do banco). */
export function esperaDoExecutor(e: EstadoExecutorTela): { segundos: number; desde: string | null } | null {
  if (!e.parado) return null;
  const s = Math.max(e.filaMaisAntigaS ?? 0, e.batimentoMaisAntigoS ?? 0);
  const agora = e.agora instanceof Date ? e.agora : e.agora ? new Date(String(e.agora)) : null;
  const desde = agora && !Number.isNaN(agora.getTime()) ? textoData(new Date(agora.getTime() - s * 1000)) : null;
  return { segundos: s, desde };
}

// ------------------------------------------------------------------------------------------------------------------------ painéis do relatório

export type LinhaPainel = { caminho: string; rotulo: string; valor: number | null; de: number | null; ids: string[] | null; motivo: string | null; nivel: number };

const ROTULOS: Readonly<Record<string, string>> = {
  urls_tentadas: "URLs tentadas",
  urls_lidas: "URLs lidas",
  urls_reaproveitadas: "URLs reaproveitadas",
  urls_com_falha: "URLs com falha",
  "urls_com_falha.por_motivo": "URLs com falha, por motivo",
  "urls_entrada.declaradas": "URLs de entrada declaradas",
  "urls_entrada.tentadas": "URLs de entrada tentadas",
  "urls_entrada.declaradas_nao_tentadas": "URLs de entrada declaradas e não tentadas",
  registros_elegiveis: "Registros elegíveis",
  registros_alcancados: "Registros alcançados",
  registros_elegiveis_nao_alcancados: "Registros elegíveis não alcançados",
  campos_com_proposta: "Campos com proposta",
  conflitantes: "Campos conflitantes",
  pendentes: "Campos pendentes",
  "pendentes.sem_pendencia_aberta": "Pendentes sem pendência aberta",
  confirmados: "Campos confirmados",
  "confirmados.pela_fonte": "Confirmados pela fonte",
  "confirmados.por_decisao": "Confirmados por decisão",
  pendencias_reabertas: "Pendências reabertas",
  "pendencias_reabertas.por_motivo": "Pendências reabertas, por motivo",
  registros_com_proposta: "Registros com proposta",
  registros_alterados: "Registros alterados",
  decisoes: "Decisões",
  "decisoes.por_acao": "Decisões, por ação",
  "decisoes.por_decidido_por_tipo": "Decisões, por quem decidiu",
  "decisoes.aplicadas": "Decisões aplicadas",
  "decisoes.nao_aplicadas": "Decisões não aplicadas",
  pendencias_ligadas: "Pendências ligadas",
};

const ehObjeto = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const ehTotal = (x: unknown): x is Record<string, unknown> => ehObjeto(x) && "valor" in x && "ids" in x;

/** Texto de um id da lista: string como está; objeto com url ou id usa esse campo. */
export function textoDoId(x: unknown): string {
  if (typeof x === "string") return x;
  if (ehObjeto(x)) {
    if (typeof x.url === "string") return x.url;
    if (typeof x.id === "string") return x.id;
  }
  return JSON.stringify(x);
}

/** Achata um painel (`coleta` ou `revisao` do relatório) em linhas `{valor, de, ids}`, uma por total, na ordem em que o relatório os traz. Não soma nada. */
export function linhasDoPainel(painel: Record<string, unknown>): LinhaPainel[] {
  const saida: LinhaPainel[] = [];
  const anda = (no: Record<string, unknown>, prefixo: string, nivel: number) => {
    for (const [k, v] of Object.entries(no)) {
      const caminho = prefixo ? `${prefixo}.${k}` : k;
      if (ehTotal(v)) {
        saida.push({
          caminho,
          rotulo: ROTULOS[caminho] ?? (prefixo ? `${ROTULOS[prefixo] ?? prefixo.split(".").pop()!.replaceAll("_", " ")}: ${k.replaceAll("_", " ")}` : k.replaceAll("_", " ")),
          valor: typeof v.valor === "number" ? v.valor : null,
          de: typeof v.de === "number" ? v.de : null,
          ids: Array.isArray(v.ids) ? v.ids.map(textoDoId) : null,
          motivo: typeof v.motivo === "string" ? v.motivo : typeof v.motivo_de === "string" ? v.motivo_de : null,
          nivel,
        });
        for (const [k2, v2] of Object.entries(v)) {
          if (ehObjeto(v2) && !("valor" in v2 && "ids" in v2) && !["itens"].includes(k2)) anda({ [k2]: v2 }, caminho, nivel + 1);
          else if (ehTotal(v2) && k2 !== "valor") anda({ [k2]: v2 }, caminho, nivel + 1);
        }
      } else if (ehObjeto(v) && !["rodada"].includes(k)) {
        anda(v, caminho, nivel);
      }
    }
  };
  anda(painel, "", 0);
  return saida;
}

// ------------------------------------------------------------------------------------------------------------------------ estado por território (mapa)

export type EstadoMapa = "lida" | "falhou" | "em_andamento" | "sem_tentativa" | "decidida" | "reaberta" | "pendente" | "sem_pendencia";

type Alvo = { uf: string | null; municipio: string | null };
const alvoDe = (f: Ficha): Alvo => {
  const t = f.territorio;
  if (!t || t.nivel === "pais") return { uf: null, municipio: null };
  if (t.nivel === "uf") return { uf: t.ibge.slice(0, 2), municipio: null };
  return { uf: t.ibge.slice(0, 2), municipio: t.ibge };
};

export type EntradaEstadosMapa = {
  fichas: readonly Ficha[];
  /** ids `classe:chave` do relatório da rodada */
  alcancados?: readonly string[];
  naoAlcancados?: readonly { id: string; motivo_falha: string | null }[];
  rodadaEmAndamento?: boolean;
  /** itens da fila: ficha e se reaberta */
  fila?: readonly { classe: string; registro_chave: string; reaberta: boolean }[];
};

/**
 * Estado de cada território (UF no país, município na UF) para o mapa, a partir de DADOS: o que a consulta traz, nunca inventado.
 * Coleta (rodada exibida): falhou > em_andamento > lida > sem_tentativa. Revisão (fila): reaberta > pendente > sem_pendencia.
 * Chave do mapa devolvido: `uf:XX` e `mun:NNNNNNN`.
 */
export function estadosPorTerritorio(visao: "coleta" | "revisao", e: EntradaEstadosMapa): Map<string, EstadoMapa> {
  const porId = new Map<string, Ficha>();
  for (const f of e.fichas) porId.set(chaveDaFicha(f), f);
  const peso: Record<string, number> = { falhou: 4, reaberta: 4, em_andamento: 3, pendente: 3, lida: 2, decidida: 2, sem_tentativa: 1, sem_pendencia: 1 };
  const saida = new Map<string, EstadoMapa>();
  const marca = (f: Ficha | undefined, estado: EstadoMapa) => {
    if (!f) return;
    const a = alvoDe(f);
    for (const k of [a.uf ? `uf:${a.uf}` : null, a.municipio ? `mun:${a.municipio}` : null]) {
      if (!k) continue;
      const atual = saida.get(k);
      if (!atual || peso[estado] > peso[atual]) saida.set(k, estado);
    }
  };
  if (visao === "coleta") {
    for (const f of e.fichas) marca(f, "sem_tentativa");
    for (const id of e.alcancados ?? []) marca(porId.get(id), "lida");
    for (const n of e.naoAlcancados ?? []) marca(porId.get(n.id), n.motivo_falha ? "falhou" : e.rodadaEmAndamento ? "em_andamento" : "sem_tentativa");
  } else {
    for (const f of e.fichas) marca(f, "sem_pendencia");
    for (const p of e.fila ?? []) marca(porId.get(`${p.classe}:${p.registro_chave}`), p.reaberta ? "reaberta" : "pendente");
  }
  return saida;
}

/** Contagens do mapa no formato de GET /admin/api/estado (`mapa`), a partir da agregação do país. */
export function contagensDeAgregado(ag: { total: number; porUf: ReadonlyMap<string, { total: number }>; semTerritorio: { total: number; porMotivo: Record<string, string[]> }; conflitos: readonly unknown[] }) {
  return {
    total: ag.total,
    porUf: Object.fromEntries([...ag.porUf].map(([uf, c]) => [uf, c.total])),
    semTerritorio: { total: ag.semTerritorio.total, porMotivo: Object.fromEntries(Object.entries(ag.semTerritorio.porMotivo).map(([m, ids]) => [m, ids.length])) },
    conflitos: ag.conflitos.length,
  };
}

/** Dados do servidor para componente cliente: tudo vira JSON (Date vira texto ISO). */
export const serializavel = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export type VisaoTela = "coleta" | "revisao";
export const visaoDe = (v: unknown): VisaoTela => (v === "revisao" ? "revisao" : "coleta");
