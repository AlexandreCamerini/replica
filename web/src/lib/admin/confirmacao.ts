// Resumos de confirmação das ações com efeito (funções puras): o que a pessoa lê antes de enviar, e o texto do botão que diz o efeito.
// Nenhuma ação com efeito sai sem este resumo: aplicar decisão, repetir rodada, recoletar e abrir rodada. "Pedir parecer" não tem efeito sobre dado (ensaio) e fica sem confirmação.
import { modoDaRodada, acaoDaDecisao, nomeDaClasse, descreverRecorte } from "./rotulos.ts";
import type { Catalogo, ParametrosRodada } from "./catalogo.ts";
import { coletorDoCatalogo, textoDoRecorte, TERRITORIO_DO_COLETOR } from "./catalogo.ts";

export type ItemResumo = { rotulo: string; valor: string };
export type Confirmacao = { titulo: string; itens: ItemResumo[]; botao: string; avisos: string[] };

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

// ------------------------------------------------------------------------------------------------------------------------ decisão

export type EntradaDecisao = {
  acao: string;
  aplicar: boolean;
  campo: string;
  classe: string;
  fichaRotulo: string;
  territorio: string;
  valorAtual: string;
  /** valores candidatos distintos das propostas ligadas à pendência */
  candidatos: readonly string[];
  valorCorrigido: string;
  justificativa: string;
  operador: string;
};

/** Valor novo por ação: aprovar = o candidato único das propostas (decisoes.py: com zero ou mais de um, a decisão é recusada pelo executor); corrigir = o valor informado. */
export function valorNovoDaDecisao(e: Pick<EntradaDecisao, "acao" | "candidatos" | "valorCorrigido">): { texto: string; aviso: string | null } {
  if (e.acao === "corrigir") return { texto: e.valorCorrigido.trim() !== "" ? e.valorCorrigido.trim() : "valor não informado", aviso: null };
  if (e.acao === "aprovar") {
    if (e.candidatos.length === 1) return { texto: e.candidatos[0], aviso: null };
    if (e.candidatos.length === 0) return { texto: "nenhum candidato", aviso: "A pendência não tem valor candidato: o executor vai recusar \"aprovar\". Use \"corrigir\" com o valor." };
    return { texto: `${e.candidatos.length} candidatos diferentes`, aviso: "As fontes divergem: o executor vai recusar \"aprovar\". Use \"corrigir\" com o valor." };
  }
  return { texto: "sem mudança de valor", aviso: null };
}

export function botaoDaDecisao(acao: string, aplicar: boolean): string {
  if (acao === "aprovar") return aplicar ? "Aprovar e aplicar" : "Aprovar (sem aplicar)";
  if (acao === "corrigir") return aplicar ? "Corrigir e aplicar" : "Corrigir (sem aplicar)";
  if (acao === "descartar") return "Descartar pendência";
  return "Pedir confirmação";
}

export function confirmacaoDeDecisao(e: EntradaDecisao): Confirmacao {
  const novo = valorNovoDaDecisao(e);
  const aplica = (e.acao === "aprovar" || e.acao === "corrigir") && e.aplicar;
  const itens: ItemResumo[] = [
    { rotulo: "Ação", valor: acaoDaDecisao(e.acao) },
    { rotulo: "Campo", valor: e.campo },
    { rotulo: "Valor atual", valor: e.valorAtual },
    { rotulo: "Valor novo", valor: novo.texto },
    { rotulo: "Escopo", valor: `1 ficha: ${e.fichaRotulo} (${nomeDaClasse(e.classe)}), ${e.territorio}` },
    { rotulo: "Efeito", valor: aplica ? "A decisão é registrada e o executor a aplica ao dado." : e.acao === "descartar" || e.acao === "pedir_confirmacao" ? "A decisão é registrada; nenhum valor muda." : "A decisão é registrada, mas NÃO é aplicada ao dado." },
    { rotulo: "Decidindo como", valor: e.operador },
    { rotulo: "Justificativa", valor: e.justificativa.trim() },
  ];
  return { titulo: "Confirme a decisão", itens, botao: botaoDaDecisao(e.acao, e.aplicar), avisos: novo.aviso ? [novo.aviso] : [] };
}

// ------------------------------------------------------------------------------------------------------------------------ recoleta

export type EntradaRecoleta = { classe: string; territorioNome: string; nivel: "uf" | "municipio" | "pais"; pendentes: number | null; truncado: boolean; pendencias?: number };

export type ItemDaFila = { classe: string; registro_chave: string; territorio: { ibge: string; nivel: string } | null };
export const LIMITE_FILA = 1000;

/** Fichas (registros distintos) e pendências abertas da classe que caem EXATAMENTE no território (o executor usa a mesma igualdade: ibge e nível; uma recoleta de UF não pega as pendências dos municípios).
 *  `itensDaFila` = o que `fila(undefined, 1000)` devolveu; com 1000 itens a contagem pode estar cortada (`truncado`). */
export function contarPendentes(itensDaFila: readonly ItemDaFila[], classe: string, t: { ibge: string; nivel: string }): { fichas: number; pendencias: number; truncado: boolean } {
  const doTerritorio = itensDaFila.filter((i) => i.classe === classe && i.territorio !== null && i.territorio.ibge === t.ibge && i.territorio.nivel === t.nivel);
  return { fichas: new Set(doTerritorio.map((i) => i.registro_chave)).size, pendencias: doTerritorio.length, truncado: itensDaFila.length >= LIMITE_FILA };
}

/** "Recoletar 12 fichas em São Paulo". Sem contagem: "Recoletar fichas pendentes em São Paulo". Contagem cortada no limite da fila: "1000 ou mais". */
export function botaoDaRecoleta(e: EntradaRecoleta): string {
  if (e.pendentes === null) return `Recoletar fichas pendentes em ${e.territorioNome}`;
  if (e.truncado) return `Recoletar ${e.pendentes} ou mais fichas em ${e.territorioNome}`;
  return `Recoletar ${plural(e.pendentes, "ficha", "fichas")} em ${e.territorioNome}`;
}

export function confirmacaoDeRecoleta(e: EntradaRecoleta): Confirmacao {
  const coletor = e.classe === "contato_mandato" ? "parlamento.extras (relê todos os mandatos que ele cobre)" : e.nivel === "municipio" ? "sapl.camaras" : "sapl.assembleias";
  const itens: ItemResumo[] = [
    { rotulo: "Ação", valor: "Recoletar as fichas pendentes" },
    { rotulo: "Classe", valor: nomeDaClasse(e.classe) },
    { rotulo: "Território", valor: e.territorioNome },
    { rotulo: "Fichas pendentes", valor: e.pendentes === null ? "não contadas" : `${e.truncado ? `${e.pendentes} ou mais (limite da fila)` : e.pendentes}${e.pendencias !== undefined ? `, em ${plural(e.pendencias, "pendência", "pendências")}` : ""}` },
    { rotulo: "Coletor", valor: coletor },
    { rotulo: "Efeito", valor: "Abre uma rodada que lê as fontes na internet. Pode levar minutos." },
  ];
  return { titulo: "Confirme a recoleta", itens, botao: botaoDaRecoleta(e), avisos: e.pendentes === 0 ? ["Não há ficha pendente desta classe neste território: o executor vai concluir sem coletar."] : [] };
}

// ------------------------------------------------------------------------------------------------------------------------ rodada

export function confirmacaoDeRodada(cat: Catalogo, p: ParametrosRodada): Confirmacao {
  const c = coletorDoCatalogo(cat, p.coletor);
  const itens: ItemResumo[] = [
    { rotulo: "Coletor", valor: p.coletor },
    { rotulo: "Alcance do coletor", valor: c ? (TERRITORIO_DO_COLETOR[c.territorio] ?? c.territorio) : "fora do catálogo" },
    { rotulo: "Modo", valor: modoDaRodada(p.modo) },
    { rotulo: "Recorte", valor: textoDoRecorte(p) },
    { rotulo: "Número de fichas", valor: "definido pela leitura: o coletor diz quantas fichas alcançou ao terminar" },
    { rotulo: "Efeito", valor: p.modo === "reprocessar" ? "Reprocessa o que já foi lido, sem rede." : "Abre uma rodada que lê as fontes na internet. Pode levar minutos." },
  ];
  const avisos = c?.exige_chave ? ["Este coletor exige uma chave de API no ambiente do executor; sem ela a rodada falha."] : [];
  return { titulo: "Confirme a abertura da rodada", itens, botao: `Abrir rodada de ${p.coletor}`, avisos };
}

export type EntradaRepetir = { coletor: string; modo: string; recorte: unknown; soPendencias: boolean };

export function confirmacaoDeRepetir(e: EntradaRepetir): Confirmacao {
  const itens: ItemResumo[] = [
    { rotulo: "Coletor", valor: e.coletor },
    { rotulo: "Modo", valor: modoDaRodada(e.modo) },
    { rotulo: "Recorte", valor: e.recorte === undefined ? "o mesmo da rodada original" : descreverRecorte(e.recorte) },
    { rotulo: "Escopo", valor: e.soPendencias ? "só as fichas que ficaram pendentes na rodada" : "todas as fichas do recorte" },
    { rotulo: "Efeito", valor: "Abre uma rodada nova que repete esta. O que já foi gravado fica; repetir não duplica nada." },
  ];
  return { titulo: "Confirme a repetição", itens, botao: e.soPendencias ? `Repetir só pendências de ${e.coletor}` : `Repetir rodada de ${e.coletor}`, avisos: [] };
}

// ------------------------------------------------------------------------------------------------------------------------ rascunho de decisão (sessionStorage)

export type RascunhoDecisao = { acao: string; justificativa: string; valor: string; aplicar: boolean };
export const chaveDoRascunho = (pendenciaId: string): string => `adm-rascunho-decisao:${pendenciaId}`;
const ACOES = ["aprovar", "corrigir", "descartar", "pedir_confirmacao"];

/** Texto salvo -> rascunho válido, ou null (texto corrompido ou de outra versão nunca quebra a tela). */
export function lerRascunho(texto: string | null | undefined): RascunhoDecisao | null {
  if (typeof texto !== "string" || texto === "") return null;
  try {
    const o = JSON.parse(texto) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    if (typeof o.acao !== "string" || !ACOES.includes(o.acao)) return null;
    if (typeof o.justificativa !== "string" || typeof o.valor !== "string" || typeof o.aplicar !== "boolean") return null;
    return { acao: o.acao, justificativa: o.justificativa.slice(0, 4000), valor: o.valor.slice(0, 4000), aplicar: o.aplicar };
  } catch {
    return null;
  }
}
export const serializarRascunho = (r: RascunhoDecisao): string => JSON.stringify(r);
/** Rascunho vazio não vale a pena guardar. */
export const rascunhoVazio = (r: RascunhoDecisao): boolean => r.justificativa.trim() === "" && r.valor.trim() === "";
