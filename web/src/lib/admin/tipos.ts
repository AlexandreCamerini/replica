// Tipos puros da central de administração (Parte C). Sem banco, sem Next, sem `server-only`.
// Importável pelos testes (node --test): só tipos e constantes, imports com extensão `.ts`.

/** As quatro classes de campo da Parte B, na ordem fixa em que toda lista é ordenada. */
export const CLASSES = ["vinculo_sapl", "cobertura", "contato_mandato", "identidade"] as const;
export type Classe = (typeof CLASSES)[number];

export type Nivel = "municipio" | "uf" | "pais";

/** Espelha `_NIVEL` de etl/civico_etl/admin/classes.py: places.kind -> nível. Outro kind (ex.: `regiao`) = sem território. */
export const NIVEL_POR_KIND: Readonly<Record<string, Nivel>> = { municipio: "municipio", uf: "uf", pais: "pais" };

export type Territorio = { ibge: string; nivel: Nivel };

export const MOTIVOS_SEM_MAPA = [
  "alcance_nacional",
  "territorio_nao_resolvido",
  "vinculo_corrigido_aguardando_validacao",
  "classe_sem_territorio",
] as const;
export type MotivoSemMapa = (typeof MOTIVOS_SEM_MAPA)[number];

export const TEXTO_MOTIVO: Readonly<Record<MotivoSemMapa, string>> = {
  alcance_nacional: "Registro de alcance nacional (Câmara, Senado, TSE e demais fontes sem município): não tem ponto no mapa.",
  territorio_nao_resolvido: "Território ainda não resolvido: o registro não tem município, UF ou país definido.",
  vinculo_corrigido_aguardando_validacao: "Vínculo territorial corrigido, aguardando validação: fica fora do mapa até ser validado.",
  classe_sem_territorio: "Esta classe de registro não tem território: só aparece na lista.",
};

/** Ficha: um registro de uma das quatro classes, pela chave estável. Não carrega contato: contato só aparece na ficha. */
export type Ficha = {
  classe: Classe;
  chave: string;
  rotulo: string;
  territorio: Territorio | null;
  motivoSemTerritorio?: MotivoSemMapa;
  aproximada?: boolean;
  /** slugs/URLs das fontes vinculadas: só para mostrar, nunca entram na contagem */
  fontes: string[];
};

export type Contagem = { total: number; ids: string[] };

export type Conflito = { id: string; ficha: Ficha; territorios: Territorio[] };

export type SemTerritorio = Contagem & { porMotivo: Record<MotivoSemMapa, string[]> };

export type AgregacaoPais = {
  porUf: Map<string, Contagem>;
  semTerritorio: SemTerritorio;
  total: number;
  conflitos: Conflito[];
};

export type AgregacaoUf = {
  porMunicipio: Map<string, Contagem>;
  daUfSemMunicipio: Contagem;
  total: number;
};

export type FiltroRegistros = { nivel: "pais" } | { nivel: "uf"; ibge: string } | { nivel: "municipio"; ibge: string };

export type RegistroLista = {
  id: string;
  ficha: Ficha;
  /** presente quando a ficha não tem ponto no mapa */
  motivo?: MotivoSemMapa;
  textoMotivo?: string;
  /** posição aproximada: registro de UF mostrado na UF, não num município */
  aproximada: boolean;
};
