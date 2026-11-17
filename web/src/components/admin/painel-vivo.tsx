"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { anunciarMudanca, resumoVivo, type ResumoVivo } from "../../lib/admin/acompanhar.ts";
import { confirmacaoDeRepetir } from "../../lib/admin/confirmacao.ts";
import { estadoDaRodada, estadoDoExecutor, esperaDoExecutor, formatarDuracao, mostrarValor } from "../../lib/admin/estado-tela.ts";
import { PROMESSA_EXECUTOR, resumoDoExecutor } from "../../lib/admin/executor-tela.ts";
import { classificarFalha, mesmaFalha, type Falha } from "../../lib/admin/falhas.ts";
import { abreviarId, modoDaRodada, nomeDaClasse, statusDaRodada } from "../../lib/admin/rotulos.ts";
import { dataBrasilia, dataComRelativo, horaBrasilia, paraData } from "../../lib/admin/tempo.ts";
import { MOTIVOS_SEM_MAPA, TEXTO_MOTIVO } from "../../lib/admin/tipos.ts";
import { AlternadorVisao, Selo } from "./blocos.tsx";
import { BotaoPedido } from "./botao-pedido.tsx";
import { MapaCliente } from "./mapa-cliente.tsx";
import { PainelRelatorio } from "./painel-relatorio.tsx";
import type { Visao } from "./mapa-escala.ts";

// Região viva da central: consulta /admin/api/estado (e o relatório da rodada em curso) a cada 5 s, com fetch RELATIVO, e PARA quando a aba não está visível.
// O que a página já traz do servidor aparece de imediato; até a primeira resposta a região fica marcada como "atualizando" (estado carregando, aria-busy).
// Falha da consulta NÃO apaga a região: o último dado fica e um aviso diz "a atualização falhou às HH:MM" e o que fazer. A região não é "live": só o anunciador pequeno
// (e o aviso de falha, que entra uma vez) falam a leitor de tela, e só em mudança de estado relevante (executor parou ou voltou, rodada entrou ou saiu de andamento).
// Ordem na tela (início): faixa de estado (pendências por classe, executor, rodada em curso), mapa com legenda e o alternador Coleta/Revisão, painéis.

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
  pedidosRecentes: { origem: string; id: string; tipo: string; status: string; rodada_id: string | null; andamento: unknown; erro: string | null; criado_em?: unknown; iniciado_em?: unknown; batimento_em?: unknown; finalizado_em?: unknown }[];
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
  /** destinos do alternador Coleta/Revisão, que fica junto do mapa */
  hrefColeta: string;
  hrefRevisao: string;
};

type Props = {
  inicial: EstadoApi | null;
  rodada: RodadaSerial | null;
  relatorio: RelatorioSerial | null;
  mapaPais?: MapaPaisVivo;
  mostrarPaineis: boolean;
  /** início: "N pendências abertas por classe" no topo da faixa de estado */
  mostrarPendencias?: boolean;
};

const EM_CURSO = ["aberta", "em_andamento"];
const CLASSES_ORDEM = ["vinculo_sapl", "cobertura", "contato_mandato", "identidade"] as const;

type FalhaViva = { falha: Falha; desde: string };

export function PainelVivo({ inicial, rodada, relatorio: relatorioInicial, mapaPais, mostrarPaineis, mostrarPendencias = false }: Props) {
  const [estado, setEstado] = useState<EstadoApi | null>(inicial);
  const [relatorio, setRelatorio] = useState<RelatorioSerial | null>(relatorioInicial);
  const [statusRodada, setStatusRodada] = useState<string | null>(rodada?.status ?? null);
  const [carregando, setCarregando] = useState(true);
  const [falhaViva, setFalhaViva] = useState<FalhaViva | null>(null);
  const [ultimaLeitura, setUltimaLeitura] = useState<string | null>(inicial?.agora ?? null);
  const [anuncio, setAnuncio] = useState("");
  const [totaisAindaNaoFecham, setTotaisAindaNaoFecham] = useState(false);
  const emCursoAntes = useRef(rodada ? EM_CURSO.includes(rodada.status) : false);
  const resumoAnterior = useRef<ResumoVivo | null>(inicial ? resumoVivo(inicial) : null);
  const statusAnterior = useRef<string | null>(rodada?.status ?? null);
  const rodadaId = rodada?.id ?? null;

  useEffect(() => {
    let ativo = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const registrarFalha = async (r: Response | null) => {
      let mensagem: string | null = null;
      if (r) {
        try {
          const j = (await r.clone().json()) as { erro?: unknown };
          if (typeof j.erro === "string") mensagem = j.erro;
        } catch {
          // corpo vazio (404 da guarda) ou não JSON: a classificação vai só pelo status
        }
      }
      const f = classificarFalha(r ? { status: r.status, mensagem } : { rede: true });
      if (!ativo) return;
      // a hora da PRIMEIRA falha fica: o aviso não é reescrito a cada tentativa (leitor de tela não repete)
      setFalhaViva((antes) => (antes && mesmaFalha(antes.falha, f) ? antes : { falha: f, desde: new Date().toISOString() }));
      if (f.tipo === "sessao" && timer !== null) {
        clearInterval(timer); // sem sessão não adianta insistir: a pessoa entra de novo
        timer = null;
      }
    };

    const buscar = async () => {
      try {
        const r = await fetch("/admin/api/estado", { cache: "no-store" });
        if (!r.ok) {
          await registrarFalha(r);
          return;
        }
        const j = (await r.json()) as EstadoApi;
        if (!ativo) return;
        setEstado(j);
        setUltimaLeitura(j.agora);
        const rv = resumoVivo(j);
        const msg = anunciarMudanca(resumoAnterior.current, rv);
        resumoAnterior.current = rv;
        if (msg) setAnuncio(msg);
        let falhouRelatorio: Response | null = null;
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
              falhouRelatorio = rr;
            }
          }
        }
        if (falhouRelatorio) await registrarFalha(falhouRelatorio);
        else if (ativo) setFalhaViva(null);
      } catch {
        await registrarFalha(null);
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

  // a rodada exibida mudou de situação (ex.: em andamento -> concluída): uma frase, uma vez
  useEffect(() => {
    if (statusAnterior.current !== null && statusRodada !== null && statusAnterior.current !== statusRodada && rodada) {
      setAnuncio(`Rodada ${rodada.coletor}: ${statusDaRodada(statusRodada)}.`);
    }
    statusAnterior.current = statusRodada;
  }, [statusRodada, rodada]);

  const ex = estado?.executor ?? null;
  const espera = ex ? esperaDoExecutor({ agora: estado?.agora, ...ex }) : null;
  const estadoRodada = estadoDaRodada(statusRodada);
  const pedidoDaRodada = rodadaId && estado ? estado.pedidosRecentes.find((p) => p.rodada_id === rodadaId && p.tipo === "rodada") : undefined;
  const agora = estado?.agora ?? null;
  const resumoExec = ex ? resumoDoExecutor(estado?.pedidosRecentes, agora) : null;
  const desdeParado = (() => {
    const base = paraData(agora);
    return base && espera ? dataBrasilia(new Date(base.getTime() - espera.segundos * 1000)) : null;
  })();
  const porClasse = estado?.pendenciasAbertasPorClasse ?? null;
  const totalPendencias = porClasse ? Object.values(porClasse).reduce((a, b) => a + b, 0) : 0;
  const recorteDaRodada = relatorio?.rodada?.recorte;

  return (
    <div className="adm-vivo" aria-busy={carregando} data-regiao="viva" data-estado={carregando ? "carregando" : undefined}>
      <p className="adm-sr" role="status" aria-live="polite">
        {anuncio}
      </p>
      {carregando && <p className="adm-marca">atualizando…</p>}

      {falhaViva && (
        <section className="adm-bloco" data-estado="erro_leitura" role="alert" aria-labelledby="adm-falha-t">
          <Selo>Atualização falhou</Selo>
          <h2 id="adm-falha-t">{falhaViva.falha.titulo}</h2>
          <p>
            A atualização falhou às {horaBrasilia(falhaViva.desde)}.{" "}
            {estado ? `Os números abaixo são da última leitura que deu certo${ultimaLeitura ? `, às ${horaBrasilia(ultimaLeitura)}` : ""}.` : "Ainda não há leitura para mostrar."}
          </p>
          <p className="adm-ajuda">
            {falhaViva.falha.mensagem} {falhaViva.falha.acao}
          </p>
          {falhaViva.falha.href && (
            <p>
              <a className="chip" href={falhaViva.falha.href}>
                Entrar de novo
              </a>
            </p>
          )}
        </section>
      )}

      {(ex || (mostrarPendencias && porClasse)) && (
        <div className="adm-faixa">
          {mostrarPendencias && porClasse && (
            <section className="adm-bloco adm-pendencias" aria-labelledby="adm-pend-t">
              <h2 id="adm-pend-t">
                <span className="disp adm-num">{totalPendencias}</span> {totalPendencias === 1 ? "pendência aberta" : "pendências abertas"}
              </h2>
              <ul className="adm-pendencias__lista">
                {CLASSES_ORDEM.map((c) => (
                  <li key={c}>
                    <Link href={`/admin/fila?classe=${c}`} className="chip">
                      <strong className="adm-num">{porClasse[c] ?? 0}</strong> {nomeDaClasse(c)}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="adm-ajuda">Por classe de campo. Abrir uma delas mostra a fila filtrada.</p>
            </section>
          )}

          {ex && resumoExec && (
            <section className="adm-bloco adm-exec" data-estado={estadoDoExecutor(ex.parado)} aria-labelledby="adm-exec-t">
              <h2 id="adm-exec-t">Executor</h2>
              {ex.parado ? (
                <>
                  <p>
                    <Selo>Parado</Selo> <strong>Executor parado.</strong> {ex.motivoParado}.
                  </p>
                  {espera && (
                    <p>
                      Tempo de espera: {formatarDuracao(espera.segundos)}
                      {desdeParado ? ` (desde ${desdeParado}, horário de Brasília)` : ""}.
                    </p>
                  )}
                  <p className="adm-ajuda">
                    {resumoExec.visto}. Os pedidos esperam na fila até o executor voltar; nada se perde. Quando ele voltar, um pedido começa em até ~5 s.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <Selo>Em dia</Selo> Sem pedido atrasado.
                  </p>
                  <p className="adm-ajuda">
                    {resumoExec.visto}. {PROMESSA_EXECUTOR}
                  </p>
                </>
              )}
              <p className="adm-ajuda">
                {ex.naFila} {ex.naFila === 1 ? "pedido na fila" : "pedidos na fila"}, {ex.emExecucao} em execução.
              </p>
            </section>
          )}

          {rodada && (
            <section className="adm-bloco adm-rodada" data-estado={estadoRodada} aria-labelledby="adm-rod-t">
              <h2 id="adm-rod-t">Rodada {rodada.coletor}</h2>
              <p className="adm-ajuda">
                {modoDaRodada(rodada.modo)}, iniciada em {dataComRelativo(rodada.iniciada_em, agora ?? undefined)}
                {rodada.finalizada_em ? `, finalizada em ${dataComRelativo(rodada.finalizada_em, agora ?? undefined)}` : ""}.
              </p>
              {estadoRodada === "rodada_em_andamento" && (
                <p>
                  <Selo>Em andamento</Selo> <strong>Em andamento.</strong> Os números abaixo são parciais.
                  {pedidoDaRodada?.andamento != null ? ` Andamento: ${mostrarValor(pedidoDaRodada.andamento)}.` : ""}
                </p>
              )}
              {estadoRodada === "rodada_interrompida" && (
                <p>
                  <Selo>{statusRodada === "falhou" ? "Com falha" : "Interrompida"}</Selo> <strong>Rodada {statusRodada === "falhou" ? "com falha" : "interrompida"}.</strong> O que já foi gravado ficou; repetir a rodada não duplica nada.
                </p>
              )}
              {estadoRodada === "rodada_concluida" && (
                <p>
                  <Selo>Concluída</Selo> <strong>Rodada concluída.</strong> Leitura bem-sucedida não quer dizer campos confirmados: veja o painel da revisão.
                </p>
              )}
              <div className="adm-acoes">
                <BotaoPedido
                  rotulo="Repetir rodada"
                  endpoint="/admin/api/pedidos"
                  corpo={{ tipo: "rodada", parametros: { repetir: rodada.id, so_pendencias: false } }}
                  confirmacao={confirmacaoDeRepetir({ coletor: rodada.coletor, modo: rodada.modo, recorte: recorteDaRodada, soPendencias: false })}
                />
                <BotaoPedido
                  rotulo="Repetir só pendências"
                  endpoint="/admin/api/pedidos"
                  corpo={{ tipo: "rodada", parametros: { repetir: rodada.id, so_pendencias: true } }}
                  confirmacao={confirmacaoDeRepetir({ coletor: rodada.coletor, modo: rodada.modo, recorte: recorteDaRodada, soPendencias: true })}
                />
              </div>
              <details className="adm-ids">
                <summary>Detalhe técnico da rodada</summary>
                <code>rodada {abreviarId(rodada.id)}</code>
              </details>
            </section>
          )}
        </div>
      )}

      {mapaPais && estado && (
        <section className="adm-bloco" aria-labelledby="adm-mapa-t">
          <h2 id="adm-mapa-t">Mapa por estado</h2>
          <AlternadorVisao visao={mapaPais.visao} hrefColeta={mapaPais.hrefColeta} hrefRevisao={mapaPais.hrefRevisao} />
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
                <strong className="adm-num">{estado.mapa.semTerritorio.porMotivo[m] ?? 0}</strong> {(estado.mapa.semTerritorio.porMotivo[m] ?? 0) === 1 ? "ficha" : "fichas"}: {TEXTO_MOTIVO[m]}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mostrarPaineis && relatorio && (
        <div className="adm-paineis">
          <p className="adm-ajuda">Os painéis de coleta e de revisão são separados e nunca somados.</p>
          {relatorio.simulado && <p className="adm-marca">SIMULADO: {relatorio.simulado}</p>}
          {totaisAindaNaoFecham && <p className="adm-marca">Os totais ainda não fecham (rodada em andamento): mostrando o último relatório que fechou.</p>}
          <PainelRelatorio id="adm-coleta" titulo="Coleta" painel={relatorio.coleta} parcial={EM_CURSO.includes(statusRodada ?? "")} />
          <PainelRelatorio id="adm-revisao" titulo="Revisão" painel={relatorio.revisao} parcial={EM_CURSO.includes(statusRodada ?? "")} />
        </div>
      )}
    </div>
  );
}
