import Link from "next/link";
import { clip, fmtDate } from "@/components/sv/fmt";
import { mandatoPrincipal } from "@/components/sv/mandato";
import { Gap, Label, List, VoteMark } from "@/components/sv/ui";
import { data, type PersonVote } from "@/lib/data";

export type Followed = { slug: string; name: string; office: string; votes: PersonVote[]; total: number };

/** Carrega quem a pessoa acompanha, na ordem alfabética do nome. Slug que não existe mais é ignorado. */
export async function loadFollowed(slugs: string[], perPerson: number): Promise<Followed[]> {
  const rows = await Promise.all(
    slugs.map(async (slug) => {
      const r = await data.getPerson(slug);
      if (!r) return null;
      const [mandates, votes] = await Promise.all([data.getMandates(r.person.id), data.listVotes(r.person.id, { scope: "lei", limit: perPerson })]);
      const main = mandatoPrincipal(mandates);
      return { slug: r.person.slug, name: r.person.displayName, office: main ? `${main.officeName}, ${main.placeLabel}. ${main.party.acronym}` : "Sem mandato carregado", votes: votes.items, total: votes.total } satisfies Followed;
    }),
  );
  return rows.filter((r): r is Followed => r !== null).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Uma pessoa acompanhada, com os votos mais recentes. */
export function FollowedCard({ f }: { f: Followed }) {
  return (
    <div>
      <Label>{f.office}</Label>
      <p className="sv-h2 sv-mt-1" style={{ textTransform: "lowercase", fontStretch: "125%" }}>
        <Link href={`/v2/pessoa/${f.slug}`} style={{ textDecoration: "none" }}>
          {f.name}
        </Link>
      </p>
      {f.votes.length === 0 ? (
        <div className="sv-mt-2">
          <Gap>Não consta voto nominal. A fonte não publica o voto deste cargo, ou ele ainda não foi carregado.</Gap>
        </div>
      ) : (
        <List>
          {f.votes.map((v) => (
            <Link key={v.event.id} className="sv-voterow" href={`/v2/votacao/${v.event.id}`} style={{ textDecoration: "none" }}>
              <div>
                {clip(v.event.description, 90)}
                <small>{fmtDate(v.event.occurredAt)}</small>
              </div>
              <VoteMark value={v.value} />
            </Link>
          ))}
        </List>
      )}
    </div>
  );
}
