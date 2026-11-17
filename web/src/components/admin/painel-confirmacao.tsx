"use client";

import { useEffect, useId, useRef } from "react";
import type { Confirmacao } from "../../lib/admin/confirmacao.ts";

/** Resumo antes de uma ação com efeito: o que muda, onde e quanto; o botão principal diz o efeito. "Voltar e editar" não envia nada. */
export function PainelConfirmacao({ conf, emVoo, onConfirmar, onVoltar }: { conf: Confirmacao; emVoo: boolean; onConfirmar: () => void; onVoltar: () => void }) {
  const uid = useId();
  const titulo = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    titulo.current?.focus();
  }, []);
  return (
    <div role="group" aria-labelledby={`${uid}-t`} className="adm-confirmacao plate" data-confirmacao="aberta">
      <h3 id={`${uid}-t`} tabIndex={-1} ref={titulo}>
        {conf.titulo}
      </h3>
      <dl className="adm-resumo">
        {conf.itens.map((i) => (
          <div key={i.rotulo}>
            <dt className="lbl">{i.rotulo}</dt>
            <dd>{i.valor}</dd>
          </div>
        ))}
      </dl>
      {conf.avisos.map((a) => (
        <p key={a} className="adm-aviso adm-aviso--atencao">
          {a}
        </p>
      ))}
      <div className="adm-acoes">
        <button type="button" className="adm-botao" onClick={onConfirmar} disabled={emVoo} aria-busy={emVoo}>
          {emVoo ? "Enviando…" : conf.botao}
        </button>
        <button type="button" className="adm-botao adm-botao--secundario" onClick={onVoltar} disabled={emVoo}>
          Voltar e editar
        </button>
      </div>
    </div>
  );
}
