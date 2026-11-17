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
