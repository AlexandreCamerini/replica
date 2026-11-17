// Envio de pedido da central (cliente). URL SEMPRE relativa ao site; nada de host. A tela só grava PEDIDO: nunca aplica, executa ou chama modelo.
export type RespostaPedido = { ok: true; id: string; novo: boolean } | { ok: false; erro: string };

export async function enviarPedido(endpoint: "/admin/api/pedidos" | "/admin/api/decisoes", corpo: unknown): Promise<RespostaPedido> {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), cache: "no-store" });
    const j = (await r.json().catch(() => null)) as { id?: unknown; novo?: unknown; erro?: unknown } | null;
    if (r.ok && j && typeof j.id === "string" && typeof j.novo === "boolean") return { ok: true, id: j.id, novo: j.novo };
    return { ok: false, erro: j && typeof j.erro === "string" ? j.erro : "Não foi possível gravar o pedido." };
  } catch {
    return { ok: false, erro: "Não foi possível falar com a central. Tente de novo." };
  }
}
