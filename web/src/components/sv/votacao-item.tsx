import Link from "next/link";
import type { VotingEventSummary } from "@/lib/data";
import { BODY_NAME, clip, fmtDate, fmtInt } from "./fmt";
import { PLACAR_MOTIVO } from "./placar";
import { Lacuna, VotoQuadrado } from "./ui";

// Uma votação numa lista (Votações, Tema): data, esfera em palavra, o que foi votado, resultado e o placar que a fonte publicou.
// O placar da lista é `placarFonte` (null = a fonte não publicou, vira lacuna; 0 publicado é dado). `yes`/`no` não servem:
// fundem "não publicou" com zero. Abstenção e Sem voto só existem na página da votação.

const RESULTADO = { aprovado: "aprovado", rejeitado: "rejeitado" } as const;

export const PLACAR_NAO_PUBLICADO = "A fonte não publicou o placar total desta votação.";

function PlacarDaFonte({ v }: { v: VotingEventSummary }) {
  if (v.isSecret) return <Lacuna>{PLACAR_MOTIVO.secreta}</Lacuna>;
  const { sim, nao } = v.placarFonte;
  if (sim === null || nao === null) return <Lacuna>{v.openNoVotes ? PLACAR_MOTIVO.semVotos : PLACAR_NAO_PUBLICADO}</Lacuna>;
  return (
    <p className="sv-pl">
      <span className="sv-vh">Placar publicado pela fonte: </span>
      <span className="sv-voto">
        <VotoQuadrado forma="sim" />
        Sim: {fmtInt(sim)}
      </span>
      <span className="sv-voto">
        <VotoQuadrado forma="nao" />
        Não: {fmtInt(nao)}
      </span>
    </p>
  );
}

export function VotacaoItem({ v }: { v: VotingEventSummary }) {
  const titulo = v.proposal?.summary ? clip(v.proposal.summary, 160) : clip(v.description, 160);
  return (
    <li className="sv-vl">
      <p className="sv-vl__d">{fmtDate(v.occurredAt)}</p>
      <p className="sv-esf">Federal · {BODY_NAME[v.body]}</p>
      <p className="sv-vl__t">
        <Link href={`/v2/votacao/${v.id}`}>{titulo}</Link>
      </p>
      <p className="sv-vl__k">
        {v.proposal?.label ? `${v.proposal.label}. ` : ""}
        {v.result ? `Resultado: ${RESULTADO[v.result]}.` : "Resultado não publicado pela fonte."}
      </p>
      <div className="sv-vl__p">
        <PlacarDaFonte v={v} />
      </div>
    </li>
  );
}
