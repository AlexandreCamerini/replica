import "server-only";
import { notFound } from "next/navigation";
import { decidirAcesso, hostDeRequisicaoLocal } from "./guarda-regra.ts";

// Guarda de acesso da central (plano, seção 4a). A REGRA é pura e mora em guarda-regra.ts (`decidirAcesso`); aqui só se liga a regra ao Next.
// Quatro pontos de entrada, todos chamam esta guarda ANTES de qualquer outra coisa:
//   - layout.tsx do grupo (admin): `exigirAdmin()` na primeira instrução, antes de qualquer Suspense (com stream iniciado, `notFound()` pode sair com status 200);
//   - cada route handler: `exigirAdminApi()` na primeira instrução;
//   - cada função de consultas.ts: `exigirAdmin()` na primeira instrução (layout e página renderizam em paralelo: a página não pode consultar o banco se o layout responde 404);
//   - sqlAdmin() em db.ts: lança se a central estiver fechada (defesa em profundidade).
// Nunca registra o valor de variável de ambiente nem o motivo da recusa: quem consulta o endpoint não aprende nada.

/** A central está liberada neste processo? (ADMIN_CENTRAL=1, fora da Vercel, ADMIN_DATABASE_URL local.) Lê o ambiente a cada chamada. */
export function centralLiberada(): boolean {
  return decidirAcesso(process.env).liberada;
}

/** Página, layout e função de consulta: central fechada = `notFound()` (404). */
export function exigirAdmin(): void {
  if (!centralLiberada()) notFound();
}

/** Route handler: `null` se liberada; senão um 404 sem corpo. Use: `const negado = exigirAdminApi(); if (negado) return negado;` */
export function exigirAdminApi(): Response | null {
  return centralLiberada() ? null : new Response(null, { status: 404 });
}

/**
 * POST da central: só aceita requisição feita pela própria página (mesma origem) e em JSON. Sem isto, qualquer site aberto no navegador
 * do dono poderia gravar pedido em `localhost` com um POST `text/plain` (que não exige preflight). `null` = aceita; senão a resposta de recusa.
 */
export function recusarOrigemExterna(req: Request): Response | null {
  const recusa = () => new Response(JSON.stringify({ erro: "requisição recusada" }), { status: 403, headers: { "content-type": "application/json" } });
  if (!hostDeRequisicaoLocal(req.headers.get("host"))) return recusa();
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return recusa();
  const origem = req.headers.get("origin");
  if (origem !== null) {
    let h: string;
    try {
      h = new URL(origem).host.toLowerCase();
    } catch {
      return recusa();
    }
    if (h !== (req.headers.get("host") ?? "").toLowerCase()) return recusa();
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return recusa();
  return null;
}
