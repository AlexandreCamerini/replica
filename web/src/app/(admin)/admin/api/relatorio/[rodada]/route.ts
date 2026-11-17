import { NextResponse } from "next/server";
import { relatorioDaRodada, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";

// GET: o mesmo JSON de `civico-etl admin relatorio ID --json` (coleta e revisao separadas, cada total {valor, de, ids}). Só lê.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ rodada: string }> }) {
  const negado = exigirAdminApi();
  if (negado) return negado;
  try {
    const { rodada } = await params;
    return NextResponse.json(await relatorioDaRodada(rodada), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respostaDeErro(e);
  }
}

// Métodos que esta rota não usa: com a central fechada respondem 404 como o resto (critério 15: a rota não se revela por um 405); aberta, 405.
export function POST() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export function PUT() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export function PATCH() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export function DELETE() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
export function OPTIONS() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  return new Response(null, { status: 405 });
}
