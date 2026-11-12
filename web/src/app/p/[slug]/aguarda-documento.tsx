"use client";

import { use } from "react";

// BUG-008: o React vendorizado pelo Next 15.5 (19.2.0-canary-0bdb9206-20250818) erra o cursor de hidratação quando um
// elemento HTML suspende porque um filho ainda não chegou no stream RSC (referência "$L…"; o Flight adia todo elemento
// depois de 3.200 bytes de linha) e é reexecutado: ele reivindica o nó do servidor duas vezes, compara o elemento com o
// próprio primeiro filho e dá #418; o React recria o documento e apaga o data-theme do <html>. Só acontece quando a
// hidratação começa antes de o HTML terminar de chegar (máquina carregada, rede lenta). Correção no React:
// facebook/react#35494 (jan/2026), que só chega com o Next 16. Até lá, o perfil espera o documento terminar de chegar
// antes de hidratar o corpo: quem suspende aqui é um componente de função, cuja reexecução não toca no cursor.
// Retirar quando o Next vendorizar um React com a #35494.

let documentoCompleto: Promise<void> | null = null;

function esperaDocumento(): Promise<void> | null {
  if (typeof document === "undefined" || document.readyState !== "loading") return null;
  // setTimeout: deixa o cliente RSC processar os últimos pedaços empurrados pelos <script> antes de retomar
  documentoCompleto ??= new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => setTimeout(resolve, 0), { once: true }));
  return documentoCompleto;
}

export function AguardaDocumento({ children }: { children: React.ReactNode }) {
  const p = esperaDocumento();
  if (p) use(p);
  return children;
}
