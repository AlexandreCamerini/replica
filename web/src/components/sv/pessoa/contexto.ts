// Contexto comum das rotas da Pessoa no /v2 (gastos, equipe, votos): pessoa, mandato principal, posse, casa, cobertura e as
// funções de fonte. Server-only (lê o DataSource). Uma leitura por requisição (cache do React).
import { cache } from "react";
import { aguardaPosse, casaDoMandato, mandatoPrincipal, motivoPosse } from "@/components/sv/mandato";
import { data, type CoberturaConjunto, type ConjuntoPessoa, type OfficeSlug, type Stamp } from "@/lib/data";
import { fonteDoConjunto } from "@/lib/data/cobertura";
import { fonteTexto, ler } from "./format";

export const SLUG = /^[a-z0-9-]{1,120}$/;

/** Cargos do Executivo: não votam em plenário nem têm cota de gabinete de casa legislativa. */
export const EXECUTIVO = new Set<OfficeSlug>(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
export const MOTIVO_PLENARIO = "Este cargo não vota em sessões de plenário.";
export const MOTIVO_COTA = "A cota de gabinete é verba de casa legislativa. Este cargo não a recebe.";

/** Dado presente sem carimbo de leitura: a origem não é afirmada. */
export const SEM_ORIGEM = (rotulo: string) => `${rotulo}, sem registro de qual casa publicou nem da data da leitura`;

export const carregarPessoa = cache((slug: string) => (SLUG.test(slug) ? data.getPerson(slug) : Promise.resolve(null)));

type Mandatos = Awaited<ReturnType<typeof data.getMandates>>;

export type ContextoPessoa = {
  person: NonNullable<Awaited<ReturnType<typeof data.getPerson>>>["person"];
  fem: boolean;
  mandatosOk: boolean;
  mandatos: Mandatos;
  main: Mandatos[number] | null;
  office: OfficeSlug | null;
  /** cargo legislativo (ou sem mandato carregado: não se afirma que não é) */
  legis: boolean;
  body: "camara" | "senado" | null;
  /** motivo de quem ainda não tomou posse; null = tomou posse */
  posse: string | null;
  ufSigla: string | null;
  /** "Câmara dos Deputados", "Assembleia Legislativa de SP"… citada como fonte quando o dado apareceu sem carimbo */
  casa: string | null;
  /** linha do cabeçalho: cargo · UF ou lugar · partido */
  cargoLinha: string | null;
  /** estado de um conjunto; null = a leitura da cobertura falhou (nada se afirma) */
  cob: (c: ConjuntoPessoa) => CoberturaConjunto | null;
  stampDe: (ds: string | null) => Promise<Stamp | null>;
  /** "Fonte: …" de um conjunto com cobertura (regra de cobertura.ts `fonteDoConjunto`). */
  fonteConjunto: (c: ConjuntoPessoa, rotulo: string, s: Stamp | null, temDado: boolean) => string;
};

/** Lê o contexto de uma pessoa já encontrada. Leituras que falham viram lacuna na tela (nunca erro de página). */
export async function contextoPessoa(person: ContextoPessoa["person"]): Promise<ContextoPessoa> {
  const id = person.id;
  const [mandatosR, coberturaR] = await Promise.all([ler(data.getMandates(id)), ler(data.getPeopleCoverage([id]))]);
  const mandatos = mandatosR.ok ? mandatosR.v : [];
  const main = mandatoPrincipal(mandatos);
  const placeR = main ? await ler(data.getPlace(main.placeIbge)) : null;
  const lugar = placeR && placeR.ok ? placeR.v : null;
  const ufSigla = lugar?.uf ?? null;
  const office = main?.office ?? null;
  const body = office === "deputado_federal" ? "camara" : office === "senador" ? "senado" : null;
  const casa = main ? casaDoMandato(main.office, ufSigla, main.placeLabel) : null;
  const cob = (c: ConjuntoPessoa): CoberturaConjunto | null => (coberturaR.ok ? (coberturaR.v[0]?.conjuntos.find((x) => x.conjunto === c) ?? null) : null);
  const partido = main ? (main.party.name && main.party.name !== main.party.acronym ? `${main.party.acronym} (${main.party.name})` : main.party.acronym) : null;
  const cargoLinha = main ? [main.officeName, ufSigla ?? main.placeLabel, partido].filter(Boolean).join(" · ") : null;
  const stampDe = (ds: string | null): Promise<Stamp | null> => (ds ? data.getStamp(ds).catch(() => null) : Promise.resolve(null));
  // Com dado e sem carimbo, a casa do mandato atual NÃO é citada: a linha pode ser de outro mandato (ex.: notas da cota
  // da Câmara de quem hoje é vereador). Diz que a leitura não registra a origem.
  const fonteConjunto = (c: ConjuntoPessoa, rotulo: string, s: Stamp | null, temDado: boolean) => {
    const f = fonteDoConjunto(cob(c), s, temDado);
    if (f.tipo === "lacuna") return `Fonte: ${f.nome}, ${rotulo}.`;
    if (!f.s && temDado) return `Fonte: ${SEM_ORIGEM(rotulo)}.`;
    return `Fonte: ${fonteTexto(rotulo, f.s, null)}.`;
  };
  return {
    person,
    fem: person.gender === "f",
    mandatosOk: mandatosR.ok,
    mandatos,
    main,
    office,
    legis: !office || !EXECUTIVO.has(office),
    body,
    posse: main && aguardaPosse(main) ? motivoPosse(main) : null,
    ufSigla,
    casa,
    cargoLinha,
    cob,
    stampDe,
    fonteConjunto,
  };
}

/** Número inteiro positivo de um parâmetro de URL (`pagina=3`); qualquer outra coisa = null. */
export function inteiroPositivo(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  // teto de 4 dígitos: página além disso não existe em nenhuma lista da Pessoa e o offset gigante não chega ao banco
  if (!s || !/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** Primeiro valor de um parâmetro de URL, com teto de tamanho. */
export function texto(v: string | string[] | undefined, max = 200): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= max ? s : null;
}
