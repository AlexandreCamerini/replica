import Link from "next/link";
import mapa from "@/data/mapa-br.json";
import { UF_ROWS } from "@/lib/data/reference";
import type { PlacarUf } from "@/lib/data/types";
import { BASE_DO_PERCENTUAL, FORA_DA_BASE, dadosDoMapa, descricaoUf, fraseSim, nivelDoEstado, textoPct, totalDoMapa } from "@/lib/mapa-votos";

// Mapa oficial do Brasil (malhas IBGE, 886 × 827) em que cada estado enche, de baixo para cima, até a parte de votos Sim
// entre os votos registrados nele. Componente de SERVIDOR: os caminhos de mapa-br.json (~95 KB) ficam fora do bundle do cliente.
// Só tinta e papel (nunca --agora/--vida), sem animação, raio 0, sem sombra e sem bolhas. Voto não é cor: o que enche é uma
// quantidade e cada estado traz o número escrito. Cada estado é um <Link>: funciona sem JS. A lista de estados ao lado é a
// equivalente acessível e a rota de toque (alvos de 44 px não cabem num mapa).
const M = mapa as unknown as {
  w: number;
  h: number;
  paths: Record<string, string>;
  /** [x, y, w, h, etiqueta fora do mapa (com linha)?, x do ponto no mapa, y do ponto no mapa] */
  lab: Record<string, [number, number, number, number, number, number, number]>;
};

const NOME = Object.fromEntries(UF_ROWS.map((r) => [r[1], r[2]])) as Record<string, string>;
const UFS_DO_MAPA = Object.keys(M.paths);

export function MapaVotos({ eventoId, placar, ufsComLink, ufSelecionada }: { eventoId: string; placar: readonly PlacarUf[]; ufsComLink: readonly string[]; ufSelecionada: string | null }) {
  const dados = dadosDoMapa(placar, UFS_DO_MAPA);
  const total = totalDoMapa(dados);
  const comLink = new Set(ufsComLink);

  return (
    <figure className="sv-mv" data-mapa-votos>
      <svg viewBox={`0 0 ${M.w} ${M.h}`} role="group" aria-label="Mapa do Brasil por estado: parte dos votos Sim entre os votos registrados. A lista de estados abaixo traz os mesmos estados." focusable="false">
        <defs>
          {dados.map((d) => (
            <linearGradient key={d.uf} id={`mv-g-${d.uf}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s1" />
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s0" />
            </linearGradient>
          ))}
        </defs>
        {/* camada 1: o desenho. Estado sem voto registrado fica vazio e com contorno tracejado (forma, não cor) */}
        <g aria-hidden="true">
          {dados.map((d) => (
            <path key={d.uf} d={M.paths[d.uf]} fill={`url(#mv-g-${d.uf})`} className={d.pct === null ? "sv-mv__pt is-sem" : "sv-mv__pt"} />
          ))}
        </g>
        {/* camada 2: um link por estado, em ordem alfabética de sigla (a mesma da lista), com área clicável, etiqueta e descrição */}
        {dados.map((d) => {
          const l = M.lab[d.uf];
          const nome = NOME[d.uf] ?? d.uf;
          const linka = comLink.has(d.uf);
          const sel = d.uf === ufSelecionada;
          const fora = !!l?.[4];
          const cx = l ? l[0] + l[2] / 2 : 0;
          const cy = l ? l[1] + l[3] / 2 : 0;
          const pw = fora ? l![2] : 48;
          const ph = 36;
          const px = fora ? l![0] : cx - pw / 2;
          const py = cy - ph / 2;
          const conteudo = (
            <>
              <desc id={`mv-d-${d.uf}`}>{descricaoUf(nome, d, linka)}</desc>
              <path d={M.paths[d.uf]} className="sv-mv__hit" />
              {l && fora && <path d={`M${l[5]} ${l[6]}L${l[0] > l[5] ? l[0] : l[0] + l[2]} ${cy}`} className="sv-mv__ld" />}
              {l && (
                <>
                  <rect x={px} y={py} width={pw} height={ph} className="sv-mv__pl" />
                  {fora ? (
                    <>
                      <text x={px + 8} y={cy + 5} className="sv-mv__uf">
                        {d.uf}
                      </text>
                      <text x={px + 34} y={cy + 6} className="sv-mv__pc">
                        {textoPct(d)}
                      </text>
                    </>
                  ) : (
                    <>
                      <text x={cx} y={cy - 3} textAnchor="middle" className="sv-mv__uf">
                        {d.uf}
                      </text>
                      <text x={cx} y={cy + 13} textAnchor="middle" className="sv-mv__pc">
                        {textoPct(d)}
                      </text>
                    </>
                  )}
                </>
              )}
            </>
          );
          return linka ? (
            <Link key={d.uf} href={`/votacao/${eventoId}?uf=${d.uf}#vt-3`} aria-describedby={`mv-d-${d.uf}`} aria-current={sel ? "page" : undefined} className={sel ? "sv-mv__a is-sel" : "sv-mv__a"} data-uf={d.uf}>
              {conteudo}
            </Link>
          ) : (
            <g key={d.uf} role="group" aria-label={`${d.uf} ${textoPct(d)}`} aria-describedby={`mv-d-${d.uf}`} className="sv-mv__a is-solo" data-uf={d.uf}>
              {conteudo}
            </g>
          );
        })}
      </svg>
      <figcaption className="sv-mv__leg">
        <p className="sv-t sv-mv__tot" data-mapa-total>
          {total.base > 0 ? `No conjunto dos estados: ${fraseSim(total)} votaram Sim (${textoPct(total)}).` : "Nenhum voto Sim, Não ou abstenção registrado nos estados desta votação."}
        </p>
        <p className="sv-t" data-mapa-base>
          Base do percentual: {BASE_DO_PERCENTUAL} O estado enche até esse percentual. {FORA_DA_BASE}
        </p>
        <p className="sv-t">Estado com contorno tracejado e “–”: sem voto Sim, Não ou abstenção registrado. Em tela pequena os estados ficam miúdos: use a lista de estados abaixo.</p>
      </figcaption>
    </figure>
  );
}
