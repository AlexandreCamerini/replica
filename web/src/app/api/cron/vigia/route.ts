import { NextResponse, type NextRequest } from "next/server";
import { getHealthSemCache } from "@/lib/data/health";
import { rodarVigia } from "@/lib/vigia";

// Vigia fora do GitHub Actions (D319). Chamado pelo Vercel Cron (web/vercel.json), que envia `Authorization: Bearer CRON_SECRET`.
// A decisão está em lib/vigia.ts (testada); aqui só entram o ambiente, a leitura (sem o cache de dados) e o POST.
// Orçamento: 15 s para ler os carimbos (lib/vigia.ts) + 10 s do POST, dentro dos 30 s da função.
// `?teste=1` (com o mesmo Bearer) envia uma mensagem de teste sem avaliar fonte: é como o dono prova que o aviso chega.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function post(url: string, text: string): Promise<number> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "manual" });
  return r.status;
}

export async function GET(req: NextRequest) {
  const { status, body } = await rodarVigia(req.headers.get("authorization"), req.nextUrl.searchParams.get("teste") === "1", {
    env: { CRON_SECRET: process.env.CRON_SECRET, VIGIA_ALERT_WEBHOOK: process.env.VIGIA_ALERT_WEBHOOK },
    getHealth: () => getHealthSemCache(),
    post,
  });
  // mensagem fixa: nunca a URL do webhook, nunca o erro do driver
  if (status >= 500) console.error(`vigia: HTTP ${status}: ${typeof body.error === "string" ? body.error : "leitura ou envio falhou"}`);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
