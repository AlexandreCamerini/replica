// Metadados editoriais das fontes (S24): o que cada uma traz e a cadência esperada. Os carimbos vêm do banco;
// aqui fica só o que o banco não sabe. Funções puras, testáveis sem servidor.

// everyHours = de quanto em quanto tempo a agenda do ETL (etl/civico_etl/schedule.py, Task.every_h) lê a fonte; maxAgeHours = prazo do site.
// test_schedule.py confere os dois contra schedule.py (mesma régua do `run-due`).
export type SourceMeta = { brings: string; cadence: string; everyHours: number; maxAgeHours: number };

export const SOURCE_META: Record<string, SourceMeta> = {
  camara: {
    brings: "deputados federais e seus mandatos, lista de presença das sessões, votações nominais e orientações, proposições com autoria e tema, cota parlamentar, comissões, discursos, equipe de gabinete (nome e nível)",
    cadence: "todo dia",
    everyHours: 20,
    maxAgeHours: 36,
  },
  senado: { brings: "senadores (em exercício e afastados da legislatura) e votações nominais, abertas e secretas", cadence: "todo dia", everyHours: 20, maxAgeHours: 36 },
  tse: {
    brings: "candidaturas e eleitos, bens declarados, votos por candidato e por município, receitas e despesas de campanha somadas por categoria e por tipo de fonte (partido, fundos públicos, pessoas físicas, recursos próprios...); só partidos e empresas aparecem com nome de doador, pessoa física nunca",
    cadence: "a cada divulgação do TSE; conferimos uma vez por mês",
    everyHours: 7 * 24,
    maxAgeHours: 60 * 24,
  },
  ibge: { brings: "regiões, estados, municípios, códigos e contornos", cadence: "uma vez por ano", everyHours: 365 * 24, maxAgeHours: 400 * 24 },
  // W3-A: Assembleias com adaptador. A casa atualiza todo dia; nossa leitura é semanal (etl/civico_etl/schedule.py, D250)
  alesp: {
    brings: "deputados estaduais de SP: verba de gabinete por mês e proposituras (projetos de lei, de lei complementar, de resolução, de decreto legislativo e PECs) com autoria. Presença e votos em plenário não são publicados em dado aberto",
    cadence: "uma vez por semana",
    everyHours: 6 * 24,
    maxAgeHours: 8 * 24,
  },
  // W3-B: cadência = agenda do ETL (schedule.py, D250). maxAgeHours aqui e MAX_AGE_H lá são a mesma régua (test_schedule.py)
  sapl: { brings: "vereadores das câmaras municipais com SAPL já lidas: projetos com autoria, presença em sessão (sem porcentagem) e votos nominais", cadence: "toda câmara lida volta a ser conferida em até uma semana", everyHours: 20, maxAgeHours: 8 * 24 },
  tcu: { brings: "lista de inabilitados para função pública (sem CPF no site)", cadence: "uma vez por mês", everyHours: 28 * 24, maxAgeHours: 35 * 24 },
  alemg: {
    brings: "deputados estaduais de MG: verba indenizatória por mês (valor reembolsado) e proposições (projetos de lei, de lei complementar, de resolução e PECs) com autoria. Presença e votos em plenário não são publicados em dado aberto",
    cadence: "uma vez por semana",
    everyHours: 6 * 24,
    maxAgeHours: 8 * 24,
  },
  "ibge-sidra": { brings: "PIB, inflação (IPCA) e desemprego (PNAD Contínua), ano a ano, para /governos", cadence: "uma vez por trimestre", everyHours: 80 * 24, maxAgeHours: 120 * 24 },
  "bcb-sgs": { brings: "meta da taxa Selic no fim de cada ano, para /governos", cadence: "uma vez por trimestre", everyHours: 80 * 24, maxAgeHours: 120 * 24 },
  "receita-federal": { brings: "arrecadação federal por estado, mês e tributo, para /impostos", cadence: "uma vez por mês", everyHours: 28 * 24, maxAgeHours: 60 * 24 },
  // catálogo D01–D03: API de dados do Portal da Transparência (CGU), com chave. Lidas toda semana (schedule.py: transparencia.emendas, sancoes.cgu)
  transparencia: {
    brings: "emendas parlamentares por ano (2023 em diante): autor, tipo, função, localidade do gasto e os valores empenhado, liquidado e pago. A fonte não traz o objeto da emenda nem o código do município",
    cadence: "uma vez por semana",
    everyHours: 7 * 24,
    maxAgeHours: 14 * 24,
  },
  cgu: {
    brings: "sanções de pessoas físicas no CEIS e no CNEP (Controladoria-Geral da União), sem CPF; só ligamos à pessoa quando o nome civil é completo, único e o órgão sancionador é estadual ou municipal",
    cadence: "uma vez por semana",
    everyHours: 7 * 24,
    maxAgeHours: 14 * 24,
  },
};

/** Fontes que o produto ainda não lê. Aparecem na tabela com “—” e o motivo, nunca como se existissem. */
export const NOT_YET: { name: string; brings: string; why: string }[] = [
  {
    name: "Assembleias Legislativas (25 de 27)",
    brings: "deputados estaduais: presença, votos, propostas, verbas",
    why: "cada casa publica de um jeito; já lemos São Paulo e Minas Gerais. Rio de Janeiro e Rio Grande do Sul: não localizamos catálogo de dados abertos que permita leitura automática",
  },
  { name: "Câmaras Municipais (fora as já lidas pelo SAPL)", brings: "vereadores: presença, votos, propostas", why: "mais de 900 câmaras usam o SAPL; a leitura avança em lotes diários, e as demais publicam em sites próprios" },
  { name: "Tribunais de Contas", brings: "salário pago a prefeitos e vereadores", why: "fonte ainda não mapeada" },
];

export type Freshness = { state: "no_prazo" | "fora_do_prazo" | "sem_carga"; ageHours: number | null; overdueHours: number };

/** Fora do prazo = a última carga é mais antiga que a cadência esperada. Sem carga nenhuma é outro estado, não “no prazo”. */
export function freshness(last: string | null, maxAgeHours: number, now: number = Date.now()): Freshness {
  if (!last) return { state: "sem_carga", ageHours: null, overdueHours: 0 };
  const t = Date.parse(last);
  if (Number.isNaN(t)) return { state: "sem_carga", ageHours: null, overdueHours: 0 };
  const ageHours = Math.max(0, (now - t) / 3_600_000);
  return ageHours > maxAgeHours
    ? { state: "fora_do_prazo", ageHours, overdueHours: ageHours - maxAgeHours }
    : { state: "no_prazo", ageHours, overdueHours: 0 };
}

export function ageLabel(hours: number): string {
  if (hours < 1) return "há menos de 1 hora";
  if (hours < 48) return `há ${Math.floor(hours)} h`;
  return `há ${Math.floor(hours / 24)} dias`;
}

// catálogo D13: "próxima leitura prevista". A agenda é chamada de SCHEDULER_EVERY_HOURS em SCHEDULER_EVERY_HOURS horas (UTC), no minuto SCHEDULER_MINUTE
// (cron do .github/workflows/etl.yml); uma fonte de cadência `everyHours` é relida na primeira chamada depois de carimbo + cadência.
// Mesma conta de schedule.next_read; test_schedule.py confere as constantes e os resultados. É um teto: tarefa que falha ou é adiada lê depois,
// e as leituras noturnas da Câmara e do Senado (catálogo D06) podem adiantar o carimbo.
export const SCHEDULER_MINUTE = 17;
export const SCHEDULER_EVERY_HOURS = 3;

const HOUR_MS = 3_600_000;

/** Primeira chamada da agenda em ou depois de `t` (ms desde a época). */
export function nextSchedulerTick(t: number): number {
  const d = new Date(t);
  let c = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), SCHEDULER_MINUTE);
  if (c < t) c += HOUR_MS;
  while (new Date(c).getUTCHours() % SCHEDULER_EVERY_HOURS !== 0) c += HOUR_MS;
  return c;
}

/** Fonte (chave de SOURCE_META) de um carimbo de `dataset_stamps` pelo prefixo do dataset. Prefixo ambíguo
 *  (agenda, governos, parlamento: mais de uma fonte ou cadência própria) devolve undefined e o rodapé não promete hora. */
const DATASET_PREFIX: Record<string, string> = {
  camara: "camara", senado: "senado", tse: "tse", ibge: "ibge", sapl: "sapl", alesp: "alesp", alemg: "alemg",
  receita: "receita-federal", transparencia: "transparencia", "sancoes.tcu": "tcu", "sancoes.cgu": "cgu",
};
export function slugForDataset(dataset: string | undefined): string | undefined {
  if (!dataset) return undefined;
  const [a, b] = dataset.split(".");
  const slug = DATASET_PREFIX[`${a}.${b}`] ?? DATASET_PREFIX[a];
  return slug && slug in SOURCE_META ? slug : undefined;
}

/** ISO da próxima leitura prevista, ou null sem carimbo válido (sem carga não há “próxima”: a agenda lê na primeira chamada, mas não prometemos hora). */
export function nextExpectedRead(last: string | null, everyHours: number, now: number = Date.now()): string | null {
  if (!last) return null;
  const t = Date.parse(last);
  if (Number.isNaN(t) || t <= 0) return null; // época 0 = carimbo de reserva de getStamp (sem carga): não prometer hora
  return new Date(nextSchedulerTick(Math.max(t + everyHours * HOUR_MS, now))).toISOString();
}

/** “09/11, por volta das 06h” em Brasília. Data e hora absolutas, não “hoje/amanhã”: a página pode estar em cache. */
export function nextReadLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}, por volta das ${get("hour") === "24" ? "00" : get("hour")}h`;
}
