import { Bell, Flag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Container } from "@/components/page/page-header";
import { Avatar } from "@/components/people/holder-card";
import { ShareButton, WhatsAppLink } from "@/components/people/share";
import { Assets, Elections, Expenses, Proposals, Votes } from "@/components/profile/sections";
import { LinkChip, hrefWith, type Params } from "@/components/profile/ui";
import { CompareToggle } from "@/components/shell/compare";
import { MissingDataNote, StatTile } from "@/components/ui/data";
import { ListenButton } from "@/components/ui/misc";
import { data, type MandateStatus, type PeriodStats } from "@/lib/data";
import { age, count, date, money } from "@/lib/format";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Params> };

const FULL_DATA = new Set(["deputado_federal", "senador"]);
const LEGISLATIVE = new Set(["senador", "deputado_federal", "deputado_estadual", "deputado_distrital", "vereador"]);

async function load(slug: string) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  const r = await data.getPerson(slug);
  if (!r) return null;
  if (r.redirectTo) permanentRedirect(`/p/${r.redirectTo}`);
  return r.person;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const person = await load((await params).slug);
  if (!person) return { title: "Pessoa não encontrada" };
  const [m] = await data.getMandates(person.id);
  return {
    title: person.displayName,
    description: m ? `${m.officeName} · ${m.placeLabel}. Mandatos, votos, propostas, gastos e patrimônio com fonte oficial.` : undefined,
  };
}

export default async function Page({ params, searchParams }: Props) {
  const slug = (await params).slug;
  const person = await load(slug);
  if (!person) notFound();
  const sp = await searchParams;

  const [mandates, candidacies, years] = await Promise.all([data.getMandates(person.id), data.getCandidacies(person.id), data.getActiveYears(person.id)]);
  const main = mandates.find((m) => m.status === "em_exercicio") ?? mandates[0];
  const yearParam = sp.ano && years.includes(Number(sp.ano)) ? Number(sp.ano) : null;
  const period: PeriodStats["period"] = yearParam ? (String(yearParam) as `${number}`) : "career";
  const stats = await data.getStats(person.id, period);

  const legislative = !!main && LEGISLATIVE.has(main.office);
  const full = !!main && FULL_DATA.has(main.office);
  const base = `/p/${person.slug}`;
  const elected = candidacies.find((c) => c.result.startsWith("eleito"));
  const withAssets = candidacies.find((c) => c.assetsCents !== null);
  const missingOf = (d: string) => stats.missing.find((m) => m.dataset === d);
  const f = person.gender === "f";
  const yrs = age(person.birthDate);
  const [birthplace] = person.birthplaceIbge ? await Promise.all([data.getPlace(person.birthplaceIbge)]) : [null];
  const periodLabel = yearParam ? `em ${yearParam}` : "na carreira";

  return (
    <Container>
      {/* cabeçalho */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <Avatar name={person.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-display break-words text-fg">{person.displayName}</h1>
          {main && (
            <p className="mt-1 text-base text-fg">
              {main.officeName} · {main.placeLabel} ·{" "}
              <abbr title={main.party.name} className="no-underline">
                {main.party.acronym}
              </abbr>
            </p>
          )}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {yrs !== null && <Fact term="Idade" value={`${yrs} anos`} />}
            {birthplace && <Fact term="Natural de" value={birthplace.kind === "municipio" ? `${birthplace.name} (${birthplace.uf})` : birthplace.name} />}
            {person.education && <Fact term="Escolaridade" value={person.education} />}
            {person.civilName !== person.displayName && <Fact term="Nome civil" value={person.civilName} />}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <CompareToggle slug={person.slug} name={person.displayName} />
            <Link
              href={`/entrar?volta=${encodeURIComponent(base)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3 text-sm font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Bell aria-hidden className="size-4" /> Acompanhar
            </Link>
            <ShareButton title={person.displayName} path={base} />
            <WhatsAppLink text={`${person.displayName}: votos, gastos e patrimônio com fonte oficial.`} path={base} />
            <ListenButton />
            <Link
              href={`/sugestoes?tipo=erro&p=${person.slug}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold text-muted outline-none hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Flag aria-hidden className="size-4" /> Reportar erro
            </Link>
          </div>
        </div>
      </header>

      {/* mandatos */}
      <section aria-labelledby="mandatos-h" className="mt-8">
        <h2 id="mandatos-h" className="sr-only">
          Mandatos
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {mandates
            .filter((m) => m.status !== "encerrado")
            .map((m) => (
              <li key={m.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
                <StatusBadge status={m.status} f={f} startedOn={m.startedOn} />
                <span className="font-semibold text-fg">
                  {m.officeName} · {m.placeLabel}
                </span>
                <span className="text-sm text-muted">
                  {m.party.name} · de {date(m.startedOn)} a {date(m.endsOn)}
                </span>
                <span className="text-xs text-muted">situação segundo o {m.statusSource.toUpperCase()}</span>
              </li>
            ))}
        </ul>
      </section>

      {/* período */}
      <nav aria-label="Período dos números" className="mt-8">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <li>
            <LinkChip href={hrefWith(base, sp, { ano: undefined, np: undefined, nv: undefined, ng: undefined })} active={!yearParam}>
              Toda a carreira
            </LinkChip>
          </li>
          {years.map((y) => (
            <li key={y}>
              <LinkChip href={hrefWith(base, sp, { ano: String(y), np: undefined, nv: undefined, ng: undefined })} active={yearParam === y}>
                {y}
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>

      {/* números */}
      <section aria-labelledby="numeros-h" className="mt-4">
        <h2 id="numeros-h" className="sr-only">
          Números {periodLabel}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            value={stats.salaryMonthlyCents}
            kind="money"
            ceiling={stats.salaryIsCeiling}
            label={stats.salaryIsCeiling ? "teto do salário" : "salário por mês"}
            sub={stats.salaryIsCeiling ? "o valor pago não é publicado" : stats.salaryMonthlyCents ? "valor bruto" : missingOf("salario")?.reason}
            help={
              stats.salaryIsCeiling
                ? "Limite que a Constituição permite para este cargo neste lugar. O órgão não publica quanto paga de fato."
                : "Subsídio bruto mensal, antes de descontos, conforme o órgão publica."
            }
          />
          <StatTile
            value={withAssets?.assetsCents ?? null}
            kind="money"
            label="patrimônio declarado"
            sub={withAssets ? `declarado ao TSE em ${withAssets.year}` : "sem declaração publicada"}
            help="Bens que a própria pessoa declarou ao registrar a candidatura. Não é auditado pelo TSE."
          />
          <StatTile value={elected?.votes ?? null} kind="count" label="votos recebidos" sub={elected ? `eleição de ${elected.year}` : undefined} />
          <StatTile
            value={elected?.raisedCents ?? null}
            kind="money"
            label="arrecadou na campanha"
            sub={elected?.spentCents != null ? `gastou ${money(elected.spentCents)}` : elected ? "gastos não publicados" : undefined}
          />
          {legislative && (
            <>
              <StatTile
                value={stats.presenceTotal ? Math.round(((stats.presencePresent ?? 0) / stats.presenceTotal) * 100) : null}
                kind="percent"
                label={`presença ${periodLabel}`}
                sub={stats.presenceTotal ? `${count(stats.presencePresent ?? 0)} de ${count(stats.presenceTotal)} dias com votação` : missingOf("presenca")?.reason}
                help="Dias com votação nominal em plenário em que a pessoa registrou voto. Ausência justificada conta como ausência na fonte."
              />
              <StatTile
                value={stats.proposalsPrincipal}
                kind="count"
                label={`propostas ${periodLabel}`}
                sub={stats.proposalsPrincipal !== null ? `+ ${count(stats.proposalsCosigned ?? 0)} como ${f ? "coautora" : "coautor"}` : missingOf("propostas")?.reason}
              />
              <StatTile
                value={stats.votesRegistered}
                kind="count"
                label={`votos em plenário ${periodLabel}`}
                sub={stats.votesRegistered === null ? missingOf("votos")?.reason : undefined}
              />
              <StatTile
                value={stats.expensesCents}
                kind="money"
                label={`gastos do gabinete ${periodLabel}`}
                sub={stats.expensesCents === null ? missingOf("gastos_gabinete")?.reason : "cota para exercício do mandato"}
              />
            </>
          )}
        </div>
      </section>

      {stats.missing.length > 0 && (
        <div className="mt-6">
          <MissingDataNote items={stats.missing.map((m) => ({ what: m.label, why: m.reason }))} />
        </div>
      )}

      <div className="mt-8 flex flex-col gap-6">
        {full && (
          <>
            <Proposals personId={person.id} base={base} sp={sp} year={yearParam} f={f} />
            <Votes personId={person.id} base={base} sp={sp} year={yearParam} body={main.office === "senador" ? "senado" : "camara"} />
            <Expenses personId={person.id} base={base} sp={sp} year={yearParam} body={main.office === "senador" ? "senado" : "camara"} />
          </>
        )}
        <Assets candidacies={candidacies} />
        <Elections candidacies={candidacies} f={f} />
      </div>
    </Container>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{term}</dt>
      <dd className="font-semibold text-fg">{value}</dd>
    </div>
  );
}

function StatusBadge({ status, f, startedOn }: { status: MandateStatus; f: boolean; startedOn: string }) {
  const label: Record<MandateStatus, string> = {
    em_exercicio: "Em exercício",
    eleito_aguardando_posse: `${f ? "Eleita" : "Eleito"}, toma posse em ${date(startedOn)}`,
    licenciado: f ? "Licenciada" : "Licenciado",
    encerrado: "Encerrado",
  };
  return (
    <span
      className={
        status === "em_exercicio"
          ? "w-fit rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text"
          : "w-fit rounded-pill bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-fg"
      }
    >
      {label[status]}
    </span>
  );
}
