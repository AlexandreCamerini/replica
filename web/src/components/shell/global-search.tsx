"use client";

import { clsx } from "clsx";
import { Briefcase, Loader2, MapPin, Search, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Collection, ComboBox, Header, Input, Label, ListBox, ListBoxItem, ListBoxSection, Popover } from "react-aria-components";
import { OpenWhenReady } from "@/components/ui/search-combobox";

export type OfficeOption = { slug: string; name: string };
type Opt = { id: string; label: string; hint: string; href: string; kind: "pessoa" | "cidade" | "estado" | "cargo" };
type Group = { id: string; title: string; items: Opt[] };
type Status = "idle" | "loading" | "ready" | "error";

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const ICON = { pessoa: User, cidade: MapPin, estado: MapPin, cargo: Briefcase } as const;

/**
 * Busca global (S03): um campo para político, cidade, estado ou cargo, com resultados em grupos.
 * Sem JavaScript é um formulário GET para /quem?nome=. Com JavaScript, escolher leva direto ao destino;
 * Enter sem escolher uma opção cai na mesma busca por nome.
 */
export function GlobalSearch({ offices }: { offices: OfficeOption[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      setStatus("idle");
      return;
    }
    const ctl = new AbortController();
    setStatus("loading");
    const id = setTimeout(async () => {
      try {
        const [pp, pl] = await Promise.all([
          fetch(`/api/people/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }),
          fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: ctl.signal }),
        ]);
        // 400 = termo fora do limite da API: grupo vazio, não erro
        const people: { slug: string; name: string; office: string; place: string; party: string }[] = pp.ok ? await pp.json() : pp.status === 400 ? [] : Promise.reject(new Error("people"));
        const places: { ibge: string; name: string; uf: string; kind: "municipio" | "uf" }[] = pl.ok ? await pl.json() : pl.status === 400 ? [] : Promise.reject(new Error("places"));
        const f = fold(q);
        const next: Group[] = [
          { id: "pessoas", title: "Políticos", items: people.map((p) => ({ id: `p:${p.slug}`, label: p.name, hint: `${p.office} · ${p.place} · ${p.party}`, href: `/p/${p.slug}`, kind: "pessoa" as const })) },
          {
            id: "cidades",
            title: "Cidades",
            items: places.filter((p) => p.kind === "municipio").map((p) => ({ id: `c:${p.ibge}`, label: p.name, hint: p.uf, href: `/representantes?cidade=${p.ibge}`, kind: "cidade" as const })),
          },
          {
            id: "estados",
            title: "Estados",
            items: places.filter((p) => p.kind === "uf").map((p) => ({ id: `u:${p.uf}`, label: p.name, hint: "estado inteiro", href: `/representantes?uf=${p.uf}`, kind: "estado" as const })),
          },
          {
            id: "cargos",
            title: "Cargos",
            items: offices.filter((o) => fold(o.name).includes(f)).map((o) => ({ id: `o:${o.slug}`, label: o.name, hint: "todas as pessoas no cargo", href: `/quem?cargo=${o.slug}`, kind: "cargo" as const })),
          },
        ].filter((g) => g.items.length > 0);
        if (!ctl.signal.aborted) {
          setGroups(next);
          setStatus("ready");
        }
      } catch (e) {
        if (!ctl.signal.aborted && (e as Error).name !== "AbortError") setStatus("error");
      }
    }, 180);
    return () => {
      ctl.abort();
      clearTimeout(id);
    };
  }, [query, offices]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const go = (href: string) => {
    setQuery("");
    setGroups([]);
    router.push(href);
  };

  return (
    <form ref={formRef} action="/quem" method="get" role="search" className="w-full">
      <ComboBox
        items={groups}
        inputValue={query}
        onInputChange={setQuery}
        onSelectionChange={(key) => {
          if (key == null) return;
          const hit = groups.flatMap((g) => g.items).find((o) => o.id === key);
          if (hit) go(hit.href);
        }}
        allowsCustomValue
        allowsEmptyCollection
        menuTrigger="input"
        aria-label="Buscar político, cidade, estado ou cargo"
        className="group relative flex w-full flex-col"
      >
        <Label className="sr-only">Buscar político, cidade, estado ou cargo</Label>
        <OpenWhenReady ready={status === "ready" || status === "error"} />
        <div className="relative">
          <button
            type="submit"
            aria-label="Procurar no site"
            className="absolute top-1/2 left-1 grid size-9 -translate-y-1/2 place-items-center rounded-pill text-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Search aria-hidden className="size-4" />
          </button>
          <Input
            name="nome"
            maxLength={80}
            autoComplete="off"
            onKeyDown={(e) => {
              // Enter sem opção destacada = busca por nome (o ComboBox engole o submit nativo com a lista aberta)
              const q = e.currentTarget.value.trim();
              if (e.key === "Enter" && q && !e.currentTarget.getAttribute("aria-activedescendant")) {
                e.preventDefault();
                go(`/quem?nome=${encodeURIComponent(q)}`);
              }
            }}
            placeholder="Político, cidade, estado ou cargo"
            className={clsx(
              "h-11 w-full rounded-pill border-[1.5px] border-border-input bg-surface pr-10 pl-10 text-base text-fg placeholder:text-muted md:h-10 md:text-sm",
              "outline-none data-[focused]:border-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus",
            )}
          />
          {status === "loading" && <Loader2 aria-label="Buscando" className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" />}
        </div>
        <span aria-live="polite" className="sr-only">
          {status === "ready" ? (total ? `${total} resultado${total === 1 ? "" : "s"}` : "Nenhum resultado") : ""}
        </span>
        <Popover offset={6} className="z-50 w-(--trigger-width) min-w-72 overflow-auto rounded-md border border-border bg-surface p-1 shadow-pop">
          <ListBox
            aria-label="Resultados"
            className="max-h-[min(24rem,60vh)] outline-none"
            renderEmptyState={() => (
              <p className="px-3 py-3 text-sm text-muted">
                {status === "error"
                  ? "Não deu para buscar agora. Aperte Enter para procurar pelo nome."
                  : "Nada com esse nome. Aperte Enter para procurar pessoas pelo nome, ou tente só o começo."}
              </p>
            )}
          >
            {(g: Group) => (
              <ListBoxSection id={g.id} className="py-1">
                <Header className="px-3 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</Header>
                <Collection items={g.items}>
                  {(o: Opt) => {
                    const Icon = ICON[o.kind];
                    return (
                      <ListBoxItem
                        id={o.id}
                        textValue={`${o.label} ${o.hint}`}
                        className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-sm text-fg outline-none data-[hovered]:bg-surface-sunken data-[focused]:bg-accent-soft data-[focused]:shadow-[inset_3px_0_0_var(--focus)]"
                      >
                        <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{o.label}</span>
                          <span className="block truncate text-xs text-muted">{o.hint}</span>
                        </span>
                      </ListBoxItem>
                    );
                  }}
                </Collection>
              </ListBoxSection>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
    </form>
  );
}
