import Link from "next/link";
import { fmtDate } from "@/components/sv/fmt";
import type { Esferas } from "@/components/sv/prefs-shared";
import { Lacuna, Nota, Quadro } from "@/components/sv/ui";
import type { OfficeSlug, RepresentativeGroup, Stamp } from "@/lib/data";

// Ordem fixa por nível do cargo (federal, estadual, municipal): nunca por quantidade.
const ORDEM: { office: OfficeSlug; nivel: "federal" | "estadual" | "municipal"; um: string; varios: string }[] = [
  { office: "presidente", nivel: "federal", um: "presidente", varios: "presidentes" },
  { office: "vice_presidente", nivel: "federal", um: "vice-presidente", varios: "vice-presidentes" },
  { office: "senador", nivel: "federal", um: "senador", varios: "senadores" },
  { office: "deputado_federal", nivel: "federal", um: "deputado federal", varios: "deputados federais" },
  { office: "governador", nivel: "estadual", um: "governador", varios: "governadores" },
  { office: "vice_governador", nivel: "estadual", um: "vice-governador", varios: "vice-governadores" },
  { office: "deputado_estadual", nivel: "estadual", um: "deputado estadual", varios: "deputados estaduais" },
  { office: "deputado_distrital", nivel: "estadual", um: "deputado distrital", varios: "deputados distritais" },
  { office: "prefeito", nivel: "municipal", um: "prefeito", varios: "prefeitos" },
  { office: "vice_prefeito", nivel: "municipal", um: "vice-prefeito", varios: "vice-prefeitos" },
  { office: "vereador", nivel: "municipal", um: "vereador", varios: "vereadores" },
];

function juntar(partes: string[]): string {
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : (partes[0] ?? "");
}

/** "Quem mais me representa?": quantas pessoas em cada cargo para a UF do leitor. Sem UF: convite. Estadual e municipal só se ligados. */
export function Representa({ uf, groups, esferas, tse }: { uf: { sigla: string; nome: string } | null; groups: RepresentativeGroup[]; esferas: Esferas; tse: Stamp | null }) {
  const lida = tse && new Date(tse.refreshedAt).getTime() > 0 ? `lida em ${fmtDate(tse.refreshedAt)}` : "data da leitura não registrada";

  if (!uf) {
    return (
      <Quadro id="inicio-representa" variante="fio" className="sv-gt" pergunta="Quem mais me representa?">
        <p className="sv-t">Escolha seu estado para ver todas as pessoas que representam você, de A a Z.</p>
        <Link className="sv-btn" href="/v2/ajustes">
          Escolher meu estado
        </Link>
      </Quadro>
    );
  }

  const ligado = (n: "federal" | "estadual" | "municipal") => n === "federal" || (n === "estadual" && esferas.estadual) || (n === "municipal" && esferas.municipal);
  const doNivel = groups.filter((g) => ligado(g.level));
  const partes: string[] = [];
  for (const o of ORDEM) {
    if (!ligado(o.nivel)) continue;
    const gs = doNivel.filter((g) => g.people.some((p) => p.mandate.office === o.office));
    const n = gs.reduce((s, g) => s + g.people.filter((p) => p.mandate.office === o.office).length, 0);
    if (n === 0) continue;
    const seats = gs.find((g) => g.seats)?.seats;
    partes.push(seats ? `${seats.loaded} de ${seats.total} ${o.varios} carregados` : `${n} ${n === 1 ? o.um : o.varios}`);
  }
  const lacunas = doNivel.flatMap((g) => g.gaps ?? []);
  const semMunicipal = esferas.municipal && !groups.some((g) => g.level === "municipal");

  return (
    <Quadro
      id="inicio-representa"
      variante="fio"
      className="sv-gt"
      pergunta="Quem mais me representa?"
      prova={`Fonte: TSE, cargos e cadeiras, ${lida}. Pessoas em ordem alfabética.`}
    >
      {partes.length === 0 ? (
        <Lacuna motivo="Fonte: TSE, cargos e cadeiras.">Ainda não temos esse dado para {uf.nome}.</Lacuna>
      ) : (
        <p className="sv-peq">
          <b>Pessoas em exercício que carregamos para {uf.nome}:</b> {juntar(partes)}.{" "}
          {!esferas.municipal ? "Prefeito e vereadores: desligado." : semMunicipal ? "Prefeito e vereadores: escolha a cidade em Ajustes." : ""}
        </p>
      )}
      {lacunas.map((l) => (
        <Nota key={l.what}>
          Sem dado: {l.what}. {l.why}
        </Nota>
      ))}
      <p className="sv-selo__l">
        <Link href={`/v2/pessoas?uf=${uf.sigla}`}>Ver todas, de A a Z</Link>
        <Link href="/v2/ajustes">{esferas.municipal ? "Mudar em Ajustes" : "Ligar em Ajustes"}</Link>
      </p>
    </Quadro>
  );
}
