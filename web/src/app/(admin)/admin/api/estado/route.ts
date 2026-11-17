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
