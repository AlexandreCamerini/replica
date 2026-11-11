import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { fmtDate } from "@/components/sv/fmt";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { dayKey, fmtFolio, hojeKey } from "@/components/sv/inicio/datas";
import { Escolhidos } from "@/components/sv/inicio/escolhidos";
import { JaRolou } from "@/components/sv/inicio/ja-rolou";
import { Lemos } from "@/components/sv/inicio/lemos";
import { Representa } from "@/components/sv/inicio/representa";
import { Semana, faixaDaSemana } from "@/components/sv/inicio/semana";
import { VaiRolar } from "@/components/sv/inicio/vai-rolar";
import { parseUf, readPrefs, ufOptions } from "@/components/sv/prefs";
import { Lacuna, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { data, type PautaOverview, type RepresentativeGroup } from "@/lib/data";

export const metadata: Metadata = { title: { absolute: "Segue o Voto: o que está rolando" } };

function lerFollows(raw: string | undefined): string[] {
  try {
    return parseFollows(raw);
  } catch {
    return []; // cookie malformado: trata como lista vazia
  }
}

/** "E no Congresso?": o tema oficial da Câmara que aparece na pauta desta semana (`reason.theme`). Sem mapa próprio de temas. */
function ECongresso({ overview, hoje }: { overview: PautaOverview | null; hoje: string }) {
  const temas = overview
    ? [...new Set(faixaDaSemana(overview, hoje).entries.filter((e) => e.body === "camara" && e.reason.theme).map((e) => e.reason.theme as string))].sort((a, b) => a.localeCompare(b, "pt-BR"))
    : [];
  const lida = overview?.reads.camara.readAt;
  return (
    <Quadro
      id="inicio-congresso"
      variante="fio"
      className="sv-gp"
      pergunta="E no Congresso?"
      prova={`Tema oficial da Câmara. Fonte: pauta da Câmara dos Deputados${lida ? `, lida em ${fmtDate(lida)}` : ", sem data de leitura registrada"}.`}
    >
      {!overview ? (
        <Lacuna>Não conseguimos ler a pauta agora. Tente de novo em alguns minutos.</Lacuna>
      ) : temas.length === 0 ? (
        <>
          <Lacuna>Nenhuma proposta da pauta da Câmara desta semana traz tema oficial.</Lacuna>
          <Link className="sv-lk" href="/v2/temas">
            Ver os temas <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : (
        <Resposta>
          <Link href="/v2/temas">
            Na pauta do Congresso desta semana: {temas.join(", ")}. <span aria-hidden="true">→</span>
          </Link>
        </Resposta>
      )}
    </Quadro>
  );
}

export default async function Inicio({ searchParams }: { searchParams: Promise<{ uf?: string }> }) {
  const sp = await searchParams;
  const [prefs, jar] = await Promise.all([readPrefs(), cookies()]);
  const follows = lerFollows(jar.get(FOLLOW_COOKIE)?.value);
  const { esferas } = prefs;

  // `?uf=XX` continua valendo como atalho de leitura (sobre o cookie). `?cidade=` não é mais entrada.
  let uf = prefs.uf;
  if (sp.uf) {
    const opts = await ufOptions().catch(() => []);
    const sigla = parseUf(sp.uf, opts.map((o) => o.sigla));
    uf = (sigla && opts.find((o) => o.sigla === sigla)) || uf;
  }

  const hoje = hojeKey();
  const ufPlace = uf ? await data.getPlaceByUf(uf.sigla).catch(() => null) : null;
  // A cidade (Ajustes) só vale quando é da mesma UF que está sendo lida; `?uf=` de outro estado ignora a cidade do cookie.
  const cidade = esferas.municipal && esferas.cidade ? await data.getPlace(esferas.cidade).catch(() => null) : null;
  const place = cidade && uf && cidade.uf === uf.sigla ? cidade : ufPlace;
  const [overview, groups, tse] = await Promise.all([
    data.getPautaOverview().catch(() => null),
    place ? data.getRepresentatives(place).catch(() => [] as RepresentativeGroup[]) : Promise.resolve([] as RepresentativeGroup[]),
    data.getStamp("tse.candidatos").catch(() => null),
  ]);
  const fimDaSemana = overview ? (faixaDaSemana(overview, hoje).dias[6] ?? null) : null;

  return (
    <div className="sv-pg sv-pg--rola">
      <div className="sv-folio sv-gh">
        <h1>O que está rolando?</h1>
        <p className="sv-intro">Aqui você acompanha o que o Congresso decide e o que fazem as pessoas em quem você votou.</p>
        <p className="sv-so-larga sv-agora">{fmtFolio(dayKey(new Date()) ?? hoje)}</p>
      </div>

      <Lemos overview={overview} ufSigla={uf?.sigla ?? null} esferas={esferas} />
      <Escolhidos slugs={follows} ufSigla={uf?.sigla ?? null} />
      <Semana overview={overview} ufSigla={uf?.sigla ?? null} estadualLigado={esferas.estadual} hoje={hoje} />
      <JaRolou />
      <VaiRolar overview={overview} fimDaSemana={fimDaSemana} />
      <Representa uf={uf} groups={groups} esferas={esferas} tse={tse} />
      <ECongresso overview={overview} hoje={hoje} />
      <Selo className="sv-gs" lidoEm={overview?.week.readAt ?? null} />
      <Proxima className="sv-gn" href="/v2/acompanhando" pergunta="O que meus escolhidos estão fazendo?" />
    </div>
  );
}
