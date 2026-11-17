// Escala e vocabulário do mapa da central (funções puras, sem React, sem rede).
// Decisão fechada do design v1: UMA cor de quantidade (`--tint`). A contagem vai pela faixa (opacidade da mesma cor);
// o ESTADO vai por padrão de preenchimento + palavra, nunca por cor. O número é sempre escrito em texto.
import { formatarContagem } from "../../lib/admin/agregacao.ts";

export type Visao = "coleta" | "revisao";

/** Faixas FIXAS de contagem (0 = vazio). Regra: 0 | 1 | 2 a 4 | 5 a 9 | 10 ou mais. Não depende do máximo: o mesmo
 *  tom significa a mesma quantidade em qualquer UF e em qualquer rodada, então dois mapas se comparam a olho. */
export type Faixa = 0 | 1 | 2 | 3 | 4;
export const FAIXAS: readonly Faixa[] = [0, 1, 2, 3, 4];

/** Opacidade de `--tint` por faixa (monótona crescente; faixa 0 não pinta). 0,35/0,6/0,8/1: degraus de 0,2 a 0,25 entre faixas vizinhas (antes 0,25/0,45/0,7/1, que o olho não separava). */
export const OPACIDADE_FAIXA: Readonly<Record<Faixa, number>> = { 0: 0, 1: 0.35, 2: 0.6, 3: 0.8, 4: 1 };

/** Lado, em PIXELS DE TELA, de cada ladrilho de padrão de estado. O ladrilho vive no espaço do desenho (que escala com o zoom): o mapa compensa com `patternTransform` = scale(1/escala). */
export const LADO_HACHURA_PX = 6;
export const LADO_PONTILHADO_PX = 5;

/** Escala (pixels de tela por unidade do desenho) a partir da largura renderizada e da largura do `viewBox`. Dado inválido: 1 (sem compensação). */
export function escalaDoDesenho(larguraPx: number, viewBox: string): number {
  const larguraUnidades = Number(viewBox.trim().split(/[\s,]+/)[2]);
  if (!Number.isFinite(larguraPx) || larguraPx <= 0 || !Number.isFinite(larguraUnidades) || larguraUnidades <= 0) return 1;
  return larguraPx / larguraUnidades;
}

/** Centro da caixa envolvente de um caminho SVG absoluto ("M295.2,484.3L298.7,485.2..."), para escrever o número no território. Sem pontos: null. */
export function centroDoCaminho(d: string): { x: number; y: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
}

export function faixaDeContagem(n: number): Faixa {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`contagem inválida: ${n}`);
  if (n === 0) return 0;
  if (n === 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

export function rotuloDaFaixa(f: Faixa): string {
  switch (f) {
    case 0: return formatarContagem(0);
    case 1: return formatarContagem(1);
    case 2: return "2 a 4 fichas";
    case 3: return "5 a 9 fichas";
    case 4: return "10 ou mais fichas";
  }
}

/** Padrões de preenchimento. `vazio` = só contorno, sem preenchimento. */
export type Padrao = "cheio" | "hachura" | "pontilhado" | "vazio";
export const PADROES: readonly Padrao[] = ["cheio", "hachura", "pontilhado", "vazio"];

/** Estados da visão Coleta: última tentativa das fontes vinculadas ao território. */
export const ESTADOS_COLETA = ["lida", "falhou", "em_andamento", "sem_tentativa"] as const;
/** Estados da visão Revisão: parecer vigente das fichas do território.
 *  reaberta = ficha decidida que voltou para a fila (destaque); pendente = aguarda parecer;
 *  decidida = parecer vigente registrado; sem_pendencia = nada a revisar. */
export const ESTADOS_REVISAO = ["decidida", "reaberta", "pendente", "sem_pendencia"] as const;
export type EstadoColeta = (typeof ESTADOS_COLETA)[number];
export type EstadoRevisao = (typeof ESTADOS_REVISAO)[number];
export type EstadoTerritorio = EstadoColeta | EstadoRevisao;

const TABELA: Readonly<Record<Visao, Readonly<Record<string, { padrao: Padrao; palavra: string; destaque: boolean }>>>> = {
  coleta: {
    lida: { padrao: "cheio", palavra: "lida", destaque: false },
    falhou: { padrao: "hachura", palavra: "falhou", destaque: false },
    em_andamento: { padrao: "pontilhado", palavra: "em andamento", destaque: false },
    sem_tentativa: { padrao: "vazio", palavra: "sem tentativa", destaque: false },
  },
  revisao: {
    decidida: { padrao: "cheio", palavra: "decidida", destaque: false },
    reaberta: { padrao: "hachura", palavra: "reaberta", destaque: true },
    pendente: { padrao: "pontilhado", palavra: "pendente", destaque: false },
    sem_pendencia: { padrao: "vazio", palavra: "sem pendência", destaque: false },
  },
};

export function estadosDaVisao(visao: Visao): readonly EstadoTerritorio[] {
  return visao === "coleta" ? ESTADOS_COLETA : ESTADOS_REVISAO;
}

function entrada(visao: Visao, estado: string) {
  const e = TABELA[visao]?.[estado];
  if (!e) throw new RangeError(`estado "${estado}" não existe na visão "${visao}"`);
  return e;
}

export const padraoDoEstado = (visao: Visao, estado: string): Padrao => entrada(visao, estado).padrao;
export const textoDoEstado = (visao: Visao, estado: string): string => entrada(visao, estado).palavra;
/** Destaque = contorno mais grosso (além do padrão), usado nas pendências reabertas. */
export const destaqueDoEstado = (visao: Visao, estado: string): boolean => entrada(visao, estado).destaque;

export type ItemLegenda = { faixa: Faixa; rotulo: string };
export type EstadoLegenda = { estado: EstadoTerritorio; padrao: Padrao; palavra: string; destaque: boolean };
export type Legenda = { titulo: string; explicacao: string; faixas: ItemLegenda[]; estados: EstadoLegenda[] };

/** Legenda própria por visão. `max` = maior contagem do mapa: faixas acima dela não aparecem (a faixa 0 sempre aparece). */
export function legenda(visao: Visao, max: number): Legenda {
  const ate = faixaDeContagem(max);
  return {
    titulo: visao === "coleta" ? "Coleta" : "Revisão",
    explicacao:
      visao === "coleta"
        ? "Última tentativa das fontes vinculadas ao território, andamento da rodada em curso e motivo de cada falha."
        : "Parecer vigente por ficha; pendências reabertas em destaque; histórico de decisões em Ver registros.",
    faixas: FAIXAS.filter((f) => f <= ate).map((f) => ({ faixa: f, rotulo: rotuloDaFaixa(f) })),
    estados: estadosDaVisao(visao).map((estado) => {
      const e = entrada(visao, estado);
      return { estado, padrao: e.padrao, palavra: e.palavra, destaque: e.destaque };
    }),
  };
}

/** Estado padrão de um território sem entrada no mapa de contagens (contagem 0). */
export const estadoVazio = (visao: Visao): EstadoTerritorio => (visao === "coleta" ? "sem_tentativa" : "sem_pendencia");

/** Versão tolerante para a tela: estado desconhecido degrada para vazio + "estado desconhecido" em vez de derrubar a página. */
export function apresentar(visao: Visao, estado: string): { padrao: Padrao; palavra: string; destaque: boolean } {
  try {
    return { padrao: padraoDoEstado(visao, estado), palavra: textoDoEstado(visao, estado), destaque: destaqueDoEstado(visao, estado) };
  } catch {
    return { padrao: "vazio", palavra: "estado desconhecido", destaque: false };
  }
}
