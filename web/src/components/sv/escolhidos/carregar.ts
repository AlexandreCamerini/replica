import "server-only";
import type { ActivityItem, AssemblyInfo, AttendanceGrid, CoberturaConjunto, ConjuntoPessoa, CoverageStatus, OfficeSlug, Place, VoteValue } from "@/lib/data";
import { data } from "@/lib/data";
import { fmtDate } from "../fmt";
import { lerOuFalhar } from "../simular";
import { aguardaPosse, cobreLeis, fraseDesde, mandatoPrincipal, motivoPosse } from "../mandato";

// Carrega, por pessoa do cookie sv_sigo, tudo o que o quadro "O que meus escolhidos estão fazendo?" mostra.
// Só dado do contrato (DataSource): nada é calculado fora do que a fonte entregou. Lacuna fica null, nunca vira zero.

export type Cobertura = { status: CoverageStatus; motivo: string } | null;
export type Casa = { nome: string; lidaEm: string | null };

export type Escolhido = {
  id: string;
  slug: string;
  nome: string;
  cargo: string | null;
  /** a leitura dos mandatos falhou: o cargo é lacuna "Não conseguimos ler…", não "sem mandato" */
  cargoFalhou: boolean;
  uf: string | null;
  partido: string | null;
  /** "no cargo desde mm/aaaa" | "eleito(a), toma posse em mm/aaaa" | "mandato desde mm/aaaa" (sv/mandato) */
  desde: string | null;
  /** ainda não tomou posse: motivo da lacuna de presença, gastos e votos */
  posse: string | null;
  /** conjuntos cuja leitura falhou: lacuna "Não conseguimos ler esta fonte agora.", nunca "nenhum" nem "ainda não temos" */
  falhou: { presenca: boolean; votos: boolean; gastos: boolean; patrimonio: boolean; propostas: boolean; leis: boolean };
  esfera: string | null;
  casa: Casa;
  tse: Casa;
  ano: number;
  presenca: AttendanceGrid;
  votos: { items: { id: string; em: string; texto: string; valor: VoteValue }[]; total: number };
  gastoCents: number | null;
  patrimonio: { ano: number; cents: number }[];
  /** `leis` null: sem leitura de leis (falhou, ou cargo fora de deputado federal e senador, que é onde lemos leis) */
  propostas: { principal: number | null; coautor: number | null; leis: number | null } | null;
  /** estado de cada conjunto (getPeopleCoverage); null = a leitura da cobertura falhou (a tela não afirma estado) */
  cobertura: Partial<Record<ConjuntoPessoa, CoberturaConjunto>> | null;
};

export type Recente = { item: ActivityItem; esfera: string | null };

/**
 * `falhas`: pessoas do cookie cuja leitura falhou (não entram em `pessoas`); `naoEncontradas`: slugs que a fonte não
 * conhece mais; `recentesFalhou`: a leitura da atividade falhou (lacuna, não "sem registro").
 */
export type Carga = { pessoas: Escolhido[]; recentes: Recente[]; recentesFalhou: boolean; falhas: number; naoEncontradas: number; lidoEm: string | null };

/** Simulação (só na demonstração): `pessoa` = a leitura de cada pessoa falha; `dados` = cada conjunto e a atividade falham. */
export type FalhaSimulada = { pessoa?: boolean; dados?: boolean };

const ESFERA: Partial<Record<OfficeSlug, string>> = {
  deputado_federal: "Federal · Câmara dos Deputados",
  senador: "Federal · Senado Federal",
  presidente: "Federal · Presidência da República",
  vice_presidente: "Federal · Presidência da República",
  governador: "Estadual · Governo do Estado",
  vice_governador: "Estadual · Governo do Estado",
  deputado_estadual: "Estadual · Assembleia Legislativa",
  deputado_distrital: "Estadual · Câmara Legislativa do Distrito Federal",
  prefeito: "Municipal · Prefeitura",
  vice_prefeito: "Municipal · Prefeitura",
  vereador: "Municipal · Câmara Municipal",
};

/** Data de leitura só quando o carimbo é real (sem carimbo, a API devolve a época 1970). */
const lida = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 ? null : fmtDate(iso);
};

const anoAtual = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));

const stampDe = async (dataset: string, nome: string): Promise<Casa> => {
  try {
    const s = await data.getStamp(dataset);
    return { nome: s.source || nome, lidaEm: lida(s.refreshedAt) };
  } catch {
    return { nome, lidaEm: null };
  }
};

export async function carregarEscolhidos(slugs: string[], sim: FalhaSimulada = {}): Promise<Carga> {
  const ano = anoAtual();
  const ler = <T>(f: () => Promise<T>) => lerOuFalhar(!!sim.dados, f);
  const [stCamara, stSenado, stTse] = await Promise.all([
    stampDe("camara", "Câmara dos Deputados"),
    stampDe("senado", "Senado Federal"),
    stampDe("tse.candidatos", "Justiça Eleitoral (TSE)"),
  ]);

  // Uma leitura em lote por conjunto (número de consultas constante, não por pessoa). "falhou" (exceção) é diferente de
  // "não existe mais" (naoEncontradas): só o segundo some sem aviso. Ids em ordem e sem repetição: a mesma chave de cache.
  const pedidos = [...new Set(slugs)];
  const achadas = await lerOuFalhar(!!sim.pessoa, () => data.getPeopleBySlugs(pedidos)).catch(() => null);
  const falhas = achadas ? 0 : pedidos.length;
  const naoEncontradas = achadas?.naoEncontradas.length ?? 0;
  const vistos = new Set<string>();
  const pessoasBase = (achadas?.encontradas ?? []).map((x) => x.person).filter((p) => !vistos.has(p.id) && !!vistos.add(p.id));
  const ids = pessoasBase.map((p) => p.id).sort();

  // null = a leitura do conjunto falhou: lacuna "Não conseguimos ler…" desse conjunto, nunca "nenhum"
  const vazio = Promise.resolve(null);
  const [mandatesR, candsR, lawsR, careerR, yearR, gridR, votesR, expR, cobR] = ids.length
    ? await Promise.all([
        ler(() => data.getMandatesForPeople(ids)).catch(() => null),
        ler(() => data.getCandidaciesForPeople(ids)).catch(() => null),
        ler(() => data.getLawsForPeople(ids)).catch(() => null),
        ler(() => data.getStatsForPeople(ids, "career")).catch(() => null),
        ler(() => data.getStatsForPeople(ids, String(ano) as `${number}`)).catch(() => null),
        ler(() => data.getAttendanceGridForPeople(ids, ano)).catch(() => null),
        ler(() => data.getRecentLawVotesForPeople(ids, 3)).catch(() => null),
        ler(() => data.getExpensesByCategoryForPeople(ids, ano)).catch(() => null),
        ler(() => data.getPeopleCoverage(ids)).catch(() => null),
      ])
    : await Promise.all([vazio, vazio, vazio, vazio, vazio, vazio, vazio, vazio, vazio]);
  const mains = new Map(pessoasBase.map((p) => [p.id, mandatoPrincipal(mandatesR?.[p.id] ?? null)]));
  const places = await data
    .getPlaces([...new Set([...mains.values()].flatMap((m) => (m ? [m.placeIbge] : [])))].sort())
    .then((ps) => new Map(ps.map((p) => [p.ibge, p])))
    .catch(() => new Map<string, Place>());
  const ufsAsm = [...new Set(pessoasBase.flatMap((p) => {
    const m = mains.get(p.id);
    const uf = m ? places.get(m.placeIbge)?.uf : null;
    return m && uf && (m.office === "deputado_estadual" || m.office === "deputado_distrital") ? [uf] : [];
  }))];
  // nome e data de leitura da Assembleia: uma leitura por UF distinta (não por pessoa)
  const asms = new Map(await Promise.all(ufsAsm.map(async (uf) => [uf, await data.getAssembly(uf).catch((): AssemblyInfo | null => null)] as const)));
  const cobDe = new Map((cobR ?? []).map((c) => [c.personId, Object.fromEntries(c.conjuntos.map((x) => [x.conjunto, x]))]));

  const pessoas = pessoasBase.map((p): Escolhido => {
      const mandates = mandatesR ? (mandatesR[p.id] ?? []) : null;
      const cands = candsR ? (candsR[p.id] ?? []) : null;
      const laws = lawsR ? (lawsR[p.id] ?? []) : null;
      const careerStats = careerR?.[p.id] ?? null;
      const yearStats = yearR?.[p.id] ?? null;
      const grid = gridR?.[p.id] ?? null;
      const votes = votesR ? (votesR[p.id] ?? { items: [], total: 0 }) : null;
      const exp = expR ? { byCategory: expR[p.id] ?? [] } : null;
      const main = mains.get(p.id) ?? null;
      const place = main ? (places.get(main.placeIbge) ?? null) : null;
      const uf = place?.uf ?? null;
      const office = main?.office ?? null;
      const estadual = office === "deputado_estadual" || office === "deputado_distrital";
      const asm = estadual && uf ? (asms.get(uf) ?? null) : null;
      const cobertura = cobR ? (cobDe.get(p.id) ?? null) : null;
      const casa: Casa =
        office === "deputado_federal"
          ? stCamara
          : office === "senador"
            ? stSenado
            : estadual
              ? { nome: asm?.houseName ?? "Assembleia Legislativa", lidaEm: lida(asm?.items.find((i) => i.refreshedAt)?.refreshedAt) }
              : office === "vereador"
                ? { nome: "Câmara Municipal", lidaEm: null }
                : { nome: "Portal oficial do cargo", lidaEm: null };

      const gastoCats = exp ? exp.byCategory.reduce((s, c) => s + c.cents, 0) : 0;
      const gastoCents = gastoCats > 0 ? gastoCats : yearStats?.expensesCents && yearStats.expensesCents > 0 ? yearStats.expensesCents : null;

      // patrimônio: um valor por eleição, em ordem cronológica (nunca por valor); 2º turno não repete o ano
      const porAno = new Map<number, number>();
      for (const c of cands ?? []) if (c.assetsCents !== null && !porAno.has(c.year)) porAno.set(c.year, c.assetsCents);
      const patrimonio = [...porAno].sort((a, b) => a[0] - b[0]).map(([a, cents]) => ({ ano: a, cents }));

      const pr = careerStats ? { principal: careerStats.proposalsPrincipal, coautor: careerStats.proposalsCosigned } : null;
      const posse = main && aguardaPosse(main) ? motivoPosse(main) : null;
      const vazia: AttendanceGrid = { year: ano, sessions: [], present: 0, absent: 0, justified: 0, outside: 0, total: 0 };

      return {
        id: p.id,
        slug: p.slug,
        nome: p.displayName,
        cargo: main?.officeName ?? null,
        cargoFalhou: mandates === null,
        uf,
        partido: main?.party.acronym ?? null,
        desde: fraseDesde(main, p.gender === "f" ? true : p.gender === "m" ? false : null),
        posse,
        // gastos: falhou só quando nenhuma das duas leituras que dão o valor veio
        falhou: { presenca: grid === null, votos: votes === null, gastos: gastoCents === null && (exp === null || yearStats === null), patrimonio: cands === null, propostas: careerStats === null, leis: laws === null },
        esfera: office ? (ESFERA[office] ?? null) : null,
        casa,
        tse: stTse,
        ano,
        // quem ainda não tomou posse não tem presença, votos nem gastos no cargo: lacuna com o motivo `posse`
        presenca: posse ? vazia : (grid ?? vazia),
        votos: posse
          ? { total: 0, items: [] }
          : {
              total: votes?.total ?? 0,
              items: (votes?.items ?? []).map((v) => ({ id: v.event.id, em: v.event.occurredAt, texto: v.event.description, valor: v.value })),
            },
        gastoCents: posse ? null : gastoCents,
        patrimonio,
        // leis: só com a leitura de leis feita para o cargo (cobertura `lido`); fora disso, sem frase sobre leis
        propostas: pr && (pr.principal !== null || pr.coautor !== null) ? { ...pr, leis: laws && cobreLeis(office) && cobertura?.leis?.estado === "lido" ? laws.length : null } : null,
        cobertura,
      };
    });
  pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const esferaDe = new Map(pessoas.map((p) => [p.slug, p.esfera]));
  const atividade = pessoas.length ? await ler(() => data.getActivity(pessoas.map((p) => p.id), 8)).catch(() => null) : [];
  const recentes = [...(atividade ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((item) => ({ item, esfera: esferaDe.get(item.personSlug) ?? null }));
  const lidoEm = await data.latestRefresh().catch(() => null);
  return { pessoas, recentes, recentesFalhou: atividade === null, falhas, naoEncontradas, lidoEm };
}
