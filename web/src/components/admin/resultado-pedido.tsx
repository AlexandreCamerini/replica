import { estadoDoPedido } from "../../lib/admin/estado-tela.ts";
import type { RespostaPedido } from "./enviar.ts";

/** Resultado de um pedido. `novo: false` = "já existe um pedido igual na fila" (estado `pedido_existente`). */
export function ResultadoPedido({ r }: { r: RespostaPedido | null }) {
  if (!r) return null;
  if (!r.ok) {
    return (
      <p role="alert" className="adm-aviso adm-aviso--erro">
        {r.erro}
      </p>
    );
  }
  const estado = estadoDoPedido(r.novo);
  return (
    <p role="status" data-estado={estado} className="adm-aviso">
      {r.novo
        ? `Pedido gravado na fila (id ${r.id}). Nada foi executado nem aplicado por esta tela: o executor consome o pedido.`
        : `Já existe um pedido igual na fila (id ${r.id}). Nenhum pedido novo foi criado.`}
    </p>
  );
}
