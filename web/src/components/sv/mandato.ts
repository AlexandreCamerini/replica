// Mandato principal de uma pessoa e as frases que dependem dele. Puro: sem JSX, sem dado. Usado por Início, Escolhidos,
// Pessoa e Decisão: quem ainda não tomou posse nunca aparece "no cargo desde"; a cobertura de leis só vale onde lemos leis.
import type { MandateStatus, OfficeSlug } from "../../lib/data/types.ts";

type M = { status: MandateStatus; office: OfficeSlug; startedOn: string };

/** Em exercício primeiro; depois eleito aguardando posse; depois o primeiro que a fonte devolveu. */
export function mandatoPrincipal<T extends M>(ms: readonly T[] | null | undefined): T | null {
  if (!ms || ms.length === 0) return null;
  return ms.find((m) => m.status === "em_exercicio") ?? ms.find((m) => m.status === "eleito_aguardando_posse") ?? ms[0];
}

/** "mm/aaaa" de uma data ISO; null se a data não vier. */
export function mmaaaa(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[1]}` : null;
}

export const aguardaPosse = (m: Pick<M, "status"> | null | undefined) => m?.status === "eleito_aguardando_posse";

/**
 * Trecho do cabeçalho sobre o tempo no cargo. Em exercício: "no cargo desde mm/aaaa". Aguardando posse:
 * "eleito(a), toma posse em mm/aaaa". Outros status: "mandato desde mm/aaaa". Sem data: null.
 */
export function fraseDesde(m: M | null | undefined, fem?: boolean | null): string | null {
  if (!m) return null;
  const d = mmaaaa(m.startedOn);
  if (m.status === "eleito_aguardando_posse") {
    const eleito = fem ? "eleita" : fem === false ? "eleito" : "eleito(a)";
    return d ? `${eleito}, toma posse em ${d}` : `${eleito}, aguardando posse`;
  }
  if (!d) return null;
  return m.status === "em_exercicio" ? `no cargo desde ${d}` : `mandato desde ${d}`;
}

/** Motivo da lacuna de presença, gastos e votos de quem ainda não tomou posse. */
export function motivoPosse(m: M): string {
  const d = mmaaaa(m.startedOn);
  return d ? `Ainda não tomou posse: toma posse em ${d}. Antes disso não há presença, gastos nem votos no cargo.` : "Ainda não tomou posse. Antes disso não há presença, gastos nem votos no cargo.";
}

/** Só lemos leis sancionadas de deputado federal e senador: fora disso, lista vazia não quer dizer "nenhuma virou lei". */
export const cobreLeis = (office: OfficeSlug | null | undefined) => office === "deputado_federal" || office === "senador";

/**
 * Nome da casa ou do órgão do mandato, para citar como fonte quando o dado apareceu sem carimbo de leitura.
 * "Assembleia Legislativa de SP", "Câmara Municipal de Campinas (SP)".
 */
export function casaDoMandato(office: OfficeSlug, uf: string | null | undefined, placeLabel: string | null | undefined): string {
  const lugar = placeLabel?.trim() || null;
  switch (office) {
    case "deputado_federal":
      return "Câmara dos Deputados";
    case "senador":
      return "Senado Federal";
    case "deputado_estadual":
      return uf ? `Assembleia Legislativa de ${uf}` : lugar ? `Assembleia Legislativa (${lugar})` : "Assembleia Legislativa";
    case "deputado_distrital":
      return "Câmara Legislativa do Distrito Federal";
    case "vereador":
      return lugar ? `Câmara Municipal de ${lugar}` : "Câmara Municipal";
    case "prefeito":
    case "vice_prefeito":
      return lugar ? `Prefeitura de ${lugar}` : "Prefeitura";
    case "governador":
    case "vice_governador":
      return uf ? `Governo do Estado de ${uf}` : "Governo do Estado";
    default:
      return "Presidência da República";
  }
}

/** Rótulo dos gastos: "cota parlamentar" é nome próprio da verba de deputado federal; nos outros cargos, "gastos do gabinete". */
export const rotuloGastos = (office: OfficeSlug | null | undefined) => (office === "deputado_federal" ? "cota parlamentar" : "gastos do gabinete");
