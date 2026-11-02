"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { UfTileMap } from "./uf-tile-map";

type Shape = { ibge: string; name: string; d: string; uf?: string; region?: string };
type Layer = { viewBox: string; items: Shape[]; uf?: string; name?: string };

// Cor = região (categórica, igual à grade). Nunca partido, nunca dado.
const REGION_FILL: Record<string, string> = {
  Norte: "var(--region-norte)",
  Nordeste: "var(--region-nordeste)",
  Sudeste: "var(--region-sudeste)",
  Sul: "var(--region-sul)",
  "Centro-Oeste": "var(--region-centro-oeste)",
};

const cache = new Map<string, Promise<Layer>>();
function load(url: string): Promise<Layer> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/**
 * Mapa com contorno oficial (malhas IBGE). Brasil por UF → toque na UF → municípios → toque abre a lista de quem representa.
 * Sem JS, cada forma é um link comum. Esc volta um nível. Se a malha não carregar, cai para a grade por UF.
 */
export function BrazilMap() {
  const [br, setBr] = useState<Layer | null>(null);
  const [uf, setUf] = useState<{ ibge: string; layer: Layer | null } | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const backRef = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load("/geo/br.json")
      .then((l) => {
        setBr(l);
        // ?mapa=SP abre direto no estado (link "Ver no mapa" da lista de representantes); lido no cliente para a home seguir estática
        const initialUf = new URLSearchParams(window.location.search).get("mapa");
        const start = initialUf && l.items.find((i) => i.uf === initialUf.toUpperCase());
        if (start) openUf(start.ibge, start.name);
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openUf = useCallback((ibge: string, name: string) => {
    setUf({ ibge, layer: null });
    setStatus(`Carregando os municípios de ${name}`);
    load(`/geo/uf/${ibge}.json`)
      .then((layer) => {
        setUf({ ibge, layer });
        setStatus(`${name}: ${layer.items.length} municípios. Escolha um para ver quem representa.`);
        requestAnimationFrame(() => backRef.current?.focus());
      })
      .catch(() => {
        setUf(null);
        setStatus(`Não deu para carregar o mapa de ${name}. Use a lista de estados.`);
      });
  }, []);

  const back = useCallback(() => {
    const name = uf?.layer?.name;
    setUf(null);
    setStatus("Mapa do Brasil por estado.");
    requestAnimationFrame(() => {
      const a = mapRef.current?.querySelector<HTMLAnchorElement>(`a[data-name="${name}"]`);
      a?.focus();
    });
  }, [uf]);

  useEffect(() => {
    if (!uf) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [uf, back]);

  if (error) return <UfTileMap />;
  const layer = uf?.layer ?? (uf ? null : br);

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex min-h-10 items-center gap-2">
        {uf ? (
          <>
            <button
              ref={backRef}
              type="button"
              onClick={back}
              className="inline-flex h-9 items-center gap-1.5 rounded-pill border-[1.5px] border-border-input bg-surface px-3 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <ArrowLeft aria-hidden className="size-4" /> Brasil
            </button>
            {uf.layer && (
              <>
                <span className="text-sm font-semibold text-fg">{uf.layer.name}</span>
                <Link href={`/representantes?uf=${uf.layer.uf}`} className="ml-auto text-sm font-semibold text-accent-text underline underline-offset-2">
                  Estado inteiro
                </Link>
              </>
            )}
          </>
        ) : (
          <span className="text-sm text-muted">Toque num estado para ver os municípios.</span>
        )}
      </div>
      <a
        href="#depois-do-mapa"
        className="sr-only focus:not-sr-only focus:w-fit focus:rounded-sm focus:bg-surface-inverse focus:px-3 focus:py-1 focus:text-on-inverse"
      >
        Pular o mapa
      </a>
      <div ref={mapRef} className="relative w-full max-w-xl">
        {!layer ? (
          <div className="skeleton aspect-square w-full" aria-hidden />
        ) : (
          <svg viewBox={layer.viewBox} className="h-auto w-full" role="group" aria-label={uf ? `Municípios de ${layer.name}` : "Estados do Brasil"}>
            {layer.items.map((s) => {
              const href = uf ? `/representantes?cidade=${s.ibge}` : `/representantes?uf=${s.uf}`;
              const label = uf ? s.name : `${s.uf}: ${s.name}`;
              return (
                <a
                  key={s.ibge}
                  href={href}
                  aria-label={label}
                  data-name={s.name}
                  className="group outline-none"
                  onClick={(e) => {
                    if (uf || e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    openUf(s.ibge, s.name);
                  }}
                >
                  <title>{label}</title>
                  <path
                    d={s.d}
                    style={{ fill: uf ? "var(--surface-sunken)" : REGION_FILL[s.region ?? ""] ?? "var(--surface-sunken)" }}
                    className="stroke-[var(--surface)] [stroke-width:1.2] transition-[filter] group-hover:brightness-90 group-focus-visible:[stroke-width:3] group-focus-visible:stroke-[var(--focus)]"
                    vectorEffect="non-scaling-stroke"
                  />
                </a>
              );
            })}
          </svg>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
      <figcaption className="text-xs text-muted">
        {uf ? "Esc volta para o Brasil. " : "Cores indicam a região, só para orientação. "}
        Malhas: IBGE (CC BY 4.0).
      </figcaption>
      <span id="depois-do-mapa" tabIndex={-1} />
    </figure>
  );
}
