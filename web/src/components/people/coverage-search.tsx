"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { PlaceCombobox, type PlaceOption } from "@/components/ui/search-combobox";

/** Busca de cidade da S23: escolher leva ao quadro da cidade na mesma página (estado na URL). */
export function CoverageSearch() {
  const router = useRouter();
  const search = useCallback(async (q: string) => {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(String(r.status));
    const rows: { ibge: string; name: string; uf: string; kind: "municipio" | "uf" }[] = await r.json();
    return rows.filter((p) => p.kind === "municipio").map<PlaceOption>((p) => ({ id: p.ibge, name: p.name, uf: p.uf, kind: p.kind }));
  }, []);
  return <PlaceCombobox label="Ver uma cidade" search={search} onPick={(p) => router.push(`/dados-abertos?cidade=${p.id}#cidade`)} />;
}
