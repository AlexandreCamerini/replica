import { data, type Body, type VotingEventSummary } from "@/lib/data";

export type Theme = { slug: string; name: string; events: VotingEventSummary[]; approved: number; rejected: number; last: string | null };

const WINDOW = 200; // votações mais recentes de cada Casa que entram no panorama

/** Panorama por tema: as votações mais recentes que mudam o texto de uma proposta, agrupadas pelo tema que a própria Casa atribui. */
export async function loadThemes(): Promise<{ themes: Theme[]; untagged: number; loaded: number; total: number }> {
  const bodies: Body[] = ["camara", "senado"];
  const [topics, ...pages] = await Promise.all([data.listTopics(), ...bodies.map((body) => data.listVotingEvents({ body, scope: "lei", limit: WINDOW }))]);
  const byKey = new Map(topics.flatMap((t) => [[t.slug, t] as const, [t.name, t] as const]));
  const map = new Map<string, Theme>();
  let untagged = 0;
  let loaded = 0;
  let total = 0;
  for (const p of pages) {
    total += p.total;
    for (const ev of p.items) {
      loaded += 1;
      const t = ev.topic ? byKey.get(ev.topic) : undefined;
      if (!t) {
        untagged += 1;
        continue;
      }
      const th = map.get(t.slug) ?? { slug: t.slug, name: t.name, events: [], approved: 0, rejected: 0, last: null };
      th.events.push(ev);
      if (ev.result === "aprovado") th.approved += 1;
      if (ev.result === "rejeitado") th.rejected += 1;
      if (!th.last || ev.occurredAt > th.last) th.last = ev.occurredAt;
      map.set(t.slug, th);
    }
  }
  // Ordem pelo que andou por último. Tema não é pessoa: aqui a ordem é de tempo, não de mérito.
  const themes = [...map.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name, "pt-BR"));
  for (const th of themes) th.events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { themes, untagged, loaded, total };
}
