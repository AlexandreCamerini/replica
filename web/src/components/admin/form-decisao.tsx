"use client";

import { useEffect, useId, useState } from "react";
import { chaveDoRascunho, confirmacaoDeDecisao, lerRascunho, rascunhoVazio, serializarRascunho } from "../../lib/admin/confirmacao.ts";
import { PainelConfirmacao } from "./painel-confirmacao.tsx";
import { ResultadoPedido } from "./resultado-pedido.tsx";
import { useAcaoPedido } from "./use-acao-pedido.ts";

const ACOES = [
  { v: "aprovar", t: "Aprovar" },
  { v: "corrigir", t: "Corrigir" },
  { v: "descartar", t: "Descartar" },
  { v: "pedir_confirmacao", t: "Pedir confirmação" },
] as const;

export type ContextoDecisao = {
  campo: string;
  classe: string;
  fichaRotulo: string;
  /** o território pelo nome (ex.: "Adamantina (SP)") */
  territorio: string;
  /** valor vigente, já em texto */
  valorAtual: string;
  /** valores candidatos distintos das propostas ligadas à pendência */
  candidatos: string[];
};

const guardar = (chave: string, texto: string | null) => {
  try {
    if (texto === null) sessionStorage.removeItem(chave);
    else sessionStorage.setItem(chave, texto);
  } catch {
    // sessionStorage indisponível (janela privada, dado bloqueado): a tela funciona sem rascunho
  }
};

/**
 * Pedido de decisão sobre uma pendência. Grava SÓ o pedido (POST /admin/api/decisoes); quem valida e registra a decisão é o executor. Quem decide é a sessão: a tela mostra
 * "Decidindo como {nome}" e o servidor ignora qualquer nome vindo daqui. Antes de enviar, abre o resumo (campo, valor atual, valor novo, escopo) e o botão diz o efeito.
 * O que foi digitado fica em sessionStorage: se a sessão expira no meio, nada se perde e a tela oferece entrar de novo.
 */
export function FormDecisao({ pendenciaId, contexto, operadorNome }: { pendenciaId: string; contexto: ContextoDecisao; operadorNome: string }) {
  const uid = useId();
  const [acao, setAcao] = useState<(typeof ACOES)[number]["v"]>("aprovar");
  const [justificativa, setJustificativa] = useState("");
  const [valor, setValor] = useState("");
  const [aplicar, setAplicar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recuperado, setRecuperado] = useState(false);
  const [pronto, setPronto] = useState(false); // o rascunho só é regravado depois de lido (senão o primeiro render apagaria o guardado)
  const { executar, emVoo, resposta, acomp, refMensagem } = useAcaoPedido();
  const aplicavel = acao === "aprovar" || acao === "corrigir";
  const chave = chaveDoRascunho(pendenciaId);

  useEffect(() => {
    try {
      const r = lerRascunho(sessionStorage.getItem(chave));
      if (r && !rascunhoVazio(r)) {
        setAcao(r.acao as (typeof ACOES)[number]["v"]);
        setJustificativa(r.justificativa);
        setValor(r.valor);
        setAplicar(r.aplicar);
        setRecuperado(true);
      }
    } catch {
      // sem sessionStorage: segue sem rascunho
    }
    setPronto(true);
  }, [chave]);

  useEffect(() => {
    if (!pronto) return;
    const r = { acao, justificativa, valor, aplicar };
    guardar(chave, rascunhoVazio(r) ? null : serializarRascunho(r));
  }, [pronto, chave, acao, justificativa, valor, aplicar]);

  const conferir = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (justificativa.trim() === "") return setAviso("A justificativa é obrigatória.");
    if (acao === "corrigir" && valor.trim() === "") return setAviso("Corrigir exige o valor.");
    setAviso(null);
    setConfirmando(true);
  };

  const enviar = () => {
    const corpo: Record<string, unknown> = { pendencia_id: pendenciaId, acao, justificativa: justificativa.trim() };
    if (valor.trim() !== "") corpo.valor = valor.trim();
    if (aplicavel && aplicar) corpo.aplicar = true;
    void executar("/admin/api/decisoes", corpo, () => {
      // sucesso: formulário limpo e rascunho descartado; a página é atualizada pelo ciclo da ação
      setConfirmando(false);
      setJustificativa("");
      setValor("");
      setAplicar(false);
      setAcao("aprovar");
      setRecuperado(false);
      guardar(chave, null);
    });
  };

  const conf = confirmacaoDeDecisao({
    acao,
    aplicar: aplicavel && aplicar,
    campo: contexto.campo,
    classe: contexto.classe,
    fichaRotulo: contexto.fichaRotulo,
    territorio: contexto.territorio,
    valorAtual: contexto.valorAtual,
    candidatos: contexto.candidatos,
    valorCorrigido: valor,
    justificativa,
    operador: operadorNome,
  });

  return (
    <form onSubmit={conferir} className="adm-form" aria-label={`Pedido de decisão sobre o campo ${contexto.campo}`}>
      <p className="adm-decidindo">
        Decidindo como <strong>{operadorNome}</strong>
      </p>
      {recuperado && <p className="adm-aviso">Rascunho recuperado deste navegador: confira antes de enviar.</p>}
      <div className="adm-campo">
        <label htmlFor={`${uid}-acao`}>Ação</label>
        <select id={`${uid}-acao`} value={acao} onChange={(e) => setAcao(e.target.value as typeof acao)} disabled={confirmando}>
          {ACOES.map((a) => (
            <option key={a.v} value={a.v}>
              {a.t}
            </option>
          ))}
        </select>
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-just`}>Justificativa (obrigatória)</label>
        <textarea id={`${uid}-just`} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} required rows={3} maxLength={4000} disabled={confirmando} />
      </div>
      <div className="adm-campo">
        <label htmlFor={`${uid}-valor`}>{acao === "corrigir" ? "Valor corrigido (obrigatório, texto)" : "Valor (opcional, texto)"}</label>
        <input id={`${uid}-valor`} type="text" value={valor} onChange={(e) => setValor(e.target.value)} required={acao === "corrigir"} autoComplete="off" disabled={confirmando} />
      </div>
      <div className="adm-campo adm-campo--linha">
        <input id={`${uid}-ap`} type="checkbox" checked={aplicavel && aplicar} disabled={!aplicavel || confirmando} onChange={(e) => setAplicar(e.target.checked)} />
        <label htmlFor={`${uid}-ap`}>Pedir que o executor aplique a decisão (só aprovar e corrigir)</label>
      </div>
      <p className="adm-ajuda">Esta tela grava um pedido de decisão. A decisão é registrada, e aplicada se pedido, pelo executor.</p>
      {confirmando ? (
        <PainelConfirmacao conf={conf} emVoo={emVoo} onConfirmar={enviar} onVoltar={() => setConfirmando(false)} />
      ) : (
        <button type="submit" className="adm-botao" disabled={emVoo} aria-busy={emVoo}>
          Pedir decisão
        </button>
      )}
      {aviso && (
        <p role="alert" className="adm-aviso adm-aviso--erro">
          {aviso}
        </p>
      )}
      <ResultadoPedido r={resposta} acomp={acomp} refMensagem={refMensagem} />
    </form>
  );
}
