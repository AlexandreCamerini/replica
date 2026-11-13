// Textos fixos por cargo, usados pela Pessoa e pelas rotas dela. Sem JSX, sem dado.
import type { OfficeSlug } from "@/lib/data";

/** Esfera em palavra, sem estilo próprio: "Esfera: Federal · Câmara dos Deputados". */
export const ESFERA: Record<OfficeSlug, string> = {
  presidente: "Federal · Presidência da República",
  vice_presidente: "Federal · Presidência da República",
  senador: "Federal · Senado Federal",
  deputado_federal: "Federal · Câmara dos Deputados",
  governador: "Estadual · Governo do estado",
  vice_governador: "Estadual · Governo do estado",
  deputado_estadual: "Estadual · Assembleia Legislativa",
  deputado_distrital: "Distrital · Câmara Legislativa",
  prefeito: "Municipal · Prefeitura",
  vice_prefeito: "Municipal · Prefeitura",
  vereador: "Municipal · Câmara Municipal",
};
