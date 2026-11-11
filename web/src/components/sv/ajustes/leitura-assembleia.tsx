import { fraseCobertura, SEM_DADO } from "@/components/sv/estados";
import { fmtDate } from "@/components/sv/fmt";
import { data } from "@/lib/data";
import type { AssemblyDataset, AssemblyInfo } from "@/lib/data";

/** Ordem fixa dos conjuntos (não por valor nem por status). */
const ORDEM: AssemblyDataset[] = ["presenca", "votos", "propostas", "gastos_gabinete"];

export async function carregarAssembleia(uf: string): Promise<{ info: AssemblyInfo | null; falhou: boolean }> {
  try {
    return { info: await data.getAssembly(uf), falhou: false };
  } catch {
    return { info: null, falhou: true };
  }
}

/** O que o site lê da Assembleia da UF: um item por conjunto, com a frase de cobertura do contrato, o motivo e a evidência. */
export function LeituraAssembleia({ uf, info, falhou }: { uf: string; info: AssemblyInfo | null; falhou: boolean }) {
  if (!info) {
    return (
      <p className="sv-t">
        {falhou ? "Não conseguimos ler essa informação agora. " : ""}
        {SEM_DADO} Fonte: portal de dados abertos da Assembleia de {uf}, ainda não ligado ao site.
      </p>
    );
  }
  const itens = [...info.items].sort((a, b) => ORDEM.indexOf(a.dataset) - ORDEM.indexOf(b.dataset));
  if (itens.length === 0)
    return (
      <p className="sv-t">
        {SEM_DADO}
        {info.source ? <> Fonte: {info.source.name}.</> : null}
      </p>
    );
  return (
    <ul className="sv-st">
      {itens.map((i) => (
        <li key={i.dataset}>
          <b>{i.label}</b>
          <span>
            {fraseCobertura(i.status) ?? `Lido e mostrado no site${i.refreshedAt ? `. Última leitura: ${fmtDate(i.refreshedAt)}` : ""}.`}
            {i.reason ? ` ${i.reason}` : ""}
            {i.evidenceUrl ? (
              <>
                {" "}
                <a href={i.evidenceUrl}>Ver a evidência</a>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
