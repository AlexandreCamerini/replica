import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { LinkChip, MoreLink, SelectField, fieldCls, hrefWith, type Params } from "@/components/profile/ui";
import { MissingDataNote, SourceFooter, TopicTag, VoteBadge } from "@/components/ui/data";
import { Hemicycle } from "@/components/ui/hemicycle";
import { data, type Body } from "@/lib/data";
import { count, date, monthYear } from "@/lib/format";

export const metadata: Metadata = { title: "Congresso", description: "Quem ocupa cada cadeira e como cada votação nominal terminou, na Câmara e no Senado." };

const STEP = 30;
const HOUSES: { id: Body; label: string; plenary: string }[] = [
  { id: "camara", label: "Câmara", plenary: "Câmara dos Deputados" },
  { id: "senado", label: "Senado", plenary: "Senado Federal" },
];

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const body: Body = sp.casa === "senado" ? "senado" : "camara";
  const tab = sp.aba === "leis" ? "leis" : sp.aba === "agenda" ? "agenda" : "votacoes";
  const house = HOUSES.find((h) => h.id === body)!;
  const shown = Math.min(Math.max(Number(sp.n) || STEP, STEP), 300);
  const result = sp.resultado === "aprovado" || sp.resultado === "rejeitado" ? sp.resultado : undefined;
  const q = sp.busca?.trim().slice(0, 80) || undefined;
  // U11: o padrão é só o que muda lei; `vtipo=tudo` mostra também requerimento e urgência
  const everything = sp.vtipo === "tudo";
  const first = await data.listVotingEvents({ body, limit: 1 });
  const year = sp.ano && first.years.includes(Number(sp.ano)) ? Number(sp.ano) : undefined;
  const [seats, events, topics, stamp] = await Promise.all([
    data.getChamber(body),
    data.listVotingEvents({ body, year, q, result, limit: shown, scope: everything ? "tudo" : "lei" }),
    data.listTopics(),
    data.getStamp(`${body}.votacoes`),
  ]);
  const topicName = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  const base = "/congresso";
  const keep: Params = { casa: body === "senado" ? "senado" : undefined, ano: year ? String(year) : undefined, busca: q, resultado: result, vtipo: everything ? "tudo" : undefined };
  const groups: { month: string; items: typeof events.items }[] = [];
  for (const e of events.items) {
    const m = e.occurredAt.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === m) last.items.push(e);
    else groups.push({ month: m, items: [e] });
  }

  return (
    <Container>
      <PageHeader title="Congresso" lead="Quem ocupa cada cadeira hoje e como terminou cada votação nominal. Toque numa votação para ver o voto de cada pessoa." />

      <nav aria-label="O que ver" className="mb-3">
        <ul className="flex gap-2">
          <li>
            <LinkChip href={hrefWith(base, {}, { casa: body === "senado" ? "senado" : undefined })} active={tab !== "leis"}>
              Votações nominais
            </LinkChip>
          </li>
          <li>
            <LinkChip href={hrefWith(base, {}, { casa: body === "senado" ? "senado" : undefined, aba: "agenda" })} active={tab === "agenda"}>
              Agenda
            </LinkChip>
          </li>
          <li>
            <LinkChip href={hrefWith(base, {}, { casa: body === "senado" ? "senado" : undefined, aba: "leis" })} active={tab === "leis"}>
              O que virou lei
            </LinkChip>
          </li>
        </ul>
      </nav>

      <nav aria-label="Casa" className="mb-6">
        <ul className="flex gap-2">
          {HOUSES.map((h) => (
            <li key={h.id}>
              <LinkChip href={hrefWith(base, {}, { casa: h.id === "senado" ? "senado" : undefined, aba: tab === "leis" ? "leis" : tab === "agenda" ? "agenda" : undefined })} active={h.id === body}>
                {h.label}
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
        <section aria-labelledby="cadeiras-h" className="rounded-md border border-border bg-surface p-4 md:p-6">
          <h2 id="cadeiras-h" className="mb-3 text-xl text-fg">
            Cadeiras · {house.plenary}
          </h2>
          {seats.length ? (
            <Hemicycle seats={seats.map((s) => ({ id: s.slug, name: s.name, party: s.party, uf: s.uf ?? "" }))} title={`${count(seats.length)} em exercício`} />
          ) : (
            <p className="text-sm text-muted">Nenhuma pessoa em exercício carregada para esta casa.</p>
          )}
          <p className="mt-3 text-xs text-muted">Cor não indica partido: escolha um partido acima para destacar as cadeiras dele. A ordem é alfabética por sigla.</p>
        </section>

        {tab === "leis" ? (
          <LawsPanel sp={sp} />
        ) : tab === "agenda" ? (
          <AgendaPanel sp={sp} body={body} />
        ) : (
        <section aria-labelledby="votacoes-h" className="rounded-md border border-border bg-surface p-4 md:p-6">
          <h2 id="votacoes-h" className="flex flex-wrap items-baseline gap-x-2 text-xl text-fg">
            Votações nominais
            <span className="text-base font-normal tabular text-muted">{count(events.total)}</span>
          </h2>
          <p className="mt-1 mb-3 text-sm text-muted">Votação simbólica não registra voto de cada pessoa e não aparece aqui.</p>
          <nav aria-label="Que votações mostrar" className="mb-2">
            <ul className="flex flex-wrap gap-2">
              <li>
                <LinkChip tall href={hrefWith(base, keep, { vtipo: undefined, n: undefined }, "votacoes-h")} active={!everything}>
                  Só o que muda lei
                </LinkChip>
              </li>
              <li>
                <LinkChip tall href={hrefWith(base, keep, { vtipo: "tudo", n: undefined }, "votacoes-h")} active={everything}>
                  Tudo
                </LinkChip>
              </li>
            </ul>
          </nav>
          <p className="mb-4 text-sm text-muted" data-testid="votos-regra">
            {everything
              ? "Mostrando tudo, inclusive pedido de urgência e requerimento."
              : events.hidden > 0
                ? `${count(events.hidden)} ${events.hidden === 1 ? "votação de requerimento ou urgência está escondida" : "votações de requerimento ou urgência estão escondidas"}.`
                : "Nenhuma votação de requerimento ou urgência escondida."}{" "}
            <Link href="/como-escolhemos#votos-lei" className="underline underline-offset-2">
              A regra
            </Link>
          </p>
          <form action={base} className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_2fr_auto]">
            {body === "senado" && <input type="hidden" name="casa" value="senado" />}
            {everything && <input type="hidden" name="vtipo" value="tudo" />}
            <SelectField label="Ano" name="ano" value={year ? String(year) : ""} options={[{ value: "", label: "Todos" }, ...events.years.map((y) => ({ value: String(y), label: String(y) }))]} />
            <SelectField label="Resultado" name="resultado" value={result} options={[{ value: "", label: "Todos" }, { value: "aprovado", label: "Aprovado" }, { value: "rejeitado", label: "Rejeitado" }]} />
            <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-fg md:col-span-1">
              Buscar
              <input type="search" name="busca" defaultValue={q} maxLength={80} placeholder="Ex.: PL 1234, saúde" className={fieldCls} />
            </label>
            <button type="submit" className="col-span-2 h-10 self-end rounded-pill bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:col-span-1">
              Filtrar
            </button>
          </form>
          {events.items.length === 0 ? (
            <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted">Nenhuma votação com esses filtros.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((g) => (
                <div key={g.month}>
                  <h3 className="mb-2 text-sm font-semibold capitalize text-muted">{monthYear(`${g.month}-01`)}</h3>
                  <ol className="flex flex-col divide-y divide-border">
                    {g.items.map((e) => (
                      <li key={e.id} className="relative flex flex-col gap-1.5 py-3">
                        <Link
                          href={`/votacoes/${e.id}`}
                          className="text-sm font-semibold text-fg outline-none after:absolute after:inset-0 hover:underline focus-visible:after:outline-2 focus-visible:after:outline-focus"
                        >
                          {e.proposal ? `${e.proposal.label}: ${e.proposal.summary.slice(0, 160)}${e.proposal.summary.length > 160 ? "…" : ""}` : e.description.slice(0, 180)}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          {e.result && <VoteBadge value={e.result} />}
                          {e.isSecret && <span className="rounded-pill bg-surface-sunken px-2 py-0.5 font-semibold text-fg">votação secreta</span>}
                          {e.openNoVotes && <span className="rounded-pill bg-surface-sunken px-2 py-0.5 font-semibold text-fg">aberta, sem voto individual publicado</span>}
                          {e.yes + e.no > 0 && (
                            <span className="tabular">
                              {count(e.yes)} sim · {count(e.no)} não
                            </span>
                          )}
                          <time dateTime={e.occurredAt}>{date(e.occurredAt)}</time>
                          {e.topic && topicName[e.topic] && <TopicTag>{topicName[e.topic]}</TopicTag>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
          <MoreLink href={hrefWith(base, keep, { n: String(shown + STEP) }, "votacoes-h")} remaining={events.total - events.items.length} />
          <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
        </section>
        )}
      </div>

      <div className="mt-8">
        <MissingDataNote
          items={[
            { what: "Sessão ao vivo", why: "a agenda mostra o que está marcado, não o que está acontecendo; as votações aparecem quando a casa publica o resultado" },
          ]}
        />
      </div>
    </Container>
  );
}

const BRT = "America/Sao_Paulo";
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: BRT });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: BRT });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: BRT });
const HOUSE_LABEL = { camara: "Câmara dos Deputados", senado: "Senado Federal", congresso: "Congresso Nacional" } as const;

/** Aba "agenda": próximas sessões do Plenário e a pauta de cada uma. Fonte: `agenda_events`/`agenda_items` (D125), carimbo `agenda.<casa>`. */
async function AgendaPanel({ sp, body }: { sp: Params; body: Body }) {
  const shown = Math.min(Math.max(Number(sp.na) || 10, 10), 50);
  const view = await data.getAgenda({ body, limit: shown });
  const keep: Params = { aba: "agenda", casa: body === "senado" ? "senado" : undefined };
  const days: { key: string; at: string; events: typeof view.events }[] = [];
  for (const e of view.events) {
    const k = dayKey(e.startsAt);
    const last = days[days.length - 1];
    if (last?.key === k) last.events.push(e);
    else days.push({ key: k, at: e.startsAt, events: [e] });
  }
  return (
    <section aria-labelledby="agenda-h" className="rounded-md border border-border bg-surface p-4 md:p-6" data-testid="agenda">
      <h2 id="agenda-h" className="flex flex-wrap items-baseline gap-x-2 text-xl text-fg">
        Próximas sessões
        <span className="text-base font-normal tabular text-muted">{count(view.total)}</span>
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Sessões do Plenário {body === "senado" ? "do Senado Federal e do Congresso Nacional" : "da Câmara dos Deputados"} já marcadas, a partir de hoje, com a pauta que a casa publicou. Horário de Brasília. A pauta
        pode mudar até a sessão e a situação é escrita como a casa informa.
      </p>
      {view.events.length === 0 ? (
        <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted" data-testid="agenda-vazia">
          Nenhuma sessão marcada a partir de hoje nos dados carregados. Isso não quer dizer que a casa não terá sessão: a agenda só aparece depois que a casa a publica.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((d) => (
            <div key={d.key}>
              <h3 className="mb-2 text-sm font-semibold capitalize text-muted">{dayLabel(d.at)}</h3>
              <ol className="flex flex-col divide-y divide-border">
                {d.events.map((e) => (
                  <li key={e.id} className="flex flex-col gap-2 py-3" data-testid="agenda-evento">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <time dateTime={e.startsAt} className="font-semibold tabular text-fg">{hhmm(e.startsAt)}</time>
                      <span className="rounded-pill bg-surface-sunken px-2 py-0.5 font-semibold text-fg">{e.kind}</span>
                      <span>{e.status}</span>
                      {e.house === "congresso" && <span>{HOUSE_LABEL.congresso}</span>}
                      {e.location && <span>{e.location}</span>}
                    </div>
                    {e.title && <p className="text-sm text-fg">{e.title}</p>}
                    {e.items.length === 0 ? (
                      <p className="text-sm text-muted">
                        <span aria-hidden>—</span> <span>Pauta não publicada pela casa para esta sessão.</span>
                      </p>
                    ) : (
                      <ol className="flex flex-col gap-2 rounded-sm bg-surface-sunken px-3 py-2" aria-label="Pauta">
                        {e.items.map((i) => (
                          <li key={i.position} className="text-sm text-fg">
                            <span className="font-semibold">
                              {i.position}. {i.label ?? i.title}
                            </span>
                            {i.summary ? `: ${i.summary.length > 220 ? `${i.summary.slice(0, 220)}…` : i.summary}` : i.label && i.title !== i.label ? `: ${i.title}` : ""}
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                              {i.regime && <span>{i.regime}</span>}
                              {i.rapporteur && <span>Relator: {i.rapporteur}</span>}
                              {i.outcome && <span>{i.outcome}</span>}
                              {i.votingEventId && (
                                <Link href={`/votacoes/${i.votingEventId}`} className="font-semibold text-accent-text underline underline-offset-2">
                                  ver a votação
                                </Link>
                              )}
                              {i.proposalUrl && (
                                <a href={i.proposalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text underline underline-offset-2">
                                  proposta no site oficial<span className="sr-only"> (abre em nova aba)</span>
                                </a>
                              )}
                            </span>
                          </li>
                        ))}
                        {e.itemsTotal > e.items.length && <li className="text-xs text-muted">e mais {count(e.itemsTotal - e.items.length)} itens na pauta oficial.</li>}
                      </ol>
                    )}
                    {e.officialUrl && (
                      <a href={e.officialUrl} target="_blank" rel="noopener noreferrer" className="w-fit text-xs font-semibold text-accent-text underline underline-offset-2">
                        sessão no site oficial<span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <MoreLink href={hrefWith("/congresso", keep, { na: String(shown + 10) }, "agenda-h")} remaining={view.total - view.events.length} />
      {view.source ? (
        <SourceFooter source={view.source.name} href={view.source.url} updatedAt={view.source.refreshedAt} />
      ) : (
        <p className="mt-4 text-xs text-muted">Fonte: dados abertos {body === "senado" ? "do Senado Federal" : "da Câmara dos Deputados"}. Data da última leitura: — (a agenda ainda não foi carregada).</p>
      )}
    </section>
  );
}

/** W2 item 15: aba "o que virou lei", por data de publicação. Fonte: `laws` (normas ligadas às propostas carregadas). */
async function LawsPanel({ sp }: { sp: Params }) {
  const shown = Math.min(Math.max(Number(sp.nl) || STEP, STEP), 200);
  const first = await data.listLaws({ limit: 1 });
  const year = sp.ano && first.years.includes(Number(sp.ano)) ? Number(sp.ano) : undefined;
  const [laws, stamp] = await Promise.all([data.listLaws({ year, limit: shown }), data.getStamp("camara.proposicoes")]);
  const keep: Params = { aba: "leis", casa: sp.casa === "senado" ? "senado" : undefined, ano: year ? String(year) : undefined };
  return (
    <section aria-labelledby="leis-h" className="rounded-md border border-border bg-surface p-4 md:p-6">
      <h2 id="leis-h" className="flex flex-wrap items-baseline gap-x-2 text-xl text-fg">
        O que virou lei
        <span className="text-base font-normal tabular text-muted">{count(laws.total)}</span>
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Leis e emendas à Constituição publicadas que vieram de propostas já carregadas no site (apresentadas na Câmara ou no Senado a partir de 2019), da mais recente para a
        mais antiga. Ainda não é a lista completa de normas do país.
      </p>
      <form action="/congresso" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="aba" value="leis" />
        {sp.casa === "senado" && <input type="hidden" name="casa" value="senado" />}
        <SelectField label="Ano" name="ano" value={year ? String(year) : ""} options={[{ value: "", label: "Todos" }, ...first.years.map((y) => ({ value: String(y), label: String(y) }))]} />
        <button type="submit" className="h-10 rounded-pill bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Filtrar
        </button>
      </form>
      {laws.items.length === 0 ? (
        <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted">Nenhuma lei{year ? ` publicada em ${year}` : ""} entre as propostas carregadas.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border" data-testid="leis">
          {laws.items.map((l) => (
            <li key={l.number} className="flex flex-col gap-1 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="font-semibold text-fg">{l.number}</span>
                <time dateTime={l.sanctionedOn}>publicada em {date(l.sanctionedOn)}</time>
                {l.proposal && <span>proposta de origem: {l.proposal}</span>}
              </div>
              <p className="text-sm text-fg">{l.summary}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {l.authors.length > 0 && (
                  <span>
                    Autoria:{" "}
                    {l.authors.map((a, i) => (
                      <span key={a.slug}>
                        {i > 0 && ", "}
                        <Link href={`/p/${a.slug}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                          {a.name}
                        </Link>
                      </span>
                    ))}
                    {l.moreAuthors > 0 && ` e mais ${l.moreAuthors}`}
                  </span>
                )}
                {l.url && (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-text underline underline-offset-2">
                    texto da lei<span className="sr-only"> (abre em nova aba)</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <MoreLink href={hrefWith("/congresso", keep, { nl: String(shown + STEP) }, "leis-h")} remaining={laws.total - laws.items.length} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </section>
  );
}
