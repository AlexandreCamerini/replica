"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Tab,
  TabList,
  TabPanel,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "react-aria-components";

const chip = clsx(
  "inline-flex h-8 shrink-0 cursor-pointer items-center rounded-pill border-[1.5px] border-border bg-surface px-3 text-sm font-semibold text-fg",
  "transition-colors outline-none data-[hovered]:border-border-input",
  "data-[selected]:border-surface-inverse data-[selected]:bg-surface-inverse data-[selected]:text-on-inverse",
  "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus",
  "data-[disabled]:opacity-50",
);

/** Linha rolável com ‹ › que só aparecem quando há overflow. */
function Scroller({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: "smooth" });
  const arrow =
    "absolute top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-pill border border-border bg-surface text-fg shadow-card";

  return (
    <div className="relative">
      {edges.start && (
        <button type="button" aria-label={`Rolar ${label} para a esquerda`} className={clsx(arrow, "left-0")} onClick={() => nudge(-1)}>
          <ChevronLeft aria-hidden className="size-4" />
        </button>
      )}
      <div
        ref={ref}
        className="flex gap-2 overflow-x-auto px-1 py-1.5 [scrollbar-width:none]"
        // fade nas bordas com overflow, para a seta não cobrir o texto do chip
        style={{
          maskImage: `linear-gradient(to right, ${edges.start ? "transparent 0, #000 48px" : "#000 0"}, ${edges.end ? "#000 calc(100% - 48px), transparent 100%" : "#000 100%"})`,
        }}
      >
        {children}
      </div>
      {edges.end && (
        <button type="button" aria-label={`Rolar ${label} para a direita`} className={clsx(arrow, "right-0")} onClick={() => nudge(1)}>
          <ChevronRight aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Seleção única. Com `renderPanel` é tablist de verdade (cada aba controla um painel).
 * Sem painel, vira grupo de seleção (ToggleButtonGroup): aba sem painel deixa aria-controls quebrado.
 */
export function SegmentedTabs({
  label,
  items,
  selectedKey,
  defaultSelectedKey,
  onSelectionChange,
  renderPanel,
}: {
  label: string;
  items: { id: string; label: string }[];
  selectedKey?: Key;
  defaultSelectedKey?: Key;
  onSelectionChange?: (key: Key) => void;
  renderPanel?: (id: string) => React.ReactNode;
}) {
  if (!renderPanel) {
    return (
      <Scroller label={label}>
        <ToggleButtonGroup
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selectedKey !== undefined ? [selectedKey] : undefined}
          defaultSelectedKeys={defaultSelectedKey !== undefined ? [defaultSelectedKey] : undefined}
          onSelectionChange={(keys) => {
            const k = [...keys][0];
            if (k !== undefined) onSelectionChange?.(k);
          }}
          className="flex gap-2"
        >
          {items.map((i) => (
            <ToggleButton key={i.id} id={i.id} className={chip}>
              {i.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Scroller>
    );
  }
  return (
    <Tabs selectedKey={selectedKey} defaultSelectedKey={defaultSelectedKey} onSelectionChange={onSelectionChange}>
      <Scroller label={label}>
        <TabList aria-label={label} className="flex gap-2">
          {items.map((i) => (
            <Tab key={i.id} id={i.id} className={chip}>
              {i.label}
            </Tab>
          ))}
        </TabList>
      </Scroller>
      {items.map((i) => (
        <TabPanel key={i.id} id={i.id} className="pt-3 outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus">
          {renderPanel(i.id)}
        </TabPanel>
      ))}
    </Tabs>
  );
}

/** Filtros que não trocam a página, só a lista. */
export function FilterChips({
  label,
  items,
  selectionMode = "single",
  defaultSelectedKeys,
}: {
  label: string;
  items: { id: string; label: string }[];
  selectionMode?: "single" | "multiple";
  defaultSelectedKeys?: Iterable<Key>;
}) {
  return (
    <Scroller label={label}>
      <ToggleButtonGroup
        aria-label={label}
        selectionMode={selectionMode}
        defaultSelectedKeys={defaultSelectedKeys}
        className="flex gap-2"
      >
        {items.map((i) => (
          <ToggleButton key={i.id} id={i.id} className={chip}>
            {i.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Scroller>
  );
}
