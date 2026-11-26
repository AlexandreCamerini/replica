import Link from "next/link";
import mapa from "@/data/mapa-br.json";
import { UF_ROWS } from "@/lib/data/reference";
import type { PlacarUf } from "@/lib/data/types";
import { BASE_DO_PERCENTUAL, FORA_DA_BASE_A, FORA_DA_BASE_B, PAINEL_PADRAO, dadosDoMapa, descricaoUf, fraseSim, nivelDoEstado, rotuloUf, textoPainel, textoPct, totalDoMapa } from "@/lib/mapa-votos";
import { MapaPainel } from "./mapa-painel";

// Mapa oficial do Brasil (malhas IBGE, 886 × 827) em que cada estado enche, de baixo para cima, até a parte de votos Sim
// entre os votos registrados nele. Componente de SERVIDOR: os caminhos de mapa-br.json (~95 KB) ficam fora do bundle do cliente.
// Só tinta e papel (nunca --agora/--vida), sem animação, raio 0, sem sombra e sem bolhas. Voto não é cor: o que enche é uma
// quantidade e cada estado traz o número escrito.
// INTERATIVO (decisão do dono, 21/11/2026, D343): cada estado é um <Link> para `?uf=XX` com nome acessível (% e contagem),
// na ordem alfabética de sigla. Funciona sem JS (links e Tab). Uma ilha cliente mínima (mapa-painel.tsx) só copia o `data-txt`
// do link em foco ou sob o mouse para o painel de leitura. Os links do SVG não têm 44 px nos estados pequenos (exceção ao
// aceite D2, só para eles): a lista `nav.sv-ufs` (44 px) segue como a rota de toque e a tabela oculta como a do leitor de tela.
const M = mapa as unknown as {
  w: number;
  h: number;
  paths: Record<string, string>;
  /** [x, y, w, h, etiqueta fora do mapa (com linha)?, x do ponto no mapa, y do ponto no mapa] */
  lab: Record<string, [number, number, number, number, number, number, number]>;
};

const NOME = Object.fromEntries(UF_ROWS.map((r) => [r[1], r[2]])) as Record<string, string>;
const UFS_DO_MAPA = Object.keys(M.paths);

export function MapaVotos({ placar, ufSelecionada, votacaoId, listaAbaixo = true }: { placar: readonly PlacarUf[]; ufSelecionada: string | null; votacaoId: string; listaAbaixo?: boolean }) {
  const dados = dadosDoMapa(placar, UFS_DO_MAPA);
  const total = totalDoMapa(dados);
  const sel = dados.find((d) => d.uf === ufSelecionada);
  const padrao = sel ? textoPainel(sel) : PAINEL_PADRAO;

  return (
    <figure className="sv-mv" data-mapa-votos>
      {/* painel de leitura: os números da UF sob o mouse ou em foco; sem JS mostra a UF escolhida. Sem aria-live: o link em foco já
          anuncia % e contagem (aria-label e descrição), e o painel os repetiria; é só eco visual. */}
      <p className="sv-mv__painel" data-mapa-painel data-padrao={padrao}>
        {padrao}
      </p>
      <MapaPainel />
      {/* atalho de teclado: o mapa tem 27 paradas de Tab (uma por estado); este link, só visível com foco, pula para depois dele */}
      <a href="#mapa-votos-fim" className="sv-vh sv-mv__pular">
        Pular o mapa
      </a>
      <svg viewBox={`0 0 ${M.w} ${M.h}`} role="group" aria-label="Mapa do Brasil: percentual de votos Sim por estado, em ordem alfabética de sigla" focusable="false">
        <defs>
          {dados.map((d) => (
            <linearGradient key={d.uf} id={`mv-g-${d.uf}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s1" />
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s0" />
            </linearGradient>
          ))}
        </defs>
        {/* o desenho: estado sem voto registrado fica vazio e com contorno tracejado (forma, não cor) */}
        {/* a descrição longa de cada estado mora aqui, fora do link: dentro dele o texto do <desc> entrava no "conteúdo" do link e o axe
            (label-content-name-mismatch) acusava o aria-label por não conter esse texto. O aria-describedby do link continua apontando para ela. */}
        {dados.map((d) => (
          <path key={d.uf} d={M.paths[d.uf]} fill={`url(#mv-g-${d.uf})`} className={d.pct === null ? "sv-mv__pt is-sem" : "sv-mv__pt"}>
            <desc id={`mv-d-${d.uf}`}>{descricaoUf(NOME[d.uf] ?? d.uf, d, true)}</desc>
          </path>
        ))}
        {/* fio de papel por cima do contorno dos estados cheios: a fronteira entre dois estados cheios não some */}
        {dados.map((d) => (nivelDoEstado(d) > 0 ? <path key={`f-${d.uf}`} d={M.paths[d.uf]} className="sv-mv__fio" /> : null))}
        {/* camada de links (ordem alfabética = ordem do Tab): um por estado, com a área de clique transparente sobre o desenho */}
        {dados.map((d) => {
          const ativo = d.uf === ufSelecionada;
          const rotulo = rotuloUf(d);
          return (
            <Link
              key={d.uf}
              href={`/votacao/${votacaoId}?uf=${d.uf}#vt-3`}
              prefetch={false}
              className={ativo ? "sv-mv__a is-sel" : "sv-mv__a"}
              aria-label={rotulo}
              aria-describedby={`mv-d-${d.uf}`}
              aria-current={ativo ? "page" : undefined}
              data-uf-link={d.uf}
              data-txt={textoPainel(d)}
            >
              <title>{rotulo}</title>
              <path d={M.paths[d.uf]} className="sv-mv__hit" />
            </Link>
          );
        })}
        {/* camada de rótulos, por cima de todos os estados: o clique no rótulo é da própria UF (o desenho de um vizinho não o cobre).
            Mesmo destino do link acima, mas fora do Tab e do leitor de tela (o link acima já tem o nome e a descrição). */}
        {dados.map((d) => {
          const l = M.lab[d.uf];
          if (!l) return null;
          const fora = !!l[4];
          const cx = l[0] + l[2] / 2;
          const cy = l[1] + l[3] / 2;
          const pw = fora ? l[2] : 52;
          const ph = 44;
          const px = fora ? l[0] : cx - pw / 2;
          const ativo = d.uf === ufSelecionada;
          return (
            <Link key={d.uf} href={`/votacao/${votacaoId}?uf=${d.uf}#vt-3`} prefetch={false} tabIndex={-1} aria-hidden="true" className="sv-mv__pa" data-uf-plaque={d.uf} data-txt={textoPainel(d)}>
              <g data-uf={d.uf} className={ativo ? "sv-mv__e is-sel" : "sv-mv__e"}>
                {fora && <path d={`M${l[5]} ${l[6]}L${l[0] > l[5] ? l[0] : l[0] + l[2]} ${cy}`} className="sv-mv__ld" />}
                <rect x={px} y={cy - ph / 2} width={pw} height={ph} className="sv-mv__pl" />
                {fora ? (
                  <>
                    <text x={px + 6} y={cy + 6} className="sv-mv__uf">
                      {d.uf}
                    </text>
                    <text x={px + 34} y={cy + 6} className="sv-mv__pc">
                      {textoPct(d)}
                    </text>
                  </>
                ) : (
                  <>
                    <text x={cx} y={cy - 4} textAnchor="middle" className="sv-mv__uf">
                      {d.uf}
                    </text>
                    <text x={cx} y={cy + 15} textAnchor="middle" className="sv-mv__pc">
                      {textoPct(d)}
                    </text>
                  </>
                )}
              </g>
            </Link>
          );
        })}
      </svg>
      <figcaption className="sv-mv__leg" id="mapa-votos-fim" tabIndex={-1}>
        <p className="sv-t sv-mv__tot" data-mapa-total>
          {total.base > 0 ? `No conjunto dos estados: ${fraseSim(total)} votaram Sim (${textoPct(total)}).` : "Nenhum voto Sim, Não ou abstenção registrado nos estados desta votação."}
        </p>
        <p className="sv-t" data-mapa-base>
          Base do percentual: {BASE_DO_PERCENTUAL} O estado enche até esse percentual, de baixo para cima. {FORA_DA_BASE_A} {FORA_DA_BASE_B}
        </p>
        <p className="sv-t">Estado com contorno tracejado e “–”: sem voto Sim, Não ou abstenção registrado. Clique, toque ou use Tab e Enter num estado{listaAbaixo ? ", ou use a lista de estados abaixo," : ""} para ver o voto de cada pessoa.</p>
      </figcaption>
      {/* leitor de tela: os números de cada estado, em ordem alfabética de sigla */}
      <div className="sv-vh">
        <table data-mapa-tabela>
        <caption>Números por estado: votos Sim entre os votos registrados</caption>
        <thead>
          <tr>
            <th scope="col">Estado</th>
            <th scope="col">Votos registrados</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.uf}>
              <th scope="row">{NOME[d.uf] ?? d.uf}</th>
              <td>{descricaoUf(NOME[d.uf] ?? d.uf, d, false).replace(`${NOME[d.uf] ?? d.uf}: `, "")}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </figure>
  );
}
