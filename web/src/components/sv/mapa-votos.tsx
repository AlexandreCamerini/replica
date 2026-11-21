import mapa from "@/data/mapa-br.json";
import { UF_ROWS } from "@/lib/data/reference";
import type { PlacarUf } from "@/lib/data/types";
import { BASE_DO_PERCENTUAL, FORA_DA_BASE_A, FORA_DA_BASE_B, dadosDoMapa, descricaoUf, fraseSim, nivelDoEstado, textoPct, totalDoMapa } from "@/lib/mapa-votos";

// Mapa oficial do Brasil (malhas IBGE, 886 × 827) em que cada estado enche, de baixo para cima, até a parte de votos Sim
// entre os votos registrados nele. Componente de SERVIDOR: os caminhos de mapa-br.json (~95 KB) ficam fora do bundle do cliente.
// Só tinta e papel (nunca --agora/--vida), sem animação, raio 0, sem sombra e sem bolhas. Voto não é cor: o que enche é uma
// quantidade e cada estado traz o número escrito. O mapa é só leitura visual (aria-hidden, sem links):
// alvos de 44 px não cabem num mapa (aceite D2). A rota de toque e de teclado é a lista de estados (links de 44 px) e o leitor de
// tela recebe a tabela "Números por estado" (visualmente oculta), com a mesma base. Tudo vem do servidor: funciona sem JS.
const M = mapa as unknown as {
  w: number;
  h: number;
  paths: Record<string, string>;
  /** [x, y, w, h, etiqueta fora do mapa (com linha)?, x do ponto no mapa, y do ponto no mapa] */
  lab: Record<string, [number, number, number, number, number, number, number]>;
};

const NOME = Object.fromEntries(UF_ROWS.map((r) => [r[1], r[2]])) as Record<string, string>;
const UFS_DO_MAPA = Object.keys(M.paths);

export function MapaVotos({ placar, ufSelecionada }: { placar: readonly PlacarUf[]; ufSelecionada: string | null }) {
  const dados = dadosDoMapa(placar, UFS_DO_MAPA);
  const total = totalDoMapa(dados);

  return (
    <figure className="sv-mv" data-mapa-votos>
      <svg viewBox={`0 0 ${M.w} ${M.h}`} aria-hidden="true" focusable="false">
        <defs>
          {dados.map((d) => (
            <linearGradient key={d.uf} id={`mv-g-${d.uf}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s1" />
              <stop offset={`${nivelDoEstado(d)}%`} className="sv-mv__s0" />
            </linearGradient>
          ))}
        </defs>
        {/* o desenho: estado sem voto registrado fica vazio e com contorno tracejado (forma, não cor) */}
        {dados.map((d) => (
          <path key={d.uf} d={M.paths[d.uf]} fill={`url(#mv-g-${d.uf})`} className={d.pct === null ? "sv-mv__pt is-sem" : "sv-mv__pt"} />
        ))}
        {/* fio de papel por cima do contorno dos estados cheios: a fronteira entre dois estados cheios não some */}
        {dados.map((d) => (nivelDoEstado(d) > 0 ? <path key={`f-${d.uf}`} d={M.paths[d.uf]} className="sv-mv__fio" /> : null))}
        {dados.map((d) => {
          const l = M.lab[d.uf];
          if (!l) return null;
          const fora = !!l[4];
          const cx = l[0] + l[2] / 2;
          const cy = l[1] + l[3] / 2;
          const pw = fora ? l[2] : 48;
          const ph = 36;
          const px = fora ? l[0] : cx - pw / 2;
          const sel = d.uf === ufSelecionada;
          return (
            <g key={d.uf} data-uf={d.uf} className={sel ? "sv-mv__e is-sel" : "sv-mv__e"}>
              {fora && <path d={`M${l[5]} ${l[6]}L${l[0] > l[5] ? l[0] : l[0] + l[2]} ${cy}`} className="sv-mv__ld" />}
              <rect x={px} y={cy - ph / 2} width={pw} height={ph} className="sv-mv__pl" />
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
            </g>
          );
        })}
      </svg>
      <figcaption className="sv-mv__leg">
        <p className="sv-t sv-mv__tot" data-mapa-total>
          {total.base > 0 ? `No conjunto dos estados: ${fraseSim(total)} votaram Sim (${textoPct(total)}).` : "Nenhum voto Sim, Não ou abstenção registrado nos estados desta votação."}
        </p>
        <p className="sv-t" data-mapa-base>
          Base do percentual: {BASE_DO_PERCENTUAL} O estado enche até esse percentual, de baixo para cima. {FORA_DA_BASE_A} {FORA_DA_BASE_B}
        </p>
        <p className="sv-t">Estado com contorno tracejado e “–”: sem voto Sim, Não ou abstenção registrado. Para ver os votos de um estado, use a lista de estados abaixo.</p>
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
