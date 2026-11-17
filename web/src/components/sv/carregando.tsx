"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { trocaDePagina } from "./carregando-regra";

// Estado de carregamento da Direção 2 (D330). É melhoria no cliente: toda página chega inteira do servidor e funciona sem
// JavaScript. O que o Next oferece para isso (loading.tsx, Suspense) foi testado e descartado: ele envia o conteúdo
// escondido e depende de script para mostrá-lo; sem JavaScript a página ficaria presa em "Carregando".
// Texto, sem cor nova e sem animação. `role="status"`: o leitor de tela anuncia sem tirar o foco de onde está.

/** Espera antes de avisar: troca de página rápida não pisca aviso. */
const ESPERA_MS = 300;
/** Depois disto, o aviso diz que está demorando. */
const DEMORA_MS = 8000;
/** Teto: o aviso some sozinho (link que baixa arquivo, navegação que o navegador desistiu). */
const TETO_MS = 30000;

type Fase = null | "carregando" | "demorando";

/**
 * Aviso de troca de página: aparece depois de um clique num link para outro endereço do site (ou do envio de um formulário
 * de busca) e some quando o endereço muda. Fica uma vez na página, no casco. Vazio, não aparece nem ocupa lugar.
 */
export function AvisoDeCarregamento() {
  const caminho = usePathname();
  const busca = useSearchParams();
  const [fase, setFase] = useState<Fase>(null);
  const relogios = useRef<ReturnType<typeof setTimeout>[]>([]);

  const parar = useCallback(() => {
    relogios.current.forEach(clearTimeout);
    relogios.current = [];
    setFase(null);
  }, []);
  const comecar = useCallback(() => {
    relogios.current.forEach(clearTimeout);
    relogios.current = [setTimeout(() => setFase("carregando"), ESPERA_MS), setTimeout(() => setFase("demorando"), DEMORA_MS), setTimeout(parar, TETO_MS)];
  }, [parar]);

  // chegou: o endereço mudou
  useEffect(parar, [caminho, busca, parar]);

  useEffect(() => {
    const aoClicar = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      if (trocaDePagina({ href: a.href, atual: window.location.href, target: a.target, download: a.hasAttribute("download"), botao: e.button, comTecla: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey })) comecar();
    };
    // Formulário de busca (method=get): o navegador troca de página; o de envio (server action) tem o próprio aviso, no
    // formulário. O ouvinte fica na janela, o último da fila: se outro código cancelou o envio, não há o que avisar.
    const aoEnviar = (e: SubmitEvent) => {
      const f = e.target;
      if (f instanceof HTMLFormElement && f.method.toLowerCase() === "get" && !e.defaultPrevented) comecar();
    };
    // voltou pelo histórico com a página guardada pelo navegador: nada está carregando
    const aoMostrar = () => parar();
    // na captura: o link do Next cancela o clique para trocar a página sem recarregar, e isso não é desistir da navegação
    document.addEventListener("click", aoClicar, true);
    window.addEventListener("submit", aoEnviar);
    window.addEventListener("pageshow", aoMostrar);
    return () => {
      document.removeEventListener("click", aoClicar, true);
      window.removeEventListener("submit", aoEnviar);
      window.removeEventListener("pageshow", aoMostrar);
      parar();
    };
  }, [comecar, parar]);

  return (
    <p className="sv-carga" role="status">
      {fase === "carregando" ? "Carregando a página…" : fase === "demorando" ? "Ainda carregando. Não é preciso clicar de novo." : ""}
    </p>
  );
}

/**
 * Aviso de envio, dentro de um formulário que grava uma escolha (estado, cidade, pessoa marcada): enquanto o servidor
 * responde, diz "Guardando…". Sem JavaScript o formulário é enviado pelo navegador, que mostra o próprio carregamento.
 */
export function AvisoDeEnvio({ texto = "Guardando…" }: { texto?: string }) {
  const { pending } = useFormStatus();
  return (
    <span className="sv-envio" role="status">
      {pending ? texto : ""}
    </span>
  );
}
