"use client";

import { useId, useRef, useState } from "react";
import { enviarPedido, type RespostaPedido } from "./enviar.ts";
import { ResultadoPedido } from "./resultado-pedido.tsx";

/** Abrir uma rodada nova: POST /admin/api/pedidos com {tipo:"rodada", parametros:{coletor, modo, recorte?:{ufs?}}}. Grava só o pedido. */
export function FormRodada() {
  const uid = useId();
  const [coletor, setColetor] = useState("");
  const [modo, setModo] = useState("recoletar");
  const [ufs, setUfs] = useState("");
  const [emVoo, setEmVoo] = useState(false);
  const trava = useRef(false);
  const [r, setR] = useState<RespostaPedido | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (trava.current) return;
    if (coletor.trim() === "") return setAviso("Informe o coletor (id do catálogo).");
    const lista = ufs.split(/[\s,;]+/).filter(Boolean).map((u) => u.toUpperCase());
    if (lista.some((u) => !/^[A-Z]{2}$/.test(u))) return setAviso("UF tem duas letras, separadas por vírgula.");
    setAviso(null);
    trava.current = true;
    setEmVoo(true);
    setR(null);
    const parametros: Record<string, unknown> = { coletor: coletor.trim(), modo };
    if (lista.length > 0) parametros.recorte = { ufs: lista };
    setR(await enviarPedido("/admin/api/pedidos", { tipo: "rodada", parametros }));
    trava.current = false;
    setEmVoo(false);
  };

  return (
    <form onSubmit={enviar} className="adm-form" aria-label="Abrir rodada">
      <div className="adm-campo">
        <label htmlFor={`${uid}-col`}>Coletor (id do catálogo, ex.: sapl.assembleias)</label>
        <input id={`${uid}-col`} type="text" value={coletor} onChange={(e) => setColetor(e.target.value)} required autoComplete="off" />
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-modo`}>Modo</label>
        <select id={`${uid}-modo`} value={modo} onChange={(e) => setModo(e.target.value)}>
          <option value="recoletar">Recoletar fontes conhecidas</option>
          <option value="descobrir">Descobrir fontes</option>
          <option value="reprocessar">Reprocessar sem rede</option>
        </select>
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-ufs`}>UFs do recorte (opcional, ex.: AC, SP)</label>
        <input id={`${uid}-ufs`} type="text" value={ufs} onChange={(e) => setUfs(e.target.value)} autoComplete="off" />
      </div>
      <button type="submit" className="adm-botao" disabled={emVoo} aria-busy={emVoo}>
        {emVoo ? "Enviando…" : "Abrir rodada"}
      </button>
      {aviso && (
        <p role="alert" className="adm-aviso adm-aviso--erro">
          {aviso}
        </p>
      )}
      <ResultadoPedido r={r} />
    </form>
  );
}
