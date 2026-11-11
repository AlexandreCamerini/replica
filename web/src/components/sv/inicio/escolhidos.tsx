import Link from "next/link";
import { clip } from "@/components/sv/fmt";
import { COOKIE_TEXTO } from "@/components/sv/prefs-shared";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { Cobertura, Lacuna, Nota, Quadro, VotoMarca } from "@/components/sv/ui";
import { data, type AssemblyInfo, type MandateStatus, type OfficeSlug, type PersonVote } from "@/lib/data";
import { dayKey, fmtLong } from "./datas";

// Esfera em palavra, derivada do cargo do mandato. Mesma forma para toda pessoa; sem estilo próprio por esfera.
const ESFERA: Record<OfficeSlug, string> = {
  presidente: "Federal · Presidência da República",
  vice_presidente: "Federal · Presidência da República",
  senador: "Federal · Senado Federal",
  deputado_federal: "Federal · Câmara dos Deputados",
  governador: "Estadual · Governo do estado",
  vice_governador: "Estadual · Governo do estado",
  deputado_estadual: "Estadual · Assembleia Legislativa",
  deputado_distrital: "Estadual · Câmara Legislativa do Distrito Federal",
  prefeito: "Municipal · Prefeitura",
  vice_prefeito: "Municipal · Prefeitura",
  vereador: "Municipal · Câmara de Vereadores",
};
const FONTE_VOTOS: Partial<Record<OfficeSlug, string>> = {
  senador: "Senado Federal, votações nominais",
  deputado_federal: "Câmara dos Deputados, votações nominais",
  vereador: "Câmara Municipal da cidade, quando publica votações nominais",
};
// Cargos do Executivo não votam em plenário: não há voto nominal a mostrar, e isso não é lacuna de dado.
const EXECUTIVO: ReadonlySet<OfficeSlug> = new Set(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
const STATUS: Partial<Record<MandateStatus, string>> = {
  eleito_aguardando_posse: "eleito, aguarda posse",
  licenciado: "licenciado",
  afastado: "afastado",
  encerrado: "mandato encerrado",
  renunciou: "renunciou",
  cassado: "cassado",
};

type Escolhido = {
  slug: string;
  nome: string;
  esfera: string | null;
  cargo: string;
  office: OfficeSlug | null;
  uf: string | null;
  votos: PersonVote[] | null;
};

async function carregar(slugs: string[]): Promise<Escolhido[]> {
  const rows = await Promise.all(
    slugs.map(async (slug): Promise<Escolhido | null> => {
      const r = await data.getPerson(slug).catch(() => null);
      if (!r) return null;
      const [mandates, votes] = await Promise.all([
        data.getMandates(r.person.id).catch(() => []),
        data.listVotes(r.person.id, { scope: "lei", limit: 3 }).catch(() => null),
      ]);
      const m = mandates.find((x) => x.status === "em_exercicio") ?? mandates[0] ?? null;
      const place = m ? await data.getPlace(m.placeIbge).catch(() => null) : null;
      const uf = place?.uf ?? null;
      const status = m ? STATUS[m.status] : undefined;
      const cargo = m ? [m.officeName, uf ?? m.placeLabel, `${m.party.acronym} (${m.party.name})`, status].filter(Boolean).join(" · ") : "Sem mandato carregado";
      return { slug: r.person.slug, nome: r.person.displayName, esfera: m ? ESFERA[m.office] : null, cargo, office: m?.office ?? null, uf, votos: votes ? votes.items : null };
    }),
  );
  return rows.filter((x): x is Escolhido => x !== null).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function SemVotos({ e, assembly }: { e: Escolhido; assembly: AssemblyInfo | null }) {
  // Estadual: a cobertura de votos da Assembleia vem do contrato. Federal: sem status, "Ainda não temos esse dado." + fonte.
  if (e.office && EXECUTIVO.has(e.office)) return <Lacuna>Este cargo não vota em plenário. Não há voto nominal para mostrar.</Lacuna>;
  const item = assembly?.items.find((i) => i.dataset === "votos");
  if (item) {
    if (item.status === "no_site") return <Lacuna>Nenhum voto nominal de lei na leitura da {assembly?.houseName}.</Lacuna>;
    return <Cobertura status={item.status} motivo={item.reason} fonte={assembly?.source?.name ?? assembly?.houseName ?? "casa legislativa"} />;
  }
  return <Cobertura fonte={(e.office && FONTE_VOTOS[e.office]) ?? "casa legislativa do cargo"} />;
}

/** "Em quem eu votei": as pessoas do cookie sv_sigo, em ordem alfabética, todas com a mesma estrutura. */
export async function Escolhidos({ slugs, ufSigla }: { slugs: string[]; ufSigla: string | null }) {
  const lista = slugs.length ? await carregar(slugs) : [];
  const ufs = [...new Set(lista.filter((e) => e.office === "deputado_estadual" || e.office === "deputado_distrital").map((e) => e.uf).filter((u): u is string => !!u))];
  const assemblies = new Map(await Promise.all(ufs.map(async (u) => [u, await data.getAssembly(u).catch(() => null)] as const)));

  return (
    <Quadro
      id="inicio-escolhidos"
      className="sv-gq"
      pergunta={
        <>
          Em quem eu votei <ExemploIlustrativo />
        </>
      }
    >
      {lista.length === 0 ? (
        <div className="sv-vazio">
          <p className="sv-t">Marque as pessoas em quem você votou. Aqui você vê o que elas votaram em plenário, em ordem alfabética.</p>
          <p className="sv-t">
            Para marcar, abra a lista de pessoas{ufSigla ? ` de ${ufSigla}` : ""}, entre na página de uma delas e marque que votou nela.
          </p>
          <Link className="sv-btn" href={ufSigla ? `/v2/pessoas?uf=${ufSigla}` : "/v2/pessoas"}>
            Escolher em quem votei
          </Link>
          <Nota>{COOKIE_TEXTO}</Nota>
        </div>
      ) : (
        <>
          <ul className="sv-esc">
            {lista.map((e) => (
              <li key={e.slug}>
                <span className="sv-esc__id">
                  <strong className="sv-esc__n">{e.nome}</strong>
                  {e.esfera && <span className="sv-esc__c">Esfera: {e.esfera}</span>}
                  <span className="sv-esc__c">{e.cargo}</span>
                </span>
                <div className="sv-esc__u">
                  {e.votos && e.votos.length > 0 ? (
                    <ul className="sv-vl">
                      {e.votos.map((v) => {
                        const dia = dayKey(v.event.occurredAt);
                        return (
                          <li key={v.event.id}>
                            <VotoMarca voto={v.value} />
                            <span>
                              {dia ? `${fmtLong(dia)} · ` : ""}
                              {clip(v.event.description, 110)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <SemVotos e={e} assembly={e.uf && (e.office === "deputado_estadual" || e.office === "deputado_distrital") ? (assemblies.get(e.uf) ?? null) : null} />
                  )}
                </div>
                <Link href={`/v2/pessoa/${e.slug}`}>
                  Ver o que faz<span className="sv-vh"> {e.nome}</span>&nbsp;<span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
          {lista.some((e) => e.votos && e.votos.length > 0) && <Nota>Sem voto não é voto contra. Ainda não temos esse dado não quer dizer que a pessoa não fez nada.</Nota>}
          <Nota>O destaque vem da sua escolha, não de nota ou ranking. Pessoas em ordem alfabética.</Nota>
        </>
      )}
    </Quadro>
  );
}
