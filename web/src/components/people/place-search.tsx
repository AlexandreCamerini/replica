"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { PlaceCombobox, type PlaceOption } from "@/components/ui/search-combobox";

/** Busca de lugar ligada à API. Escolher leva direto à lista de representantes (1 dos 3 cliques do F01). */
export function PlaceSearch({ label }: { label?: string }) {
  const router = useRouter();
  const search = useCallback(async (q: string) => {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(String(r.status));
    const rows: { ibge: string; name: string; uf: string; kind: "municipio" | "uf" }[] = await r.json();
    return rows.map<PlaceOption>((p) => ({ id: p.ibge, name: p.name, uf: p.uf, kind: p.kind }));
  }, []);
  return (
    <PlaceCombobox
      label={label}
      search={search}
      onPick={(p) => router.push(p.kind === "uf" ? `/representantes?uf=${p.uf}` : `/representantes?cidade=${p.id}`)}
    />
  );
}
