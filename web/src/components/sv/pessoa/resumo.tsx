// U04 (D304): resumo do ano em frases, só com dado lido. Sem média, sem comparação com outras pessoas (seria ranking
// implícito). Conjunto não lido: lacuna nomeada pelo estado de cobertura, nunca zero. "Nenhum" só com o conjunto `lido`.
import { anoDe, fmtInt } from "@/components/sv/fmt";
import { ESTADO_COBERTURA, FALHOU_LEITURA, naoHaNaLeitura, SEM_DADO } from "@/components/sv/estados";
import { Lacuna } from "@/components/sv/ui";
import type { AttendanceGrid, CoberturaConjunto, LawItem } from "@/lib/data";
import { frasesPresenca } from "./secoes";

export type FraseAno = { tipo: "fato"; texto: string } | { tipo: "lacuna"; texto: string; motivo?: string | null; estado?: string };

/** Frase de lacuna de um conjunto pelo estado de cobertura; `lido` sem registro vira "não há" com a data da leitura. */
function lacuna(rotulo: string, oQue: string, cob: CoberturaConjunto | null, motivoSemCobertura?: string | null): FraseAno {
  if (!cob) return { tipo: "lacuna", texto: `${rotulo}: ${SEM_DADO}`, motivo: motivoSemCobertura };
  if (cob.estado === "lido") return { tipo: "fato", texto: naoHaNaLeitura(oQue, cob.lidoEm) };
  return { tipo: "lacuna", texto: `${rotulo}: ${ESTADO_COBERTURA[cob.estado]}`, motivo: cob.motivo, estado: cob.estado };
}

export function frasesDoAno(i: {
  ano: number;
  fem: boolean;
  /** motivo da lacuna de presença quando a cobertura não pôde ser lida (posse, cargo sem plenário); null = nenhum */
  motivoPresenca: string | null;
  grade: AttendanceGrid | null;
  presencaFalhou: boolean;
  cobPresenca: CoberturaConjunto | null;
  /** propostas como autor(a) principal no ano; null = a fonte não publica / não lido; undefined = a leitura falhou */
  propostas: number | null | undefined;
  cobPropostas: CoberturaConjunto | null;
  /** leis lidas da pessoa; null = não se fala de leis (cargo fora da leitura ou conjunto não lido) */
  leis: LawItem[] | null;
  cobLeis: CoberturaConjunto | null;
}): FraseAno[] {
  const { ano } = i;
  const out: FraseAno[] = [];
  // presença
  if (i.grade && i.grade.year === ano) out.push({ tipo: "fato", texto: frasesPresenca(i.grade).r });
  else if (i.presencaFalhou) out.push({ tipo: "lacuna", texto: `Presença em ${ano}: ${FALHOU_LEITURA}` });
  else out.push(lacuna(`Presença em ${ano}`, `presença em sessão de votação em ${ano}`, i.cobPresenca, i.motivoPresenca));
  // propostas
  const autor = i.fem ? "autora" : "autor";
  if (i.propostas === undefined) out.push({ tipo: "lacuna", texto: `Propostas em ${ano}: ${FALHOU_LEITURA}` });
  else if (i.propostas !== null && i.propostas > 0) out.push({ tipo: "fato", texto: `Apresentou ${fmtInt(i.propostas)} ${i.propostas === 1 ? "proposta" : "propostas"} como ${autor} principal em ${ano}.` });
  else out.push(lacuna(`Propostas em ${ano}`, `proposta como ${autor} principal em ${ano}`, i.cobPropostas));
  // leis: só com o conjunto lido para o cargo
  if (i.leis) {
    const n = i.leis.filter((l) => l.role === "autor" && anoDe(l.sanctionedOn) === ano).length;
    out.push(
      n > 0
        ? { tipo: "fato", texto: `${fmtInt(n)} ${n === 1 ? "proposta" : "propostas"} de autoria principal ${n === 1 ? "virou lei" : "viraram lei"} em ${ano}.` }
        : { tipo: "fato", texto: naoHaNaLeitura(`lei sancionada em ${ano} de proposta com autoria principal`, i.cobLeis?.lidoEm ?? null) },
    );
  } else out.push(lacuna(`Leis em ${ano}`, `lei sancionada em ${ano}`, i.cobLeis?.estado === "lido" ? null : i.cobLeis));
  return out;
}

// sem `data-cobertura`: a frase leva o rótulo do conjunto ("Presença em 2026: …"), e a bateria compara a frase de cada
// estado entre as lacunas marcadas
export function ResumoDoAno({ frases }: { frases: FraseAno[] }) {
  return (
    <ul className="sv-ano">
      {frases.map((f) => (
        <li key={f.texto}>{f.tipo === "fato" ? f.texto : <Lacuna motivo={f.motivo ?? undefined}>{f.texto}</Lacuna>}</li>
      ))}
    </ul>
  );
}
