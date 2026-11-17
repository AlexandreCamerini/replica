import { NextResponse } from "next/server";
import { pedir, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi, recusarOrigemExterna } from "@/lib/admin/guarda";
import { ErroPedidoInvalido } from "@/lib/admin/sql";

// POST { tipo: "rodada" | "recoleta" | "parecer", parametros }: grava um pedido na fila (`adm_pedidos`) e devolve { id, novo }. Não aplica nada e não chama modelo:
// o executor da CLI consome o pedido. Dois POST iguais enquanto o primeiro está na fila ou em execução devolvem o mesmo id (novo = false).
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
    if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) throw new ErroPedidoInvalido("o corpo tem de ser um objeto");
    const { tipo, parametros, ...resto } = corpo as Record<string, unknown>;
    if (Object.keys(resto).length > 0) throw new ErroPedidoInvalido("campo não aceito no corpo");
    return NextResponse.json(await pedir(tipo as string, parametros), { headers: { "Cache-Control": "no-store" } });
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
