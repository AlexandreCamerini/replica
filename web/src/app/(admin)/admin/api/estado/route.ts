import { NextResponse } from "next/server";
import { contagensDoMapa, estadoDoExecutor, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";

// GET: o que a tela consulta a cada 5 s. Estado do executor, rodadas em curso, pedidos recentes, pendências abertas por classe e contagens do mapa. Só lê.
export const dynamic = "force-dynamic";

export async function GET() {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  try {
    const [estado, mapa] = await Promise.all([estadoDoExecutor(), contagensDoMapa()]);
    return NextResponse.json({ ...estado, mapa }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respostaDeErro(e);
  }
}

// Métodos que esta rota não usa: com a central fechada respondem 404 como o resto (critério 15: a rota não se revela por um 405); aberta, 405.
export async function POST() {
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
