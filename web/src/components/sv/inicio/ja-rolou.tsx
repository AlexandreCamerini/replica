import Link from "next/link";
import { BODY_NAME, clip, fmtDate } from "@/components/sv/fmt";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { Cobertura, Lacuna, Nota, Placar, Prova } from "@/components/sv/ui";
import { data, type Body, type Stamp, type VotingEventDetail } from "@/lib/data";
import { placarDe } from "../placar";
import { dayKey, fmtLong } from "./datas";

const POR_CASA = 3;
const TOTAL = 4;
const FONTE = "Câmara dos Deputados e Senado Federal, votações nominais";

const lida = (s: Stamp | null) => {
  const t = s ? new Date(s.refreshedAt).getTime() : 0;
  return t > 0 ? fmtDate(s?.refreshedAt) : null;
};

function Contagem({ ev }: { ev: VotingEventDetail }) {
  const fonte = `${BODY_NAME[ev.body]}, votação nominal`;
  const p = placarDe(ev);
  if (p.kind === "lacuna") return p.motivo ? <Lacuna>{p.motivo}</Lacuna> : <Cobertura fonte={fonte} />;
  return (
    <>
      <Placar titulo={`Votação de ${fmtDate(ev.occurredAt)}: ${BODY_NAME[ev.body]}`} sim={p.sim} nao={p.nao} abs={p.abs} sem={p.sem} />
      {p.obstrucao > 0 && <Nota>Obstrução: {p.obstrucao}. É um registro próprio da Casa e não entra nas quatro linhas acima.</Nota>}
    </>
  );
}

/** "Já rolou": as votações nominais mais recentes das duas Casas, com o placar. Coluna por UF omitida: o contrato não traz as cadeiras da UF na Câmara. */
export async function JaRolou() {
  const bodies: Body[] = ["camara", "senado"];
  const pages = await Promise.all(bodies.map((body) => data.listVotingEvents({ body, scope: "lei", limit: POR_CASA }).catch(() => null)));
  const resumo = pages.flatMap((p) => p?.items ?? []).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, TOTAL);
  const [detalhes, stCamara, stSenado] = await Promise.all([
    Promise.all(resumo.map((r) => data.getVotingEvent(r.id).catch(() => null))),
    data.getStamp("camara.votacoes").catch(() => null),
    data.getStamp("senado.votacoes").catch(() => null),
  ]);
  const datas = [lida(stCamara) && `Câmara ${lida(stCamara)}`, lida(stSenado) && `Senado ${lida(stSenado)}`].filter(Boolean).join("; ");

  return (
    <section className="sv-tl sv-gj" aria-labelledby="inicio-rolou">
      <h2 className="sv-th" id="inicio-rolou">
        Já rolou <ExemploIlustrativo />
      </h2>
      {resumo.length === 0 ? (
        <Cobertura fonte={FONTE} />
      ) : (
        resumo.map((r, i) => {
          const d = detalhes[i];
          const dia = dayKey(r.occurredAt);
          return (
            <div key={r.id} className="sv-ev">
              {dia && <p className="sv-ev__d">{fmtLong(dia)}</p>}
              <p className="sv-esf">Federal · {BODY_NAME[r.body]}</p>
              <p className="sv-ev__t">
                <Link href={`/votacao/${r.id}`}>{r.proposal ? `${r.proposal.label}: ${clip(r.proposal.summary, 140)}` : clip(r.description, 140)}</Link>
              </p>
              {d ? <Contagem ev={d} /> : <Cobertura fonte={`${BODY_NAME[r.body]}, votação nominal`} />}
            </div>
          );
        })
      )}
      {resumo.length > 0 && <Nota>Sem voto soma quem não registrou voto e quem presidia a sessão. Não é voto contra. A ordem é fixa: Sim, Não, Abstenção, Sem voto.</Nota>}
      <p className="sv-ir2">
        <Link className="sv-lk" href="/acompanhando">
          Como meus escolhidos votaram <span aria-hidden="true">→</span>
        </Link>
      </p>
      <Prova>
        Fonte: {FONTE}
        {datas ? `, lidas em: ${datas}` : ", data da leitura não registrada"}.
      </Prova>
    </section>
  );
}
