// "O que mudou com seus escolhidos desde a última visita" (F1/F2 do roteiro do eleitor, replica/roteiro-eleitor-2026-11.md, A1 e A2).
// Puro (sem servidor nem React), para o teste unitário.
//
// A data da última visita fica só neste aparelho (localStorage): o servidor nunca a recebe. Por isso o servidor entrega os registros
// dos últimos 60 dias e a conta "desde" é feita no navegador. Sem JavaScript, ou na primeira visita, vale a janela padrão de 14 dias,
// dita na tela ("nos últimos 14 dias"), nunca um "desde" inventado.
//
// A conta é só contagem de registros da fonte, por pessoa e por tipo, com o valor em reais dos gastos. Nada de média, ranking ou
// comparação entre pessoas (D82, D342). "Sem voto registrado" não é "voto contra" nem "ausência": é o que a fonte registrou.
import { compararNomes } from "../../../lib/ordem-nomes.ts";

export const JANELA_PADRAO = 14;
/** Os gastos são lidos dos últimos 60 dias (pg.ts, getActivity): não há "desde" mais antigo que isso. */
export const JANELA_MAX = 60;
export const CHAVE_VISITA = "sv_visita";

/** O que a conta precisa de um item de atividade (`ActivityItem`, lib/data/types), com o dia já em Brasília. */
export type AtoDesde = {
  slug: string;
  nome: string;
  kind: "voto" | "proposta" | "gasto";
  /** aaaa-mm-dd, em Brasília */
  dia: string;
  /** voto: destino da votação (um por votação); proposta: título (uma por proposta); gasto: não conta como chave */
  chave: string;
  /** voto: o que a fonte registrou ("Sim", "Não", "Abstenção", "Não votou"…) */
  voto: string | null;
  /** gasto: valor em centavos; null se o texto da fonte não deu para ler */
  centavos: number | null;
};

/** `atual`: a última vez que a home abriu neste aparelho. `anterior`: a última vez que ela abriu em um DIA anterior ao de `atual` (a "última visita"). */
export type Visita = { atual: string; anterior: string | null };

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const utc = (k: string) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12));
export const somarDias = (k: string, n: number) => new Date(utc(k).getTime() + n * 86400e3).toISOString().slice(0, 10);

const TZ = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** Dia (em Brasília) de um instante ISO. Inválido: null. */
export function diaDe(iso: string): string | null {
  if (DIA.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : fmtDia.format(d);
}

/** Lê o que o navegador guardou. Qualquer coisa fora do formato vale como "sem visita guardada". */
export function lerVisita(bruto: string | null): Visita | null {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto) as unknown;
    if (!v || typeof v !== "object") return null;
    const { atual, anterior } = v as Record<string, unknown>;
    if (typeof atual !== "string" || Number.isNaN(new Date(atual).getTime())) return null;
    if (anterior !== null && (typeof anterior !== "string" || Number.isNaN(new Date(anterior).getTime()))) return null;
    return { atual, anterior: (anterior as string | null) ?? null };
  } catch {
    return null;
  }
}

/**
 * Chamada uma vez por carga da página. A visita é o dia (em Brasília): abrir a home de novo no mesmo dia é a mesma visita e não
 * mexe no `anterior`, então recarregar ou voltar à home não zera o "desde". Em outro dia, a última abertura guardada vira a
 * `anterior`. Relógio do aparelho para trás (dia guardado depois de hoje) vale como dia novo, sem estourar.
 */
export function proximaVisita(guardada: Visita | null, agora: Date): Visita {
  const hoje = diaDe(agora.toISOString());
  const dia = guardada ? diaDe(guardada.atual) : null;
  if (guardada && dia && dia === hoje) return { atual: agora.toISOString(), anterior: guardada.anterior };
  return { atual: agora.toISOString(), anterior: guardada ? guardada.atual : null };
}

export type Janela = {
  /** primeiro dia que conta (inclusive) */
  desde: string;
  /** "visita": o dia da última visita; "padrao": 14 dias, porque não há visita anterior guardada */
  origem: "visita" | "padrao";
  /** a última visita é mais antiga que a janela lida: só há os últimos 60 dias */
  limitada: boolean;
};

export function janelaDe(visita: Visita | null, hoje: string): Janela {
  const minimo = somarDias(hoje, -JANELA_MAX);
  const dia = visita?.anterior ? diaDe(visita.anterior) : null;
  if (!dia || dia > hoje) return { desde: somarDias(hoje, -JANELA_PADRAO), origem: "padrao", limitada: false };
  if (dia < minimo) return { desde: minimo, origem: "visita", limitada: true };
  return { desde: dia, origem: "visita", limitada: false };
}

/** "R$ 1.234,56" (como a fonte formata, com espaço comum ou sem quebra) para centavos. Fora desse formato: null, nunca chute. */
export function centavosDe(texto: string | null | undefined): number | null {
  const m = /^(-?)R\$[\s ]*(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec((texto ?? "").trim());
  if (!m) return null;
  const n = Number(m[3].replace(/\./g, "")) * 100 + Number(m[4]);
  return m[1] || m[2] ? -n : n;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtReais = (centavos: number) => brl.format(centavos / 100).replace(/ /g, " ");

export type ResumoPessoa = {
  slug: string;
  nome: string;
  votos: number;
  /** votações em que a fonte registrou "não votou" ou "Art. 17" (não é voto contra nem é ausência declarada) */
  semVoto: number;
  propostas: number;
  gastos: number;
  /** soma em centavos; null se algum gasto veio sem valor legível (a tela diz o valor só quando fecha) */
  gastoCentavos: number | null;
};

/** O que a fonte registra quando a pessoa não votou: "Não votou" e "Art. 17" (o presidente da sessão não vota). Não é voto contra nem ausência declarada. */
const SEM_VOTO: ReadonlySet<string> = new Set(["Não votou", "Art. 17"]);

/** Uma linha por pessoa que teve registro desde `desde`, em ordem alfabética. Quem não teve registro não aparece. */
export function resumir(atos: readonly AtoDesde[], desde: string): ResumoPessoa[] {
  const por = new Map<string, { r: ResumoPessoa; v: Set<string>; sv: Set<string>; p: Set<string>; legiveis: boolean }>();
  for (const a of atos) {
    if (a.dia < desde) continue;
    let e = por.get(a.slug);
    if (!e) {
      e = { r: { slug: a.slug, nome: a.nome, votos: 0, semVoto: 0, propostas: 0, gastos: 0, gastoCentavos: 0 }, v: new Set(), sv: new Set(), p: new Set(), legiveis: true };
      por.set(a.slug, e);
    }
    if (a.kind === "voto") (a.voto !== null && SEM_VOTO.has(a.voto) ? e.sv : e.v).add(a.chave);
    else if (a.kind === "proposta") e.p.add(a.chave);
    else {
      e.r.gastos += 1;
      if (a.centavos === null) e.legiveis = false;
      else e.r.gastoCentavos = (e.r.gastoCentavos ?? 0) + a.centavos;
    }
  }
  return [...por.values()]
    .map(({ r, v, sv, p, legiveis }) => ({ ...r, votos: v.size, semVoto: sv.size, propostas: p.size, gastoCentavos: legiveis ? r.gastoCentavos : null }))
    .sort((a, b) => compararNomes(a.nome, b.nome));
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * A frase de uma pessoa, só com o que houve. `minimo`: a leitura parou no limite de registros, então os números são "pelo menos".
 * Ex.: "votou em 6 votações, consta na autoria de 2 propostas e teve 31 gastos registrados (R$ 12.345,67)".
 */
export function frasePessoa(r: ResumoPessoa, minimo: boolean): string {
  const aoMenos = minimo ? "pelo menos " : "";
  const partes: string[] = [];
  if (r.votos) partes.push(`votou em ${aoMenos}${plural(r.votos, "votação", "votações")}`);
  if (r.semVoto) partes.push(`ficou sem voto registrado em ${aoMenos}${plural(r.semVoto, "votação", "votações")}`);
  if (r.propostas) partes.push(`consta na autoria de ${aoMenos}${plural(r.propostas, "proposta", "propostas")}`);
  if (r.gastos) {
    const valor = r.gastoCentavos === null ? "" : ` (${fmtReais(r.gastoCentavos)})`;
    partes.push(`teve ${aoMenos}${plural(r.gastos, "gasto registrado", "gastos registrados")}${valor}`);
  }
  return partes.length <= 1 ? (partes[0] ?? "") : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}
