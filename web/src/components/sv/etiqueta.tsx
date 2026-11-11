import { data } from "@/lib/data";

/** "Exemplo ilustrativo": só existe na versão de demonstração (data.isDemo). Com dado real, não renderiza nada. */
export function ExemploIlustrativo({ children = "Exemplo ilustrativo" }: { children?: string }) {
  if (!data.isDemo) return null;
  return <span className="sv-etq">{children}</span>;
}
