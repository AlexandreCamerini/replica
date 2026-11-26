// F6 do roteiro do eleitor: aviso de pauta velha. Módulo puro. Uma pauta lida há mais de LIMITE_HORAS é "velha": a tela avisa no topo, com a data da leitura.
// 24 h porque o ritmo real da coleta é de 30 em 30 minutos nos dias úteis (08h às 22h30 em Brasília), de 3 em 3 horas no fim de semana (.github/workflows/etl-pauta.yml)
// e as maiores pausas normais são a da madrugada de dia útil (cerca de 10 h) e a da noite de domingo para a manhã de segunda (cerca de 14 h, o cron não cobre a segunda 00h–01h UTC): passar de um dia inteiro sem leitura já não é pausa normal, e a margem para um disparo perdido do cron é de ~10 h. É o mesmo limite do aviso de sistema da /pauta (lib/pauta.ts).
import type { Body } from "@/lib/data/types";

export const LIMITE_HORAS = 24;
export type PautaVelha = { casa: Body; readAt: string; horas: number };

/** Casas com leitura, mas lida há mais de LIMITE_HORAS (Câmara antes do Senado). Casa sem leitura NÃO entra: é outro estado, "ainda não foi lida". Data ilegível não entra (não se afirma idade). */
export function pautasVelhas(reads: Record<Body, { readAt: string | null }>, agora: number): PautaVelha[] {
  const out: PautaVelha[] = [];
  for (const casa of ["camara", "senado"] as const) {
    const r = reads[casa].readAt;
    if (!r) continue;
    const t = new Date(r).getTime();
    if (Number.isNaN(t)) continue;
    const horas = (agora - t) / 3_600_000;
    if (horas > LIMITE_HORAS) out.push({ casa, readAt: r, horas });
  }
  return out;
}

/** "há mais de 1 dia" / "há mais de 3 dias" (dias inteiros; a leitura de 24 h a 48 h é "mais de 1 dia"). */
export function haQuantoTempo(horas: number): string {
  const d = Math.max(1, Math.floor(horas / 24));
  return `há mais de ${d} ${d === 1 ? "dia" : "dias"}`;
}
