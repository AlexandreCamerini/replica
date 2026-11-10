import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { clip, fmtDate, fmtInt } from "@/components/sv/fmt";
import { FollowButton } from "@/components/sv/follow";
import { Gap, Item, Label, List, Row, Src, VoteMark } from "@/components/sv/ui";
import { data, type OfficeSlug, type PeriodStats } from "@/lib/data";

const SLUG = /^[a-z0-9-]{1,120}$/;
const load = (slug: string) => (SLUG.test(slug) ? data.getPerson(slug) : Promise.resolve(null));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug);
  return { title: r ? r.person.displayName : "Pessoa não encontrada" };
}

// O que cada cargo decide, em uma frase. Texto próprio, escrito a partir da Constituição Federal.
const ROLE: Record<OfficeSlug, string> = {
  presidente: "Chefia o governo federal, propõe o orçamento da União e sanciona ou veta as leis aprovadas pelo Congresso.",
  vice_presidente: "Substitui o presidente quando ele está fora ou impedido.",
  senador: "Vota leis federais, julga autoridades e aprova indicações do presidente. São três por estado.",
  deputado_federal: "Vota leis federais e o orçamento da União, e fiscaliza o governo federal.",
  governador: "Chefia o governo do estado, propõe o orçamento estadual e sanciona ou veta as leis estaduais.",
  vice_governador: "Substitui o governador quando ele está fora ou impedido.",
  deputado_estadual: "Vota leis e o orçamento do estado, e fiscaliza o governo estadual.",
  deputado_distrital: "Vota leis e o orçamento do Distrito Federal, e fiscaliza o governo distrital.",
  prefeito: "Chefia a prefeitura, propõe o orçamento da cidade e sanciona ou veta as leis municipais.",
  vice_prefeito: "Substitui o prefeito quando ele está fora ou impedido.",
  vereador: "Vota as leis e o orçamento da cidade, e fiscaliza a prefeitura.",
};

/** Síntese por regra: frases montadas do dado, iguais para qualquer pessoa. Sem média, sem adjetivo. */
function summary(s: PeriodStats): string[] {
  const out: string[] = [];
  if (s.presencePresent !== null && s.presenceTotal !== null && s.presenceTotal > 0) out.push(`Esteve presente em ${fmtInt(s.presencePresent)} de ${fmtInt(s.presenceTotal)} sessões com registro.`);
  if (s.votesRegistered !== null) out.push(`Tem ${fmtInt(s.votesRegistered)} votos registrados em plenário.`);
  if (s.proposalsPrincipal !== null) out.push(`Apresentou ${fmtInt(s.proposalsPrincipal)} propostas como autor principal${s.proposalsCosigned ? ` e assinou outras ${fmtInt(s.proposalsCosigned)}` : ""}.`);
  if (s.topTopics.length > 0) out.push(`Assuntos que mais aparecem nas propostas: ${s.topTopics.slice(0, 3).map((t) => t.topic).join(", ")}.`);
  return out;
}

export default async function Pessoa({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/v2/pessoa/${r.redirectTo}`);
  const person = r.person;

  const [mandates, stats, votes, proposals] = await Promise.all([
    data.getMandates(person.id),
    data.getStats(person.id, "career"),
    data.listVotes(person.id, { scope: "lei", limit: 8 }),
    data.listProposals(person.id, { role: "autor", limit: 5 }),
  ]);

  const main = mandates.find((m) => m.status === "em_exercicio") ?? mandates[0] ?? null;
  const sentences = summary(stats);
  const fem = person.gender === "f";

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <h1 className="sv-name">{person.displayName}</h1>
          {main ? (
            <>
              <p className="sv-lead sv-mt-2" style={{ fontSize: 17 }}>
                <b>{main.officeName}</b>, {main.placeLabel}. {main.party.acronym}. No cargo desde {fmtDate(main.startedOn)}
                {main.status !== "em_exercicio" ? ` (situação: ${main.status.replaceAll("_", " ")})` : ""}.
              </p>
              <p className="sv-meta sv-mt-3" style={{ fontWeight: 400, fontSize: 14.5 }}>
                O que este cargo decide: {ROLE[main.office]}
              </p>
            </>
          ) : (
            <Gap>Não consta mandato carregado para esta pessoa.</Gap>
          )}

          <div className="sv-mt-4">
            <FollowButton slug={person.slug} name={person.displayName} />
          </div>

          <div className="sv-mt-4">
            <Label>Em resumo</Label>
            {sentences.length === 0 ? (
              <Gap>Ainda não há registro suficiente para resumir a atuação {fem ? "dela" : "dele"}.</Gap>
            ) : (
              <ul className="sv-mt-1" style={{ fontSize: 16, lineHeight: 1.4 }}>
                {sentences.map((t) => (
                  <li key={t} style={{ padding: "5px 0" }}>
                    {t}
                  </li>
                ))}
              </ul>
            )}
            <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
              Frases montadas por regra a partir do registro oficial, iguais para qualquer pessoa.
            </p>
          </div>
        </div>

        <div>
          <Label>Como votou, do mais recente para o mais antigo</Label>
          {votes.items.length === 0 ? (
            <Gap>Não consta. A fonte não publica o voto nominal deste cargo, ou ele ainda não foi carregado.</Gap>
          ) : (
            <List>
              {votes.items.map((v) => (
                <Link key={v.event.id} className="sv-voterow" href={`/v2/votacao/${v.event.id}`} style={{ textDecoration: "none" }}>
                  <div>
                    {clip(v.event.description, 110)}
                    <small>{fmtDate(v.event.occurredAt)}</small>
                  </div>
                  <VoteMark value={v.value} />
                </Link>
              ))}
            </List>
          )}
          {votes.total > votes.items.length && (
            <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
              Mostrando {votes.items.length} de {fmtInt(votes.total)} votos. Sem voto registrado não é voto contra.
            </p>
          )}

          <div className="sv-mt-5">
            <Label>O que propôs</Label>
            {proposals.items.length === 0 ? (
              <Gap>Não consta proposta de autoria principal.</Gap>
            ) : (
              <List>
                {proposals.items.map((p) => (
                  <Item key={p.id} href={p.url || undefined} title={clip(p.summary, 130)} note={`${p.type} ${p.number}/${p.year}. ${p.status}`} value={fmtDate(p.presentedOn)} />
                ))}
              </List>
            )}
          </div>

          <div className="sv-mt-5">
            <Label>O que prometeu</Label>
            <Gap>Não consta. Ainda não temos compromissos documentados de nenhuma pessoa.</Gap>
          </div>

          <div className="sv-mt-5">
            <Label>O que consta e o que falta</Label>
            <List>
              <Row label="Mandato e partido" value="consta" on />
              {stats.missing.map((m) => (
                <Item key={m.dataset} title={m.label} note={m.status === "no_site" ? undefined : m.reason} value={m.status === "no_site" ? "consta" : "não consta"} on={m.status === "no_site"} />
              ))}
            </List>
          </div>

          <Link className="sv-more" href={`/p/${person.slug}`}>
            Ver o registro completo: gastos, patrimônio, campanhas e equipe
          </Link>
        </div>
      </div>
      <Src>Fonte: TSE e casas legislativas, dados abertos. Cada número do registro completo traz a própria fonte e data.</Src>
    </>
  );
}
