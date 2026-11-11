import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { PersonPicker } from "@/components/people/person-picker";
import { LinkChip, SelectField } from "@/components/profile/ui";
import { NotPublished, SourceFooter } from "@/components/ui/data";
import { data, type Person } from "@/lib/data";
import { COMPARE_MAX, COMPARE_RANGE } from "@/lib/compare";
import { age, count, date, money } from "@/lib/format";
import { campaignTotals, joinYears } from "@/lib/campaign";

export const metadata: Metadata = { title: "Comparar", description: `${COMPARE_RANGE} lado a lado, com os mesmos dados oficiais.` };

const MAX = COMPARE_MAX;
const SLUG = /^[a-z0-9-]{1,120}$/;
type SP = Promise<{ p?: string; periodo?: string; par?: string; tema?: string; nd?: string }>;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const asked = [...new Set((sp.p ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const over = Math.max(0, asked.length - MAX);
  const found = await Promise.all(asked.slice(0, MAX).map(async (s) => (SLUG.test(s) ? data.getPerson(s) : null)));
  const people = found.filter((x) => x !== null).map((x) => x.person);
  const invalid = found.filter((x) => x === null).length;
  const slugs = people.map((p) => p.slug);

  return (
    <Container>
      <PageHeader title="Comparar" lead="Ponha de 2 a 5 pessoas lado a lado. Os números vêm das mesmas fontes oficiais; “—” quer dizer que a fonte não publica ou que não se aplica ao cargo." />
      {(invalid > 0 || over > 0) && (
        <p role="status" className="mb-4 rounded-sm bg-warning-soft px-4 py-3 text-sm text-fg">
          {invalid > 0 && `${invalid === 1 ? "1 pessoa do link não foi encontrada" : `${invalid} pessoas do link não foram encontradas`} e saiu da comparação. `}
          {over > 0 && `O limite é ${MAX}; ${over === 1 ? "a última ficou de fora" : `as últimas ${over} ficaram de fora`}.`}
        </p>
      )}
      <div className="mb-8">
        <PersonPicker current={slugs} max={MAX} />
      </div>
      {people.length < 2 ? <Presets have={people} /> : <CompareTable people={people} periodoRaw={sp.periodo} sp={sp} />}
    </Container>
  );
}

async function Presets({ have }: { have: Person[] }) {
  // pares que fazem sentido comparar: mesma casa, mesmo lugar
  const [sp, mg, ssa] = await Promise.all([data.getPlaceByUf("SP"), data.getPlaceByUf("MG"), data.getPlace("2927408")]);
  const groups = await Promise.all([sp!, mg!, ssa!].map((p) => data.getRepresentatives(p)));
  const pick = (gs: typeof groups[number], key: string, n: number) => gs.find((g) => g.key === key)?.people.slice(0, n) ?? [];
  const presets = [
    { label: "Os 3 senadores de São Paulo", people: pick(groups[0], "senado", 3) },
    { label: "Governo de Minas Gerais", people: pick(groups[1], "governo", 2) },
    { label: "4 deputados federais de Minas", people: pick(groups[1], "camara", 4) },
    { label: "Prefeitura de Salvador", people: pick(groups[2], "prefeitura", 2) },
  ];
  return (
    <section aria-labelledby="sugestoes-h">
      {have.length === 1 && (
        <p className="mb-4 text-sm text-fg">
          Você escolheu <strong>{have[0].displayName}</strong>. Adicione mais uma pessoa para comparar.
        </p>
      )}
      <h2 id="sugestoes-h" className="mb-3 text-lg text-fg">
        Ou comece por um destes
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {presets.map((p) => (
          <li key={p.label}>
            <Link
              href={`/comparar?p=${p.people.map((h) => h.person.slug).join(",")}`}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4 outline-none hover:border-border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="font-semibold text-fg">{p.label}</span>
              <span className="truncate text-sm text-muted">{p.people.map((h) => h.person.displayName).join(", ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Cell = React.ReactNode;

async function CompareTable({ people, periodoRaw, sp }: { people: Person[]; periodoRaw?: string; sp: Awaited<SP> }) {
  const years = [...new Set((await Promise.all(people.map((p) => data.getActiveYears(p.id)))).flat())].sort((a, b) => b - a).slice(0, 6);
  const year = periodoRaw && years.includes(Number(periodoRaw)) ? Number(periodoRaw) : null;
  const period = year ? (String(year) as `${number}`) : ("career" as const);
  const rows = await Promise.all(
    people.map(async (p) => {
      const [mandates, cands, stats, yearly] = await Promise.all([data.getMandates(p.id), data.getCandidacies(p.id), data.getStats(p.id, period), data.getYearlyStats(p.id)]);
      const main = mandates.find((m) => m.status === "em_exercicio") ?? mandates[0];
      const lastElected = cands.find((c) => c.result?.startsWith("eleito"));
      const decl = cands.filter((c) => c.assetsCents !== null);
      return { p, main, lastElected, latest: decl[0], first: decl[decl.length - 1], stats, camp: campaignTotals(cands), since: yearly.find((y) => y.votesRegistered !== null || y.proposalsPrincipal !== null || y.expensesCents !== null)?.year ?? null };
    }),
  );
  const sinceAll = rows.map((r) => r.since).filter((y): y is number => y !== null);
  const since = sinceAll.length ? Math.min(...sinceAll) : null;
  const agreement = await data.getAgreement(people.map((p) => p.id), year ?? "career");
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.displayName]));
  const slugs = people.map((p) => p.slug);
  const without = (s: string) => `/comparar?p=${slugs.filter((x) => x !== s).join(",")}${year ? `&periodo=${year}` : ""}`;
  const periodHref = (y: number | null) => `/comparar?p=${slugs.join(",")}${y ? `&periodo=${y}` : ""}`;
  const stamp = await data.getStamp("tse.candidatos");
  const dash = <NotPublished />;
  // fonte e data de cada bloco da tabela, pela casa de cada pessoa comparada (BUG-026)
  const offices = new Set(rows.map((r) => r.main?.office));
  const hasCamara = offices.has("deputado_federal");
  const hasSenado = offices.has("senador");
  const hasOther = [...offices].some((o) => o && o !== "deputado_federal" && o !== "senador");
  const line = async (label: string, dataset: string) => {
    const st = await data.getStamp(dataset);
    return { label, source: st.source, href: st.sourceUrl, updatedAt: st.refreshedAt };
  };
  const sourceLines = [
    await line("Quem é, eleição e patrimônio", "tse.candidatos"),
    await line("Arrecadação de campanha", "tse.contas"),
    ...(hasCamara ? [await line("Presença, propostas, votos e cota (Câmara)", "camara.votacoes")] : []),
    ...(hasSenado ? [await line("Propostas, votos e cota (Senado)", "senado.votacoes")] : []),
  ];

  const groups: { title: string; rows: [string, (r: (typeof rows)[number]) => Cell][] }[] = [
    {
      title: "Quem é",
      rows: [
        ["Cargo", (r) => r.main?.officeName ?? dash],
        ["Lugar", (r) => r.main?.placeLabel ?? dash],
        ["Partido", (r) => r.main?.party.acronym ?? dash],
        ["Idade", (r) => (age(r.p.birthDate) !== null ? `${age(r.p.birthDate)} anos` : dash)],
        ["Escolaridade", (r) => r.p.education ?? dash],
        ["No cargo desde", (r) => (r.main ? date(r.main.startedOn) : dash)],
      ],
    },
    {
      title: "Eleição",
      rows: [
        ["Última vitória", (r) => r.lastElected?.year ?? dash],
        ["Votos", (r) => (r.lastElected?.votes != null ? count(r.lastElected.votes) : dash)],
        ["Arrecadou na última vitória", (r) => (r.lastElected?.raisedCents != null ? money(r.lastElected.raisedCents) : dash)],
        ["Gastou na última vitória", (r) => (r.lastElected?.spentCents != null ? money(r.lastElected.spentCents) : dash)],
        ["Arrecadou, somando as campanhas", (r) => (r.camp.raisedCents !== null ? `${money(r.camp.raisedCents)} (${joinYears(r.camp.years)})` : dash)],
      ],
    },
    {
      title: "Patrimônio declarado",
      rows: [
        ["Mais recente", (r) => (r.latest ? `${money(r.latest.assetsCents!)} (${r.latest.year})` : dash)],
        ["Mais antigo", (r) => (r.first && r.first !== r.latest ? `${money(r.first.assetsCents!)} (${r.first.year})` : dash)],
        ["Variação", (r) => (r.first && r.latest && r.first !== r.latest ? `${Math.round((r.latest.assetsCents! / r.first.assetsCents! - 1) * 100)}%` : dash)],
      ],
    },
    {
      title: year ? `Atividade em ${year}` : since ? `Atividade desde ${since} (o que está carregado)` : "Atividade na carreira",
      rows: [
        ["Presença em sessões deliberativas", (r) => (r.stats.presenceTotal ? `${Math.round(((r.stats.presencePresent ?? 0) / r.stats.presenceTotal) * 100)}% (${count(r.stats.presencePresent ?? 0)} de ${count(r.stats.presenceTotal)})` : <span title={r.stats.missing.find((m) => m.dataset === "presenca")?.reason}>{dash}</span>)],
        ["Propostas como autor(a)", (r) => (r.stats.proposalsPrincipal === null ? dash : count(r.stats.proposalsPrincipal))],
        ["Votos em plenário", (r) => (r.stats.votesRegistered === null ? dash : count(r.stats.votesRegistered))],
        ["Gastos do gabinete", (r) => (r.stats.expensesCents === null ? dash : money(r.stats.expensesCents))],
      ],
    },
  ];

  return (
    <>
      <nav aria-label="Período da atividade" className="mb-4">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <li>
            <LinkChip href={periodHref(null)} active={!year}>
              Carreira
            </LinkChip>
          </li>
          {years.map((y) => (
            <li key={y}>
              <LinkChip href={periodHref(y)} active={year === y}>
                {y}
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>

      <div tabIndex={0} role="region" aria-label="Tabela de comparação" className="relative overflow-x-auto rounded-md border border-border bg-surface outline-none focus-visible:outline-2 focus-visible:outline-focus">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Comparação de {people.map((p) => p.displayName).join(", ")}</caption>
          <thead>
            <tr className="border-b border-border">
              <td className="sticky left-0 w-40 bg-surface" />
              {rows.map(({ p, main }) => (
                <th key={p.id} scope="col" className="min-w-40 p-3 text-left align-top font-normal">
                  <Link href={`/p/${p.slug}`} className="block font-semibold text-fg underline-offset-2 hover:underline">
                    {p.displayName}
                  </Link>
                  <span className="block text-xs text-muted">{main ? `${main.officeName} · ${main.placeLabel}` : ""}</span>
                  <Link
                    href={without(p.slug)}
                    className="mt-2 inline-flex h-7 items-center gap-1 rounded-pill px-2 text-xs font-semibold text-muted outline-none hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <X aria-hidden className="size-3.5" /> Tirar <span className="sr-only">{p.displayName}</span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title}>
              <tr>
                <th scope="colgroup" colSpan={rows.length + 1} className="bg-surface-sunken px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  {g.title}
                </th>
              </tr>
              {g.rows.map(([label, fn]) => (
                <tr key={label} className="border-b border-border last:border-0">
                  <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-normal text-muted">
                    {label}
                  </th>
                  {rows.map((r) => (
                    <td key={r.p.id} className="px-3 py-2 tabular text-fg">
                      {fn(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <p className="mt-2 text-xs text-muted">
        Presença: lista oficial de presença da Câmara nas sessões deliberativas do plenário (a página da Câmara conta dias, então o número pode diferir; ver <Link href="/sobre#presenca" className="underline underline-offset-2">como contamos</Link>). O Senado não publica a lista de presença por senador, por isso “—”.
      </p>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted" data-testid="comparar-fontes" aria-label="Fontes de cada bloco da tabela">
        {sourceLines.map((l, i) => (
          <li key={`${i}-${l.label}`}>
            {l.label}: Fonte:{" "}
            <a href={l.href} className="underline underline-offset-2 hover:text-fg">
              {l.source}
            </a>{" "}
            · atualizado em <time dateTime={l.updatedAt}>{date(l.updatedAt)}</time>
          </li>
        ))}
      </ul>
      {hasOther && <p className="mt-1 text-xs text-muted">Para Assembleias Legislativas e Câmaras Municipais, a fonte e a data de presença, propostas, votos e gastos estão no crachá de cada pessoa.</p>}

      <section aria-labelledby="iguais-h" className="mt-8">
        <h2 id="iguais-h" className="text-xl text-fg">
          Votaram igual?
        </h2>
        <p className="mb-3 text-sm text-muted">
          Só votações nominais em que as duas pessoas registraram voto{year ? ` em ${year}` : since ? `, desde ${since} (o que está carregado)` : ""}. Ausência não conta como divergência.
        </p>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {agreement.map((a) => (
            <li key={`${a.a}-${a.b}`} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
              <span className="text-sm font-semibold text-fg">
                {nameOf[a.a]} e {nameOf[a.b]}
              </span>
              {a.total === 0 ? (
                <span className="text-sm text-muted">Nenhuma votação em comum (casas ou períodos diferentes).</span>
              ) : (
                <span className="text-sm text-fg">
                  <strong className="tabular">{Math.round((a.same / a.total) * 100)}%</strong> iguais · {count(a.same)} de {count(a.total)} votações
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Divergences people={people} year={year} since={since} sp={sp} />
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </>
  );
}

const VOTE_LABEL: Record<string, string> = { sim: "Sim", nao: "Não", abstencao: "Abstenção", obstrucao: "Obstrução" };
const STEP = 20;

/** W1 item 8: em que o par escolhido votou diferente, com filtro por tema e "mostrar mais"; tudo na URL. Ordem: data. */
async function Divergences({ people, year, since, sp }: { people: Person[]; year: number | null; since: number | null; sp: Awaited<SP> }) {
  const slugs = people.map((p) => p.slug);
  const want = (sp.par ?? "").split(",").filter((x) => slugs.includes(x));
  const [a, b] = want.length === 2 && want[0] !== want[1] ? want.map((x) => people.find((p) => p.slug === x)!) : [people[0], people[1]];
  const shown = Math.min(Math.max(Number(sp.nd) || STEP, STEP), 400);
  const topicsAll = await data.listTopics();
  const tema = topicsAll.some((t) => t.slug === sp.tema) ? sp.tema : undefined;
  const page = await data.listDisagreements(a.id, b.id, { year: year ?? undefined, topic: tema, limit: shown });
  const topicName = Object.fromEntries(topicsAll.map((t) => [t.slug, t.name]));
  const qs = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string | undefined> = { p: slugs.join(","), periodo: year ? String(year) : undefined, par: `${a.slug},${b.slug}`, tema, nd: undefined, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) u.set(k, v);
    return `/comparar?${u.toString()}`;
  };
  const pairs: [Person, Person][] = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) pairs.push([people[i], people[j]]);
  return (
    <section aria-labelledby="diferente-h" id="diferente" className="mt-8 scroll-mt-28">
      <h2 id="diferente-h" className="text-xl text-fg">
        Em que votaram diferente
      </h2>
      <p className="mb-3 text-sm text-muted">
        Votações nominais em que {a.displayName} e {b.displayName} registraram votos diferentes{year ? ` em ${year}` : since ? `, desde ${since}` : ""}, da mais recente para a mais
        antiga. Ausência não entra.
      </p>
      {pairs.length > 1 && (
        <nav aria-label="Escolher o par" className="mb-3">
          <ul className="flex flex-wrap gap-2">
            {pairs.map(([x, y]) => (
              <li key={`${x.slug}-${y.slug}`}>
                <LinkChip href={qs({ par: `${x.slug},${y.slug}`, tema: undefined })} active={(x.slug === a.slug && y.slug === b.slug) || (x.slug === b.slug && y.slug === a.slug)}>
                  {x.displayName} × {y.displayName}
                </LinkChip>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <form action="/comparar#diferente" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="p" value={slugs.join(",")} />
        {year && <input type="hidden" name="periodo" value={year} />}
        <input type="hidden" name="par" value={`${a.slug},${b.slug}`} />
        <SelectField
          label="Tema"
          name="tema"
          value={tema}
          options={[{ value: "", label: "Todos os temas" }, ...page.topics.map((t) => ({ value: t.slug, label: `${topicName[t.slug] ?? t.slug} (${count(t.count)})` }))]}
        />
        <button type="submit" className="h-10 rounded-pill bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Filtrar
        </button>
      </form>
      <p className="mb-2 text-sm text-fg" data-testid="divergencias-total">
        <strong className="tabular">{count(page.total)}</strong> {page.total === 1 ? "votação" : "votações"} com votos diferentes{tema ? ` em ${topicName[tema]}` : ""}.
      </p>
      {page.items.length === 0 ? (
        <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted">
          {tema ? "Nenhuma votação com votos diferentes neste tema." : "Sem votação com votos diferentes entre os dois (casas ou períodos diferentes, ou votaram sempre igual)."}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface px-4" data-testid="divergencias">
          {page.items.map((d) => (
            <li key={d.event.id} className="relative flex flex-col gap-1.5 py-3">
              <Link href={`/votacoes/${d.event.id}`} className="text-sm text-fg outline-none after:absolute after:inset-0 hover:underline focus-visible:after:outline-2 focus-visible:after:outline-focus">
                {d.event.proposalLabel && <span className="font-mono font-semibold">{d.event.proposalLabel}: </span>}
                {d.event.description.slice(0, 200)}
                {d.event.description.length > 200 ? "…" : ""}
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <time dateTime={d.event.occurredAt}>{date(d.event.occurredAt)}</time>
                <span>
                  {a.displayName}: <strong className="text-fg">{VOTE_LABEL[d.a]}</strong>
                </span>
                <span>
                  {b.displayName}: <strong className="text-fg">{VOTE_LABEL[d.b]}</strong>
                </span>
                {d.event.topic && topicName[d.event.topic] && <span>{topicName[d.event.topic]}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {page.total > page.items.length && (
        <Link
          href={`${qs({ nd: String(shown + STEP) })}#diferente`}
          scroll={false}
          className="mt-3 inline-flex h-10 items-center rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Mostrar mais {Math.min(page.total - page.items.length, STEP)} de {count(page.total - page.items.length)}
        </Link>
      )}
    </section>
  );
}
