"use client";

import { Loader2, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ComboBox, Input, Label, ListBox, ListBoxItem, Popover, Text } from "react-aria-components";
import { OpenWhenReady } from "@/components/ui/search-combobox";

type Row = { slug: string; name: string; office: string; place: string; party: string };

/** Adiciona uma pessoa à comparação. A URL é a fonte da verdade (?p=a,b,c). */
export function PersonPicker({ current, max }: { current: string[]; max: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const full = current.length >= max;

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setRows([]);
      setStatus("idle");
      return;
    }
    let live = true;
    setStatus("loading");
    const id = setTimeout(() => {
      fetch(`/api/people/search?q=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: Row[]) => live && (setRows(d.filter((x) => !current.includes(x.slug))), setStatus("ready")))
        .catch(() => live && setStatus("error"));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q, current]);

  return (
    <ComboBox
      items={rows}
      inputValue={q}
      onInputChange={setQ}
      isDisabled={full}
      menuTrigger="input"
      allowsEmptyCollection
      onSelectionChange={(k) => {
        if (typeof k !== "string" || current.includes(k)) return;
        setQ("");
        router.push(`/comparar?p=${[...current, k].join(",")}`);
      }}
      className="flex w-full max-w-xl flex-col gap-1.5"
    >
      <Label className="text-sm font-semibold text-fg">Adicionar pessoa</Label>
      <OpenWhenReady ready={status === "ready" || status === "error"} />
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
        <Input
          placeholder={full ? `Máximo de ${max} pessoas` : "Digite um nome"}
          className="h-12 w-full rounded-pill border-[1.5px] border-border-input bg-surface pr-12 pl-11 text-base text-fg outline-none placeholder:text-muted data-[disabled]:opacity-50 data-[focused]:border-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus"
        />
        {status === "loading" && <Loader2 aria-label="Buscando" className="absolute top-1/2 right-4 size-5 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      <Text slot="description" className="text-xs text-muted">
        {full ? "Tire alguém para adicionar outra pessoa." : `De 2 a ${max} pessoas. Cargos diferentes também valem: o que não se aplica aparece como “—”.`}
      </Text>
      <Popover offset={6} className="z-50 w-(--trigger-width) overflow-auto rounded-md border border-border bg-surface p-1 shadow-pop">
        <ListBox
          className="max-h-80 outline-none"
          renderEmptyState={() => (
            <p className="px-3 py-3 text-sm text-muted">{status === "error" ? "Não deu para buscar agora. Tente de novo." : "Ninguém no cargo com esse nome."}</p>
          )}
        >
          {(r: Row) => (
            <ListBoxItem
              id={r.slug}
              textValue={r.name}
              className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-sm text-fg outline-none data-[hovered]:bg-surface-sunken data-[focused]:bg-accent-soft data-[focused]:shadow-[inset_3px_0_0_var(--focus)]"
            >
              <UserRound aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {r.office} · {r.place} · {r.party}
                </span>
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
