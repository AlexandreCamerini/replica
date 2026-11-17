"use client";

// Mapa da central de administração (Parte C). Lógica de carga e desenho copiada do mapa público, sem importá-lo.
// Só as malhas do próprio repositório (/geo), por caminho relativo ao site. Sem bolha, sem alfinete, sem agrupamento flutuante:
// o território carrega a contagem pelo preenchimento em uma cor (--tint); o estado vai por padrão + palavra.
// Navegação por link: descer para a UF e abrir o município são <a href>; Esc volta um nível.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { formatarContagem } from "../../lib/admin/agregacao.ts";
import {
  FAIXAS,
  OPACIDADE_FAIXA,
  apresentar,
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

  const fillDe = (padrao: Padrao, faixa: Faixa) =>
    faixa === 0 || padrao === "vazio" ? "none" : padrao === "cheio" ? "var(--tint, #9a9d9b)" : `url(#${uid}-${padrao}-${faixa})`;
  const opacidadeDe = (padrao: Padrao, faixa: Faixa) => (padrao === "cheio" ? OPACIDADE_FAIXA[faixa] : 1);

  return (
    <section className="admin-central admin-mapa" aria-label={`Mapa da central, visão ${leg.titulo}`}>
      {/* definições dos padrões: um <pattern> por padrão e faixa, na cor do tema (--tint, --text) */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="admin-mapa__defs">
        <defs>
          {FAIXAS.filter((f) => f > 0).map((f) => (
            <g key={f}>
              <pattern id={`${uid}-hachura-${f}`} width="6" height="6" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" className="admin-mapa__base" style={{ opacity: OPACIDADE_FAIXA[f] * 0.6 }} />
                <path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" className="admin-mapa__traco" />
              </pattern>
              <pattern id={`${uid}-pontilhado-${f}`} width="5" height="5" patternUnits="userSpaceOnUse">
                <rect width="5" height="5" className="admin-mapa__base" style={{ opacity: OPACIDADE_FAIXA[f] * 0.6 }} />
                <rect x="1.8" y="1.8" width="1.4" height="1.4" className="admin-mapa__ponto" />
              </pattern>
            </g>
          ))}
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
                      <Link href={hrefTerritorio(ibge)}>{rotulo(`Território ${ibge}`, c)}</Link>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {malha && (
            <svg viewBox={malha.viewBox} role="group" aria-label={nomeNivel} className="admin-mapa__svg">
              {malha.items.map((t) => {
                const { c, faixa } = info(t.ibge);
                const ap = apresentar(visao, c.estado);
                const padrao = ap.padrao;
                const nome = nivel.tipo === "pais" && t.uf ? `${t.uf}: ${t.name}` : t.name;
                const texto = rotulo(nome, c);
                const destaque = c.total > 0 && ap.destaque;
                const vazio = c.total > 0 && padrao === "vazio";
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
                      className={`admin-mapa__forma${destaque ? " is-destaque" : ""}${vazio ? " is-vazio" : ""}`}
                      style={{ fill: fillDe(padrao, faixa), fillOpacity: opacidadeDe(padrao, faixa) }}
                      vectorEffect="non-scaling-stroke"
                    />
                  </Link>
                );
              })}
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
                    <rect width="22" height="14" style={{ fill: fillDe("cheio", f.faixa), fillOpacity: OPACIDADE_FAIXA[f.faixa] }} />
                  </svg>
                  {f.rotulo}
                </li>
              ))}
            </ul>
            <h4>Estado (padrão e palavra)</h4>
            <ul>
              {leg.estados.map((e) => (
                <li key={e.estado}>
                  <svg width="22" height="14" aria-hidden="true" className="admin-mapa__amostra">
                    <rect
                      width="22"
                      height="14"
                      className={e.destaque ? "is-destaque" : undefined}
                      style={{ fill: fillDe(e.padrao, 3), fillOpacity: opacidadeDe(e.padrao, 3) }}
                    />
                  </svg>
                  {e.palavra} ({e.padrao}){e.destaque ? ", em destaque" : ""}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      <p className="admin-mapa__fonte">Malhas: IBGE (CC BY 4.0). Território sem ponto definido aparece só na lista.</p>
    </section>
  );
}
