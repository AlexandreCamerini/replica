"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtDate } from "../fmt";
import { CHAVE_VISITA, JANELA_MAX, JANELA_PADRAO, frasePessoa, janelaDe, lerVisita, proximaVisita, resumir, type AtoDesde, type Visita } from "./desde";

// Ilha cliente do quadro "O que mudou com seus escolhidos" (F2 do roteiro do eleitor, A1 e A2).
// O servidor entrega os registros dos últimos 60 dias (só fatos, com fonte nos links) e a conta "desde a última visita" é feita
// AQUI, com a data guardada no localStorage deste aparelho: essa data nunca vai ao servidor (não está em cookie, URL nem pedido).
// Sem JavaScript, ou na primeira visita, o quadro mostra a janela padrão de 14 dias, dita na tela.
// Marcação mínima própria (sem importar ui.tsx) para a ilha continuar pequena.

export function MudouDesde({ atos, hoje, minimo }: { atos: AtoDesde[]; hoje: string; /** a leitura parou no limite de registros: os números são "pelo menos" */ minimo: boolean }) {
  // null até o navegador ler a visita: a primeira pintura é a mesma do servidor (janela padrão), sem diferença na hidratação
  const [visita, setVisita] = useState<Visita | null>(null);
  useEffect(() => {
    // ler e gravar são tentativas separadas: se gravar falhar (cota, janela privada), o "desde" já calculado ainda vale nesta página
    let lida: Visita | null = null;
    try {
      lida = lerVisita(window.localStorage.getItem(CHAVE_VISITA));
    } catch {
      lida = null;
    }
    const v = proximaVisita(lida, new Date());
    try {
      window.localStorage.setItem(CHAVE_VISITA, JSON.stringify(v));
    } catch {
      // armazenamento bloqueado: nada é guardado
    }
    setVisita(v);
  }, []);

  const j = janelaDe(visita, hoje);
  const linhas = resumir(atos, j.desde);
  const titulo = j.origem === "visita" ? `O que mudou desde ${fmtDate(j.desde)}` : `O que mudou nos últimos ${JANELA_PADRAO} dias`;

  return (
    <div className="sv-mud" data-mudou-desde="true" data-origem={j.origem}>
      <h3 className="sv-mud__t">{titulo}</h3>
      {j.limitada && <p className="sv-nota">Sua última visita foi há mais de {JANELA_MAX} dias. Só lemos os últimos {JANELA_MAX}.</p>}
      {linhas.length === 0 ? (
        <p className="sv-lac">
          <span className="sv-lac__liso">Nenhum registro de voto, proposta ou gasto destas pessoas com data desde {fmtDate(j.desde)} nos dados que lemos.</span>
        </p>
      ) : (
        <ul className="sv-mud__l">
          {linhas.map((r) => (
            <li key={r.slug} data-pessoa={r.slug}>
              <p className="sv-mud__f">
                <strong className="sv-mud__n">{r.nome}</strong> {frasePessoa(r, minimo)}.
              </p>
              <span className="sv-mud__a">
                {(r.votos > 0 || r.semVoto > 0) && (
                  <Link href={`/pessoa/${r.slug}/votos`}>
                    Ver os votos<span className="sv-vh"> de {r.nome}</span>
                  </Link>
                )}
                {r.gastos > 0 && (
                  <Link href={`/pessoa/${r.slug}/gastos`}>
                    Ver os gastos<span className="sv-vh"> de {r.nome}</span>
                  </Link>
                )}
                {r.propostas > 0 && (
                  <Link href={`/pessoa/${r.slug}`}>
                    Ver o que faz<span className="sv-vh"> {r.nome}</span>
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="sv-nota">
        A data da sua última visita fica só neste aparelho. A contagem usa a data de cada registro (do voto, da proposta ou do gasto), não a de quando o site o leu: registro que chega com atraso aparece na data dele. Contagem da fonte, em ordem alfabética, sem comparação entre pessoas.
        {minimo ? " A leitura parou no limite de registros: os números são um mínimo e pode faltar quem teve registros mais antigos no período." : ""}
      </p>
    </div>
  );
}
