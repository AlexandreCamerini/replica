"use client";

import { use } from "react";

// BUG-008: o React vendorizado pelo Next 15.5 (19.2.0-canary-0bdb9206-20250818) perde o cursor de hidratação quando um
// elemento HTML (HostComponent) suspende durante a hidratação e é reexecutado; o perfil, longo, chega em pedaços e a
// hidratação que começa antes do fim do documento cai nisso: #418, o React recria o documento e o data-theme do <html>
// some. Medido: 29/100 cargas com JS em cache e HTML a 200 KB/s; 0/100 com este componente.
// Correção no React: facebook/react#35494 ("[Fiber] Correctly handle replaying when hydrating"), que restaura o cursor
// ao reexecutar um HostComponent; está no React 19.3.0, sem backport para 19.2.x.
// Até lá, o perfil espera o documento terminar de chegar antes de hidratar o corpo: quem suspende aqui é um componente
// de função, que não depende do cursor. O HTML do servidor fica na tela durante a espera; navegação no cliente não espera
// (readyState já não é "loading"). Retirar quando o Next vendorizar React >= 19.3.0.

let documentoCompleto: Promise<void> | null = null;

function esperaDocumento(): Promise<void> | null {
  // no servidor não há document: nada é guardado no módulo, nada vaza entre requisições
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
