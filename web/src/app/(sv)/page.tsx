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
import { readPrefs } from "@/components/sv/prefs";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
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
  const incompleta = !!overview && overview.reads.camara.failed > 0;
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
      ) : !lida ? (
        // pauta da Câmara sem leitura: não dá para dizer que nenhuma proposta traz tema
        <Lacuna>A pauta da Câmara desta semana ainda não foi lida.</Lacuna>
      ) : temas.length === 0 && incompleta ? (
        <Lacuna motivo="A leitura da pauta da Câmara foi incompleta: não dá para dizer que nenhuma proposta traz tema oficial.">{FALHOU_LEITURA}</Lacuna>
      ) : temas.length === 0 ? (
        <>
          <Lacuna>Nenhuma proposta da pauta da Câmara desta semana traz tema oficial.</Lacuna>
          <Link className="sv-lk" href="/temas">
            Ver os temas <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : (
        <Resposta>
          <Link href="/temas">
            Na pauta do Congresso desta semana: {temas.join(", ")}. <span aria-hidden="true">→</span>
          </Link>
        </Resposta>
      )}
    </Quadro>
  );
}

export default async function Inicio({ searchParams }: { searchParams: Promise<{ simular?: string | string[] }> }) {
  const [prefs, jar, sp] = await Promise.all([readPrefs(), cookies(), searchParams]);
  // `?simular=…` só vale na demonstração (simular.ts): é como os estados de leitura que falhou são testados
  const sim = simulacao(sp.simular);
  const falhar = sim === "erro";
  const follows = lerFollows(jar.get(FOLLOW_COOKIE)?.value);
  const { esferas } = prefs;

  // A UF vem só do cookie (a mesma que o topo mostra). Sem atalho `?uf=` nem `?cidade=`: uma UF por página.
  const uf = prefs.uf;

  const hoje = hojeKey();
  // null = leitura falhou (lacuna "Não conseguimos ler…"), distinto de "não há"
  const ufPlace = uf ? await lerOuFalhar(falhar, () => data.getPlaceByUf(uf.sigla)).catch(() => undefined) : null;
  // A cidade (Ajustes) só vale quando é da mesma UF do cookie.
  const cidade = esferas.municipal && esferas.cidade ? await data.getPlace(esferas.cidade).catch(() => null) : null;
  const place = cidade && uf && cidade.uf === uf.sigla ? cidade : (ufPlace ?? null);
  const [overview, groups, tse] = await Promise.all([
    // a opção só existe na demonstração; sem simulação, a chamada é a de sempre (sem argumento)
    (sim === "camara_nao_lida" ? data.getPautaOverview({ simulate: "camara_nao_lida" }) : data.getPautaOverview()).catch(() => null),
    place ? lerOuFalhar(falhar, () => data.getRepresentatives(place)).catch(() => null) : Promise.resolve([] as RepresentativeGroup[]),
    data.getStamp("tse.candidatos").catch(() => null),
  ]);
  const representantesFalhou = ufPlace === undefined || groups === null || !!prefs.ufFalhou;
  const fimDaSemana = overview ? (faixaDaSemana(overview, hoje).dias[6] ?? null) : null;

  return (
    <div className="sv-pg sv-pg--rola">
      <div className="sv-folio sv-gh">
        <h1>O que está rolando?</h1>
        <p className="sv-intro">Aqui você acompanha o que o Congresso decide e o que fazem as pessoas em quem você votou.</p>
        <p className="sv-so-larga sv-agora">{fmtFolio(dayKey(new Date()) ?? hoje)}</p>
      </div>

      <Lemos overview={overview} ufSigla={uf?.sigla ?? null} ufFalhou={!!prefs.ufFalhou} esferas={esferas} />
      <Escolhidos slugs={follows} ufSigla={uf?.sigla ?? null} simularFalha={falhar} />
      <Semana overview={overview} ufSigla={uf?.sigla ?? null} estadualLigado={esferas.estadual} hoje={hoje} simularFalha={falhar} />
      <JaRolou />
      <VaiRolar overview={overview} fimDaSemana={fimDaSemana} />
      <Representa uf={uf} groups={groups ?? []} falhou={representantesFalhou} esferas={esferas} tse={tse} />
      <ECongresso overview={overview} hoje={hoje} />
      <Selo className="sv-gs" lidoEm={overview?.week.readAt ?? null} />
      <Proxima className="sv-gn" href="/acompanhando" pergunta="O que meus escolhidos estão fazendo?" />
    </div>
  );
}
