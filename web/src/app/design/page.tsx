"use client";

import { useCallback, useState } from "react";
import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChips, SegmentedTabs } from "@/components/ui/chips";
import {
  BarBreakdown,
  BigNumber,
  MissingDataNote,
  PersonCard,
  SourceFooter,
  StatTile,
  TopicTag,
  VoteBadge,
} from "@/components/ui/data";
import { Hemicycle, type Seat } from "@/components/ui/hemicycle";
import { EmailField, ListenButton, OnboardingDialog, ThemeToggle } from "@/components/ui/misc";
import { PlaceCombobox, type PlaceOption } from "@/components/ui/search-combobox";

// Vitrine do design system. Dados fictícios: nenhum nome, partido ou valor real.
const PLACES: PlaceOption[] = [
  { id: "1", name: "Vila Aurora", uf: "SP", kind: "municipio" },
  { id: "2", name: "Vila Aurora", uf: "MG", kind: "municipio" },
  { id: "3", name: "Vila Aurora do Norte", uf: "PA", kind: "municipio" },
  { id: "4", name: "Estado Exemplo", uf: "EX", kind: "uf" },
];
const PARTIES = ["Partido A", "Partido B", "Partido C", "Partido D", "Partido E"];
const SEATS: Seat[] = Array.from({ length: 81 }, (_, i) => ({
  id: String(i),
  name: `Pessoa ${i + 1}`,
  party: PARTIES[(i * 7) % PARTIES.length],
  uf: "EX",
}));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5 shadow-card">
      <h2 className="text-lg text-fg">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  const [compare, setCompare] = useState<string[]>(["a"]);
  const toggle = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const search = useCallback(
    (q: string) =>
      new Promise<PlaceOption[]>((r) =>
        setTimeout(() => r(PLACES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))), 250),
      ),
    [],
  );

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted">design system · v0 · valores provisórios</p>
          <h1 className="font-display text-display text-fg">Primitivas</h1>
        </div>
        <div className="flex items-center gap-2">
          <ListenButton />
          <ThemeToggle />
        </div>
      </header>

      <Section title="Cores (papéis)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {["bg", "surface", "surface-sunken", "surface-inverse", "border", "border-input", "text", "text-muted", "accent", "accent-soft", "danger", "success", "warning", "seat", "seat-active", "region-norte", "region-nordeste", "region-centro-oeste", "region-sudeste", "region-sul"].map((c) => (
            <div key={c} className="flex items-center gap-2 text-xs text-fg">
              <span className="size-8 shrink-0 rounded-sm border border-border" style={{ background: `var(--${c})` }} />
              <span className="font-mono">{c}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografia">
        <BigNumber value={70800} caption="pessoas no cargo hoje, da câmara da sua cidade a Brasília" />
        <p className="font-display text-display">Nome em destaque</p>
        <p className="text-xl">Título de seção (xl)</p>
        <p className="text-lg">Subtítulo (lg)</p>
        <p className="text-base">Corpo (base): texto corrido com <a className="text-accent-text underline underline-offset-2" href="#">um link</a>.</p>
        <p className="text-sm text-muted">Apoio (sm muted)</p>
        <p className="font-mono text-xs text-muted">Fonte: Órgão oficial · atualizado em 01/11/2026</p>
      </Section>

      <Section title="Botões">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" icon={<Bell aria-hidden className="size-4" />}>Acompanhar</Button>
          <Button variant="secondary" icon={<Share2 aria-hidden className="size-4" />}>Compartilhar</Button>
          <Button variant="ghost">Agora não</Button>
          <Button variant="inverse">Selecionado</Button>
          <Button variant="danger">Apagar minha conta</Button>
          <Button variant="primary" isPending>Enviando</Button>
          <Button variant="secondary" isDisabled>Indisponível</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Pequeno</Button>
          <Button size="md">Médio</Button>
          <Button size="lg">Grande</Button>
        </div>
      </Section>

      <Section title="Chips e abas">
        <SegmentedTabs
          label="Ano"
          items={["Todos", "2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016"].map((y) => ({ id: y, label: y }))}
          defaultSelectedKey="2026"
          renderPanel={(y) => <p className="text-sm text-muted">Painel do ano {y}: aqui entram propostas, votos e gastos daquele período.</p>}
        />
        <FilterChips
          label="Cargo"
          items={["Todos os cargos", "Presidência", "Senado", "Câmara", "Governos", "Assembleias", "Prefeituras", "Câmaras municipais"].map((c) => ({ id: c, label: c }))}
          defaultSelectedKeys={["Todos os cargos"]}
        />
      </Section>

      <Section title="Busca de lugar (combobox)">
        <div className="max-w-xl">
          <PlaceCombobox search={search} />
        </div>
      </Section>

      <Section title="Números do perfil">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile value={4636600} kind="money" label="salário por mês" sub="12 meses: R$ 556 mil" help="Valor bruto informado pela casa legislativa." />
          <StatTile value={2602000} kind="money" ceiling label="teto do salário" sub="o valor pago não é publicado" help="Limite constitucional para o tamanho da cidade." />
          <StatTile value={94} kind="percent" label="presença em votações" sub="878 de 932 sessões" />
          <StatTile value={null} kind="count" label="propostas" sub="a câmara não publica" help="Esta câmara municipal não tem dados abertos de proposições." stale="30/10" />
        </div>
      </Section>

      <Section title="Votos, temas e quebra de valores">
        <div className="flex flex-wrap gap-2">
          {(["sim", "nao", "abstencao", "obstrucao", "art17", "nao_votou", "aprovado", "rejeitado"] as const).map((v) => (
            <VoteBadge key={v} value={v} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <TopicTag href="#">Saúde</TopicTag>
          <TopicTag href="#">Educação</TopicTag>
          <TopicTag>Transporte e trânsito</TopicTag>
        </div>
        <div className="max-w-2xl">
          <BarBreakdown
            caption="Com o que gastou em 2026"
            rows={[
              { label: "Escritório de apoio", cents: 15294700 },
              { label: "Divulgação do mandato", cents: 8120000 },
              { label: "Passagens", cents: 6200000 },
              { label: "Combustível", cents: 2104300 },
            ]}
          />
          <SourceFooter source="Órgão oficial" href="#" updatedAt="2026-11-01" />
          <SourceFooter source="Câmara municipal" href="#" updatedAt="2026-08-12" stale />
        </div>
      </Section>

      <Section title="Pessoas">
        <div className="grid gap-3 md:grid-cols-2">
          <PersonCard name="Ana Exemplo" office="Vereadora" uf="EX" party="Partido A" href="#" comparing={compare.includes("a")} onToggleCompare={() => toggle("a")} />
          <PersonCard name="Bruno Fictício" office="Prefeito" uf="EX" party="Partido B" href="#" comparing={compare.includes("b")} onToggleCompare={() => toggle("b")} />
          <PersonCard name="Carla Modelo" office="Deputada estadual" uf="EX" party="Partido C" href="#" comparing={compare.includes("c")} compareFull onToggleCompare={() => toggle("c")} />
        </div>
        <MissingDataNote
          items={[
            { what: "Salário do prefeito", why: "a prefeitura mostra a folha só no portal, sem dado aberto." },
            { what: "Presença dos vereadores", why: "a câmara publica, mas ainda estamos carregando." },
          ]}
        />
      </Section>

      <Section title="Hemiciclo (neutro)">
        <Hemicycle seats={SEATS} title="Casa exemplo · 81 cadeiras" />
      </Section>

      <Section title="Formulário e diálogo">
        <div className="grid max-w-xl gap-4">
          <EmailField />
          <EmailField errorMessage="Confira o e-mail: falta o @." />
        </div>
        <OnboardingDialog />
      </Section>

      <Section title="Carregando">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-10 w-48" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      </Section>
    </main>
  );
}
