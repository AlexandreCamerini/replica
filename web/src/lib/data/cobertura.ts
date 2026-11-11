// Regra única da cobertura por pessoa: para cada conjunto (presença, votos, gastos…), o que o banco sustenta dizer.
// Puro: pg.ts e fake.ts montam a entrada (mandato, data_coverage, carimbos) e chamam `coberturaDe`; a tela só lê o estado.
// Importável pelos testes (node --test): imports com extensão e só de tipo.
import type { AssemblyInfo, CoberturaConjunto, ConjuntoPessoa, CoverageStatus, EstadoCobertura, MandateStatus, OfficeSlug } from "./types.ts";
import { CONJUNTOS_PESSOA } from "./types.ts";

export type CarimboFonte = { nome: string; url: string | null; em: string };

export type EntradaCobertura = {
  /** cargo e situação do mandato principal (em exercício > aguardando posse > o mais recente); null = sem mandato carregado */
  office: OfficeSlug | null;
  status: MandateStatus | null;
  /** person_period_stats (career).missing_datasets, só do Congresso; null = sem linha */
  faltaFederal: string[] | null;
  /** data_coverage do lugar do mandato (UF da Assembleia ou município da Câmara Municipal) */
  coberturaLugar: { dataset: string; status: CoverageStatus; reason: string; evidenceUrl: string | null }[];
  /** carimbo mais novo de cada família de carga (chave = prefixo de dataset_stamps, ex.: "camara.presenca"); null = nunca carregado */
  carimbos: Record<string, CarimboFonte | null>;
  /** Assembleia da UF (getAssembly), só para deputado estadual e distrital; null = não lida ou leitura falhou */
  assembleia: AssemblyInfo | null;
  /** carga do SAPL da Câmara Municipal, quando o vereador está casado no SAPL; null = não */
  sapl: CarimboFonte | null;
  /** nome da casa do mandato, citado como fonte das lacunas que vêm de data_coverage */
  casa: string | null;
};

/** Famílias de carimbo (dataset_stamps) de cada conjunto no Congresso. null = o ETL não lê esse conjunto para a casa. */
export const CARIMBO_CONGRESSO: Record<"camara" | "senado", Record<ConjuntoPessoa, string | null>> = {
  camara: {
    presenca: "camara.presenca",
    votos: "camara.votacoes",
    gastos: "camara.despesas",
    propostas: "camara.proposicoes",
    leis: "camara.proposicoes", // as leis vêm das proposições da Câmara (camara_diario: laws + became_law_id)
    equipe: "camara.equipe",
    comissoes: "parlamento.extras",
    emendas: "transparencia.emendas",
    patrimonio: "tse.candidatos",
  },
  senado: {
    presenca: null,
    votos: "senado.votacoes",
    gastos: "senado.despesas",
    propostas: "senado.autorias",
    leis: null,
    equipe: null,
    comissoes: "parlamento.extras",
    emendas: "transparencia.emendas",
    patrimonio: "tse.candidatos",
  },
};
/** Todas as famílias que o leitor consulta (uma consulta só em dataset_stamps). */
export const FAMILIAS_CARIMBO = [...new Set(Object.values(CARIMBO_CONGRESSO).flatMap((m) => Object.values(m).filter((x): x is string => !!x)))].sort();

const EXECUTIVO: ReadonlySet<OfficeSlug> = new Set(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
/** chave de data_coverage de cada conjunto da casa legislativa (só esses quatro existem em data_coverage por lugar) */
const CHAVE_COBERTURA: Partial<Record<ConjuntoPessoa, string>> = { presenca: "presenca", votos: "votos", propostas: "propostas", gastos: "gastos_gabinete" };

const MOTIVO = {
  semMandato: "Não há mandato carregado para esta pessoa: não sabemos de que casa ler.",
  posse: "Ainda não tomou posse: antes disso não há esse dado no cargo.",
  executivo: {
    presenca: "Cargo do Executivo: não vota em sessões de plenário.",
    votos: "Cargo do Executivo: não vota em sessões de plenário.",
    gastos: "A cota de gabinete é verba de casa legislativa. Este cargo não a recebe.",
    comissoes: "Comissões são de casa legislativa. Este cargo não participa delas.",
    emendas: "Emendas ao orçamento são de parlamentares. Este cargo não as apresenta.",
  } as Partial<Record<ConjuntoPessoa, string>>,
  naoLemosExecutivo: "Não lemos este dado para cargos do Executivo.",
  senadoPresenca: "O Senado não publica a lista de presença por senador.",
  senadoLeis: "Lemos as leis a partir das proposições da Câmara; as de autoria no Senado ainda não.",
  senadoEquipe: "Não lemos a equipe dos gabinetes do Senado.",
  faltaFederal: "A casa publica, mas este dado ainda não foi carregado para esta pessoa.",
  semCarimbo: "A casa publica, mas a carga deste dado ainda não rodou.",
  soCongresso: "Lemos este dado só para deputados federais e senadores.",
  semAssembleia: "Ainda não conferimos o que a Assembleia publica.",
  semLinha: "Ainda não conferimos se a casa publica este dado.",
  semTse: "As candidaturas do TSE ainda não foram carregadas.",
} as const;

const DE_COBERTURA: Record<Exclude<CoverageStatus, "no_site">, EstadoCobertura> = {
  carregando: "nao_carregado",
  so_portal: "fonte_sem_adaptador",
  nao_publica: "sem_fonte",
  desconhecido: "nao_conferido",
};

const item = (conjunto: ConjuntoPessoa, estado: EstadoCobertura, motivo: string, fonte: CoberturaConjunto["fonte"] = null, lidoEm: string | null = null): CoberturaConjunto => ({
  conjunto,
  estado,
  motivo,
  fonte,
  lidoEm: estado === "lido" ? lidoEm : null,
});
const lido = (c: ConjuntoPessoa, k: CarimboFonte, motivo = "Lido na fonte oficial.") => item(c, "lido", motivo, { nome: k.nome, url: k.url }, k.em);

/** Uma linha de data_coverage vira estado. `no_site` só é lido com carimbo (mesma regra de getAssembly). */
function deLinha(c: ConjuntoPessoa, linha: EntradaCobertura["coberturaLugar"][number] | undefined, carimbo: CarimboFonte | null, casa: string | null): CoberturaConjunto {
  if (!linha) return item(c, "nao_conferido", MOTIVO.semLinha, casa ? { nome: casa, url: null } : null);
  const fonte = casa || linha.evidenceUrl ? { nome: casa ?? "página oficial", url: linha.evidenceUrl } : null;
  if (linha.status === "no_site") return carimbo ? lido(c, carimbo) : item(c, "nao_carregado", linha.reason || MOTIVO.semCarimbo, fonte);
  return item(c, DE_COBERTURA[linha.status], linha.reason, fonte);
}

function patrimonio(e: EntradaCobertura): CoberturaConjunto {
  const k = e.carimbos["tse.candidatos"] ?? null;
  return k ? lido("patrimonio", k, "Bens declarados à Justiça Eleitoral nas candidaturas.") : item("patrimonio", "nao_carregado", MOTIVO.semTse);
}

/** Cobertura de uma pessoa, um item por conjunto, na ordem de CONJUNTOS_PESSOA. */
export function coberturaDe(e: EntradaCobertura): CoberturaConjunto[] {
  return CONJUNTOS_PESSOA.map((c) => (c === "patrimonio" ? patrimonio(e) : umConjunto(c, e)));
}

function umConjunto(c: ConjuntoPessoa, e: EntradaCobertura): CoberturaConjunto {
  const { office } = e;
  if (!office) return item(c, "nao_carregado", MOTIVO.semMandato);
  if (e.status === "eleito_aguardando_posse") return item(c, "fora_do_mandato", MOTIVO.posse);
  if (EXECUTIVO.has(office)) {
    const m = MOTIVO.executivo[c];
    return m ? item(c, "nao_se_aplica", m) : item(c, "nao_carregado", MOTIVO.naoLemosExecutivo);
  }
  if (office === "deputado_federal" || office === "senador") {
    const casa = office === "senador" ? "senado" : "camara";
    const familia = CARIMBO_CONGRESSO[casa][c];
    if (!familia) {
      if (c === "presenca") return item(c, "sem_fonte", MOTIVO.senadoPresenca, { nome: "Senado Federal", url: null });
      return item(c, "nao_carregado", c === "leis" ? MOTIVO.senadoLeis : MOTIVO.senadoEquipe);
    }
    const chave = CHAVE_COBERTURA[c];
    if (chave && e.faltaFederal?.includes(chave)) return item(c, "nao_carregado", MOTIVO.faltaFederal);
    const k = e.carimbos[familia] ?? null;
    return k ? lido(c, k) : item(c, "nao_carregado", MOTIVO.semCarimbo);
  }
  const chave = CHAVE_COBERTURA[c];
  if (!chave) return item(c, "nao_carregado", MOTIVO.soCongresso);
  if (office === "deputado_estadual" || office === "deputado_distrital") {
    const a = e.assembleia;
    const it = a?.items.find((x) => x.dataset === chave);
    if (!a || !it) return item(c, "nao_conferido", MOTIVO.semAssembleia, e.casa ? { nome: e.casa, url: null } : null);
    if (it.status === "no_site" && it.refreshedAt && a.source) return lido(c, { nome: a.source.name, url: a.source.url, em: it.refreshedAt });
    if (it.status === "no_site") return item(c, "nao_carregado", it.reason || MOTIVO.semCarimbo, { nome: a.houseName, url: it.evidenceUrl });
    return item(c, DE_COBERTURA[it.status], it.reason, { nome: a.houseName, url: it.evidenceUrl });
  }
  // vereador: o SAPL casado cobre propostas, presença e votos; gastos vêm da cobertura do município
  if (office === "vereador" && e.sapl && c !== "gastos") return lido(c, e.sapl, "Lido no SAPL da Câmara Municipal.");
  return deLinha(c, e.coberturaLugar.find((x) => x.dataset === chave), null, e.casa);
}
