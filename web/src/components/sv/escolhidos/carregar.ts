import "server-only";
import type { ActivityItem, AssemblyDataset, AssemblyInfo, AttendanceGrid, CoverageStatus, OfficeSlug, VoteValue } from "@/lib/data";
import { data } from "@/lib/data";
import { fmtDate } from "../fmt";
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
  /** conjuntos cuja leitura falhou: lacuna "Não conseguimos ler esta fonte agora.", nunca "nenhum" */
  falhou: { votos: boolean; leis: boolean };
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
  /** status de cobertura por conjunto, só quando o contrato o entrega por pessoa (Assembleia) */
  cob: Partial<Record<AssemblyDataset, Cobertura>>;
};

export type Recente = { item: ActivityItem; esfera: string | null };

export type Carga = { pessoas: Escolhido[]; recentes: Recente[]; lidoEm: string | null };

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

export async function carregarEscolhidos(slugs: string[]): Promise<Carga> {
  const ano = anoAtual();
  const asmCache = new Map<string, Promise<AssemblyInfo | null>>();
  const assembly = (uf: string) => {
    let p = asmCache.get(uf);
    if (!p) asmCache.set(uf, (p = data.getAssembly(uf).catch(() => null)));
    return p;
  };
  const [stCamara, stSenado, stTse] = await Promise.all([
    stampDe("camara", "Câmara dos Deputados"),
    stampDe("senado", "Senado Federal"),
    stampDe("tse.candidatos", "Justiça Eleitoral (TSE)"),
  ]);

  const resolvidos = await Promise.all(
    slugs.map(async (slug) => {
      let r = await data.getPerson(slug).catch(() => null);
      if (r?.redirectTo) r = await data.getPerson(r.redirectTo).catch(() => null);
      return r?.person ?? null;
    }),
  );
  const vistos = new Set<string>();
  const pessoasBase = resolvidos.filter((p): p is NonNullable<typeof p> => !!p && !vistos.has(p.id) && !!vistos.add(p.id));

  const pessoas = await Promise.all(
    pessoasBase.map(async (p): Promise<Escolhido> => {
      const [mandates, cands, laws, careerStats, yearStats, grid, votes, exp] = await Promise.all([
        data.getMandates(p.id).catch(() => null), // null = leitura falhou: lacuna só desta pessoa
        data.getCandidacies(p.id).catch(() => []),
        data.getLaws(p.id).catch(() => null),
        data.getStats(p.id, "career").catch(() => null),
        data.getStats(p.id, String(ano) as `${number}`).catch(() => null),
        data.getAttendanceGrid(p.id, ano).catch(() => null),
        data.listVotes(p.id, { scope: "lei", limit: 3 }).catch(() => null),
        data.listExpenses(p.id, { year: ano, limit: 1 }).catch(() => null),
      ]);
      const main = mandatoPrincipal(mandates);
      const place = main ? await data.getPlace(main.placeIbge).catch(() => null) : null;
      const uf = place?.uf ?? null;
      const office = main?.office ?? null;
      const estadual = office === "deputado_estadual" || office === "deputado_distrital";
      const asm = estadual && uf ? await assembly(uf) : null;

      const cob: Escolhido["cob"] = {};
      if (asm) for (const it of asm.items) cob[it.dataset] = { status: it.status, motivo: it.reason };
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
      for (const c of cands) if (c.assetsCents !== null && !porAno.has(c.year)) porAno.set(c.year, c.assetsCents);
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
        falhou: { votos: votes === null, leis: laws === null },
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
        propostas: pr && (pr.principal !== null || pr.coautor !== null) ? { ...pr, leis: laws && cobreLeis(office) ? laws.length : null } : null,
        cob,
      };
    }),
  );
  pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const esferaDe = new Map(pessoas.map((p) => [p.slug, p.esfera]));
  const atividade = pessoas.length ? await data.getActivity(pessoas.map((p) => p.id), 8).catch(() => []) : [];
  const recentes = [...atividade].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((item) => ({ item, esfera: esferaDe.get(item.personSlug) ?? null }));
  const lidoEm = await data.latestRefresh().catch(() => null);
  return { pessoas, recentes, lidoEm };
}
