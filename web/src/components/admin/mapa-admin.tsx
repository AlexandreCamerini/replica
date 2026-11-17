"use client";

// Mapa da central de administração (Parte C). Lógica de carga e desenho copiada do mapa público, sem importá-lo.
// Só as malhas do próprio repositório (/geo), por caminho relativo ao site. Sem bolha, sem alfinete, sem agrupamento flutuante:
// o território carrega a contagem pelo preenchimento em uma cor (--tint, faixas de opacidade); o estado vai por padrão + palavra, em camada separada (sobreposição com tamanho fixo em px de tela).
// O número é escrito na lista ao lado; o 0 também é escrito sobre o território (no mapa do país), distinto do "vazio" (fichas sem tentativa = contorno reforçado).
// Navegação por link: descer para a UF e abrir o município são <a href>; Esc volta um nível.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatarContagem } from "../../lib/admin/agregacao.ts";
import { nomeDaUf } from "../../lib/admin/rotulos.ts";
import {
  LADO_HACHURA_PX,
  LADO_PONTILHADO_PX,
  OPACIDADE_FAIXA,
  apresentar,
  centroDoCaminho,
  escalaDoDesenho,
  estadoVazio,
  faixaDeContagem,
  legenda,
  type EstadoTerritorio,
  type Faixa,
  type Padrao,
  type Visao,
} from "./mapa-escala.ts";
import "../../styles/admin.css";

type Forma = { ibge: string; name: string; d: string; uf?: string };
type Malha = { viewBox: string; items: Forma[]; uf?: string; name?: string };

export type NivelMapa = { tipo: "pais" } | { tipo: "uf"; uf: string };
export type ContagemTerritorio = { total: number; estado: EstadoTerritorio };

export type MapaAdminProps = {
  nivel: NivelMapa; // no nível "uf", `uf` é o código IBGE de 2 dígitos (arquivo /geo/uf/{ibge}.json)
  contagens: ReadonlyMap<string, ContagemTerritorio>; // chave: ibge da UF (país) ou do município (UF)
  semMunicipio?: number; // ficha de UF (Assembleia, mandato estadual): só no nível "uf"
  semTerritorio: number; // fichas sem ponto no mapa: vão para a lista
  hrefRegistros: string; // destino de "Ver registros" (equivalente acessível do mapa)
  visao: Visao;
  hrefTerritorio: (ibge: string) => string;
  hrefVoltar: string;
  selecionado?: string;
};

const cache = new Map<string, Promise<Malha>>();
function carregar(url: string): Promise<Malha> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

type Estado = { url: string; malha?: Malha; erro?: boolean };

export function MapaAdmin(props: MapaAdminProps) {
  const { nivel, contagens, semMunicipio, semTerritorio, hrefRegistros, visao, hrefTerritorio, hrefVoltar, selecionado } = props;
  const router = useRouter();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ufIbge = nivel.tipo === "uf" ? nivel.uf : null;
  const urlValida = nivel.tipo === "pais" || /^\d{2}$/.test(nivel.uf);
  const url = nivel.tipo === "pais" ? "/geo/br.json" : `/geo/uf/${nivel.uf}.json`;
  const [estado, setEstado] = useState<Estado | null>(null);
  const [busca, setBusca] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [escala, setEscala] = useState(1); // pixels de tela por unidade do desenho: o padrão de estado a compensa

  useEffect(() => {
    if (!urlValida) return;
    let vivo = true;
    carregar(url)
      .then((malha) => vivo && setEstado({ url, malha }))
      .catch(() => vivo && setEstado({ url, erro: true }));
    return () => {
      vivo = false;
    };
  }, [url, urlValida]);

  useEffect(() => {
    if (ufIbge === null) return;
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.key !== "Escape" || alvo?.tagName === "INPUT") return;
      router.push(hrefVoltar);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ufIbge, hrefVoltar, router]);

  const atual = estado && estado.url === url ? estado : null;
  const malha = atual?.malha;
  const falhou = !urlValida || atual?.erro === true;
  const carregando = !falhou && !malha;
  const viewBox = malha?.viewBox ?? null;

  useEffect(() => {
    const el = svgRef.current;
    if (!el || !viewBox) return;
    const medir = () => setEscala(escalaDoDesenho(el.getBoundingClientRect().width, viewBox));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewBox]);

  const max = useMemo(() => {
    let m = 0;
    for (const c of contagens.values()) m = Math.max(m, c.total);
    return m;
  }, [contagens]);
  const leg = useMemo(() => legenda(visao, max), [visao, max]);

  const nomeNivel = nivel.tipo === "pais" ? "Brasil por estado" : `${malha?.name ?? "Estado"} por município`;
  const anuncio = falhou
    ? "Não deu para carregar o mapa. A lista de registros continua disponível."
    : carregando
      ? "Carregando o mapa."
      : `${nomeNivel}: ${malha?.items.length ?? 0} territórios.`;

  const rotuloBusca = nivel.tipo === "pais" ? "Localizar estado" : "Localizar município";
  const irPara = (valor: string) => {
    const n = normalizar(valor);
    const achado = malha?.items.find((i) => normalizar(i.name) === n || (i.uf && normalizar(i.uf) === n));
    if (achado) router.push(hrefTerritorio(achado.ibge));
  };

  const info = (ibge: string) => {
    const c = contagens.get(ibge) ?? { total: 0, estado: estadoVazio(visao) };
    const faixa = faixaDeContagem(c.total);
    return { c, faixa };
  };
  const rotulo = (nome: string, c: ContagemTerritorio) =>
    c.total === 0 ? `${nome}: ${formatarContagem(0)}` : `${nome}: ${formatarContagem(c.total)}, ${apresentar(visao, c.estado).palavra}`;

  // Contagem: preenchimento em --tint, faixa de opacidade (só quando há ficha). Estado: sobreposição de padrão (hachura, pontilhado), sem base, em camada separada.
  // "cheio" e "vazio" não têm sobreposição: o vazio com fichas ganha contorno reforçado (is-vazio); o 0 não ganha nada além do número escrito.
  const fillDaContagem = (faixa: Faixa) => (faixa === 0 ? "none" : "var(--adm-tint)");
  const urlDoPadrao = (padrao: Padrao, legendaDe: boolean) => (padrao === "hachura" || padrao === "pontilhado" ? `url(#${uid}-${padrao}${legendaDe ? "-leg" : ""})` : null);
  const compensacao = `scale(${1 / escala})`;

  const linhas = malha
    ? malha.items
        .map((t) => {
          const { c, faixa } = info(t.ibge);
          const nome = nivel.tipo === "pais" && t.uf ? `${t.name} (${t.uf})` : t.name;
          return { ibge: t.ibge, nome, c, faixa, palavra: apresentar(visao, c.estado).palavra };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    : [];
  const rotuloDaColuna = nivel.tipo === "pais" ? "Estado" : "Município";

  return (
    <section className="admin-central admin-mapa" aria-label={`Mapa da central, visão ${leg.titulo}`}>
      {/* definições dos padrões de estado: ladrilho em px de tela (patternTransform anula o zoom do desenho); o jogo "-leg" é das amostras da legenda, que não têm zoom */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="admin-mapa__defs">
        <defs>
          <pattern id={`${uid}-hachura`} width={LADO_HACHURA_PX} height={LADO_HACHURA_PX} patternUnits="userSpaceOnUse" patternTransform={compensacao}>
            <path d={`M-1 1L1 -1M0 ${LADO_HACHURA_PX}L${LADO_HACHURA_PX} 0M${LADO_HACHURA_PX - 1} ${LADO_HACHURA_PX + 1}L${LADO_HACHURA_PX + 1} ${LADO_HACHURA_PX - 1}`} className="admin-mapa__traco" />
          </pattern>
          <pattern id={`${uid}-pontilhado`} width={LADO_PONTILHADO_PX} height={LADO_PONTILHADO_PX} patternUnits="userSpaceOnUse" patternTransform={compensacao}>
            <rect x="1.8" y="1.8" width="1.4" height="1.4" className="admin-mapa__ponto" />
          </pattern>
          <pattern id={`${uid}-hachura-leg`} width={LADO_HACHURA_PX} height={LADO_HACHURA_PX} patternUnits="userSpaceOnUse">
            <path d={`M-1 1L1 -1M0 ${LADO_HACHURA_PX}L${LADO_HACHURA_PX} 0M${LADO_HACHURA_PX - 1} ${LADO_HACHURA_PX + 1}L${LADO_HACHURA_PX + 1} ${LADO_HACHURA_PX - 1}`} className="admin-mapa__traco" />
          </pattern>
          <pattern id={`${uid}-pontilhado-leg`} width={LADO_PONTILHADO_PX} height={LADO_PONTILHADO_PX} patternUnits="userSpaceOnUse">
            <rect x="1.8" y="1.8" width="1.4" height="1.4" className="admin-mapa__ponto" />
          </pattern>
        </defs>
      </svg>

      <div className="admin-mapa__topo">
        <p className="admin-mapa__nivel">{nomeNivel}</p>
        {nivel.tipo === "uf" && (
          <Link href={hrefVoltar} className="admin-mapa__voltar">
            Voltar ao Brasil (Esc)
          </Link>
        )}
        <label className="admin-mapa__busca">
          <span>{rotuloBusca}</span>
          <input
            type="text"
            list={`${uid}-nomes`}
            value={busca}
            disabled={!malha}
            autoComplete="off"
            onChange={(e) => {
              setBusca(e.target.value);
              irPara(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && irPara(busca)}
          />
          <datalist id={`${uid}-nomes`}>
            {malha?.items.map((i) => (
              <option key={i.ibge} value={i.name} />
            ))}
          </datalist>
        </label>
      </div>

      <p aria-live="polite" className="admin-mapa__anuncio">
        {anuncio}
      </p>

      <div className="admin-mapa__corpo">
        <div className="admin-mapa__quadro">
          {carregando && <div className="admin-mapa__espera" aria-hidden="true" />}
          {falhou && (
            <div role="alert" className="admin-mapa__erro">
              <p>Não deu para carregar a malha do mapa. As contagens continuam na lista abaixo e em Ver registros.</p>
              <ul>
                {[...contagens.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([ibge, c]) => (
                    <li key={ibge}>
                      <Link href={hrefTerritorio(ibge)}>{rotulo(nivel.tipo === "pais" ? nomeDaUf(ibge) : `Município ${ibge}`, c)}</Link>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {malha && (
            <svg ref={svgRef} viewBox={malha.viewBox} role="group" aria-label={nomeNivel} className="admin-mapa__svg">
              {malha.items.map((t) => {
                const { c, faixa } = info(t.ibge);
                const ap = apresentar(visao, c.estado);
                const padrao = ap.padrao;
                const nome = nivel.tipo === "pais" && t.uf ? `${t.uf}: ${t.name}` : t.name;
                const texto = rotulo(nome, c);
                const destaque = c.total > 0 && ap.destaque;
                const vazio = c.total > 0 && padrao === "vazio";
                const sobreposicao = c.total > 0 ? urlDoPadrao(padrao, false) : null;
                return (
                  <Link
                    key={t.ibge}
                    href={hrefTerritorio(t.ibge)}
                    aria-label={texto}
                    aria-current={selecionado === t.ibge ? "true" : undefined}
                    data-faixa={faixa}
                    data-padrao={c.total === 0 ? "vazio" : padrao}
                    className="admin-mapa__t"
                  >
                    <title>{texto}</title>
                    <path
                      d={t.d}
                      className={`admin-mapa__forma${destaque ? " is-destaque" : ""}${vazio ? " is-vazio" : ""}${c.total === 0 ? " is-zero" : ""}`}
                      style={{ fill: fillDaContagem(faixa), fillOpacity: OPACIDADE_FAIXA[faixa] }}
                      vectorEffect="non-scaling-stroke"
                    />
                    {sobreposicao && <path d={t.d} className="admin-mapa__estado" style={{ fill: sobreposicao }} />}
                  </Link>
                );
              })}
              {nivel.tipo === "pais" && (
                <g aria-hidden="true" className="admin-mapa__zeros">
                  {malha.items.map((t) => {
                    if (info(t.ibge).c.total !== 0) return null;
                    const centro = centroDoCaminho(t.d);
                    return centro ? (
                      <text key={t.ibge} x={centro.x} y={centro.y} fontSize={12 / escala} strokeWidth={3 / escala} textAnchor="middle" dominantBaseline="central" className="admin-mapa__zero">
                        0
                      </text>
                    ) : null;
                  })}
                </g>
              )}
            </svg>
          )}
        </div>

        <aside className="admin-mapa__lado">
          <ul className="admin-mapa__fora">
            {nivel.tipo === "uf" && (
              <li>
                da UF, sem município: <strong>{formatarContagem(semMunicipio ?? 0)}</strong>
              </li>
            )}
            <li>
              sem território no mapa: <strong>{formatarContagem(semTerritorio)}</strong>{" "}
              <Link href={hrefRegistros}>(ver registros)</Link>
            </li>
          </ul>

          <div className="admin-mapa__legenda plate">
            <h3>Legenda: {leg.titulo}</h3>
            <p>{leg.explicacao}</p>
            <h4>Quantidade (mesma cor, mais forte = mais fichas)</h4>
            <ul>
              {leg.faixas.map((f) => (
                <li key={f.faixa}>
                  <svg width="22" height="14" aria-hidden="true" className="admin-mapa__amostra">
                    <rect width="22" height="14" style={{ fill: fillDaContagem(f.faixa), fillOpacity: OPACIDADE_FAIXA[f.faixa] }} />
                    {f.faixa === 0 && (
                      <text x="11" y="7" fontSize="11" textAnchor="middle" dominantBaseline="central" className="admin-mapa__zero">
                        0
                      </text>
                    )}
                  </svg>
                  {f.rotulo}
                  {f.faixa === 0 ? ": sem preenchimento, com o 0 escrito" : ""}
                </li>
              ))}
            </ul>
            <h4>Estado (padrão e palavra)</h4>
            <ul>
              {leg.estados.map((e) => (
                <li key={e.estado}>
                  <svg width="22" height="14" aria-hidden="true" className="admin-mapa__amostra">
                    <rect width="22" height="14" className={e.padrao === "vazio" ? "is-vazio" : e.destaque ? "is-destaque" : undefined} style={{ fill: fillDaContagem(2), fillOpacity: OPACIDADE_FAIXA[2] }} />
                    {urlDoPadrao(e.padrao, true) && <rect width="22" height="14" className={e.destaque ? "is-destaque" : undefined} style={{ fill: urlDoPadrao(e.padrao, true) ?? "none" }} />}
                  </svg>
                  {e.palavra} ({e.padrao === "vazio" ? "contorno reforçado, sem sobreposição" : e.padrao}){e.destaque ? ", em destaque" : ""}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {malha && (
        <div className="adm-rolagem admin-mapa__lista" tabIndex={0} role="region" aria-label={`Lista de fichas por ${nivel.tipo === "pais" ? "estado" : "município"}`}>
          <table className="adm-tabela">
            <caption>Fichas por {nivel.tipo === "pais" ? "estado" : "município"}, com o número escrito</caption>
            <thead>
              <tr>
                <th scope="col">{rotuloDaColuna}</th>
                <th scope="col" className="adm-num">
                  Fichas
                </th>
                <th scope="col">{leg.titulo === "Coleta" ? "Última tentativa" : "Revisão"}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.ibge} data-faixa={l.faixa}>
                  <th scope="row">
                    <Link href={hrefTerritorio(l.ibge)}>{l.nome}</Link>
                  </th>
                  <td className="adm-num">{l.c.total}</td>
                  <td>{l.c.total === 0 ? "sem ficha" : l.palavra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-mapa__fonte">Malhas: IBGE (CC BY 4.0). Território sem ponto definido aparece só na lista.</p>
    </section>
  );
}
