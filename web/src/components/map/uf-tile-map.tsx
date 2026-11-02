import Link from "next/link";
import { REGIONS, UF_ROWS } from "@/lib/data/reference";

const FILL: Record<string, string> = {
  "1": "bg-[var(--region-norte)]",
  "2": "bg-[var(--region-nordeste)]",
  "3": "bg-[var(--region-sudeste)]",
  "4": "bg-[var(--region-sul)]",
  "5": "bg-[var(--region-centro-oeste)]",
};

/**
 * Mapa em grade: um quadrado por UF na posição aproximada. Cor = região (categórica), nunca partido ou dado.
 * O contorno real (malha IBGE, CC BY 4.0) entra no R1+ como BrazilMap; a grade fica como alternativa leve e acessível.
 */
export function UfTileMap() {
  return (
    <figure className="flex flex-col gap-4">
      <ul className="grid w-full max-w-md grid-cols-7 gap-1.5" aria-label="Estados no mapa">
        {UF_ROWS.map(([, uf, name, region, , row, col]) => (
          <li key={uf} style={{ gridRow: row + 1, gridColumn: col + 1 }}>
            <Link
              href={`/representantes?uf=${uf}`}
              aria-label={`${uf}: ${name}`}
              title={name}
              className={`grid aspect-square place-items-center rounded-sm text-xs font-bold text-fg outline-none transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:text-sm ${FILL[region]}`}
            >
              {uf}
            </Link>
          </li>
        ))}
      </ul>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg">
          {REGIONS.map((r) => (
            <li key={r.ibge} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-3 rounded-xs ${FILL[r.ibge]}`} />
              {r.name}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
