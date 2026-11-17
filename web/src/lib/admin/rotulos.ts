// Rótulos da central em linguagem de operador (funções puras, sem React, sem Next, sem rede). Importável pelos testes (node --test): imports com extensão `.ts`.
// A tabela de UFs confere com as malhas de web/public/geo/br.json (o teste admin-rotulos.test.ts lê o arquivo). O nome de município vem da malha da UF (`nomeDeMunicipioNaMalha`).

export type UfInfo = { ibge: string; sigla: string; nome: string };

export const UFS: readonly UfInfo[] = [
  { ibge: "11", sigla: "RO", nome: "Rondônia" },
  { ibge: "12", sigla: "AC", nome: "Acre" },
  { ibge: "13", sigla: "AM", nome: "Amazonas" },
  { ibge: "14", sigla: "RR", nome: "Roraima" },
  { ibge: "15", sigla: "PA", nome: "Pará" },
  { ibge: "16", sigla: "AP", nome: "Amapá" },
  { ibge: "17", sigla: "TO", nome: "Tocantins" },
  { ibge: "21", sigla: "MA", nome: "Maranhão" },
  { ibge: "22", sigla: "PI", nome: "Piauí" },
  { ibge: "23", sigla: "CE", nome: "Ceará" },
  { ibge: "24", sigla: "RN", nome: "Rio Grande do Norte" },
  { ibge: "25", sigla: "PB", nome: "Paraíba" },
  { ibge: "26", sigla: "PE", nome: "Pernambuco" },
  { ibge: "27", sigla: "AL", nome: "Alagoas" },
  { ibge: "28", sigla: "SE", nome: "Sergipe" },
  { ibge: "29", sigla: "BA", nome: "Bahia" },
  { ibge: "31", sigla: "MG", nome: "Minas Gerais" },
  { ibge: "32", sigla: "ES", nome: "Espírito Santo" },
  { ibge: "33", sigla: "RJ", nome: "Rio de Janeiro" },
  { ibge: "35", sigla: "SP", nome: "São Paulo" },
  { ibge: "41", sigla: "PR", nome: "Paraná" },
  { ibge: "42", sigla: "SC", nome: "Santa Catarina" },
  { ibge: "43", sigla: "RS", nome: "Rio Grande do Sul" },
  { ibge: "50", sigla: "MS", nome: "Mato Grosso do Sul" },
  { ibge: "51", sigla: "MT", nome: "Mato Grosso" },
  { ibge: "52", sigla: "GO", nome: "Goiás" },
  { ibge: "53", sigla: "DF", nome: "Distrito Federal" },
];

const POR_IBGE = new Map(UFS.map((u) => [u.ibge, u]));
const POR_SIGLA = new Map(UFS.map((u) => [u.sigla, u]));

/** UF pelo código IBGE de 2 dígitos ou pela sigla; `null` se não existe. */
export function ufDe(codigo: string | null | undefined): UfInfo | null {
  if (typeof codigo !== "string") return null;
  const c = codigo.trim();
  return POR_IBGE.get(c) ?? POR_SIGLA.get(c.toUpperCase()) ?? null;
}

/** "São Paulo" para "35" ou "SP". Código desconhecido: `UF <código>` (nunca "Estado 35"). */
export function nomeDaUf(codigo: string | null | undefined): string {
  const u = ufDe(codigo);
  return u ? u.nome : codigo ? `UF ${codigo}` : "UF desconhecida";
}

/** "São Paulo (SP)". */
export function nomeComSigla(codigo: string | null | undefined): string {
  const u = ufDe(codigo);
  return u ? `${u.nome} (${u.sigla})` : nomeDaUf(codigo);
}

/** Nome do município a partir dos itens da malha da UF (`/geo/uf/NN.json`). Sem malha ou sem o item: `município <código>` (o código IBGE fica visível, não some). */
export function nomeDeMunicipioNaMalha(ibge: string, itens: readonly { ibge: string; name: string }[] | null | undefined): string {
  const achado = itens?.find((i) => i.ibge === ibge);
  return achado ? achado.name : `município ${ibge}`;
}

export type TerritorioRef = { nivel: "municipio" | "uf" | "pais"; ibge: string };

/** Nome do território para a tela. `nomeMunicipio` (se a malha foi lida) tem prioridade sobre o código. */
export function nomeDoTerritorio(t: TerritorioRef | null | undefined, nomeMunicipio?: string | null): string {
  if (!t) return "sem território";
  if (t.nivel === "pais") return "Brasil";
  if (t.nivel === "uf") return nomeDaUf(t.ibge);
  const uf = ufDe(t.ibge.slice(0, 2));
  const nome = nomeMunicipio && nomeMunicipio.trim() !== "" ? nomeMunicipio : `município ${t.ibge}`;
  return uf ? `${nome} (${uf.sigla})` : nome;
}

export const NOME_CLASSE: Readonly<Record<string, string>> = {
  vinculo_sapl: "Vínculo SAPL",
  cobertura: "Cobertura",
  contato_mandato: "Contato do mandato",
  identidade: "Identidade",
};
export const nomeDaClasse = (c: string): string => NOME_CLASSE[c] ?? semSublinhado(c);

const semSublinhado = (s: string): string => {
  const t = s.replaceAll("_", " ").trim();
  return t === "" ? s : t.charAt(0).toUpperCase() + t.slice(1);
};

/** Status de pedido (adm_pedidos e adm_pedidos_decisao). */
export const STATUS_PEDIDO: Readonly<Record<string, string>> = {
  na_fila: "na fila",
  em_execucao: "em execução",
  concluido: "concluído",
  falhou: "falhou",
  interrompido: "interrompido",
};
export const statusDoPedido = (s: string): string => STATUS_PEDIDO[s] ?? s.replaceAll("_", " ");

/** Status de rodada (adm_rodadas). */
export const STATUS_RODADA: Readonly<Record<string, string>> = {
  aberta: "aberta, ainda não iniciada",
  em_andamento: "em andamento",
  concluida: "concluída",
  interrompida: "interrompida",
  falhou: "com falha",
};
export const statusDaRodada = (s: string): string => STATUS_RODADA[s] ?? s.replaceAll("_", " ");

export const TIPO_PEDIDO: Readonly<Record<string, string>> = { rodada: "Rodada", recoleta: "Recoleta", parecer: "Parecer", aprovar: "Decisão: aprovar", corrigir: "Decisão: corrigir", descartar: "Decisão: descartar", pedir_confirmacao: "Decisão: pedir confirmação" };
export const tipoDoPedido = (t: string): string => TIPO_PEDIDO[t] ?? semSublinhado(t);

export const MODO_RODADA: Readonly<Record<string, string>> = { descobrir: "Descobrir fontes", recoletar: "Recoletar fontes conhecidas", reprocessar: "Reprocessar sem rede" };
export const modoDaRodada = (m: string): string => MODO_RODADA[m] ?? m;

export const TIPO_PENDENCIA: Readonly<Record<string, string>> = { mudanca: "Mudança", divergencia: "Divergência", duplicata: "Duplicata", confirmacao: "Confirmação" };
export const tipoDaPendencia = (t: string): string => TIPO_PENDENCIA[t] ?? semSublinhado(t);

export const MOTIVO_REABERTURA: Readonly<Record<string, string>> = { evidencia_mudou: "a evidência mudou", registro_mudou: "o registro mudou" };
export const motivoDaReabertura = (m: string | null | undefined): string => (m ? (MOTIVO_REABERTURA[m] ?? m.replaceAll("_", " ")) : "motivo não registrado");

export const ACAO_DECISAO: Readonly<Record<string, string>> = { aprovar: "Aprovar", corrigir: "Corrigir", descartar: "Descartar", pedir_confirmacao: "Pedir confirmação" };
export const acaoDaDecisao = (a: string): string => ACAO_DECISAO[a] ?? semSublinhado(a);

/** Nome do tipo de quem decidiu (adm_decisoes.decidido_por_tipo). */
export const quemDecidiu = (t: string): string => (t === "pessoa" ? "pessoa" : t === "agentes" ? "agentes" : t);

/** UUID abreviado para a tela (8 primeiros caracteres); texto que não é UUID volta como está (cortado em 12). O id inteiro só aparece em detalhe. */
export function abreviarId(id: string | null | undefined): string {
  if (typeof id !== "string" || id === "") return "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.slice(0, 8) : id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** Recorte de rodada (o jsonb `recorte`) em frases: UFs pelo nome, anos, casas e municípios. Recorte vazio: "sem recorte (tudo o que o coletor cobre)". */
export function descreverRecorte(recorte: unknown): string {
  if (recorte === null || typeof recorte !== "object" || Array.isArray(recorte)) return "sem recorte (tudo o que o coletor cobre)";
  const r = recorte as Record<string, unknown>;
  const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const partes: string[] = [];
  const ufs = lista(r.ufs);
  if (ufs.length) partes.push(`${ufs.length === 1 ? "estado" : "estados"}: ${ufs.map(nomeDaUf).join(", ")}`);
  const anos = lista(r.anos);
  if (anos.length) partes.push(`${anos.length === 1 ? "ano" : "anos"}: ${anos.join(", ")}`);
  const casas = lista(r.casas);
  if (casas.length) partes.push(`${casas.length === 1 ? "casa" : "casas"}: ${casas.join(", ")}`);
  const ibges = lista(r.ibges);
  if (ibges.length) partes.push(`${ibges.length} ${ibges.length === 1 ? "município" : "municípios"} por código IBGE: ${ibges.join(", ")}`);
  const extras = r.extras && typeof r.extras === "object" && !Array.isArray(r.extras) ? (r.extras as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(extras)) partes.push(`${k}: ${String(v)}`);
  return partes.length ? partes.join("; ") : "sem recorte (tudo o que o coletor cobre)";
}
