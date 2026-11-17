"use client";

import { useId, useRef, useState } from "react";
import { enviarPedido, type RespostaPedido } from "./enviar.ts";
import { ResultadoPedido } from "./resultado-pedido.tsx";

const CLASSES = [
  { v: "vinculo_sapl", t: "Vínculo SAPL" },
  { v: "cobertura", t: "Cobertura" },
  { v: "contato_mandato", t: "Contato do mandato" },
] as const; // identidade não tem recoleta

/** "Recoletar fichas pendentes" num território: POST /admin/api/pedidos {tipo:"recoleta", parametros:{classe, territorio:{ibge, nivel}}}. Classe e território obrigatórios. */
export function FormRecoleta({ nivel, ibge, nome }: { nivel: "uf" | "municipio" | "pais"; ibge?: string; nome: string }) {
  const uid = useId();
  const [classe, setClasse] = useState<(typeof CLASSES)[number]["v"]>("vinculo_sapl");
  const [emVoo, setEmVoo] = useState(false);
  const trava = useRef(false);
  const [r, setR] = useState<RespostaPedido | null>(null);
  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (trava.current) return;
    trava.current = true;
    setEmVoo(true);
    setR(null);
    const territorio = nivel === "pais" ? { nivel } : { ibge, nivel };
    setR(await enviarPedido("/admin/api/pedidos", { tipo: "recoleta", parametros: { classe, territorio } }));
    trava.current = false;
    setEmVoo(false);
  };
  return (
    <form onSubmit={enviar} className="adm-form" aria-label={`Recoletar fichas pendentes em ${nome}`}>
      <div className="adm-campo">
        <label htmlFor={`${uid}-cl`}>Classe de campo</label>
        <select id={`${uid}-cl`} value={classe} onChange={(e) => setClasse(e.target.value as typeof classe)}>
          {CLASSES.map((c) => (
            <option key={c.v} value={c.v}>
              {c.t}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="adm-botao" disabled={emVoo} aria-busy={emVoo}>
        {emVoo ? "Enviando…" : "Recoletar fichas pendentes"}
      </button>
      <p className="adm-ajuda">Território: {nome}. Grava um pedido de recoleta; o executor consome.</p>
      <ResultadoPedido r={r} />
    </form>
  );
}
