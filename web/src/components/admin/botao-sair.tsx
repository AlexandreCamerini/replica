"use client";

import { useState } from "react";

// Sair da central (0158): revoga as sessões da pessoa em todos os aparelhos. Fala só com a API da própria central.
export function BotaoSair() {
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sair = async () => {
    setPendente(true);
    setErro(null);
    try {
      const r = await fetch("/admin/api/sair", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { proximo?: string; erro?: string };
      if (r.ok && j.proximo) {
        window.location.assign(j.proximo);
        return;
      }
      setErro(j.erro ?? "Não foi possível sair agora. Tente de novo.");
    } catch {
      setErro("Sem conexão com a central. Tente de novo.");
    }
    setPendente(false);
  };
  return (
    <p className="adm-sair">
      <button type="button" className="chip" onClick={sair} disabled={pendente} aria-busy={pendente}>
        {pendente ? "Saindo…" : "Sair"}
      </button>
      {erro && (
        <span role="alert" className="adm-ajuda" data-estado="erro">
          {erro}
        </span>
      )}
    </p>
  );
}
