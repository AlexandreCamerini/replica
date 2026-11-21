"use client";
import { useEffect, useRef } from "react";

// Ilha cliente mínima do mapa de votos: só copia para o painel de leitura o texto que o servidor já pôs em `data-txt` de
// cada link da UF. Não recebe o mapa, os caminhos nem os números por props. Sem JS o mapa e os links continuam valendo.
export function MapaPainel() {
  const marca = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const fig = marca.current?.closest<HTMLElement>("[data-mapa-votos]");
    const painel = fig?.querySelector<HTMLElement>("[data-mapa-painel]");
    if (!fig || !painel) return;
    // o rótulo da UF (camada de cima) inverte junto com o foco ou o mouse no desenho dela
    const marcar = (uf: string | null) => {
      fig.querySelectorAll(".sv-mv__pa.is-on").forEach((x) => x.classList.remove("is-on"));
      if (uf) fig.querySelector(`.sv-mv__pa[data-uf-plaque="${uf}"]`)?.classList.add("is-on");
    };
    const mostrar = (txt: string) => {
      if (painel.textContent !== txt) painel.textContent = txt;
    };
    const daUf = (e: Event) => (e.target as Element | null)?.closest?.("a[data-txt]") as HTMLElement | null;
    const entra = (e: Event) => {
      const a = daUf(e);
      if (a?.dataset.txt) {
        mostrar(a.dataset.txt);
        marcar(a.dataset.ufLink ?? a.dataset.ufPlaque ?? null);
      }
    };
    const sai = (e: Event) => {
      const para = (e as MouseEvent | FocusEvent).relatedTarget as Element | null;
      if (para?.closest?.("a[data-txt]")) return;
      // o padrão é lido na hora: a navegação com ?uf= troca o texto sem remontar a ilha. Com foco de teclado ainda numa UF, volta a ela.
      const foco = document.activeElement?.closest?.("a[data-txt]") as HTMLElement | null;
      if (foco && fig.contains(foco) && foco.dataset.txt) {
        mostrar(foco.dataset.txt);
        marcar(foco.dataset.ufLink ?? null);
        return;
      }
      mostrar(painel.dataset.padrao ?? "");
      marcar(null);
    };
        fig.addEventListener("mouseover", entra);
    fig.addEventListener("focusin", entra);
    fig.addEventListener("mouseout", sai);
    fig.addEventListener("focusout", sai);
    return () => {
      fig.removeEventListener("mouseover", entra);
      fig.removeEventListener("focusin", entra);
      fig.removeEventListener("mouseout", sai);
      fig.removeEventListener("focusout", sai);
    };
  }, []);
  return <span hidden ref={marca} />;
}
