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
    const padrao = painel.dataset.padrao ?? "";
    // o rótulo da UF (camada de cima) inverte junto com o foco ou o mouse no desenho dela
    const marcar = (uf: string | null) => {
      fig.querySelectorAll(".sv-mv__pa.is-on").forEach((x) => x.classList.remove("is-on"));
      if (uf) fig.querySelector(`.sv-mv__pa[data-uf-plaque="${uf}"]`)?.classList.add("is-on");
    };
    const mostrar = (txt: string, foco: boolean) => {
      // foco por Tab: o leitor de tela já lê o nome do link; o painel não repete (aria-live só para mouse e toque)
      painel.setAttribute("aria-live", foco ? "off" : "polite");
      if (painel.textContent !== txt) painel.textContent = txt;
    };
    const daUf = (e: Event) => (e.target as Element | null)?.closest?.("a[data-txt]") as HTMLElement | null;
    const entra = (foco: boolean) => (e: Event) => {
      const a = daUf(e);
      if (a?.dataset.txt) {
        mostrar(a.dataset.txt, foco);
        marcar(a.dataset.ufLink ?? a.dataset.ufPlaque ?? null);
      }
    };
    const sai = (e: Event) => {
      const para = (e as MouseEvent | FocusEvent).relatedTarget as Element | null;
      if (para?.closest?.("a[data-txt]")) return;
      mostrar(padrao, true);
      marcar(null);
    };
    const over = entra(false);
    const focoIn = entra(true);
    fig.addEventListener("mouseover", over);
    fig.addEventListener("focusin", focoIn);
    fig.addEventListener("mouseout", sai);
    fig.addEventListener("focusout", sai);
    return () => {
      fig.removeEventListener("mouseover", over);
      fig.removeEventListener("focusin", focoIn);
      fig.removeEventListener("mouseout", sai);
      fig.removeEventListener("focusout", sai);
    };
  }, []);
  return <span hidden ref={marca} />;
}
