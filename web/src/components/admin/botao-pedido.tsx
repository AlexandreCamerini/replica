"use client";

import { useRef, useState } from "react";
import { enviarPedido, type RespostaPedido } from "./enviar.ts";
import { ResultadoPedido } from "./resultado-pedido.tsx";

type Props = {
  rotulo: string;
  endpoint: "/admin/api/pedidos" | "/admin/api/decisoes";
  /** corpo do POST, serializável */
  corpo: unknown;
  ajuda?: string;
};

/** Botão de ação da central: desabilita enquanto o POST está em voo e mostra o resultado (inclusive "já existe um pedido igual"). */
export function BotaoPedido({ rotulo, endpoint, corpo, ajuda }: Props) {
  const [emVoo, setEmVoo] = useState(false);
  const trava = useRef(false); // dois cliques antes do re-render: só o primeiro passa
  const [r, setR] = useState<RespostaPedido | null>(null);
  const clicar = async () => {
    if (trava.current) return;
    trava.current = true;
    setEmVoo(true);
    setR(null);
    setR(await enviarPedido(endpoint, corpo));
    trava.current = false;
    setEmVoo(false);
  };
  return (
    <div className="adm-acao">
      <button type="button" className="adm-botao" onClick={clicar} disabled={emVoo} aria-busy={emVoo}>
        {emVoo ? "Enviando…" : rotulo}
      </button>
      {ajuda && <p className="adm-ajuda">{ajuda}</p>}
      <ResultadoPedido r={r} />
    </div>
  );
}
