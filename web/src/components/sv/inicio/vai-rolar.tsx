import Link from "next/link";
import { BODY_NAME, fmtDate, fmtDateTime } from "@/components/sv/fmt";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { Lacuna, Prova } from "@/components/sv/ui";
import { data, type Body, type ChamberTransition, type PautaOverview } from "@/lib/data";
import { dayKey, fmtDiaMes } from "./datas";
import { NotaRegra, byDate, casasSemLeitura, esferaDe, tituloDe } from "./semana";

const MAX_ITENS = 6;

async function transicao(body: Body): Promise<ChamberTransition | null> {
  return data.getChamberTransition(body).catch(() => null);
}

function Posse({ body, t }: { body: Body; t: ChamberTransition | null }) {
  const casa = BODY_NAME[body];
  if (!t) return <Lacuna>{casa}: quem sai e quem entra. Ainda não temos esse dado.</Lacuna>;
  if (!t.loaded)
    return (
      <Lacuna motivo="Os eleitos de 2026 do TSE ainda não foram carregados para esta Casa.">
        {casa}: quem sai e quem entra. Ainda não temos esse dado.
      </Lacuna>
    );
  return (
    <p className="sv-t">
      <b>{casa}:</b> {t.entra} entram, {t.sai} saem e {t.continua} continuam, entre {t.capacity} cadeiras.
      {t.pending > 0 ? ` ${t.pending} cadeiras ainda sem eleito carregado.` : ""}
    </p>
  );
}

/** "Vai rolar": o plenário depois desta semana, até 14 dias (`later`), e a posse de fevereiro de 2027. */
export async function VaiRolar({ overview, fimDaSemana }: { overview: PautaOverview | null; fimDaSemana: string | null }) {
  const [camara, senado] = await Promise.all([transicao("camara"), transicao("senado")]);
  const later = overview ? [...overview.later].sort(byDate) : [];
  const mostrados = later.slice(0, MAX_ITENS);
  const falhou = overview ? overview.reads.camara.failed + overview.reads.senado.failed > 0 : false;
  const lido = overview?.week.readAt ?? null;
  const naoLidas = overview ? casasSemLeitura(overview) : [];

  return (
    <section className="sv-tl sv-gv" aria-labelledby="inicio-vai">
      <h2 className="sv-th" id="inicio-vai">
        Vai rolar <ExemploIlustrativo />
      </h2>
      {!overview ? (
        <Lacuna>Não conseguimos ler a pauta agora. Tente de novo em alguns minutos.</Lacuna>
      ) : naoLidas.length === 2 ? (
        <Lacuna>A pauta da Câmara dos Deputados e do Senado Federal ainda não foi lida.</Lacuna>
      ) : later.length === 0 ? (
        <div className="sv-ev">
          <p className="sv-ev__d">{fimDaSemana ? `Depois de ${fmtDiaMes(fimDaSemana)}, até 14 dias` : "Nos próximos 14 dias"}</p>
          <p className="sv-esf">Federal · Câmara e Senado · plenário</p>
          <Lacuna>
            <b>Nenhum item que acompanhamos</b> está marcado {lido ? `na leitura de ${fmtDate(lido)}` : "na leitura disponível"}. A pauta pode mudar.{falhou ? " A leitura foi incompleta." : ""}
          </Lacuna>
        </div>
      ) : (
        <>
          {mostrados.map((e) => {
            const k = dayKey(e.scheduledFor);
            return (
              <div key={`${e.key}-${e.scheduledFor}`} className="sv-ev">
                <p className="sv-ev__d">{k ? fmtDiaMes(k) : "Data não informada"}</p>
                <p className="sv-esf">{esferaDe(e)}</p>
                <p className="sv-ev__t">
                  <Link href={`/v2/decisao/${e.key}`}>{tituloDe(e)}</Link>
                </p>
              </div>
            );
          })}
          {later.length > mostrados.length && <p className="sv-resto">E mais {later.length - mostrados.length} no plenário, até 14 dias. Veja todas em Decisões.</p>}
        </>
      )}
      {naoLidas.length === 1 && <p className="sv-resto">A pauta {naoLidas[0]} ainda não foi lida: a lista acima não inclui essa Casa.</p>}
      {overview && naoLidas.length < 2 && <NotaRegra />}
      <div className="sv-ev">
        <p className="sv-ev__d">1º de fevereiro de 2027</p>
        <p className="sv-esf">Federal · Câmara e Senado</p>
        <p className="sv-ev__t">Posse dos eleitos em 2026.</p>
        <Posse body="camara" t={camara} />
        <Posse body="senado" t={senado} />
      </div>
      <Link className="sv-lk" href="/v2/decisoes">
        Ver tudo o que está em pauta <span aria-hidden="true">→</span>
      </Link>
      <Prova>
        Fonte: Câmara dos Deputados e Senado Federal (pauta{lido ? `, lida em ${fmtDateTime(lido)}` : ""}); TSE (eleitos de 2026). A pauta pode mudar.
      </Prova>
    </section>
  );
}
