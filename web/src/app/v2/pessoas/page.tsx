import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/sv-pessoas.css";
import { fraseLida, lidoEm } from "@/components/sv/carimbo";
import { esferaDoCargo } from "@/components/sv/esfera";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { fmtInt } from "@/components/sv/fmt";
import { Lacuna, Nota, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { data, type Officeholder, type OfficeSlug } from "@/lib/data";

export const metadata: Metadata = { title: "Quem está no cargo?" };

const SLUGS: OfficeSlug[] = ["presidente", "vice_presidente", "senador", "deputado_federal", "governador", "vice_governador", "deputado_estadual", "deputado_distrital", "prefeito", "vice_prefeito", "vereador"];
const isOffice = (s: string | undefined): s is OfficeSlug => !!s && (SLUGS as string[]).includes(s);
const POR_PAGINA = 60;
const FONTE = "TSE, dados abertos, e as casas legislativas";

/** Pessoas sempre de A a Z: nenhuma lista de pessoas tem ordem de mérito. O link leva só o nome. */
function Pessoas({ items }: { items: Officeholder[] }) {
  const sorted = [...items].sort((a, b) => a.person.displayName.localeCompare(b.person.displayName, "pt-BR"));
  return (
    <ul className="sv-pp">
      {sorted.map((h) => {
        const esfera = esferaDoCargo(h.mandate.office);
        return (
          <li key={`${h.person.id}-${h.mandate.id}`}>
            <Link href={`/v2/pessoa/${h.person.slug}`}>{h.person.displayName}</Link>
            <span className="sv-pp__c">
              {h.officeName}, {h.placeLabel} · {h.party.acronym}
            </span>
            <span className="sv-esf">Esfera: {esfera ?? "ainda não temos esse dado"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PessoasPage({ searchParams }: { searchParams: Promise<{ nome?: string; cargo?: string; uf?: string; cidade?: string; grupo?: string; pagina?: string }> }) {
  const raw = await searchParams;
  // parâmetro repetido chega como array: só string vale, o resto é ignorado (nunca erro 500)
  const so = (v: unknown) => (typeof v === "string" ? v : undefined);
  const sp = { nome: so(raw.nome), cargo: so(raw.cargo), uf: so(raw.uf), cidade: so(raw.cidade), grupo: so(raw.grupo), pagina: so(raw.pagina) };
  const q = (sp.nome ?? "").trim().slice(0, 80);
  const office = isOffice(sp.cargo) ? sp.cargo : undefined;
  const uf = sp.uf && /^[A-Za-z]{2}$/.test(sp.uf) ? sp.uf.toUpperCase() : undefined;
  const stamp = await data.getStamp("tse.candidatos").catch(() => null);
  const fonte = `Fonte: ${FONTE}${fraseLida(stamp)}.`;

  // Vindo de um lugar: as pessoas de um grupo (ex.: vereadores) de uma cidade.
  if (sp.cidade && /^\d{7}$/.test(sp.cidade)) {
    const place = await data.getPlace(sp.cidade).catch(() => null);
    const groups = place ? await data.getRepresentatives(place).catch(() => null) : null;
    const group = groups?.find((g) => g.key === sp.grupo) ?? null;
    if (place && group) {
      const onde = `${place.name}${place.uf ? `, ${place.uf}` : ""}`;
      return (
        <div className="sv-pg sv-pg--pps">
          <div className="sv-folio sv-folio--dom">
            <h1>{group.title}</h1>
            <p className="sv-intro">
              {onde}. {group.where}.
            </p>
          </div>
          <Quadro id="pp-1" variante="dom" numero={1} pergunta={`Quantas pessoas estão no cargo em ${place.name}?`} className="sv-c5" prova={fonte}>
            {group.seats ? (
              <>
                <Resposta tamanho="dom">
                  {fmtInt(group.seats.loaded)} de {fmtInt(group.seats.total)} cadeiras carregadas.
                </Resposta>
                <p className="sv-t">{group.seats.why}</p>
              </>
            ) : (
              <Resposta tamanho="dom">{group.people.length === 1 ? "1 pessoa no cargo hoje." : `${fmtInt(group.people.length)} pessoas no cargo hoje.`}</Resposta>
            )}
          </Quadro>
          <Quadro
            id="pp-2"
            variante={group.people.length ? "padrao" : "lacuna"}
            numero={2}
            pergunta="Quem são, em ordem alfabética?"
            className="sv-c7"
            prova={
              <>
                <ExemploIlustrativo>Exemplo ilustrativo: pessoas inventadas para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. {fonte}
              </>
            }
          >
            {group.people.length === 0 ? <Lacuna motivo="Ninguém foi carregado para este grupo.">Ainda não temos esse dado.</Lacuna> : <Pessoas items={group.people} />}
          </Quadro>
          {group.gaps && group.gaps.length > 0 && (
            <Quadro id="pp-gaps" variante="lacuna" numero={3} pergunta="O que ainda não consta?" prova={fonte}>
              {group.gaps.map((g) => (
                <Lacuna key={g.what} motivo={g.why}>
                  {g.what}: ainda não temos esse dado.
                </Lacuna>
              ))}
            </Quadro>
          )}
          <Selo id="pp-selo" numero={group.gaps?.length ? 4 : 3} lidoEm={lidoEm(stamp)} className="sv-c7" />
          <Proxima href="/v2/pessoas" pergunta="Quem mais está no cargo?" className="sv-c5" />
        </div>
      );
    }
  }

  const [offices, ufs, page] = await Promise.all([
    data.listOffices().catch(() => []),
    data.listUfs().catch(() => []),
    data.listPeople({ q: q || undefined, office, uf, cursor: sp.pagina, limit: POR_PAGINA }).catch(() => null),
  ]);
  const next = new URLSearchParams();
  if (q) next.set("nome", q);
  if (office) next.set("cargo", office);
  if (uf) next.set("uf", uf);
  if (page?.nextCursor) next.set("pagina", page.nextCursor);
  const filtrou = !!(q || office || uf);
  const n = page?.items.length ?? 0;

  return (
    <div className="sv-pg sv-pg--pps">
      <div className="sv-folio sv-folio--dom">
        <h1>Quem está no cargo?</h1>
        <p className="sv-intro">Quem ocupa cargo eletivo hoje, em ordem alfabética. Procure pelo nome ou filtre por cargo e estado.</p>
      </div>

      <Quadro id="pp-1" numero={1} pergunta="Quem você procura?">
        <form className="sv-filtro" action="/v2/pessoas" method="get" role="search" aria-label="Procurar pessoas">
          <label htmlFor="pp-nome">Nome</label>
          <input className="sv-campo" id="pp-nome" name="nome" type="text" defaultValue={q} maxLength={80} autoComplete="off" />
          <label htmlFor="pp-cargo">Cargo</label>
          <select className="sv-campo" id="pp-cargo" name="cargo" defaultValue={office ?? ""}>
            <option value="">Todos os cargos</option>
            {offices.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.nameM}
              </option>
            ))}
          </select>
          <label htmlFor="pp-uf">Estado</label>
          <select className="sv-campo" id="pp-uf" name="uf" defaultValue={uf ?? ""}>
            <option value="">Todos os estados</option>
            {ufs.map((u) => (
              <option key={u.ibge} value={u.uf ?? ""}>
                {u.name}
              </option>
            ))}
          </select>
          <span className="sv-filtro__b" aria-hidden="true" />
          <button className="sv-enviar" type="submit">
            Procurar
          </button>
        </form>
        {filtrou && (
          <Link className="sv-lk" href="/v2/pessoas">
            Limpar os filtros
          </Link>
        )}
      </Quadro>

      <Quadro
        id="pp-2"
        variante={page && n > 0 ? "padrao" : "lacuna"}
        numero={2}
        pergunta={filtrou ? "Quem está no cargo, com esses filtros?" : "Quem está no cargo, em ordem alfabética?"}
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: pessoas inventadas para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética. {fonte}
          </>
        }
      >
        {!page ? (
          <Lacuna motivo="A lista de pessoas não pôde ser lida. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : n === 0 ? (
          <Lacuna>{filtrou ? "Nenhuma pessoa encontrada com esses filtros." : "Ninguém carregado ainda."}</Lacuna>
        ) : (
          <>
            <Resposta tamanho="m">
              {page.total === 1 ? "1 pessoa" : `${fmtInt(page.total)} pessoas`}
              {filtrou ? " com esses filtros" : " no cargo hoje"}, em ordem alfabética.
            </Resposta>
            {n < page.total && (
              <p className="sv-t">
                Esta página mostra {fmtInt(n)} de {fmtInt(page.total)}.
              </p>
            )}
            <Pessoas items={page.items} />
            {page.nextCursor && (
              <Link className="sv-lk" href={`/v2/pessoas?${next.toString()}`}>
                Próximas {POR_PAGINA} <span aria-hidden="true">→</span>
              </Link>
            )}
            <Nota>Partido é o da filiação vigente, como a fonte publica. Nenhuma lista tem ordem de mérito.</Nota>
          </>
        )}
      </Quadro>

      <Selo id="pp-selo" numero={3} lidoEm={lidoEm(stamp)} className="sv-c7" />
      <Proxima href="/v2/acompanhando" pergunta="O que meus escolhidos estão fazendo?" className="sv-c5" />
    </div>
  );
}
