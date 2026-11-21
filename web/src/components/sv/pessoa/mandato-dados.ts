// Leitura única da visão do mandato (painel da Pessoa e página /pessoa/[slug]/mandato). Server-only (lê o DataSource).
// Só compõe o que já existe e a lógica pura de lib/mandato-visao.ts: nenhuma tabela nova, nenhuma escrita.
// Regras: janela = max(início do mandato, primeiro ano carregado), sempre dita como "desde AAAA"; sem dado = lacuna com motivo,
// nunca zero; sem ordenação por valor, sem média, sem comparação com outras pessoas.
import { rotuloGastos } from "@/components/sv/mandato";
import { data, type SalaryAccrued, type YearStats } from "@/lib/data";
import { comissoesNaJanela, custoMandato, frasePeriodo, janelaMandato, somaAnual, vmGastoMandato, type CustoMandato, type Janela, type VmGastoMandato } from "@/lib/mandato-visao";
import { fmtDate, fmtInt } from "@/components/sv/fmt";
import { hojeBR, ler, listaE } from "./format";
import { MOTIVO_COTA, MOTIVO_PLENARIO, type ContextoPessoa } from "./contexto";
import { LACUNA_FALHA, lacunaCobertura, lacunaSem, type LacunaVm } from "./secoes";

export const FONTE_MANDATO: Record<string, string> = { tse: "TSE (Justiça Eleitoral)", camara: "Câmara dos Deputados", senado: "Senado Federal" };

/** Um número da visão: o texto, o período que ele cobre e a fonte; sem dado, a lacuna (nunca zero). */
export type ItemMandato = { texto: string | null; periodo: string | null; lacuna: LacunaVm | null; fonte: string; lista?: string[] };

export type DadosMandato = {
  ctx: ContextoPessoa;
  hojeIso: string;
  lidoEm: string | null;
  /** o cargo tem plenário e cota (legislativo) e a pessoa já tomou posse */
  aplica: boolean;
  /** motivo, quando `aplica` é falso */
  motivoNaoAplica: string | null;
  janela: Janela | null;
  /** "cota parlamentar" (Câmara) ou "gastos do gabinete" */
  rotulo: string;
  gasto: { vm: VmGastoMandato | null; lacuna: LacunaVm | null; fonte: string };
  salario: { v: SalaryAccrued | null; lacuna: LacunaVm | null; fonte: string };
  custo: CustoMandato | null;
  fez: { votos: ItemMandato; propostas: ItemMandato; presenca: ItemMandato; comissoes: ItemMandato; discursos: ItemMandato };
  /** o que ficou de fora, com o motivo */
  fora: { oQue: string; motivo: string }[];
  fonteMandato: string;
};

const FALHOU = LACUNA_FALHA;
const textoLacuna = (l: LacunaVm) => `${l.texto}${typeof l.motivo === "string" && l.motivo ? ` · ${l.motivo}` : ""}`;

/** Lê tudo o que a visão precisa. Cada leitura que falha vira lacuna daquele item, nunca erro de página. */
export async function carregarMandato(ctx: ContextoPessoa): Promise<DadosMandato> {
  const id = ctx.person.id;
  const hoje = hojeBR();
  const hojeIso = `${hoje.ano}-${String(hoje.mes).padStart(2, "0")}-${String(hoje.dia).padStart(2, "0")}`;
  const main = ctx.main;
  const rotulo = rotuloGastos(ctx.office);
  const refresh = await ler(data.latestRefresh());
  const lidoEm = refresh.ok ? refresh.v : null;
  const aplica = !!main && ctx.legis && !ctx.posse;
  const motivoNaoAplica = !main ? "Não consta mandato carregado para esta pessoa." : ctx.posse ? ctx.posse : !ctx.legis ? `${MOTIVO_PLENARIO} ${MOTIVO_COTA}` : null;
  const fonteMandato = main ? (FONTE_MANDATO[main.statusSource] ?? "fonte oficial do mandato") : "";

  if (!main || !aplica) {
    const l = lacunaSem(null, motivoNaoAplica);
    const sem = (): ItemMandato => ({ texto: null, periodo: null, lacuna: l, fonte: "" });
    return {
      ctx, hojeIso, lidoEm, aplica, motivoNaoAplica, janela: null, rotulo,
      gasto: { vm: null, lacuna: l, fonte: "" },
      salario: { v: null, lacuna: l, fonte: "" },
      custo: null,
      fez: { votos: sem(), propostas: sem(), presenca: sem(), comissoes: sem(), discursos: sem() },
      fora: motivoNaoAplica ? [{ oQue: "Gasto, votos, propostas, comissões, discursos e presença", motivo: motivoNaoAplica }] : [],
      fonteMandato,
    };
  }

  const emExercicio = main.status === "em_exercicio";
  const fimMandato = emExercicio ? null : main.endsOn;
  const body = ctx.body;

  // 1) gasto: a janela depende da primeira nota carregada, que vem na mesma leitura
  const gastoR = await ler(data.getMandateSpend(id, { from: main.startedOn, to: fimMandato }));
  const janela = janelaMandato({ inicio: main.startedOn, fim: fimMandato, primeiraNotaEm: gastoR.ok ? gastoR.v.primeiraNotaEm : null, hojeIso });
  // a soma de salário e cota cobre o MESMO intervalo: do primeiro ao último mês com nota de cota na janela
  const vm = gastoR.ok && janela ? vmGastoMandato(gastoR.v, janela) : null;
  const mesIni = vm?.meses[0]?.mes ?? null;
  const mesFim = vm?.meses[vm.meses.length - 1]?.mes ?? null;
  const anoMax = janela?.fim ? Number(janela.fim.slice(0, 4)) : hoje.ano;

  // 2) o resto, já com a janela
  const [salarioR, anualR, comissoesR, discursosR, salarioFontesR, sGastos, sExtras] = await Promise.all([
    janela && mesIni && mesFim ? ler(data.getSalaryAccrued(id, undefined, `${mesIni}-01`, `${mesFim}-01`)) : Promise.resolve({ ok: true as const, v: null }),
    ler(data.getYearlyStats(id)),
    ler(data.getCommittees(id)),
    janela ? ler(data.listSpeeches(id, { since: janela.inicio, until: janela.fim ?? undefined, limit: 1 })) : Promise.resolve({ ok: true as const, v: null }),
    ler(data.getSalarySources(main.office)),
    ctx.stampDe(body ? `${body}.despesas` : null),
    ctx.stampDe("parlamento.extras"),
  ]);

  // ---------- gasto (cota) ----------
  const fonteGasto = ctx.fonteConjunto("gastos", rotulo, sGastos, !!vm);
  const lacGasto = vm ? null : !gastoR.ok ? FALHOU : lacunaCobertura(ctx.cob("gastos"), `nota de gasto desde ${main.startedOn.slice(0, 4)}`, null, body === "senado" ? "O Senado tem verba própria, com outra fonte." : null);

  // ---------- salário ----------
  const sal = salarioR.ok ? salarioR.v : null;
  const fontesSal = salarioFontesR.ok ? salarioFontesR.v : [];
  const cargaSal = fontesSal.flatMap((s) => (s.loadedAt ? [s.loadedAt] : [])).sort().at(-1) ?? null;
  const fonteSalario =
    fontesSal.length > 0
      ? `Fonte: ${listaE(fontesSal.map((s) => s.name))}, ${cargaSal ? `carga registrada em ${fmtDate(cargaSal)}` : "data da carga não registrada"}.`
      : "Fonte: norma do subsídio do cargo, ainda não carregada.";
  const lacSalario = sal ? null : !salarioR.ok ? FALHOU : lacunaSem(null, mesIni ? "Sem valor de subsídio carregado para este cargo neste período." : "Sem nota de cota no período, a soma não tem intervalo de referência.");

  const custo = janela ? custoMandato({ salario: sal, cotaCents: vm ? vm.totalCents : null, mesesSemNotaCota: vm?.mesesSemNota ?? 0, intervalo: mesIni && mesFim ? { de: mesIni, ate: mesFim } : null }) : null;

  // ---------- o que fez ----------
  const anual: readonly YearStats[] = anualR.ok ? anualR.v : [];
  const anoIni = janela ? janela.desdeAno : Number(main.startedOn.slice(0, 4));
  const periodo = (desde: number) => (janela ? frasePeriodo(desde, janela) : `desde ${desde}`);
  const falhouAnual = !anualR.ok;
  const item = (cob: Parameters<ContextoPessoa["cob"]>[0], oQue: string, texto: string | null, desde: number | null, fonte: string, motivoExtra?: string | null): ItemMandato => {
    if (texto !== null && desde !== null) return { texto, periodo: periodo(desde), lacuna: null, fonte };
    return { texto: null, periodo: null, lacuna: falhouAnual ? FALHOU : lacunaCobertura(ctx.cob(cob), oQue, null, motivoExtra ?? undefined), fonte };
  };

  const sv = somaAnual(anual, "votesRegistered", anoIni, anoMax);
  const votos = item("votos", "voto nominal", sv ? `${fmtInt(sv.valor)} ${sv.valor === 1 ? "voto nominal" : "votos nominais"}` : null, sv?.desde ?? null, ctx.fonteConjunto("votos", "votações nominais", null, !!sv));

  const sp = somaAnual(anual, "proposalsPrincipal", anoIni, anoMax);
  const sc = somaAnual(anual, "proposalsCosigned", anoIni, anoMax);
  const fem = ctx.fem;
  const propostas = item(
    "propostas",
    "proposta apresentada",
    sp ? `${fmtInt(sp.valor)} ${sp.valor === 1 ? "proposta" : "propostas"} como ${fem ? "autora" : "autor"} principal${sc ? ` e ${fmtInt(sc.valor)} em coautoria` : ""}` : null,
    sp?.desde ?? null,
    ctx.fonteConjunto("propostas", "propostas apresentadas", null, !!sp),
  );

  const pp = somaAnual(anual, "presencePresent", anoIni, anoMax);
  const pt = somaAnual(anual, "presenceTotal", anoIni, anoMax);
  const presenca = item(
    "presenca",
    "presença em sessão de votação",
    pp && pt ? `Esteve em ${fmtInt(pp.valor)} de ${fmtInt(pt.valor)} sessões de votação` : null,
    pp && pt ? Math.min(pp.desde, pt.desde) : null,
    ctx.fonteConjunto("presenca", body === "senado" ? "votações nominais" : "presença em sessões de votação", null, !!pp),
    body === "senado" ? "O Senado não publica a lista de presença por senador." : null,
  );

  // comissões: só a contagem que a cobertura sustenta; lista vazia lida é "nenhuma", não lida é lacuna
  const cobCom = ctx.cob("comissoes");
  const comJanela = comissoesR.ok && janela ? comissoesNaJanela(comissoesR.v, janela.inicio, janela.fim) : [];
  const nomesCom = [...new Set(comJanela.map((c) => c.name))];
  const fonteCom = ctx.fonteConjunto("comissoes", "comissões", sExtras, comJanela.length > 0);
  const comissoes: ItemMandato =
    comJanela.length > 0
      ? { texto: nomesCom.length === 1 ? "1 comissão" : `${fmtInt(nomesCom.length)} comissões`, periodo: janela ? `participações que tocam o período a partir de ${janela.inicio.slice(5, 7)}/${janela.inicio.slice(0, 4)}` : null, lacuna: null, fonte: fonteCom, lista: nomesCom }
      : !comissoesR.ok
        ? { texto: null, periodo: null, lacuna: FALHOU, fonte: fonteCom }
        : cobCom?.estado === "lido"
          ? { texto: null, periodo: null, lacuna: { texto: "Nenhuma comissão na leitura da fonte para este período.", estado: "lido" }, fonte: fonteCom }
          : { texto: null, periodo: null, lacuna: lacunaCobertura(cobCom, "comissão"), fonte: fonteCom };

  // discursos: não há cobertura própria (o derive condiciona o zero a votes_src). Só a contagem positiva aparece; zero lido não é afirmado.
  const nDisc = discursosR.ok && discursosR.v ? discursosR.v.total : null;
  const fonteDisc = ctx.fonteConjunto("comissoes", "discursos", sExtras, !!nDisc);
  const discursos: ItemMandato =
    nDisc && nDisc > 0 && janela
      ? { texto: `${fmtInt(nDisc)} ${nDisc === 1 ? "discurso" : "discursos"}`, periodo: `contados a partir de ${janela.inicio.slice(5, 7)}/${janela.inicio.slice(0, 4)}, quando começa o período desta página`, lacuna: null, fonte: fonteDisc }
      : !discursosR.ok
        ? { texto: null, periodo: null, lacuna: FALHOU, fonte: fonteDisc }
        : { texto: null, periodo: null, lacuna: { texto: "Nenhum discurso carregado.", motivo: "A leitura de discursos não tem cobertura confirmada para esta pessoa: por isso não dizemos que não houve." }, fonte: fonteDisc };

  // ---------- o que ficou de fora ----------
  const fora: DadosMandato["fora"] = [];
  const marca = (oQue: string, l: LacunaVm | null) => {
    if (l) fora.push({ oQue, motivo: textoLacuna(l) });
  };
  marca("Gasto da cota", lacGasto);
  marca("Salário", lacSalario);
  marca("Votos", votos.lacuna);
  marca("Propostas", propostas.lacuna);
  marca("Presença", presenca.lacuna);
  marca("Comissões", comissoes.lacuna);
  marca("Discursos", discursos.lacuna);
  if (janela?.truncada) fora.push({ oQue: `Antes de ${janela.desdeAno}`, motivo: `Não há nota de cota carregada desta pessoa antes de ${janela.desdeAno}; o que veio antes não está nesta página.` });
  if (custo && custo.estado === "soma") for (const f of custo.fora) fora.push({ oQue: "Parte da soma", motivo: f });

  return {
    ctx, hojeIso, lidoEm, aplica, motivoNaoAplica, janela, rotulo,
    gasto: { vm, lacuna: lacGasto, fonte: fonteGasto },
    salario: { v: sal, lacuna: lacSalario, fonte: fonteSalario },
    custo,
    fez: { votos, propostas, presenca, comissoes, discursos },
    fora,
    fonteMandato,
  };
}
