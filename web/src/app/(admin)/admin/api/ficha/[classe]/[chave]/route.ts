import { NextResponse } from "next/server";
import { ficha, respostaDeErro } from "@/lib/admin/consultas";
import { exigirAdminApi } from "@/lib/admin/guarda";

// GET: a ficha de um registro (campos, valor vigente de agora, propostas com evidência, pendências com a pergunta, pareceres, histórico de decisões). Só lê.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ classe: string; chave: string }> }) {
  const negado = exigirAdminApi();
  if (negado) return negado;
  try {
    const { classe, chave } = await params;
    return NextResponse.json(await ficha(decodeURIComponent(classe), decodeURIComponent(chave)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respostaDeErro(e);
  }
}
