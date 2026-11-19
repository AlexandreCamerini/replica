import { NextResponse } from "next/server";
import { pedirDecisao, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi, recusarOrigemExterna } from "@/lib/admin/guarda";
import { ErroPedidoInvalido } from "@/lib/admin/sql";

// POST { pendencia_id, acao, por, justificativa, valor?, aplicar? }: grava um PEDIDO de decisão (`adm_pedidos_decisao`), nunca a decisão, e devolve { id, novo }.
// `por` e `justificativa` não vazios. O executor valida e grava a decisão (decisoes.decidir) e aplica, se pedido.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  const recusado = recusarOrigemExterna(req);
  if (recusado) return recusado;
  try {
    const texto = await req.text();
    if (texto.length > 65536) throw new ErroPedidoInvalido("corpo grande demais");
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw new ErroPedidoInvalido("o corpo tem de ser JSON");
    }
    return NextResponse.json(await pedirDecisao(corpo), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respostaDeErro(e);
  }
}

// Métodos que esta rota não usa: com a central fechada respondem 404 como o resto (critério 15: a rota não se revela por um 405); aberta, 405.
export async function GET() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export async function PUT() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export async function PATCH() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export async function DELETE() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export async function OPTIONS() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export async function HEAD() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
