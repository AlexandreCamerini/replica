import { NextResponse } from "next/server";
import { haLeitura, lerCasa, montarCalendario, type Leituras } from "@/components/sv/calendario-pauta";
import { data } from "@/lib/data";

// F5b: calendário (.ics) da pauta do plenário, para colocar na agenda do leitor. Sem conta, sem e-mail, sem cookie: é um download.
// `?casa=camara|senado` (ausente = as duas). Só plenário, de agora até 14 dias, sem filtro por tema (a F5a filtra votações; o tema da pauta é texto oficial só da Câmara).
// Falha de leitura, ou nenhuma leitura da Casa pedida = 503 sem calendário (um calendário vazio diria "nada marcado", o que não sabemos).
// Calendário sem entradas, com leitura, é 200 e vazio. Casa não lida (quando se pedem as duas) e leitura incompleta vão como aviso no arquivo.
export const dynamic = "force-dynamic";
const TEXTO = { "Content-Type": "text/plain; charset=utf-8" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const casa = lerCasa(url.searchParams.get("casa"));
  if (!casa) return new NextResponse("casa inválida: use camara ou senado", { status: 400, headers: TEXTO });
  let o;
  try {
    o = await data.getPautaOverview();
  } catch {
    return new NextResponse("não foi possível ler a pauta agora", { status: 503, headers: { ...TEXTO, "Retry-After": "300" } });
  }
  const leituras: Leituras = { camara: o.reads.camara, senado: o.reads.senado };
  if (!haLeitura(leituras, casa)) return new NextResponse("a pauta ainda não foi lida: sem calendário para não dizer que nada está marcado", { status: 503, headers: { ...TEXTO, "Retry-After": "300" } });
  const base = process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL) ? process.env.SITE_URL : url.origin;
  const ics = montarCalendario([...o.plenary, ...o.later], { base, geradoEm: new Date().toISOString(), leituras, casa, demo: data.isDemo });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="pauta-plenario${casa === "todas" ? "" : `-${casa}`}.ics"`,
      "Cache-Control": "public, s-maxage=300",
    },
  });
}
