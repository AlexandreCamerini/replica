// Vigia fora do GitHub Actions (D317). O `vigia.yml` roda no Actions; quando o Actions para (cobrança, cota de minutos, cron
// desligado por inatividade), o ETL e o próprio vigia param juntos e ninguém é avisado. Este vigia é chamado pelo Vercel Cron
// (web/vercel.json), lê a mesma régua de /api/health/fontes e avisa por webhook.
// Sem dependência do Next nem do alias "@/": a decisão inteira é testável com `node --test` (deps injetadas).
import { timingSafeEqual } from "node:crypto";
import type { HealthReport } from "./data/health.ts";

export type VigiaEnv = { CRON_SECRET?: string; VIGIA_ALERT_WEBHOOK?: string };
export type VigiaDeps = {
  env: VigiaEnv;
  /** lê os carimbos; pode lançar (banco fora) */
  getHealth: () => Promise<HealthReport>;
  /** POST {"text": …} no webhook; devolve o status HTTP ou lança (rede, tempo esgotado) */
  post: (url: string, text: string) => Promise<number>;
  /** teto da leitura dos carimbos, em ms (padrão LEITURA_MAX_MS) */
  leituraMaxMs?: number;
};
/** Banco que aceita a conexão e não responde não lança: sem este teto a função morreria no limite da Vercel sem avisar. */
export const LEITURA_MAX_MS = 15_000;
export type VigiaResult = { status: number; body: Record<string, unknown> };

/** O cabeçalho inteiro tem de ser `Bearer <segredo>`, como a Vercel envia; comparação em tempo constante. Sem segredo configurado, ninguém entra. */
export function autorizado(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O corpo enviado é {"text": …}, o formato do Slack (o mesmo do alerta do ETL). Discord só aceita esse corpo na URL terminada em `/slack`;
 * Teams novo pede Adaptive Card. Destino que não entende responde não-2xx e o vigia devolve 502: o teste de entrega (`?teste=1`) acusa. */
export function webhookValido(url: string | undefined): url is string {
  return !!url && /^https:\/\/[^\s"'\\]+$/.test(url);
}

const h = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Texto do alerta. null = nada a avisar (tudo em dia). `report` null = a leitura dos carimbos falhou. */
export function mensagem(report: HealthReport | null): string | null {
  if (!report) return "vigia (Vercel Cron): não foi possível ler os carimbos das fontes. O banco pode estar fora ou a leitura foi negada.";
  if (report.ok) return null;
  const linhas = report.fontes
    .filter((f) => report.essenciaisComProblema.includes(f.fonte))
    .map((f) => (f.idadeHoras === null ? `${f.fonte}: sem carga` : `${f.fonte}: última leitura há ${h(f.idadeHoras)} h (limite ${h(f.alertaHoras)} h)`));
  return [
    "vigia (Vercel Cron): fonte essencial fora do prazo.",
    ...linhas,
    "Este aviso não depende do GitHub Actions: se o ETL e o vigia.yml estiverem parados, o problema pode estar lá (cobrança, cota de minutos, cron desligado).",
  ].join("\n");
}

export const MENSAGEM_TESTE = "vigia (Vercel Cron): teste de entrega. Nenhuma fonte foi avaliada nesta mensagem.";

/**
 * Uma execução do vigia. O status fica no registro do cron na Vercel (que não repete a chamada nem notifica ninguém por conta própria):
 * 401 sem o Bearer certo · 500 webhook ausente ou inválido (mesmo com tudo em dia: configuração errada tem de aparecer todo dia)
 * · 502 havia o que avisar e o envio falhou · 200 tudo em dia, ou o aviso foi entregue.
 * O corpo nunca traz a URL do webhook nem mensagem de driver.
 */
export async function rodarVigia(authorization: string | null, teste: boolean, deps: VigiaDeps): Promise<VigiaResult> {
  if (!autorizado(authorization, deps.env.CRON_SECRET)) return { status: 401, body: { error: "não autorizado" } };
  const hook = deps.env.VIGIA_ALERT_WEBHOOK;
  let report: HealthReport | null = null;
  if (!teste) {
    let relogio: ReturnType<typeof setTimeout> | undefined;
    try {
      // leitura que lança (banco fora) ou que não volta no teto (banco travado) dá no mesmo: carimbos ilegíveis, e isso é aviso
      report = await Promise.race([
        deps.getHealth(),
        new Promise<never>((_, rej) => (relogio = setTimeout(() => rej(new Error("tempo esgotado")), deps.leituraMaxMs ?? LEITURA_MAX_MS))),
      ]);
    } catch {
      report = null;
    } finally {
      clearTimeout(relogio);
    }
  }
  const texto = teste ? MENSAGEM_TESTE : mensagem(report);
  const estado = teste ? { teste: true } : { ok: report?.ok ?? false, essenciaisComProblema: report?.essenciaisComProblema ?? null };
  if (!webhookValido(hook)) return { status: 500, body: { ...estado, alertou: false, error: "VIGIA_ALERT_WEBHOOK ausente ou inválido: o vigia não tem como avisar" } };
  if (texto === null) return { status: 200, body: { ...estado, alertou: false } };
  try {
    const code = await deps.post(hook, texto);
    if (code < 200 || code >= 300) return { status: 502, body: { ...estado, alertou: false, error: `o webhook respondeu HTTP ${code}` } };
  } catch {
    return { status: 502, body: { ...estado, alertou: false, error: "o envio ao webhook falhou" } };
  }
  return { status: 200, body: { ...estado, alertou: true } };
}
