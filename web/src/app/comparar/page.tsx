import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { PersonPicker } from "@/components/people/person-picker";
import { LinkChip } from "@/components/profile/ui";
import { NotPublished, SourceFooter } from "@/components/ui/data";
import { data, type Person } from "@/lib/data";
import { age, count, date, money } from "@/lib/format";

export const metadata: Metadata = { title: "Comparar", description: "De 2 a 5 pessoas lado a lado, com os mesmos dados oficiais." };

const MAX = 5;
const SLUG = /^[a-z0-9-]{1,120}$/;
type SP = Promise<{ p?: string; periodo?: string }>;

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
      {people.length < 2 ? <Presets have={people} /> : <CompareTable people={people} periodoRaw={sp.periodo} />}
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
      <ul className="grid gap-3 md:grid-cols-2">
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

async function CompareTable({ people, periodoRaw }: { people: Person[]; periodoRaw?: string }) {
  const years = [...new Set((await Promise.all(people.map((p) => data.getActiveYears(p.id)))).flat())].sort((a, b) => b - a).slice(0, 6);
  const year = periodoRaw && years.includes(Number(periodoRaw)) ? Number(periodoRaw) : null;
  const period = year ? (String(year) as `${number}`) : ("career" as const);
  const rows = await Promise.all(
    people.map(async (p) => {
      const [mandates, cands, stats] = await Promise.all([data.getMandates(p.id), data.getCandidacies(p.id), data.getStats(p.id, period)]);
      const main = mandates.find((m) => m.status === "em_exercicio") ?? mandates[0];
      const lastElected = cands.find((c) => c.result.startsWith("eleito"));
      const decl = cands.filter((c) => c.assetsCents !== null);
      return { p, main, lastElected, latest: decl[0], first: decl[decl.length - 1], stats };
    }),
  );
  const agreement = await data.getAgreement(people.map((p) => p.id), year ?? "career");
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.displayName]));
  const slugs = people.map((p) => p.slug);
  const without = (s: string) => `/comparar?p=${slugs.filter((x) => x !== s).join(",")}${year ? `&periodo=${year}` : ""}`;
  const periodHref = (y: number | null) => `/comparar?p=${slugs.join(",")}${y ? `&periodo=${y}` : ""}`;
  const stamp = await data.getStamp("tse.candidatos");
  const dash = <NotPublished />;
  const pct = (a: number | null, b: number | null) => (a === null || !b ? dash : `${Math.round((a / b) * 100)}%`);

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
        ["Votos", (r) => (r.lastElected ? count(r.lastElected.votes) : dash)],
        ["Arrecadou", (r) => (r.lastElected?.raisedCents != null ? money(r.lastElected.raisedCents) : dash)],
        ["Gastou", (r) => (r.lastElected?.spentCents != null ? money(r.lastElected.spentCents) : dash)],
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
      title: year ? `Atividade em ${year}` : "Atividade na carreira",
      rows: [
        ["Presença", (r) => pct(r.stats.presencePresent, r.stats.presenceTotal)],
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

      <div tabIndex={0} role="region" aria-label="Tabela de comparação" className="overflow-x-auto rounded-md border border-border bg-surface outline-none focus-visible:outline-2 focus-visible:outline-focus">
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

      <section aria-labelledby="iguais-h" className="mt-8">
        <h2 id="iguais-h" className="text-xl text-fg">
          Votaram igual?
        </h2>
        <p className="mb-3 text-sm text-muted">
          Só votações nominais em que as duas pessoas registraram voto{year ? ` em ${year}` : ""}. Ausência não conta como divergência.
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
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
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </>
  );
}
