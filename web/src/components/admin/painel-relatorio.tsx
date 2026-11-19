import { formatarDe, linhasDoPainel } from "../../lib/admin/estado-tela.ts";

/**
 * Um painel do relatório da rodada (coleta OU revisão: blocos separados, nunca somados). Cada número vem como "X de N" e abre a lista de ids que o compõem
 * ("Ver registros"). Sem hooks: serve ao servidor e ao componente vivo.
 */
export function PainelRelatorio({ id, titulo, painel, parcial }: { id: string; titulo: string; painel: Record<string, unknown>; parcial: boolean }) {
  const linhas = linhasDoPainel(painel);
  const mensagem = typeof painel.mensagem === "string" ? painel.mensagem : null;
  return (
    <section className="adm-painel" aria-labelledby={`${id}-t`} data-painel={id}>
      <h3 id={`${id}-t`}>{titulo}</h3>
      {parcial && <p className="adm-marca">Números parciais: a rodada ainda não terminou.</p>}
      {mensagem && <p className="adm-ajuda">{mensagem}</p>}
      <ul className="adm-totais">
        {linhas.map((l) => (
          <li key={l.caminho} className="adm-total" data-total={l.caminho}>
            <span className="adm-total__rotulo">{l.rotulo}: </span>
            <strong className="adm-total__valor">{formatarDe(l.valor, l.de)}</strong>
            {l.valor === null && l.motivo && <span className="adm-ajuda"> ({l.motivo})</span>}
            {l.valor !== null && l.de === null && l.motivo && <span className="adm-ajuda"> ({l.motivo})</span>}
            {l.ids !== null && l.ids.length > 0 && (
              <details className="adm-ids">
                <summary>Ver registros ({l.ids.length})</summary>
                <ul>
                  {l.ids.map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
