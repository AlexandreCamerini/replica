import { NextResponse } from "next/server";
import { getHealth } from "@/lib/data/health";

// Vigia externo (D14): o GitHub Actions `vigia.yml` bate aqui todo dia. 200 = fontes essenciais em dia; 503 = alguma fora do prazo.
// Erro ao ler o banco também é 503 (e o corpo não diz por quê: nada de mensagem de driver nem URL).
export const dynamic = "force-dynamic";
const CACHE = { "Cache-Control": "public, s-maxage=60" };

export async function GET() {
  try {
    const report = await getHealth();
    return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: CACHE });
  } catch {
    return NextResponse.json({ geradoEm: new Date().toISOString(), ok: false, erro: "não foi possível ler os carimbos", fontes: [] }, { status: 503, headers: CACHE });
  }
}
