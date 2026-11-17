import { NextResponse } from "next/server";
import { ficha, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";

// GET: a ficha de um registro (campos, valor vigente de agora, propostas com evidência, pendências com a pergunta, pareceres, histórico de decisões). Só lê.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ classe: string; chave: string }> }) {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  try {
    const { classe, chave } = await params;
    return NextResponse.json(await ficha(decodeURIComponent(classe), decodeURIComponent(chave)), { headers: { "Cache-Control": "no-store" } });
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
