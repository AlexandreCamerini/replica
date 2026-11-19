"use client";

import { useId, useState } from "react";
import { botaoDaRecoleta, confirmacaoDeRecoleta } from "../../lib/admin/confirmacao.ts";
import { nomeDaClasse } from "../../lib/admin/rotulos.ts";
import { PainelConfirmacao } from "./painel-confirmacao.tsx";
import { ResultadoPedido } from "./resultado-pedido.tsx";
import { useAcaoPedido } from "./use-acao-pedido.ts";

const CLASSES = ["vinculo_sapl", "cobertura", "contato_mandato"] as const; // identidade não tem recoleta
type Classe = (typeof CLASSES)[number];

export type ContagemClasse = { fichas: number; pendencias: number; truncado: boolean };

/**
 * "Recoletar fichas pendentes" num território: POST /admin/api/pedidos {tipo:"recoleta", parametros:{classe, territorio:{ibge, nivel}}}. NENHUMA classe vem escolhida:
 * a pessoa escolhe, vê o resumo (classe, território, quantas fichas) e confirma no botão que diz o efeito ("Recoletar 12 fichas em São Paulo").
 * `contagens`: fichas e pendências abertas por classe NESTE território (o executor usa a mesma igualdade de território); ausente = não contadas.
 */
export function FormRecoleta({ nivel, ibge, nome, contagens }: { nivel: "uf" | "municipio" | "pais"; ibge?: string; nome: string; contagens?: Partial<Record<Classe, ContagemClasse>> }) {
  const uid = useId();
  const [classe, setClasse] = useState<"" | Classe>("");
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { executar, emVoo, resposta, acomp, refMensagem } = useAcaoPedido();

  const contagem = classe ? contagens?.[classe] : undefined;
  const entrada = { classe: classe || "vinculo_sapl", territorioNome: nome, nivel, pendentes: contagem ? contagem.fichas : null, truncado: contagem?.truncado ?? false, pendencias: contagem?.pendencias };

  const revisar = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (classe === "") return setAviso("Escolha a classe de campo antes de recoletar.");
    setAviso(null);
    setConfirmando(true);
  };
  const enviar = () => {
    if (classe === "") return;
    const territorio = nivel === "pais" ? { nivel } : { ibge, nivel };
    void executar("/admin/api/pedidos", { tipo: "recoleta", parametros: { classe, territorio } }, () => {
      setConfirmando(false);
      setClasse("");
    });
  };

  return (
    <form onSubmit={revisar} className="adm-form" aria-label={`Recoletar fichas pendentes em ${nome}`}>
      <div className="adm-campo">
        <label htmlFor={`${uid}-cl`}>Classe de campo</label>
        <select id={`${uid}-cl`} value={classe} onChange={(e) => setClasse(e.target.value as "" | Classe)} disabled={confirmando}>
          <option value="">Escolha a classe…</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {nomeDaClasse(c)}
              {contagens?.[c] ? ` (${contagens[c]!.fichas} ${contagens[c]!.fichas === 1 ? "ficha pendente" : "fichas pendentes"}${contagens[c]!.truncado ? " ou mais" : ""})` : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="adm-ajuda">Território: {nome}. Grava um pedido de recoleta; o executor consome. Nada é coletado antes da sua confirmação.</p>
      {confirmando && classe !== "" ? (
        <PainelConfirmacao conf={confirmacaoDeRecoleta(entrada)} emVoo={emVoo} onConfirmar={enviar} onVoltar={() => setConfirmando(false)} />
      ) : (
        <button type="submit" className="adm-botao" disabled={emVoo}>
          {classe === "" ? "Recoletar fichas pendentes" : `Revisar: ${botaoDaRecoleta(entrada)}`}
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
