import { ArrowLeft, Bell, Flag, MessageSquareReply } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { FollowButton } from "@/components/account/forms";
import { Container } from "@/components/page/page-header";
import { currentUser } from "@/lib/auth";
import { isFollowing } from "@/lib/follows";
import { Avatar } from "@/components/people/holder-card";
import { ShareButton, WhatsAppLink } from "@/components/people/share";
import { Assets, Committees, Contact, Elections, Expenses, Laws, MandateCost, NotLoadedYet, Proposals, Speeches, Votes } from "@/components/profile/sections";
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
  // meses de mandato no período (para o custo): ano escolhido ou soma dos mandatos já exercidos
  const months = mandates
    .filter((m) => m.status !== "eleito_aguardando_posse")
    .reduce((acc, m) => {
      const start = new Date(`${m.startedOn}T12:00:00Z`);
      const end = new Date(Math.min(new Date(`${m.endsOn}T12:00:00Z`).getTime(), Date.now()));
      const a = yearParam ? new Date(Math.max(start.getTime(), Date.UTC(yearParam, 0, 1))) : start;
      const b = yearParam ? new Date(Math.min(end.getTime(), Date.UTC(yearParam, 11, 31))) : end;
      return acc + Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1);
    }, 0);
  const wins = [...new Set(candidacies.filter((c) => c.result.startsWith("eleito")).map((c) => c.year))].sort((a, b) => a - b);
  const placeUf = main ? (await data.getPlace(main.placeIbge))?.uf : null;
  const user = await currentUser();
  const following = user ? await isFollowing(user.id, person.id).catch(() => false) : false;

  return (
    <Container>
      {/* cabeçalho: o nome é o título da página; cargo e lugar vêm antes, como contexto */}
      <header className="rounded-lg border border-border bg-surface p-5 md:p-8">
        {main && (
          <nav aria-label="Você está em" className="mb-3">
            <Link
              href={main.placeIbge === "BR" ? "/representantes" : /^\d{7}$/.test(main.placeIbge) ? `/representantes?cidade=${main.placeIbge}` : `/representantes?uf=${placeUf ?? ""}`}
              className="inline-flex h-8 items-center gap-1 rounded-pill bg-surface-sunken px-3 text-xs font-semibold text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <ArrowLeft aria-hidden className="size-3.5" /> {main.placeLabel}
            </Link>
          </nav>
        )}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {main && (
              <p className="text-sm font-semibold text-muted">
                {main.officeName} · {main.placeLabel} ·{" "}
                <abbr title={main.party.name} className="no-underline">
                  {main.party.acronym}
                </abbr>
              </p>
            )}
            <h1 className="mt-1 font-display text-hero leading-none break-words text-fg">{person.displayName}</h1>
            {wins.length > 0 && (
              <p className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex h-7 items-center rounded-pill bg-surface-sunken px-3 text-xs font-semibold text-fg">
                  {f ? "Eleita" : "Eleito"} {wins.length === 1 ? "em" : `${wins.length} vezes:`} {wins.join(", ")}
                </span>
              </p>
            )}
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {yrs !== null && <Fact term="Idade" value={`${yrs} anos`} />}
              {birthplace && <Fact term="Natural de" value={birthplace.kind === "municipio" ? `${birthplace.name} (${birthplace.uf})` : birthplace.name} />}
              {person.education && <Fact term="Escolaridade" value={person.education} />}
              {person.civilName !== person.displayName && <Fact term="Nome civil" value={person.civilName} />}
            </dl>
          </div>
          <Avatar name={person.displayName} size="lg" />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <CompareToggle slug={person.slug} name={person.displayName} />
          {user ? (
            <FollowButton slug={person.slug} name={person.displayName} following={following} />
          ) : (
            <Link
              href={`/entrar?volta=${encodeURIComponent(base)}&seguir=${person.slug}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3 text-sm font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Bell aria-hidden className="size-4" /> Acompanhar
            </Link>
          )}
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
      </header>

      {/* mandatos */}
      <section aria-labelledby="mandatos-h" className="mt-8">
        <h2 id="mandatos-h" className="sr-only">
          Mandatos
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                sub={stats.presenceTotal ? `${count(stats.presencePresent ?? 0)} de ${count(stats.presenceTotal)} sessões deliberativas` : missingOf("presenca")?.reason}
                help="Sessões deliberativas do plenário em que o nome está na lista oficial de presença da Câmara, entre as realizadas enquanto a pessoa estava em exercício. A lista não traz justificativa: ausência justificada conta como ausência. O Senado não publica lista de presença por senador."
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

      {full && <YearSummary stats={stats} periodLabel={periodLabel} f={f} />}

      <div className="mt-8 flex flex-col gap-6">
        {full && (
          <>
            <Proposals personId={person.id} base={base} sp={sp} year={yearParam} f={f} />
            <Votes personId={person.id} base={base} sp={sp} year={yearParam} body={main.office === "senador" ? "senado" : "camara"} />
            <Expenses personId={person.id} base={base} sp={sp} year={yearParam} body={main.office === "senador" ? "senado" : "camara"} />
            <Laws personId={person.id} f={f} />
            <Committees personId={person.id} />
            <Speeches personId={person.id} base={base} sp={sp} year={yearParam} />
          </>
        )}
        <Assets candidacies={candidacies} />
        <Elections candidacies={candidacies} f={f} />
        {main && main.status === "em_exercicio" && <Contact personId={person.id} />}
        {full && (
          <MandateCost
            salaryMonthlyCents={stats.salaryIsCeiling ? null : stats.salaryMonthlyCents}
            months={months}
            expensesCents={stats.expensesCents}
            periodLabel={periodLabel}
          />
        )}
        {full && (
          <NotLoadedYet
            items={[
              { what: "Emendas parlamentares", why: "vêm do Portal da Transparência, que exige chave de acesso cadastrada; entra quando a chave for configurada" },
              { what: "Viagens oficiais", why: "a casa publica por missão, em formato que ainda não carregamos" },
              { what: "Equipe do gabinete", why: "nomes e salários dos assessores entram na próxima fase" },
            ]}
          />
        )}
      </div>

      <footer aria-labelledby="resposta-h" className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken p-4">
        <div className="max-w-[62ch]">
          <h2 id="resposta-h" className="text-base font-semibold text-fg">
            {f ? "É ela e discorda de algo aqui?" : "É ele e discorda de algo aqui?"}
          </h2>
          <p className="text-sm text-muted">
            Quem é citado, ou quem o representa, pode contestar um dado ou o jeito como ele aparece. Como tratamos o pedido:{" "}
            <Link href="/sobre#s-resposta" className="font-semibold text-fg underline underline-offset-2">
              direito de resposta
            </Link>
            .
          </p>
        </div>
        <Link
          href={`/sugestoes?tipo=resposta&p=${person.slug}`}
          className="inline-flex h-10 items-center gap-2 rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <MessageSquareReply aria-hidden className="size-4" /> Direito de resposta
        </Link>
      </footer>
    </Container>
  );
}

async function YearSummary({ stats, periodLabel, f }: { stats: PeriodStats; periodLabel: string; f: boolean }) {
  const topics = await data.listTopics();
  const name = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  const share = stats.partyAlignmentTotal ? Math.round(((stats.partyAligned ?? 0) / stats.partyAlignmentTotal) * 100) : null;
  return (
    <section aria-labelledby="resumo-h" className="mt-6 grid gap-4 rounded-md border border-border bg-surface p-4 md:grid-cols-2 md:p-6">
      <h2 id="resumo-h" className="text-xl text-fg md:col-span-2">
        Resumo {periodLabel}
      </h2>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Temas mais presentes nas propostas</h3>
        {stats.topTopics.length ? (
          <ol className="flex flex-col gap-1.5">
            {stats.topTopics.map((t) => (
              <li key={t.topic} className="flex items-center justify-between gap-3 text-sm text-fg">
                <span>{name[t.topic] ?? t.topic}</span>
                <span className="tabular text-muted">
                  {count(t.count)} {t.count === 1 ? "proposta" : "propostas"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">Nenhuma proposta com tema classificado {periodLabel}.</p>
        )}
        <p className="mt-2 text-xs text-muted">Tema segundo a classificação oficial da casa, agrupada em 17 temas.</p>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Votos iguais à orientação do partido</h3>
        {share === null ? (
          <p className="text-sm text-muted">
            <span aria-label="não publicado pela fonte" title="A fonte oficial não publica este dado">
              —
            </span>{" "}
            sem votação com orientação do partido {periodLabel}.
          </p>
        ) : (
          <p className="text-sm text-fg">
            <span className="font-display text-xl tabular">{share}%</span>{" "}
            <span className="text-muted">
              ({count(stats.partyAligned ?? 0)} de {count(stats.partyAlignmentTotal ?? 0)} votações em que o partido {f ? "dela" : "dele"} orientou sim ou não)
            </span>
          </p>
        )}
        <p className="mt-2 text-xs text-muted">Descreve o voto, não avalia: seguir ou não a orientação é decisão de cada mandato.</p>
      </div>
    </section>
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
