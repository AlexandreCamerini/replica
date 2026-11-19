"use client";

import { useId, useMemo, useState } from "react";
import catalogoJson from "../../lib/admin/catalogo.json";
import { OPCOES_ESCOPO, ROTULO_ESCOPO, TERRITORIO_DO_COLETOR, coletorDoCatalogo, validarRodada, type Catalogo, type ParametrosRodada } from "../../lib/admin/catalogo.ts";
import { confirmacaoDeRodada } from "../../lib/admin/confirmacao.ts";
import { modoDaRodada, UFS } from "../../lib/admin/rotulos.ts";
import { PainelConfirmacao } from "./painel-confirmacao.tsx";
import { ResultadoPedido } from "./resultado-pedido.tsx";
import { useAcaoPedido } from "./use-acao-pedido.ts";

const CATALOGO = catalogoJson as Catalogo;

/**
 * Abrir uma rodada nova: POST /admin/api/pedidos com {tipo:"rodada", parametros:{coletor, modo, recorte?}}. O coletor vem do CATÁLOGO (lista, não campo livre) e a tela só oferece os modos
 * e os recortes que ele suporta. Grava só o pedido; antes, abre o resumo e o botão diz o efeito.
 */
export function FormRodada() {
  const uid = useId();
  const [coletor, setColetor] = useState("");
  const [modo, setModo] = useState("");
  const [ufs, setUfs] = useState<string[]>([]);
  const [anos, setAnos] = useState("");
  const [casas, setCasas] = useState("");
  const [ibges, setIbges] = useState("");
  const [escopo, setEscopo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [parametros, setParametros] = useState<ParametrosRodada | null>(null);
  const { executar, emVoo, resposta, acomp, refMensagem } = useAcaoPedido();

  const c = useMemo(() => coletorDoCatalogo(CATALOGO, coletor), [coletor]);
  const aceita = (r: string) => !!c && c.recortes.includes(r);
  const modoValido = c && c.modos.includes(modo) ? modo : "";

  const escolherColetor = (id: string) => {
    setColetor(id);
    const novo = coletorDoCatalogo(CATALOGO, id);
    setModo(novo ? (novo.modos.includes("recoletar") ? "recoletar" : novo.modos[0]) : "");
    setUfs([]);
    setAnos("");
    setCasas("");
    setIbges("");
    setEscopo("");
    setAviso(null);
  };

  const revisar = (ev: React.FormEvent) => {
    ev.preventDefault();
    const r = validarRodada(CATALOGO, { coletor, modo: modoValido, anos, ufs, casas, ibges, escopo });
    if (!r.ok) return setAviso(r.erro);
    setAviso(null);
    setParametros(r.parametros);
  };

  const enviar = () => {
    if (!parametros) return;
    void executar("/admin/api/pedidos", { tipo: "rodada", parametros }, () => {
      setParametros(null);
      escolherColetor("");
    });
  };

  return (
    <form onSubmit={revisar} className="adm-form" aria-label="Abrir rodada">
      <div className="adm-campo">
        <label htmlFor={`${uid}-col`}>Coletor</label>
        <select id={`${uid}-col`} value={coletor} onChange={(e) => escolherColetor(e.target.value)} required disabled={parametros !== null}>
          <option value="">Escolha o coletor…</option>
          {CATALOGO.coletores.map((x) => (
            <option key={x.id} value={x.id}>
              {x.rotulo} ({TERRITORIO_DO_COLETOR[x.territorio] ?? x.territorio})
            </option>
          ))}
        </select>
      </div>
      {c && (
        <>
          <p className="adm-ajuda">
            Fontes: {c.fontes.join(", ")}.{c.exige_chave ? " Exige chave de API no ambiente do executor." : ""}
          </p>
          <div className="adm-campo">
            <label htmlFor={`${uid}-modo`}>Modo</label>
            <select id={`${uid}-modo`} value={modoValido} onChange={(e) => setModo(e.target.value)} disabled={parametros !== null}>
              {c.modos.map((m) => (
                <option key={m} value={m}>
                  {modoDaRodada(m)}
                </option>
              ))}
            </select>
            {Object.entries(c.modos_recusados).map(([m, motivo]) => (
              <span key={m} className="adm-ajuda">
                {modoDaRodada(m)} não vale para este coletor: {motivo}.
              </span>
            ))}
          </div>
          {aceita("uf") && (
            <fieldset className="adm-campo adm-ufs" disabled={parametros !== null}>
              <legend>Estados do recorte (opcional)</legend>
              <div className="adm-ufs__grade">
                {UFS.map((u) => (
                  <label key={u.sigla} className="chip adm-ufs__item" data-on={ufs.includes(u.sigla) ? "true" : undefined}>
                    <input type="checkbox" checked={ufs.includes(u.sigla)} onChange={(e) => setUfs(e.target.checked ? [...ufs, u.sigla] : ufs.filter((x) => x !== u.sigla))} />
                    {u.nome}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {aceita("ano") && (
            <div className="adm-campo">
              <label htmlFor={`${uid}-anos`}>Anos do recorte (opcional, ex.: 2024, 2025)</label>
              <input id={`${uid}-anos`} type="text" inputMode="numeric" value={anos} onChange={(e) => setAnos(e.target.value)} autoComplete="off" disabled={parametros !== null} />
            </div>
          )}
          {aceita("casa") && (
            <div className="adm-campo">
              <label htmlFor={`${uid}-casas`}>Casas legislativas do recorte (opcional)</label>
              <input id={`${uid}-casas`} type="text" value={casas} onChange={(e) => setCasas(e.target.value)} autoComplete="off" disabled={parametros !== null} />
            </div>
          )}
          {aceita("ibge") && (
            <div className="adm-campo">
              <label htmlFor={`${uid}-ibges`}>Municípios por código IBGE (opcional, 7 dígitos, separados por vírgula)</label>
              <input id={`${uid}-ibges`} type="text" inputMode="numeric" value={ibges} onChange={(e) => setIbges(e.target.value)} autoComplete="off" disabled={parametros !== null} />
            </div>
          )}
          {aceita("escopo") && (
            <div className="adm-campo">
              <label htmlFor={`${uid}-esc`}>Escopo (opcional)</label>
              <select id={`${uid}-esc`} value={escopo} onChange={(e) => setEscopo(e.target.value)} disabled={parametros !== null}>
                <option value="">Padrão do coletor</option>
                {OPCOES_ESCOPO.map((o) => (
                  <option key={o} value={o}>
                    {ROTULO_ESCOPO[o]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {c.recortes.length === 0 && <p className="adm-ajuda">Este coletor não aceita recorte: ele lê tudo o que cobre.</p>}
        </>
      )}
      {parametros ? (
        <PainelConfirmacao conf={confirmacaoDeRodada(CATALOGO, parametros)} emVoo={emVoo} onConfirmar={enviar} onVoltar={() => setParametros(null)} />
      ) : (
        <button type="submit" className="adm-botao" disabled={emVoo}>
          Revisar e abrir rodada
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
