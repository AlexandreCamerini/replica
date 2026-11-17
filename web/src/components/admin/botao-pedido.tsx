"use client";

import { useState } from "react";
import type { Confirmacao } from "../../lib/admin/confirmacao.ts";
import { PainelConfirmacao } from "./painel-confirmacao.tsx";
import { ResultadoPedido } from "./resultado-pedido.tsx";
import { useAcaoPedido } from "./use-acao-pedido.ts";

type Props = {
  rotulo: string;
  endpoint: "/admin/api/pedidos" | "/admin/api/decisoes";
  /** corpo do POST, serializável */
  corpo: unknown;
  ajuda?: string;
  /** ação com efeito: abre o resumo e só envia no botão que diz o efeito. Sem isto, o clique envia (ex.: "Pedir parecer", que é ensaio e não muda dado). */
  confirmacao?: Confirmacao;
};

/** Botão de ação da central: desabilita enquanto o POST está em voo, atualiza a página no sucesso e mostra o resultado e o status do pedido (inclusive "já existe um pedido igual"). */
export function BotaoPedido({ rotulo, endpoint, corpo, ajuda, confirmacao }: Props) {
  const { executar, emVoo, resposta, acomp, refMensagem } = useAcaoPedido();
  const [aberto, setAberto] = useState(false);
  const enviar = () => void executar(endpoint, corpo, () => setAberto(false));
  return (
    <div className="adm-acao">
      {aberto && confirmacao ? (
        <PainelConfirmacao conf={confirmacao} emVoo={emVoo} onConfirmar={enviar} onVoltar={() => setAberto(false)} />
      ) : (
        <button type="button" className="adm-botao" onClick={() => (confirmacao ? setAberto(true) : enviar())} disabled={emVoo} aria-busy={emVoo} aria-expanded={confirmacao ? aberto : undefined}>
          {emVoo ? "Enviando…" : rotulo}
        </button>
      )}
      {ajuda && <p className="adm-ajuda">{ajuda}</p>}
      <ResultadoPedido r={resposta} acomp={acomp} refMensagem={refMensagem} />
    </div>
  );
}
