import { NextResponse } from "next/server";
import { contagensDoMapa, estadoDoExecutor, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";

// GET: o que a tela consulta a cada 5 s. Estado do executor, rodadas em curso, pedidos recentes, pendências abertas por classe e contagens do mapa. Só lê.
export const dynamic = "force-dynamic";

export async function GET() {
  const negado = exigirAdminApi();
  if (negado) return negado;
  try {
    const [estado, mapa] = await Promise.all([estadoDoExecutor(), contagensDoMapa()]);
    return NextResponse.json({ ...estado, mapa }, { headers: { "Cache-Control": "no-store" } });
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
