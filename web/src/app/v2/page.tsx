import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { billLabel, clip, fmtDate, fmtDateTime, fmtWeekday } from "@/components/sv/fmt";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { FollowedCard, loadFollowed } from "@/components/sv/followed";
import { LastPlace, RememberPlace } from "@/components/sv/shell";
import { loadThemes } from "@/components/sv/temas";
import { Block, Gap, Item, Label, List, Notice, Row, Src } from "@/components/sv/ui";
import { data, type Level, type PautaEntry, type PautaOverview, type Place, type RepresentativeGroup } from "@/lib/data";

export const metadata: Metadata = { title: { absolute: "Segue o Voto: quem decide por você" } };

const LEVELS: { level: Level; label: string }[] = [
  { level: "municipal", label: "Na cidade" },
  { level: "estadual", label: "No estado" },
  { level: "federal", label: "Em Brasília" },
];

const placeLabel = (p: Place) => (p.kind === "municipio" && p.uf ? `${p.name}, ${p.uf}` : p.name);

/** A decisão mais próxima: plenário antes de comissão, a data mais cedo primeiro. */
function nextDecision(o: PautaOverview): PautaEntry | null {
  const byDate = (a: PautaEntry, b: PautaEntry) => a.scheduledFor.localeCompare(b.scheduledFor);
  return [...o.plenary].sort(byDate)[0] ?? [...o.committees].sort(byDate)[0] ?? null;
}

function DecisionBlock({ o, className, bleed }: { o: PautaOverview | null; className?: string; bleed?: boolean }) {
  if (!o) {
    return (
      <Block label="Em decisão agora" title="Não conseguimos ler a pauta" className={className} bleed={bleed}>
        <p>Quem representa você continua aqui. Tente de novo em alguns minutos.</p>
      </Block>
    );
  }
  const e = nextDecision(o);
  if (!e) {
    return (
      <Block href="/v2/decisoes" label="Em decisão agora" title="Nenhuma decisão marcada nesta semana" className={className} bleed={bleed}>
        <p>A pauta foi lida e não há item marcado. Veja o que já foi votado.</p>
      </Block>
    );
  }
  const house = e.body === "camara" ? "da Câmara" : "do Senado";
  const where = e.stage === "plenario" ? `no plenário ${house}` : `em comissão ${house}`;
  return (
    <Block href={`/v2/decisao/${e.key}`} label="Em decisão agora" title={e.plain ?? clip(e.summary ?? billLabel(e), 110)} className={className} bleed={bleed}>
      <p>
        {billLabel(e)}. Proposta, {where}. Reunião: {fmtWeekday(e.scheduledFor)}.
      </p>
    </Block>
  );
}

function Groups({ groups, place }: { groups: RepresentativeGroup[]; place: Place }) {
  return (
    <div className="sv-cols is-3">
      {LEVELS.map(({ level, label }) => {
        const gs = groups.filter((g) => g.level === level);
        return (
          <div key={level}>
            <Label>{label}</Label>
            {gs.length === 0 ? (
              <Gap>Não consta para este lugar.</Gap>
            ) : (
              <List>
                {gs.map((g) => (
                  <Row key={g.key} href={`/v2/pessoas?cidade=${place.ibge}&grupo=${encodeURIComponent(g.key)}`} label={g.title} value={g.seats ? `${g.seats.loaded} de ${g.seats.total}` : g.people.length} />
                ))}
              </List>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default async function Inicio({ searchParams }: { searchParams: Promise<{ cidade?: string; uf?: string; q?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const follows = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);

  const place = sp.cidade && /^\d{7}$/.test(sp.cidade) ? await data.getPlace(sp.cidade) : sp.uf && /^[A-Za-z]{2}$/.test(sp.uf) ? await data.getPlaceByUf(sp.uf.toUpperCase()) : null;

  const [overview, groups, matches, followed, panorama] = await Promise.all([
    data.getPautaOverview().catch(() => null),
    place ? data.getRepresentatives(place) : Promise.resolve([] as RepresentativeGroup[]),
    !place && q.length >= 2 ? data.searchPlaces(q, 12) : Promise.resolve([] as Place[]),
    loadFollowed(follows.slice(0, 3), 2),
    loadThemes().catch(() => null),
  ]);

  const failed = overview ? overview.reads.camara.failed + overview.reads.senado.failed : 0;
  const total = overview ? overview.reads.camara.total + overview.reads.senado.total : 0;
  const readAt = overview?.week.readAt ?? null;

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <h1 className="sv-hero">quem decide por você</h1>
          {place ? (
            <p className="sv-place sv-mt-2">
              <b>{placeLabel(place)}</b>
              <Link href="/v2">trocar</Link>
            </p>
          ) : (
            <>
              <p className="sv-lead sv-mt-3">Diga onde você mora. Mostramos quem representa você, do vereador ao presidente, e o que essas pessoas estão decidindo.</p>
              <form className="sv-form" action="/v2" method="get" role="search">
                <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>
                  Sua cidade ou estado
                </label>
                <input className="sv-input" id="q" name="q" defaultValue={q} placeholder="Sua cidade ou estado" autoComplete="off" minLength={2} maxLength={60} required />
                <button className="sv-btn" type="submit">
                  Procurar
                </button>
              </form>
              <LastPlace />
            </>
          )}
          <DecisionBlock o={overview} className="sv-mt-5 sv-wide" />
        </div>

        <div>
          {failed > 0 && (
            <div style={{ marginBottom: 20 }}>
              <Notice label="Leitura incompleta">
                {failed} de {total} reuniões não carregaram. Pode haver mais decisões do que as mostradas. Última leitura: {fmtDateTime(readAt)}.
              </Notice>
            </div>
          )}
          {place ? (
            <>
              <RememberPlace ibge={place.ibge} />
              <Groups groups={groups} place={place} />
            </>
          ) : q.length >= 2 ? (
            <>
              <Label>{matches.length === 0 ? "Nenhum lugar encontrado" : `Lugares com “${q}”`}</Label>
              {matches.length === 0 ? (
                <Gap>Confira a grafia ou tente o nome do estado.</Gap>
              ) : (
                <List>
                  {matches.map((m) => (
                    <Row key={m.ibge} href={m.kind === "uf" && m.uf ? `/v2?uf=${m.uf}` : `/v2?cidade=${m.ibge}`} label={placeLabel(m)} value={m.kind === "uf" ? "estado inteiro" : "cidade"} />
                  ))}
                </List>
              )}
            </>
          ) : (
            <>
              <Label>Ou comece por aqui</Label>
              <List>
                <Row href="/v2/temas" label="Os temas que o Congresso está decidindo" value="→" on />
                <Row href="/v2/decisoes" label="O que está em decisão nesta semana" value="→" on />
                <Row href="/v2/pessoas" label="Procurar uma pessoa pelo nome" value="→" on />
              </List>
            </>
          )}
        </div>
      </div>

      <DecisionBlock o={overview} className="sv-mt-5 sv-narrow" bleed />

      {/* Em quem eu votei: o destaque da casa. O voto não termina na urna. */}
      <section className="sv-band" aria-labelledby="h-sigo">
        <Label>Seu voto não termina na urna</Label>
        <h2 id="h-sigo">{followed.length > 0 ? "O que fez quem você votou" : "Em quem você votou?"}</h2>
        {followed.length === 0 ? (
          <>
            <p className="sv-lead sv-mt-2">Marque as pessoas em quem você votou. A cada visita, você vê aqui o que elas votaram e propuseram desde a eleição.</p>
            <Link className="sv-btn sv-mt-3" href={place ? `/v2/pessoas?uf=${place.uf ?? ""}` : "/v2/pessoas"}>
              Escolher em quem votei
            </Link>
            <p className="sv-meta sv-mt-2" style={{ fontWeight: 400 }}>
              A lista fica guardada só neste navegador. Não criamos conta e não perguntamos seu voto.
            </p>
          </>
        ) : (
          <>
            <div className="sv-cols is-3 sv-mt-3">
              {followed.map((f) => (
                <FollowedCard key={f.slug} f={f} />
              ))}
            </div>
            <Link className="sv-more" href="/v2/acompanhando">
              {follows.length > followed.length ? `Ver as ${follows.length} pessoas que você acompanha` : "Ver tudo de quem você acompanha"}
            </Link>
          </>
        )}
      </section>

      {/* Visão global: os temas nacionais em movimento. */}
      <section className="sv-mt-5" aria-labelledby="h-temas">
        <Label>Panorama nacional</Label>
        <h2 className="sv-h2 sv-mt-1" id="h-temas">
          Os temas que o Congresso está decidindo
        </h2>
        {!panorama || panorama.themes.length === 0 ? (
          <div className="sv-mt-2">
            <Gap>Não consta. Nenhuma votação com tema classificado foi carregada.</Gap>
          </div>
        ) : (
          <>
            <div className="sv-cols is-2 sv-mt-2">
              {[panorama.themes.slice(0, 4), panorama.themes.slice(4, 8)].map((col, i) => (
                <List key={i}>
                  {col.map((t) => (
                    <Item key={t.slug} href={`/v2/tema/${t.slug}`} title={t.name} note={`${t.events.length} votações recentes. Última em ${fmtDate(t.last)}.`} value="→" on />
                  ))}
                </List>
              ))}
            </div>
            <Link className="sv-more" href="/v2/temas">
              Ver todos os {panorama.themes.length} temas
            </Link>
          </>
        )}
      </section>

      <Src>
        Fonte: TSE (cargos e cadeiras); pauta e votações da Câmara dos Deputados e do Senado Federal{readAt ? `, pauta lida em ${fmtDateTime(readAt)}` : ", pauta ainda não lida"}.
      </Src>
    </>
  );
}
