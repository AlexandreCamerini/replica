// Nome de cada casa legislativa estadual com a preposição certa ("da Bahia", "do Rio de Janeiro").
// O banco guarda "Assembleia Legislativa de Bahia" (gerado no seed); a tela usa este nome.

const UF_PREP: Record<string, string> = {
  AC: "do Acre", AL: "de Alagoas", AM: "do Amazonas", AP: "do Amapá", BA: "da Bahia", CE: "do Ceará", ES: "do Espírito Santo",
  GO: "de Goiás", MA: "do Maranhão", MG: "de Minas Gerais", MS: "de Mato Grosso do Sul", MT: "de Mato Grosso", PA: "do Pará",
  PB: "da Paraíba", PE: "de Pernambuco", PI: "do Piauí", PR: "do Paraná", RJ: "do Rio de Janeiro", RN: "do Rio Grande do Norte",
  RO: "de Rondônia", RR: "de Roraima", RS: "do Rio Grande do Sul", SC: "de Santa Catarina", SE: "de Sergipe", SP: "de São Paulo",
  TO: "do Tocantins",
};

export function houseName(uf: string): string {
  return uf === "DF" ? "Câmara Legislativa do Distrito Federal" : `Assembleia Legislativa ${UF_PREP[uf] ?? `(${uf})`}`;
}

/** Motivo padrão de "—" para uma casa que o site ainda não lê. */
export function notReadReason(uf: string): string {
  return `a ${houseName(uf)} ainda não é lida pelo site`;
}
