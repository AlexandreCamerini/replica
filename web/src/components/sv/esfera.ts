// Esfera em palavra a partir do cargo. Puro: sem JSX, sem dado. Esfera nunca vira cor nem estilo próprio.
import type { OfficeSlug } from "../../lib/data/types.ts";

const ESFERA: Record<OfficeSlug, "Federal" | "Estadual" | "Municipal"> = {
  presidente: "Federal",
  vice_presidente: "Federal",
  senador: "Federal",
  deputado_federal: "Federal",
  governador: "Estadual",
  vice_governador: "Estadual",
  deputado_estadual: "Estadual",
  deputado_distrital: "Estadual",
  prefeito: "Municipal",
  vice_prefeito: "Municipal",
  vereador: "Municipal",
};

/** "Federal", "Estadual" ou "Municipal"; null para um cargo que o contrato não conhece. */
export function esferaDoCargo(office: string): "Federal" | "Estadual" | "Municipal" | null {
  return (ESFERA as Record<string, "Federal" | "Estadual" | "Municipal">)[office] ?? null;
}
