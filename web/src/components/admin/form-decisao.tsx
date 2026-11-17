"use client";

import { useId, useRef, useState } from "react";
import { enviarPedido, type RespostaPedido } from "./enviar.ts";
import { ResultadoPedido } from "./resultado-pedido.tsx";

const ACOES = [
  { v: "aprovar", t: "Aprovar" },
  { v: "corrigir", t: "Corrigir" },
  { v: "descartar", t: "Descartar" },
  { v: "pedir_confirmacao", t: "Pedir confirmação" },
] as const;

/** Pedido de decisão sobre uma pendência. Grava SÓ o pedido (POST /admin/api/decisoes); quem valida e registra a decisão é o executor. */
export function FormDecisao({ pendenciaId, campo }: { pendenciaId: string; campo: string }) {
  const uid = useId();
  const [acao, setAcao] = useState<(typeof ACOES)[number]["v"]>("aprovar");
  const [justificativa, setJustificativa] = useState("");
  const [valor, setValor] = useState("");
  const [aplicar, setAplicar] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  const trava = useRef(false);
  const [r, setR] = useState<RespostaPedido | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const aplicavel = acao === "aprovar" || acao === "corrigir";

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (trava.current) return;
    if (justificativa.trim() === "") return setAviso("A justificativa é obrigatória.");
    if (acao === "corrigir" && valor.trim() === "") return setAviso("Corrigir exige o valor.");
    setAviso(null);
    trava.current = true;
    setEmVoo(true);
    setR(null);
    const corpo: Record<string, unknown> = { pendencia_id: pendenciaId, acao, justificativa: justificativa.trim() };
    if (valor.trim() !== "") corpo.valor = valor.trim();
    if (aplicavel && aplicar) corpo.aplicar = true;
    setR(await enviarPedido("/admin/api/decisoes", corpo));
    trava.current = false;
    setEmVoo(false);
  };

  return (
    <form onSubmit={enviar} className="adm-form" aria-label={`Pedido de decisão sobre o campo ${campo}`}>
      <div className="adm-campo">
        <label htmlFor={`${uid}-acao`}>Ação</label>
        <select id={`${uid}-acao`} value={acao} onChange={(e) => setAcao(e.target.value as typeof acao)}>
          {ACOES.map((a) => (
            <option key={a.v} value={a.v}>
              {a.t}
            </option>
          ))}
        </select>
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-just`}>Justificativa (obrigatória)</label>
        <textarea id={`${uid}-just`} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} required rows={3} maxLength={4000} />
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-valor`}>{acao === "corrigir" ? "Valor corrigido (obrigatório, texto)" : "Valor (opcional, texto)"}</label>
        <input id={`${uid}-valor`} type="text" value={valor} onChange={(e) => setValor(e.target.value)} required={acao === "corrigir"} autoComplete="off" />
      </div>
      <div className="adm-campo adm-campo--linha">
        <input id={`${uid}-ap`} type="checkbox" checked={aplicavel && aplicar} disabled={!aplicavel} onChange={(e) => setAplicar(e.target.checked)} />
        <label htmlFor={`${uid}-ap`}>Pedir que o executor aplique a decisão (só aprovar e corrigir)</label>
      </div>
      <p className="adm-ajuda">Esta tela grava um pedido de decisão. A decisão é registrada, e aplicada se pedido, pelo executor.</p>
      <button type="submit" className="adm-botao" disabled={emVoo} aria-busy={emVoo}>
        {emVoo ? "Enviando…" : "Pedir decisão"}
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
