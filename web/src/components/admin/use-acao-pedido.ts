"use client";

// Ciclo comum de toda ação que grava pedido: envia (uma vez só, mesmo com duplo clique), e no sucesso atualiza a página (router.refresh), leva o foco à mensagem
// e ACOMPANHA o pedido pela consulta periódica já existente (GET /admin/api/estado, `pedidosRecentes`) até ele sair da fila e terminar. O formulário quem limpa (aoSucesso).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { acompanharPedido, type Acompanhamento, type PedidoRecenteApi } from "../../lib/admin/acompanhar.ts";
import { enviarPedido, type RespostaPedido } from "./enviar.ts";

const INTERVALO_MS = 3000;
const MAX_CONSULTAS = 200; // 10 min

export function useAcaoPedido() {
  const router = useRouter();
  const trava = useRef(false); // dois cliques antes do re-render: só o primeiro passa
  const refMensagem = useRef<HTMLDivElement | null>(null);
  const [emVoo, setEmVoo] = useState(false);
  const [resposta, setResposta] = useState<RespostaPedido | null>(null);
  const [acomp, setAcomp] = useState<Acompanhamento | null>(null);
  const [idAcompanhado, setIdAcompanhado] = useState<string | null>(null);

  const executar = useCallback(
    async (endpoint: "/admin/api/pedidos" | "/admin/api/decisoes", corpo: unknown, aoSucesso?: (r: Extract<RespostaPedido, { ok: true }>) => void) => {
      if (trava.current) return;
      trava.current = true;
      setEmVoo(true);
      setResposta(null);
      setAcomp(null);
      setIdAcompanhado(null);
      const r = await enviarPedido(endpoint, corpo);
      setResposta(r);
      if (r.ok) {
        aoSucesso?.(r);
        setIdAcompanhado(r.id);
        router.refresh(); // o histórico e os números da página mudam: nada de tela parada depois de uma ação
      }
      trava.current = false;
      setEmVoo(false);
    },
    [router],
  );

  // o foco vai para a mensagem quando ela aparece (leitor de tela lê o resultado; teclado continua de onde a ação foi feita)
  useEffect(() => {
    if (resposta) refMensagem.current?.focus();
  }, [resposta]);

  useEffect(() => {
    if (!idAcompanhado) return;
    let ativo = true;
    let consultas = 0;
    let semVer = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const consultar = async () => {
      if (document.visibilityState !== "visible") return;
      consultas++;
      try {
        const r = await fetch("/admin/api/estado", { cache: "no-store" });
        if (!r.ok) throw new Error("estado");
        const j = (await r.json()) as { pedidosRecentes?: PedidoRecenteApi[] };
        if (!ativo) return;
        const achou = j.pedidosRecentes?.some((p) => p.id === idAcompanhado) ?? false;
        semVer = achou ? 0 : semVer + 1;
        const a = acompanharPedido(idAcompanhado, j.pedidosRecentes, semVer);
        setAcomp((antes) => (antes && antes.fase === a.fase && antes.texto === a.texto ? antes : a));
        if (a.terminal) {
          if (timer !== null) clearInterval(timer);
          timer = null;
          router.refresh(); // o pedido acabou: a página lê o resultado
        }
      } catch {
        // a consulta periódica da região viva mostra a falha; aqui só se tenta de novo
      }
      if (consultas >= MAX_CONSULTAS && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    void consultar();
    timer = setInterval(() => void consultar(), INTERVALO_MS);
    return () => {
      ativo = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [idAcompanhado, router]);

  return { executar, emVoo, resposta, acomp, refMensagem };
}
