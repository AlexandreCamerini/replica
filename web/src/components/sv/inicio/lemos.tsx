import Link from "next/link";
import { fmtDateTime } from "@/components/sv/fmt";
import type { Esferas } from "@/components/sv/prefs-shared";
import type { PautaOverview, PautaRead } from "@/lib/data";

/** Nome da casa estadual da UF, curto. DF tem Câmara Legislativa, não Assembleia. */
export const casaEstadual = (sigla: string) => (sigla === "DF" ? "Câmara Legislativa do DF" : `Assembleia de ${sigla}`);

function leitura(nome: string, r: PautaRead): string {
  if (!r.readAt) return `${nome}: ainda sem leitura registrada.`;
  const quando = fmtDateTime(r.readAt);
  if (r.failed > 0) return `${nome}: leitura de ${quando}. A leitura falhou em ${r.failed} de ${r.total} reuniões; pode haver itens que não aparecem aqui.`;
  return `${nome}: leitura de ${quando}, sem reuniões que falharam.`;
}

/** "O que lemos": o que entra na tela, por esfera. Leitura que falhou é dita; estadual e municipal dependem das Ajustes. */
export function Lemos({ overview, ufSigla, esferas }: { overview: PautaOverview | null; ufSigla: string | null; esferas: Esferas }) {
  return (
    <div className="sv-lemos sv-gl">
      <p className="sv-lemos__t">
        <b>O que lemos</b>
      </p>
      <ul className="sv-lemos__l">
        {overview ? (
          <>
            <li>{leitura("Federal, Câmara dos Deputados", overview.reads.camara)}</li>
            <li>{leitura("Federal, Senado Federal", overview.reads.senado)}</li>
          </>
        ) : (
          <li>Federal: a leitura da pauta da Câmara dos Deputados e do Senado Federal falhou agora. Tente de novo em alguns minutos.</li>
        )}
        {!ufSigla ? (
          <li>
            <span>Estadual: escolha seu estado para ver.</span>
            <Link href="/v2/ajustes">Escolher estado em Ajustes</Link>
          </li>
        ) : !esferas.estadual ? (
          <li>
            <span>Estadual: desligado.</span>
            <Link href="/v2/ajustes">Ligar em Ajustes</Link>
          </li>
        ) : (
          <li>
            <span>Estadual: {casaEstadual(ufSigla)}.</span>
            <Link href="/v2/ajustes">Ver o que lemos em Ajustes</Link>
          </li>
        )}
        <li>
          <span>Municipal: {esferas.municipal ? "ligado" : "desligado"}.</span>
          <Link href="/v2/ajustes">{esferas.municipal ? "Ver em Ajustes" : "Ligar em Ajustes"}</Link>
        </li>
      </ul>
    </div>
  );
}
