import type { Office, OfficeSlug, Place, Topic } from "./types";

// Dados de referência. UFs, regiões e tamanho das bancadas são fatos públicos (IBGE, CF art. 45 e 27).
// Municípios: os códigos IBGE das capitais e de Campinas são reais; os homônimos com código 9xxxx são de demonstração.

export const OFFICES: Office[] = [
  { slug: "presidente", nameM: "Presidente da República", nameF: "Presidenta da República", level: "federal", order: 1 },
  { slug: "vice_presidente", nameM: "Vice-presidente", nameF: "Vice-presidenta", level: "federal", order: 2 },
  { slug: "senador", nameM: "Senador", nameF: "Senadora", level: "federal", order: 3 },
  { slug: "deputado_federal", nameM: "Deputado federal", nameF: "Deputada federal", level: "federal", order: 4 },
  { slug: "governador", nameM: "Governador", nameF: "Governadora", level: "estadual", order: 5 },
  { slug: "vice_governador", nameM: "Vice-governador", nameF: "Vice-governadora", level: "estadual", order: 6 },
  { slug: "deputado_estadual", nameM: "Deputado estadual", nameF: "Deputada estadual", level: "estadual", order: 7 },
  { slug: "deputado_distrital", nameM: "Deputado distrital", nameF: "Deputada distrital", level: "estadual", order: 7 },
  { slug: "prefeito", nameM: "Prefeito", nameF: "Prefeita", level: "municipal", order: 8 },
  { slug: "vice_prefeito", nameM: "Vice-prefeito", nameF: "Vice-prefeita", level: "municipal", order: 9 },
  { slug: "vereador", nameM: "Vereador", nameF: "Vereadora", level: "municipal", order: 10 },
];
export const officeBySlug = Object.fromEntries(OFFICES.map((o) => [o.slug, o])) as Record<OfficeSlug, Office>;
export const PLURAL: Record<OfficeSlug, string> = {
  presidente: "Presidência",
  vice_presidente: "Vice-presidência",
  senador: "Senado",
  deputado_federal: "Deputados federais",
  governador: "Governo do estado",
  vice_governador: "Vice-governo",
  deputado_estadual: "Deputados estaduais",
  deputado_distrital: "Deputados distritais",
  prefeito: "Prefeitura",
  vice_prefeito: "Vice-prefeitura",
  vereador: "Vereadores",
};

export const REGIONS = [
  { ibge: "1", name: "Norte" },
  { ibge: "2", name: "Nordeste" },
  { ibge: "3", name: "Sudeste" },
  { ibge: "4", name: "Sul" },
  { ibge: "5", name: "Centro-Oeste" },
] as const;

// [ibge, sigla, nome, região, cadeiras na Câmara, linha, coluna no mapa em grade]
export const UF_ROWS: [string, string, string, string, number, number, number][] = [
  ["14", "RR", "Roraima", "1", 8, 0, 2],
  ["16", "AP", "Amapá", "1", 8, 0, 4],
  ["13", "AM", "Amazonas", "1", 8, 1, 1],
  ["15", "PA", "Pará", "1", 17, 1, 3],
  ["21", "MA", "Maranhão", "2", 18, 1, 4],
  ["23", "CE", "Ceará", "2", 22, 1, 5],
  ["24", "RN", "Rio Grande do Norte", "2", 8, 1, 6],
  ["12", "AC", "Acre", "1", 8, 2, 0],
  ["11", "RO", "Rondônia", "1", 8, 2, 1],
  ["51", "MT", "Mato Grosso", "5", 8, 2, 2],
  ["17", "TO", "Tocantins", "1", 8, 2, 3],
  ["22", "PI", "Piauí", "2", 10, 2, 4],
  ["26", "PE", "Pernambuco", "2", 25, 2, 5],
  ["25", "PB", "Paraíba", "2", 12, 2, 6],
  ["50", "MS", "Mato Grosso do Sul", "5", 8, 3, 2],
  ["52", "GO", "Goiás", "5", 17, 3, 3],
  ["29", "BA", "Bahia", "2", 39, 3, 4],
  ["28", "SE", "Sergipe", "2", 8, 3, 5],
  ["27", "AL", "Alagoas", "2", 9, 3, 6],
  ["53", "DF", "Distrito Federal", "5", 8, 4, 3],
  ["31", "MG", "Minas Gerais", "3", 53, 4, 4],
  ["32", "ES", "Espírito Santo", "3", 10, 4, 5],
  ["35", "SP", "São Paulo", "3", 70, 5, 3],
  ["33", "RJ", "Rio de Janeiro", "3", 46, 5, 4],
  ["41", "PR", "Paraná", "4", 30, 6, 2],
  ["42", "SC", "Santa Catarina", "4", 16, 7, 2],
  ["43", "RS", "Rio Grande do Sul", "4", 31, 8, 2],
];

/** CF art. 27: até 12 federais, o triplo; acima disso, 36 + (federais − 12). */
export function stateSeats(federal: number) {
  return federal <= 12 ? federal * 3 : 36 + (federal - 12);
}

// [ibge, nome, uf, vereadores]
export const MUNICIPALITY_ROWS: [string, string, string, number][] = [
  ["3550308", "São Paulo", "SP", 55],
  ["3509502", "Campinas", "SP", 33],
  ["3304557", "Rio de Janeiro", "RJ", 51],
  ["3106200", "Belo Horizonte", "MG", 41],
  ["2927408", "Salvador", "BA", 43],
  ["2304400", "Fortaleza", "CE", 43],
  ["2611606", "Recife", "PE", 39],
  ["4314902", "Porto Alegre", "RS", 36],
  ["4106902", "Curitiba", "PR", 38],
  ["1302603", "Manaus", "AM", 41],
  ["1501402", "Belém", "PA", 35],
  ["5208707", "Goiânia", "GO", 37],
  ["2299001", "Bom Jesus", "PI", 11],
  ["4399001", "Bom Jesus", "RS", 9],
  ["4299001", "Bom Jesus", "SC", 9],
  ["2499001", "Bom Jesus", "PB", 9],
  ["4399002", "Campinas do Sul", "RS", 9],
  ["2299002", "Campinas do Piauí", "PI", 9],
];

export const TOPICS: Topic[] = [
  { slug: "saude", name: "Saúde" },
  { slug: "educacao", name: "Educação" },
  { slug: "seguranca", name: "Segurança pública" },
  { slug: "economia", name: "Economia e tributos" },
  { slug: "trabalho", name: "Trabalho e previdência" },
  { slug: "meio-ambiente", name: "Meio ambiente" },
  { slug: "agro", name: "Agricultura e alimentos" },
  { slug: "cidades", name: "Cidades e transporte" },
  { slug: "direitos", name: "Direitos humanos" },
  { slug: "cultura", name: "Cultura e esporte" },
  { slug: "ciencia", name: "Ciência e tecnologia" },
  { slug: "energia", name: "Energia e mineração" },
  { slug: "assistencia", name: "Assistência social" },
  { slug: "gestao", name: "Gestão pública" },
  { slug: "justica", name: "Justiça" },
  { slug: "defesa", name: "Defesa e relações exteriores" },
  { slug: "comunicacao", name: "Comunicação" },
];
export const topicName = Object.fromEntries(TOPICS.map((t) => [t.slug, t.name])) as Record<string, string>;

export const EXPENSE_CATEGORIES = [
  "Escritório de apoio",
  "Divulgação do mandato",
  "Passagens aéreas",
  "Combustível",
  "Telefonia",
  "Hospedagem",
  "Consultorias e pesquisas",
  "Alimentação",
  "Locação de veículos",
];

export const SOURCES = {
  tse: { name: "TSE · Dados Abertos", url: "https://dadosabertos.tse.jus.br/" },
  camara: { name: "Câmara dos Deputados · Dados Abertos", url: "https://dadosabertos.camara.leg.br/" },
  senado: { name: "Senado Federal · Dados Abertos", url: "https://www12.senado.leg.br/dados-abertos" },
  ibge: { name: "IBGE · Localidades", url: "https://servicodados.ibge.gov.br/api/docs/localidades" },
} as const;

export function buildPlaces(): Place[] {
  const out: Place[] = [{ ibge: "BR", kind: "pais", name: "Brasil", slug: "brasil", uf: null, region: null }];
  for (const r of REGIONS) out.push({ ibge: r.ibge, kind: "regiao", name: r.name, slug: slugify(r.name), uf: null, region: r.ibge });
  for (const [ibge, uf, name, region] of UF_ROWS) out.push({ ibge, kind: "uf", name, slug: slugify(name), uf, region });
  const regionOf = Object.fromEntries(UF_ROWS.map((r) => [r[1], r[3]]));
  for (const [ibge, name, uf] of MUNICIPALITY_ROWS)
    out.push({ ibge, kind: "municipio", name, slug: `${slugify(name)}-${uf.toLowerCase()}`, uf, region: regionOf[uf] });
  return out;
}

export function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Para busca: sem acento, minúsculo. Espelha unaccent + lower do Postgres. */
export function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
