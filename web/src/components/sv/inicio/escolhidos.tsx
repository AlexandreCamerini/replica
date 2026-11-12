import Link from "next/link";
import { clip } from "@/components/sv/fmt";
import { COOKIE_TEXTO } from "@/components/sv/prefs-shared";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { aguardaPosse, fraseDesde, mandatoPrincipal, motivoPosse } from "@/components/sv/mandato";
import { ESTADO_COBERTURA, FALHOU_LEITURA, naoHaNaLeitura } from "@/components/sv/estados";
import { lerOuFalhar } from "@/components/sv/simular";
import { Cobertura, Fonte, Lacuna, Nota, Quadro, VotoMarca } from "@/components/sv/ui";
import { data, type CoberturaConjunto, type MandateStatus, type OfficeSlug, type PersonVote, type Place } from "@/lib/data";
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
  /** null: a leitura dos votos falhou (lacuna "Não conseguimos ler esta fonte agora."), nunca "nenhum voto" */
  votos: PersonVote[] | null;
  /** motivo de não haver votos: ainda não tomou posse */
  posse: string | null;
  /** estado de cobertura dos votos; null = a leitura da cobertura falhou ou não veio */
  cobVotos: CoberturaConjunto | null;
};

const FALHOU = FALHOU_LEITURA;

/**
 * `falhas`: quantas pessoas do cookie não puderam ser lidas (a leitura falhou). Slug que não existe mais é ignorado.
 * Leituras em lote (uma por conjunto, não por pessoa); cada conjunto que falha vira lacuna só dele.
 */
async function carregar(slugs: string[], falhar: boolean): Promise<{ lista: Escolhido[]; falhas: number }> {
  const pedidos = [...new Set(slugs)];
  const achadas = await lerOuFalhar(falhar, () => data.getPeopleBySlugs(pedidos)).catch(() => null);
  if (!achadas) return { lista: [], falhas: pedidos.length };
  const vistos = new Set<string>();
  const pessoas = achadas.encontradas.map((x) => x.person).filter((p) => !vistos.has(p.id) && !!vistos.add(p.id));
  const ids = pessoas.map((p) => p.id).sort();
  if (!ids.length) return { lista: [], falhas: 0 };
  const [mandR, votosR, cobR] = await Promise.all([
    data.getMandatesForPeople(ids).catch(() => null), // null = leitura falhou, diferente de "sem mandato"
    data.getRecentLawVotesForPeople(ids, 3).catch(() => null),
    data.getPeopleCoverage(ids).catch(() => null),
  ]);
  const mains = new Map(pessoas.map((p) => [p.id, mandatoPrincipal(mandR?.[p.id] ?? null)]));
  const places = await data
    .getPlaces([...new Set([...mains.values()].flatMap((m) => (m ? [m.placeIbge] : [])))].sort())
    .then((ps) => new Map(ps.map((p) => [p.ibge, p])))
    .catch(() => new Map<string, Place>());
  const cobDe = new Map((cobR ?? []).map((c) => [c.personId, c.conjuntos.find((x) => x.conjunto === "votos") ?? null]));
  const rows = pessoas.map((person): Escolhido => {
    const m = mains.get(person.id) ?? null;
    const uf = m ? (places.get(m.placeIbge)?.uf ?? null) : null;
    const fem = person.gender === "f" ? true : person.gender === "m" ? false : null;
    const status = m ? (aguardaPosse(m) ? fraseDesde(m, fem) : STATUS[m.status]) : undefined;
    const cargo = m
      ? [m.officeName, uf ?? m.placeLabel, `${m.party.acronym} (${m.party.name})`, status].filter(Boolean).join(" · ")
      : mandR === null
        ? "Não conseguimos ler o mandato agora."
        : "Sem mandato carregado";
    const posse = m && aguardaPosse(m) ? motivoPosse(m) : null;
    const votos = votosR ? (votosR[person.id]?.items ?? []) : null;
    return { slug: person.slug, nome: person.displayName, esfera: m ? ESFERA[m.office] : null, cargo, office: m?.office ?? null, uf, votos, posse, cobVotos: cobR ? (cobDe.get(person.id) ?? null) : null };
  });
  return { lista: rows.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), falhas: 0 };
}

function SemVotos({ e }: { e: Escolhido }) {
  if (e.office && EXECUTIVO.has(e.office)) return <Lacuna>Este cargo não vota em plenário. Não há voto nominal para mostrar.</Lacuna>;
  if (e.posse) return <Lacuna>{e.posse}</Lacuna>;
  const fonte = (e.office && FONTE_VOTOS[e.office]) ?? "casa legislativa do cargo";
  if (e.votos === null) return <Lacuna motivo={`Fonte: ${fonte}.`}>{FALHOU}</Lacuna>;
  // estado de cobertura dos votos (getPeopleCoverage): lido sem voto = "não há", com a data; outro estado = frase do estado
  const c = e.cobVotos;
  if (c?.estado === "lido")
    return (
      <Lacuna estado="lido" motivo={`Fonte: ${c.fonte?.nome ?? fonte}.`}>
        {naoHaNaLeitura("voto nominal em lei", c.lidoEm)}
      </Lacuna>
    );
  if (c)
    return (
      <>
        <Lacuna estado={c.estado} motivo={c.motivo}>
          {ESTADO_COBERTURA[c.estado]}
        </Lacuna>
        <Fonte>Fonte: {c.fonte?.nome ?? fonte}.</Fonte>
      </>
    );
  return <Cobertura fonte={fonte} />;
}

/** "Em quem eu votei": as pessoas do cookie sv_sigo, em ordem alfabética, todas com a mesma estrutura. */
export async function Escolhidos({ slugs, ufSigla, simularFalha = false }: { slugs: string[]; ufSigla: string | null; /** só na demonstração */ simularFalha?: boolean }) {
  const { lista, falhas } = slugs.length ? await carregar(slugs, simularFalha) : { lista: [], falhas: 0 };

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
      {falhas > 0 && (
        <Lacuna motivo={falhas === 1 ? "1 pessoa que você marcou não pôde ser lida." : `${falhas} pessoas que você marcou não puderam ser lidas.`}>{FALHOU}</Lacuna>
      )}
      {lista.length === 0 && slugs.length > 0 ? (
        falhas > 0 ? null : <Lacuna>Não encontramos nos dados as pessoas que você marcou.</Lacuna>
      ) : lista.length === 0 ? (
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
                  {!e.posse && e.votos && e.votos.length > 0 ? (
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
                    <SemVotos e={e} />
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
