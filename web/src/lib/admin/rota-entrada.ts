import "server-only";
import { after } from "next/server";
import { exigirEntradaApi } from "./guarda.ts";
import type { Resultado } from "./entrada.ts";

// Casca comum das rotas de API da entrada (/admin/api/entrar): guarda da entrada na primeira instrução (await), corpo JSON pequeno, resposta JSON sem cache. Só POST; os outros métodos respondem 404.
export async function rotaDeEntrada(req: Request, acao: (corpo: Record<string, unknown>) => Promise<Resultado>): Promise<Response> {
  const negado = await exigirEntradaApi(req);
  if (negado) return negado;
  let corpo: Record<string, unknown> = {};
  try {
    const texto = await req.text();
    if (texto.length > 16384) return new Response(JSON.stringify({ erro: "corpo grande demais" }), { status: 413, headers: { "content-type": "application/json" } });
    const j: unknown = texto === "" ? {} : JSON.parse(texto);
    if (j && typeof j === "object" && !Array.isArray(j)) corpo = j as Record<string, unknown>;
    else return new Response(JSON.stringify({ erro: "o corpo tem de ser um objeto JSON" }), { status: 400, headers: { "content-type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ erro: "o corpo tem de ser JSON" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const r = await acao(corpo);
  if (r.pendente) after(r.pendente);
  if (r.status === 404) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Método que as rotas da entrada não usam: 404 (nada se revela por um 405). */
export const naoUsado = async (): Promise<Response> => new Response(null, { status: 404 });
