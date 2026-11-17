import { NextResponse } from "next/server";
import { fila, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";
import { ErroPedidoInvalido } from "@/lib/admin/sql";

// GET ?classe=&limite=: pendências abertas na ordem da restrição 7 (classe, tipo, vencimento, cobertura do recorte, id), nunca por pessoa, partido ou popularidade. Só lê.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  try {
    const u = new URL(req.url).searchParams;
    const classe = u.get("classe") || undefined;
    const bruto = u.get("limite");
    const limite = bruto === null || bruto === "" ? 100 : /^\d+$/.test(bruto) ? Number(bruto) : Number.NaN;
    if (Number.isNaN(limite)) throw new ErroPedidoInvalido("limite tem de ser um inteiro de 1 a 1000");
    return NextResponse.json(await fila(classe, limite), { headers: { "Cache-Control": "no-store" } });
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
