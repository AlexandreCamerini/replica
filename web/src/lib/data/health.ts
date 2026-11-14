// D14 · frescor por fonte para o vigia externo (GET /api/health/fontes). Sem segredo: só nome da fonte, carimbo e idade.
// buildHealth é puro (testável sem banco); getHealth lê pela camada de dados existente (listSourceStatus), sem tocar em pg.ts.
import { SOURCE_META, freshness } from "../sources.ts"; // com extensão: o runner de teste (node --test) não resolve import sem ela
import type { SourceStatus } from "./types";

/** Fora do prazo numa destas = a página principal do produto está velha: o vigia responde 503 e o job falha.
 * `sapl` entra porque roda só no launchd de um Mac (D274), fora do Actions, e nenhum alerta do ETL cobre a parada dele: o vigia é o único aviso ativo.
 * Fontes que aguardam chave de API (transparencia, cgu) ficam de fora de propósito: sem a chave o carimbo nunca existe e isso não é falha. */
export const ESSENTIAL = ["camara", "senado", "pauta", "sapl"] as const;
/** Pauta não está em SOURCE_META (é um conjunto de datasets `pauta.*` das duas casas). O workflow etl-pauta roda a cada 30 min em dia útil e a cada 3 h no fim de semana; 36 h dá folga para o cron do GitHub pular disparos. */
export const PAUTA_MAX_AGE_H = 36;

/** Limite do vigia para Câmara e Senado: cadência de 20 h (schedule.py, D250) + 6 h de folga. Mais apertado que o maxAgeHours do site (36 h, que absorve um recuo de falha) para cumprir o aceite do D14: agenda parada por 26 h gera aviso. Custo: uma falha transitória que empurre o carimbo além de 26 h acende o alerta, e é o que se quer saber. */
export const ALERTA_CASA_H = 26;

export type HealthState = "em_dia" | "fora_do_prazo" | "sem_dado";
export type SourceHealth = { fonte: string; nome: string | null; essencial: boolean; ultimoCarimbo: string | null; idadeHoras: number | null; maxAgeHours: number; alertaHoras: number; estado: HealthState };
export type HealthReport = { geradoEm: string; ok: boolean; essenciaisComProblema: string[]; fontes: SourceHealth[] };

const latest = (xs: string[]) => xs.reduce<string | null>((a, b) => (!a || b > a ? b : a), null);

const isEssential = (k: string) => (ESSENTIAL as readonly string[]).includes(k);

export function buildHealth(status: SourceStatus[], now: number = Date.now()): HealthReport {
  const bySlug = new Map(status.map((s) => [s.slug, s]));
  const all = status.flatMap((s) => s.datasets);
  const pautaAt = latest(all.filter((d) => d.dataset.startsWith("pauta.")).map((d) => d.refreshedAt));
  // Câmara e Senado: só os datasets da própria casa. O carimbo da fonte inteira (lastRefreshedAt) inclui `pauta.*` e `agenda.*`,
  // que são lidos de hora em hora e mascarariam um diário parado. `.equipe` é semanal e também fica de fora do máximo.
  const core = (k: string) => latest(all.filter((d) => d.dataset.startsWith(k + ".") && !d.dataset.endsWith(".equipe") && !d.dataset.includes(".noturna.")).map((d) => d.refreshedAt));
  // SAPL das câmaras: só `sapl.*` de carga. `sapl.descoberta` carimba mesmo sem nenhuma câmara lida (schedule.NOT_FRESHNESS) e mascararia a tarefa parada.
  const saplAt = latest(all.filter((d) => d.dataset.startsWith("sapl.") && d.dataset !== "sapl.descoberta").map((d) => d.refreshedAt));
  const rows: { key: string; name: string | null; at: string | null; max: number; alerta?: number }[] = [
    ...["camara", "senado"].map((k) => ({ key: k, name: bySlug.get(k)?.name ?? null, at: core(k), max: SOURCE_META[k].maxAgeHours, alerta: ALERTA_CASA_H })),
    { key: "pauta", name: "Pauta do Congresso", at: pautaAt, max: PAUTA_MAX_AGE_H },
    { key: "sapl", name: bySlug.get("sapl")?.name ?? null, at: saplAt, max: SOURCE_META.sapl.maxAgeHours },
    ...Object.keys(SOURCE_META)
      .filter((k) => !isEssential(k))
      .map((k) => ({ key: k, name: bySlug.get(k)?.name ?? null, at: bySlug.get(k)?.lastRefreshedAt ?? null, max: SOURCE_META[k].maxAgeHours })),
  ];
  const fontes = rows.map<SourceHealth>((r) => {
    const f = freshness(r.at, r.max, now);
    return {
      fonte: r.key,
      nome: r.name,
      essencial: isEssential(r.key),
      ultimoCarimbo: f.state === "sem_carga" ? null : r.at,
      idadeHoras: f.ageHours === null ? null : Math.round(f.ageHours * 10) / 10,
      maxAgeHours: r.max,
      alertaHoras: r.alerta ?? r.max,
      estado: f.state === "no_prazo" ? "em_dia" : f.state === "fora_do_prazo" ? "fora_do_prazo" : "sem_dado",
    };
  });
  // essencial sem carimbo nenhum também derruba: fonte que nunca carregou não está "em dia"
  const essenciaisComProblema = fontes.filter((f) => f.essencial && (f.estado !== "em_dia" || (f.idadeHoras ?? 0) > f.alertaHoras)).map((f) => f.fonte);
  return { geradoEm: new Date(now).toISOString(), ok: essenciaisComProblema.length === 0, essenciaisComProblema, fontes };
}

export async function getHealth(now: number = Date.now()): Promise<HealthReport> {
  const { data } = await import("./index"); // import tardio: buildHealth continua testável sem Postgres
  return buildHealth(await data.listSourceStatus(), now);
}

/** A mesma régua, lida direto do banco, sem o cache de dados: o vigia (D319) precisa dos carimbos de agora e do erro se o banco estiver fora. */
export async function getHealthSemCache(now: number = Date.now()): Promise<HealthReport> {
  const { fonteSemCache } = await import("./index");
  return buildHealth(await (await fonteSemCache()).listSourceStatus(), now);
}
