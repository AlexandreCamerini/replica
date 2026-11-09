import type { MissingDataset } from "@/lib/data";
import { AskSource, type BLOCOS } from "./ask-source";

const BLOCO_OF: Partial<Record<MissingDataset["dataset"], keyof typeof BLOCOS>> = {
  salario: "salario",
  presenca: "presenca",
  votos: "votos",
  propostas: "propostas",
  gastos_gabinete: "gastos",
};

/**
 * Lista do que o crachá não tem, com o motivo de cada um (no lugar do MissingDataNote genérico).
 * U02: onde a fonte não foi achada (não conferida ou só no portal), convida a mandar o endereço, com a cidade já na URL.
 */
export function ProfileGaps({ items, askHref }: { items: MissingDataset[]; askHref?: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="lacunas-h" className="border border-border bg-surface-sunken p-4 text-sm text-fg" data-testid="lacunas">
      <h2 id="lacunas-h" className="mb-2 text-base font-semibold">
        {items.length} {items.length === 1 ? "dado ainda não está" : "dados ainda não estão"} aqui
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => {
          const bloco = BLOCO_OF[i.dataset];
          const ask = askHref && bloco && (i.status === "desconhecido" || i.status === "so_portal");
          return (
            <li key={`${i.dataset}-${i.label}`}>
              <span className="font-semibold">{i.label}:</span> {i.reason}
              {ask && <AskSource href={askHref} bloco={bloco} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
