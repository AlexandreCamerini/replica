// Guarda da central na borda da requisição (critério 15). Roda ANTES do roteador do Next, para QUALQUER método e qualquer requisição, inclusive RSC e prefetch:
// com a central fechada responde 404 sem corpo; com ela liberada, só atende Host local (DNS rebinding). Só a regra pura de lib/admin/guarda-regra.ts entra aqui:
// nada do site público, nada de `server-only`. O matcher cobre só /admin; o site público não passa por aqui.
import { NextResponse, type NextRequest } from "next/server";
import { decidirAcesso, hostDeRequisicaoLocal } from "./lib/admin/guarda-regra.ts";

export const config = { matcher: ["/admin", "/admin/:path*"], runtime: "nodejs" };

export function middleware(req: NextRequest) {
  if (!decidirAcesso(process.env).liberada) return new Response(null, { status: 404 });
  if (!hostDeRequisicaoLocal(req.headers.get("host"))) return new Response(null, { status: 404 });
  return NextResponse.next();
}
