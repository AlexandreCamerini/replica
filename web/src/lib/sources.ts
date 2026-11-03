// Metadados editoriais das fontes (S24): o que cada uma traz e a cadência esperada. Os carimbos vêm do banco;
// aqui fica só o que o banco não sabe. Funções puras, testáveis sem servidor.

export type SourceMeta = { brings: string; cadence: string; maxAgeHours: number };

export const SOURCE_META: Record<string, SourceMeta> = {
  camara: {
    brings: "deputados federais e seus mandatos, lista de presença das sessões, votações nominais e orientações, proposições com autoria e tema, cota parlamentar, comissões, discursos, equipe de gabinete (nome e nível)",
    cadence: "todo dia",
    maxAgeHours: 36,
  },
  senado: { brings: "senadores (em exercício e afastados da legislatura) e votações nominais, abertas e secretas", cadence: "todo dia", maxAgeHours: 36 },
  tse: {
    brings: "candidaturas e eleitos, bens declarados, votos por candidato e por município, receitas e despesas de campanha somadas por categoria (sem nome de doador)",
    cadence: "a cada divulgação do TSE; conferimos uma vez por mês",
    maxAgeHours: 60 * 24,
  },
  ibge: { brings: "regiões, estados, municípios, códigos e contornos", cadence: "uma vez por ano", maxAgeHours: 400 * 24 },
  "ibge-sidra": { brings: "PIB, inflação (IPCA) e desemprego (PNAD Contínua), ano a ano, para /governos", cadence: "uma vez por trimestre", maxAgeHours: 120 * 24 },
  "bcb-sgs": { brings: "meta da taxa Selic no fim de cada ano, para /governos", cadence: "uma vez por trimestre", maxAgeHours: 120 * 24 },
  "receita-federal": { brings: "arrecadação federal por estado, mês e tributo, para /impostos", cadence: "uma vez por mês", maxAgeHours: 60 * 24 },
};

/** Fontes que o produto ainda não lê. Aparecem na tabela com “—” e o motivo, nunca como se existissem. */
export const NOT_YET: { name: string; brings: string; why: string }[] = [
  { name: "Assembleias Legislativas (27)", brings: "deputados estaduais: presença, votos, propostas, verbas", why: "cada casa publica de um jeito; a leitura começa pelas maiores" },
  { name: "Câmaras Municipais", brings: "vereadores: presença, votos, propostas", why: "mais de 900 sites diferentes, a lê-los um de cada vez" },
  { name: "Portal da Transparência (federal)", brings: "emendas parlamentares", why: "depende de chave de acesso que ainda não foi criada" },
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
