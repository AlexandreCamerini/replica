"use client";

import { clsx } from "clsx";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import {
  Button as AriaButton,
  ComboBox,
  ComboBoxStateContext,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Text,
} from "react-aria-components";

export type PlaceOption = { id: string; name: string; uf: string; kind: "municipio" | "uf" };

type Status = "idle" | "loading" | "ready" | "error";

/**
 * Abre a lista quando a busca assíncrona responde. O ComboBox abre no input, mas quando os itens chegam depois
 * (fetch), o estado interno pode já ter fechado; sem isto a lista só aparece de forma intermitente.
 */
export function OpenWhenReady({ ready }: { ready: boolean }) {
  const state = useContext(ComboBoxStateContext);
  const focused = state?.isFocused;
  const size = state?.collection.size;
  useEffect(() => {
    // trigger "input", não "manual": em toque, "manual" tira o foco do campo e o ComboBox apaga o texto digitado
    if (state && ready && focused && !state.isOpen) state.open(null, "input");
  }, [state, ready, focused, size]);
  return null;
}

/**
 * Autocomplete de lugar. `search` é injetado (na app real chama /api/places); aqui na vitrine é um mock.
 * Regras: mínimo 2 caracteres, debounce 150ms, mantém a lista anterior enquanto carrega, homônimo sempre com UF.
 */
export function PlaceCombobox({
  label = "Sua cidade ou estado",
  search,
  onPick,
}: {
  label?: string;
  search: (q: string) => Promise<PlaceOption[]>;
  onPick?: (p: PlaceOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PlaceOption[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setStatus("idle");
      return;
    }
    let live = true;
    setStatus("loading");
    const id = setTimeout(() => {
      search(q)
        .then((r) => live && (setItems(r), setStatus("ready")))
        .catch(() => live && setStatus("error"));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, search]);

  return (
    <ComboBox
      items={items}
      inputValue={query}
      onInputChange={setQuery}
      onSelectionChange={(key) => {
        const p = items.find((i) => i.id === key);
        if (p) onPick?.(p);
      }}
      menuTrigger="input"
      allowsEmptyCollection
      className="group flex w-full flex-col gap-1.5"
    >
      <Label className="text-sm font-semibold text-fg">{label}</Label>
      <OpenWhenReady ready={status === "ready" || status === "error"} />
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
        <Input
          placeholder="Digite o nome da cidade ou do estado"
          className={clsx(
            "h-12 w-full rounded-pill border-[1.5px] border-border-input bg-surface pr-12 pl-11 text-base text-fg placeholder:text-muted",
            "outline-none data-[focused]:border-focus data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus",
          )}
        />
        <span className="absolute top-1/2 right-3 -translate-y-1/2">
          {status === "loading" ? (
            <Loader2 aria-label="Buscando" className="size-5 animate-spin text-muted" />
          ) : query ? (
            <AriaButton
              aria-label="Limpar busca"
              onPress={() => setQuery("")}
              className="grid size-8 place-items-center rounded-pill text-muted outline-none data-[hovered]:bg-surface-sunken data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus"
            >
              <X aria-hidden className="size-4" />
            </AriaButton>
          ) : null}
        </span>
      </div>
      <Text slot="description" className="text-xs text-muted">
        Ex.: Campinas, Salvador, Minas Gerais
      </Text>
      <span aria-live="polite" className="sr-only">
        {status === "ready" ? `${items.length} resultado${items.length === 1 ? "" : "s"}` : ""}
      </span>
      {/*
        BUG-009: em toque, o Popover do React Aria só "revela" a lista depois que o teclado virtual termina de abrir
        (Popover.mjs: runAfterKeyboard -> useEnterAnimation), até ~0,6 s. Nesse intervalo ele aplica no próprio elemento
        opacity:0, clip, clip-path e mask-image, e o toque cai no conteúdo atrás. A posição já foi calculada
        (data-placement presente) e o campo já está focado, então anulamos só esse ocultamento, com !important
        (o estilo do React Aria é inline). Sem data-placement (posição ainda não calculada) a lista segue oculta.
      */}
      <Popover
        offset={6}
        className={clsx(
          "z-50 w-(--trigger-width) overflow-auto rounded-md border border-border bg-surface p-1 shadow-pop",
          "data-[placement]:opacity-100! data-[placement]:[clip:auto]! data-[placement]:[clip-path:none]! data-[placement]:[mask-image:none]!",
        )}
      >
        <ListBox
          className="max-h-80 outline-none"
          renderEmptyState={() => (
            <p className="px-3 py-3 text-sm text-muted">
              {status === "error"
                ? "Não deu para buscar agora. Tente de novo em instantes."
                : "Nenhum lugar com esse nome. Tente sem acento ou só o começo."}
            </p>
          )}
        >
          {(p: PlaceOption) => (
            <ListBoxItem
              id={p.id}
              textValue={`${p.name} ${p.uf}`}
              className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-sm text-fg outline-none data-[hovered]:bg-surface-sunken data-[focused]:bg-accent-soft data-[focused]:shadow-[inset_3px_0_0_var(--focus)]"
            >
              <MapPin aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="flex-1 font-semibold">{p.name}</span>
              <span className="text-xs text-muted">{p.kind === "uf" ? "estado inteiro" : `cidade · ${p.uf}`}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
