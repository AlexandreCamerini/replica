import "server-only";
import { ErroInvariante, fila, relatorioDaRodada } from "./consultas.ts";
import { estadosPorTerritorio, type EstadoMapa } from "./estado-tela.ts";
import type { Ficha } from "./tipos.ts";

// Dados do mapa da central: junta o que as consultas já trazem (relatório da rodada, fila) com a função pura `estadosPorTerritorio`.
// Só lê, só por consultas.ts (que chama a guarda). Sem SQL aqui.

type ColetaRelatorio = { registros_alcancados?: { ids?: string[] }; registros_elegiveis_nao_alcancados?: { itens?: { id: string; motivo_falha: string | null }[] } };

/** Estado por território (`uf:XX`, `mun:NNNNNNN`) da visão escolhida. Coleta usa a rodada dada; revisão usa a fila de pendências abertas. */
export async function estadosDoMapa(visao: "coleta" | "revisao", todas: readonly Ficha[], rodadaId: string | null, statusRodada: string | null): Promise<Map<string, EstadoMapa>> {
  let coleta: ColetaRelatorio | undefined;
  if (visao === "coleta" && rodadaId) {
    try {
      coleta = (await relatorioDaRodada(rodadaId)).coleta as ColetaRelatorio;
    } catch (e) {
      if (!(e instanceof ErroInvariante)) throw e; // rodada em andamento: sem estado por território ainda
    }
  }
  const filaAberta = visao === "revisao" ? await fila(undefined, 1000) : [];
  return estadosPorTerritorio(visao, {
    fichas: todas,
    alcancados: coleta?.registros_alcancados?.ids ?? [],
    naoAlcancados: coleta?.registros_elegiveis_nao_alcancados?.itens ?? [],
    rodadaEmAndamento: statusRodada === "aberta" || statusRodada === "em_andamento",
    fila: filaAberta,
  });
}
