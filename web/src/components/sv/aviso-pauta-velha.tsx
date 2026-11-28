import "@/styles/sv-aviso.css";
import { BODY_NAME, fmtDateTime } from "./fmt";
import { haQuantoTempo, pautasVelhas } from "./pauta-velha";
import type { PautaOverview } from "@/lib/data";

// F6: aviso destacado de pauta velha, no topo da pauta (Decisões) e antes da semana (início). Uma pauta lida há mais de 36 h pode já ter mudado.
// Só aparece quando há leitura velha; Casa sem leitura tem o seu próprio aviso ("ainda não foi lida"). Diz a data da última leitura de cada Casa.
export function AvisoPautaVelha({ reads, agora = Date.now() }: { reads: PautaOverview["reads"]; agora?: number }) {
  const velhas = pautasVelhas(reads, agora);
  if (velhas.length === 0) return null;
  return (
    <aside className="sv-aviso" role="note" aria-label="A pauta pode estar desatualizada" data-aviso="pauta-velha">
      <p className="sv-aviso__t">A pauta pode estar desatualizada.</p>
      <ul className="sv-aviso__l">
        {velhas.map((v) => (
          <li key={v.casa}>
            A pauta {v.casa === "camara" ? "da" : "do"} {BODY_NAME[v.casa]} foi lida pela última vez em {fmtDateTime(v.readAt)}, {haQuantoTempo(v.horas)}.
          </li>
        ))}
      </ul>
      <p className="sv-aviso__n">O que está marcado pode ter mudado desde então: confira nas páginas da Câmara e do Senado.</p>
    </aside>
  );
}
