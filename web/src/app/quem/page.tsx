import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { HolderGrid } from "@/components/people/holder-card";
import { LinkChip, SelectField, fieldCls, hrefWith, type Params } from "@/components/profile/ui";
import { SourceFooter } from "@/components/ui/data";
import { data, type OfficeSlug } from "@/lib/data";
import { count } from "@/lib/format";

export const metadata: Metadata = { title: "Quem é quem", description: "Todas as pessoas no cargo, com filtro por nome, cargo, estado e partido." };

const PAGE = 60;
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const [offices, ufs, parties, stamp] = await Promise.all([data.listOffices(), data.listUfs(), data.listParties(), data.getStamp("tse.candidatos")]);
  // filtro inválido some, nunca derruba a página
  const office = offices.some((o) => o.slug === sp.cargo) ? (sp.cargo as OfficeSlug) : undefined;
  const uf = ufs.some((u) => u.uf === sp.uf?.toUpperCase()) ? sp.uf!.toUpperCase() : undefined;
  const party = parties.some((p) => p.id === sp.partido) ? sp.partido : undefined;
  const letter = sp.letra && LETTERS.includes(sp.letra) ? sp.letra : undefined;
  const q = sp.nome?.trim().slice(0, 80) || undefined;
  const cursor = /^\d{1,6}$/.test(sp.pagina ?? "") ? sp.pagina : undefined;
  const clean: Params = { nome: q, cargo: office, uf, partido: party, letra: letter };

  const page = await data.listPeople({ q, office, uf, party, letter, cursor, limit: PAGE });
  const from = Number(cursor ?? 0);
  const filtered = Object.values(clean).some(Boolean);

  return (
    <Container>
      <PageHeader title="Quem é quem" lead="Todas as pessoas no cargo agora. Filtre por nome, cargo, estado ou partido." />

      <form action="/quem" className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        {letter && <input type="hidden" name="letra" value={letter} />}
        <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold text-fg md:col-span-1">
          Nome
          <input type="search" name="nome" defaultValue={q} maxLength={80} autoComplete="off" placeholder="Ex.: Ana, Teixeira" className={fieldCls} />
        </label>
        <SelectField label="Cargo" name="cargo" value={office} options={[{ value: "", label: "Todos" }, ...offices.map((o) => ({ value: o.slug, label: o.nameM }))]} />
        <SelectField label="Estado" name="uf" value={uf} options={[{ value: "", label: "Todos" }, ...ufs.map((u) => ({ value: u.uf!, label: u.name }))]} />
        <SelectField label="Partido" name="partido" value={party} options={[{ value: "", label: "Todos" }, ...parties.map((p) => ({ value: p.id, label: `${p.acronym} · ${p.name}` }))]} />
        <button type="submit" className="col-span-2 h-10 self-end rounded-pill bg-accent px-5 text-sm font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:col-span-1">
          Buscar
        </button>
      </form>

      <nav aria-label="Primeira letra do nome" className="mt-4">
        <ul className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
          <li>
            <LinkChip href={hrefWith("/quem", clean, { letra: undefined })} active={!letter}>
              Todas
            </LinkChip>
          </li>
          {LETTERS.map((l) => (
            <li key={l}>
              <LinkChip href={hrefWith("/quem", clean, { letra: l })} active={letter === l}>
                <span className="w-3 text-center uppercase">{l}</span>
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-fg" aria-live="polite">
          <strong>{count(page.total)}</strong> {page.total === 1 ? "pessoa" : "pessoas"}
          {page.total > PAGE && ` · mostrando ${count(from + 1)}–${count(from + page.items.length)}`}
        </p>
        {filtered && (
          <Link href="/quem" className="text-sm font-semibold text-accent-text underline underline-offset-2">
            Limpar filtros
          </Link>
        )}
      </div>

      {page.items.length ? (
        <HolderGrid people={page.items} showPlace />
      ) : (
        <p className="rounded-md bg-surface-sunken px-4 py-10 text-center text-sm text-muted">
          Ninguém no cargo com esses filtros. Tente tirar um deles ou buscar só o sobrenome.
        </p>
      )}

      {(from > 0 || page.nextCursor) && (
        <nav aria-label="Páginas" className="mt-6 flex justify-between gap-3">
          {from > 0 ? <LinkChip scroll href={hrefWith("/quem", clean, { pagina: from - PAGE > 0 ? String(from - PAGE) : undefined })}>← Anteriores</LinkChip> : <span />}
          {page.nextCursor && <LinkChip scroll href={hrefWith("/quem", clean, { pagina: page.nextCursor })}>Próximas →</LinkChip>}
        </nav>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
    </Container>
  );
}
