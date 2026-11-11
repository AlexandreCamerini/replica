import type { Metadata } from "next";
import Link from "next/link";
import { fmtInt } from "@/components/sv/fmt";
import { Gap, Item, Label, List, Src } from "@/components/sv/ui";
import { data, type Officeholder, type OfficeSlug } from "@/lib/data";

export const metadata: Metadata = { title: "Pessoas" };

const SLUGS: OfficeSlug[] = ["presidente", "vice_presidente", "senador", "deputado_federal", "governador", "vice_governador", "deputado_estadual", "deputado_distrital", "prefeito", "vice_prefeito", "vereador"];
const isOffice = (s: string | undefined): s is OfficeSlug => !!s && (SLUGS as string[]).includes(s);

function People({ items }: { items: Officeholder[] }) {
  // A–Z sempre: nenhuma lista de pessoas tem ordem de mérito.
  const sorted = [...items].sort((a, b) => a.person.displayName.localeCompare(b.person.displayName, "pt-BR"));
  return (
    <List>
      {sorted.map((h) => (
        <Item key={`${h.person.id}-${h.mandate.id}`} href={`/v2/pessoa/${h.person.slug}`} title={h.person.displayName} note={`${h.officeName}, ${h.placeLabel}`} value={h.party.acronym} />
      ))}
    </List>
  );
}

export default async function Pessoas({ searchParams }: { searchParams: Promise<{ nome?: string; cargo?: string; uf?: string; cidade?: string; grupo?: string; pagina?: string }> }) {
  const raw = await searchParams;
  // parâmetro repetido chega como array: só string vale, o resto é ignorado (nunca erro 500)
  const so = (v: unknown) => (typeof v === "string" ? v : undefined);
  const sp = { nome: so(raw.nome), cargo: so(raw.cargo), uf: so(raw.uf), cidade: so(raw.cidade), grupo: so(raw.grupo), pagina: so(raw.pagina) };
  const q = (sp.nome ?? "").trim().slice(0, 80);
  const office = isOffice(sp.cargo) ? sp.cargo : undefined;
  const uf = sp.uf && /^[A-Za-z]{2}$/.test(sp.uf) ? sp.uf.toUpperCase() : undefined;

  // Vindo da Entrada: as pessoas de um grupo (ex.: vereadores) de um lugar.
  if (sp.cidade && /^\d{2,7}$/.test(sp.cidade)) {
    const place = sp.cidade.length === 7 ? await data.getPlace(sp.cidade) : null;
    const groups = place ? await data.getRepresentatives(place) : [];
    const group = groups.find((g) => g.key === sp.grupo) ?? null;
    if (place && group) {
      return (
        <>
          <Label>
            <Link href={`/v2?cidade=${place.ibge}`}>
              {place.name}
              {place.uf ? `, ${place.uf}` : ""}
            </Link>
          </Label>
          <h1 className="sv-title sv-mt-1">{group.title}</h1>
          <p className="sv-lead sv-mt-2">
            {group.where}. {group.seats ? `${group.seats.loaded} de ${group.seats.total} cadeiras carregadas: ${group.seats.why}` : `${group.people.length} no cargo hoje.`}
          </p>
          <div className="sv-mt-4">{group.people.length === 0 ? <Gap>Não consta. Ninguém carregado para este grupo.</Gap> : <People items={group.people} />}</div>
          {group.gaps && group.gaps.length > 0 && (
            <div className="sv-mt-5">
              <Label>O que ainda não consta</Label>
              <List>
                {group.gaps.map((g) => (
                  <Item key={g.what} title={g.what} note={g.why} value="não consta" />
                ))}
              </List>
            </div>
          )}
          <Src>Fonte: TSE, dados abertos, e as casas legislativas.</Src>
        </>
      );
    }
  }

  const [offices, ufs, page] = await Promise.all([data.listOffices(), data.listUfs(), data.listPeople({ q: q || undefined, office, uf, cursor: sp.pagina, limit: 60 })]);
  const next = new URLSearchParams();
  if (q) next.set("nome", q);
  if (office) next.set("cargo", office);
  if (uf) next.set("uf", uf);
  if (page.nextCursor) next.set("pagina", page.nextCursor);

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <h1 className="sv-title">Pessoas</h1>
          <p className="sv-lead sv-mt-2">Quem ocupa cargo eletivo hoje. Procure pelo nome ou filtre por cargo e estado.</p>
          <form className="sv-form" action="/v2/pessoas" method="get" role="search" style={{ flexDirection: "column" }}>
            <label className="sv-label" htmlFor="nome">
              Nome
            </label>
            <input className="sv-input" id="nome" name="nome" defaultValue={q} maxLength={80} autoComplete="off" style={{ flex: "none" }} />
            <label className="sv-label" htmlFor="cargo">
              Cargo
            </label>
            <select className="sv-input" id="cargo" name="cargo" defaultValue={office ?? ""} style={{ flex: "none" }}>
              <option value="">Todos</option>
              {offices.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.nameM}
                </option>
              ))}
            </select>
            <label className="sv-label" htmlFor="uf">
              Estado
            </label>
            <select className="sv-input" id="uf" name="uf" defaultValue={uf ?? ""} style={{ flex: "none" }}>
              <option value="">Todos</option>
              {ufs.map((u) => (
                <option key={u.ibge} value={u.uf ?? ""}>
                  {u.name}
                </option>
              ))}
            </select>
            <button className="sv-btn" type="submit" style={{ alignSelf: "flex-start", marginTop: 6 }}>
              Procurar
            </button>
          </form>
        </div>

        <div>
          <Label>{fmtInt(page.total)} pessoas, em ordem alfabética</Label>
          {page.items.length === 0 ? <Gap>Nenhuma pessoa encontrada com esses filtros.</Gap> : <People items={page.items} />}
          {page.nextCursor && (
            <Link className="sv-more" href={`/v2/pessoas?${next.toString()}`}>
              Próximas 60
            </Link>
          )}
        </div>
      </div>
      <Src>Fonte: TSE, dados abertos, e as casas legislativas.</Src>
    </>
  );
}
