import type { RefObject } from "react";
import type { Acompanhamento } from "../../lib/admin/acompanhar.ts";
import { estadoDoPedido } from "../../lib/admin/estado-tela.ts";
import { abreviarId } from "../../lib/admin/rotulos.ts";
import type { RespostaPedido } from "./enviar.ts";

/**
 * Resultado de um pedido. `novo: false` = "já existe um pedido igual na fila" (estado `pedido_existente`). O status do pedido (na fila, em execução, concluído, falhou)
 * vai num <span data-status-pedido>, dentro do mesmo aviso; só a mudança de status altera o texto, então o leitor de tela não repete a leitura. O id inteiro fica em detalhe; na tela, abreviado.
 */
export function ResultadoPedido({ r, acomp, refMensagem }: { r: RespostaPedido | null; acomp?: Acompanhamento | null; refMensagem?: RefObject<HTMLDivElement | null> }) {
  if (!r) return null;
  if (!r.ok) {
    const f = r.falha;
    return (
      <div role="alert" className="adm-aviso adm-aviso--erro" tabIndex={-1} ref={refMensagem} data-falha={f.tipo}>
        <p>
          <strong>{f.titulo}.</strong> {r.erro}
        </p>
        <p className="adm-ajuda">{f.acao}</p>
        {f.href && (
          <p>
            <a className="chip" href={f.href}>
              Entrar de novo
            </a>
          </p>
        )}
      </div>
    );
  }
  const estado = estadoDoPedido(r.novo);
  return (
    <>
      <div role="status" data-estado={estado} className="adm-aviso" tabIndex={-1} ref={refMensagem}>
        <p>
          {r.novo
            ? `Pedido gravado na fila (pedido ${abreviarId(r.id)}). Nada foi executado nem aplicado por esta tela: o executor consome o pedido.`
            : `Já existe um pedido igual na fila (pedido ${abreviarId(r.id)}). Nenhum pedido novo foi criado.`}{" "}
          {acomp && (
            <span className="adm-status" data-status-pedido={acomp.fase}>
              {acomp.texto}
            </span>
          )}
        </p>
        <details className="adm-ids">
          <summary>Identificador completo do pedido</summary>
          <code>{r.id}</code>
        </details>
      </div>
      {acomp?.problema && acomp.terminal && (
        <p role="alert" className="adm-aviso adm-aviso--erro">
          {acomp.texto}
        </p>
      )}
    </>
  );
}
