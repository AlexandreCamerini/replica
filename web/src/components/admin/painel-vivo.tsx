"use client";

import { useEffect, useRef, useState } from "react";
import { estadoDaRodada, estadoDoExecutor, esperaDoExecutor, formatarDuracao, mostrarValor, textoData } from "../../lib/admin/estado-tela.ts";
import { MOTIVOS_SEM_MAPA, TEXTO_MOTIVO } from "../../lib/admin/tipos.ts";
import { BlocoErro } from "./blocos.tsx";
import { BotaoPedido } from "./botao-pedido.tsx";
import { MapaCliente } from "./mapa-cliente.tsx";
import { PainelRelatorio } from "./painel-relatorio.tsx";
import type { Visao } from "./mapa-escala.ts";

// Região viva da central: consulta /admin/api/estado (e o relatório da rodada em curso) a cada 5 s, com fetch RELATIVO, e PARA quando a aba não está visível.
// O que a página já traz do servidor aparece de imediato; até a primeira resposta a região fica marcada como "atualizando" (estado carregando, aria-busy).

const INTERVALO_MS = 5000;

export type ExecutorSerial = {
  naFila: number;
  emExecucao: number;
  filaMaisAntigaS: number | null;
  batimentoMaisAntigoS: number | null;
  ultimoBatimentoS: number | null;
  parado: boolean;
  motivoParado: string | null;
};
export type MapaSerial = { total: number; porUf: Record<string, number>; semTerritorio: { total: number; porMotivo: Record<string, number> }; conflitos: number };
export type EstadoApi = {
  agora: string | null;
  executor: ExecutorSerial;
  pedidosRecentes: { origem: string; id: string; tipo: string; status: string; rodada_id: string | null; andamento: unknown; erro: string | null }[];
  rodadasEmCurso: { id: string; coletor: string; modo: string; status: string }[];
  pendenciasAbertasPorClasse: Record<string, number>;
  mapa: MapaSerial;
};
export type RodadaSerial = { id: string; coletor: string; modo: string; status: string; iniciada_em: string | null; finalizada_em: string | null; repete_id: string | null };
export type RelatorioSerial = { simulado: string | null; rodada: RodadaSerial & { recorte: unknown }; coleta: Record<string, unknown>; revisao: Record<string, unknown> };

export type MapaPaisVivo = {
  visao: Visao;
  /** estado por UF (ibge de 2 dígitos), vindo de dados da página; UF sem entrada usa o estado vazio da visão */
  estadosPorUf: Record<string, string>;
  hrefRegistros: string;
};

type Props = {
  inicial: EstadoApi | null;
  rodada: RodadaSerial | null;
  relatorio: RelatorioSerial | null;
  mapaPais?: MapaPaisVivo;
  mostrarPaineis: boolean;
};

const EM_CURSO = ["aberta", "em_andamento"];

export function PainelVivo({ inicial, rodada, relatorio: relatorioInicial, mapaPais, mostrarPaineis }: Props) {
  const [estado, setEstado] = useState<EstadoApi | null>(inicial);
  const [relatorio, setRelatorio] = useState<RelatorioSerial | null>(relatorioInicial);
  const [statusRodada, setStatusRodada] = useState<string | null>(rodada?.status ?? null);
  const [carregando, setCarregando] = useState(true);
  const [falhaLeitura, setFalhaLeitura] = useState(false);
  const [totaisAindaNaoFecham, setTotaisAindaNaoFecham] = useState(false);
  const emCursoAntes = useRef(rodada ? EM_CURSO.includes(rodada.status) : false);
  const rodadaId = rodada?.id ?? null;

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const buscar = async () => {
      try {
        const r = await fetch("/admin/api/estado", { cache: "no-store" });
        if (!r.ok) throw new Error("estado");
        const j = (await r.json()) as EstadoApi;
        if (!ativo) return;
        setEstado(j);
        let falhou = false;
        if (rodadaId) {
          const emCurso = j.rodadasEmCurso.some((x) => x.id === rodadaId);
          if (emCurso || emCursoAntes.current) {
            const rr = await fetch(`/admin/api/relatorio/${rodadaId}`, { cache: "no-store" });
            if (!ativo) return;
            if (rr.ok) {
              const rel = (await rr.json()) as RelatorioSerial;
              setRelatorio(rel);
              setStatusRodada(rel.rodada.status);
              setTotaisAindaNaoFecham(false);
              emCursoAntes.current = EM_CURSO.includes(rel.rodada.status);
            } else if (rr.status === 409) {
              setTotaisAindaNaoFecham(true); // somas parciais não fecham: mantém o último relatório
              if (!emCurso) emCursoAntes.current = false;
            } else {
              falhou = true;
            }
          }
        }
        setFalhaLeitura(falhou);
      } catch {
        if (ativo) setFalhaLeitura(true);
      } finally {
        if (ativo) setCarregando(false);
      }
    };

    const parar = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const iniciar = () => {
      parar();
      if (document.visibilityState !== "visible") return; // aba escondida: sem consulta
      void buscar();
      timer = setInterval(() => void buscar(), INTERVALO_MS);
    };
    const aoMudarVisibilidade = () => (document.visibilityState === "visible" ? iniciar() : parar());

    iniciar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      ativo = false;
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [rodadaId]);

  const ex = estado?.executor ?? null;
  const espera = ex ? esperaDoExecutor({ agora: estado?.agora, ...ex }) : null;
  const estadoRodada = estadoDaRodada(statusRodada);
  const pedidoDaRodada = rodadaId && estado ? estado.pedidosRecentes.find((p) => p.rodada_id === rodadaId && p.tipo === "rodada") : undefined;

  return (
    <div className="adm-vivo" aria-live="polite" aria-busy={carregando} data-regiao="viva" data-estado={carregando ? "carregando" : undefined}>
      {carregando && <p className="adm-marca">atualizando…</p>}

      {falhaLeitura ? (
        <BlocoErro />
      ) : (
        <>
          {ex && (
            <section className="adm-bloco" data-estado={estadoDoExecutor(ex.parado)} aria-labelledby="adm-exec-t">
              <h2 id="adm-exec-t">Executor</h2>
              {ex.parado ? (
                <>
                  <p>
                    <strong>Executor parado.</strong> {ex.motivoParado}.
                  </p>
                  {espera && (
                    <p>
                      Tempo de espera: {formatarDuracao(espera.segundos)}
                      {espera.desde ? ` (desde ${espera.desde})` : ""}. Suba o executor local para consumir a fila.
                    </p>
                  )}
                </>
              ) : (
                <p>Sem pedido atrasado.</p>
              )}
              <p className="adm-ajuda">
                {ex.naFila} {ex.naFila === 1 ? "pedido na fila" : "pedidos na fila"}, {ex.emExecucao} em execução.
              </p>
            </section>
          )}

          {rodada && (
            <section className="adm-bloco" data-estado={estadoRodada} aria-labelledby="adm-rod-t">
              <h2 id="adm-rod-t">Rodada {rodada.coletor}</h2>
              <p className="adm-ajuda">
                id {rodada.id}, modo {rodada.modo}, iniciada em {textoData(rodada.iniciada_em)}
                {rodada.finalizada_em ? `, finalizada em ${textoData(rodada.finalizada_em)}` : ""}.
              </p>
              {estadoRodada === "rodada_em_andamento" && (
                <p>
                  <strong>Em andamento.</strong> Os números abaixo são parciais.
                  {pedidoDaRodada?.andamento != null ? ` Andamento: ${mostrarValor(pedidoDaRodada.andamento)}.` : ""}
                </p>
              )}
              {estadoRodada === "rodada_interrompida" && (
                <p>
                  <strong>Rodada {statusRodada === "falhou" ? "com falha" : "interrompida"}.</strong> O que já foi gravado ficou; repetir a rodada não duplica nada.
                </p>
              )}
              {estadoRodada === "rodada_concluida" && (
                <p>
                  <strong>Rodada concluída.</strong> Leitura bem-sucedida não quer dizer campos confirmados: veja o painel da revisão.
                </p>
              )}
              <div className="adm-acoes">
                <BotaoPedido rotulo="Repetir rodada" endpoint="/admin/api/pedidos" corpo={{ tipo: "rodada", parametros: { repetir: rodada.id, so_pendencias: false } }} />
                <BotaoPedido rotulo="Repetir só pendências" endpoint="/admin/api/pedidos" corpo={{ tipo: "rodada", parametros: { repetir: rodada.id, so_pendencias: true } }} />
              </div>
            </section>
          )}

          {mostrarPaineis && relatorio && (
            <div className="adm-paineis">
              {relatorio.simulado && <p className="adm-marca">SIMULADO: {relatorio.simulado}</p>}
              {totaisAindaNaoFecham && <p className="adm-marca">Os totais ainda não fecham (rodada em andamento): mostrando o último relatório que fechou.</p>}
              <PainelRelatorio id="adm-coleta" titulo="Coleta" painel={relatorio.coleta} parcial={EM_CURSO.includes(statusRodada ?? "")} />
              <PainelRelatorio id="adm-revisao" titulo="Revisão" painel={relatorio.revisao} parcial={EM_CURSO.includes(statusRodada ?? "")} />
            </div>
          )}

          {mapaPais && estado && (
            <section className="adm-bloco" aria-labelledby="adm-mapa-t">
              <h2 id="adm-mapa-t">Mapa por estado</h2>
              <p className="adm-ajuda">
                {estado.mapa.total} fichas no total. Conflitos de território entre fontes: {estado.mapa.conflitos}.
              </p>
              <MapaCliente
                nivel={{ tipo: "pais" }}
                contagens={Object.entries(estado.mapa.porUf).map(([uf, n]) => [uf, n, mapaPais.estadosPorUf[uf] ?? (mapaPais.visao === "coleta" ? "sem_tentativa" : "sem_pendencia")])}
                semTerritorio={estado.mapa.semTerritorio.total}
                hrefRegistros={mapaPais.hrefRegistros}
                visao={mapaPais.visao}
                hrefBaseUf="/admin/uf/"
                hrefBaseMunicipio="/admin/registros?uf="
                hrefVoltar="/admin"
              />
              <h3>Sem território no mapa, por motivo</h3>
              <ul className="adm-totais">
                {MOTIVOS_SEM_MAPA.map((m) => (
                  <li key={m}>
                    <strong>{estado.mapa.semTerritorio.porMotivo[m] ?? 0}</strong> {(estado.mapa.semTerritorio.porMotivo[m] ?? 0) === 1 ? "ficha" : "fichas"}: {TEXTO_MOTIVO[m]}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
