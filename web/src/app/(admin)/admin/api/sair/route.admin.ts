import { exigirAdminApi, recusarOrigemExterna } from "@/lib/admin/guarda";
import { sair } from "@/lib/admin/login";
import { operadorAtual } from "@/lib/admin/sessao";

// POST: sair da central. Só modo produção tem sessão; no modo local não há o que encerrar (a identidade é ADMIN_LOCAL_EMAIL) e a resposta só manda de volta ao início.
// Revoga as sessões de nível 2 da pessoa em todos os aparelhos (0158), não só a deste navegador.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const negado = await exigirAdminApi();
  if (negado) return negado;
  const recusado = recusarOrigemExterna(req);
  if (recusado) return recusado;
  if (process.env.ADMIN_CENTRAL !== "producao") return Response.json({ proximo: "/admin" }, { headers: { "cache-control": "no-store" } });
  try {
    await sair((await operadorAtual()).email);
  } catch (e) {
    console.error("[admin] sair:", e instanceof Error ? e.name : typeof e);
    return Response.json({ erro: "Não foi possível sair agora. Tente de novo." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ proximo: "/admin/entrar" }, { headers: { "cache-control": "no-store" } });
}
