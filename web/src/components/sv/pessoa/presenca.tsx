// Grade de presença por sessão (D2 "Foi trabalhar?"): traços verticais agrupados por mês.
// Quatro estados: presente, ausência justificada, ausente e fora do exercício (sem marca de falta, fora da conta).
import type { AttendanceGrid, AttendanceState } from "@/lib/data";
import { MESES, MESES_ABREV, listaE } from "./format";

const CLASSE: Record<AttendanceState, string> = { presente: "", ausencia_justificada: "sv-j", ausente: "sv-au", fora_do_exercicio: "sv-fx" };

type Mes = { mes: number; sessoes: AttendanceState[] };

function porMes(g: AttendanceGrid): Mes[] {
  const out: Mes[] = [];
  for (const s of g.sessions) {
    const mes = Number(s.date.slice(5, 7));
    if (!(mes >= 1 && mes <= 12)) continue;
    let m = out.find((x) => x.mes === mes);
    if (!m) out.push((m = { mes, sessoes: [] }));
    m.sessoes.push(s.state);
  }
  return out.sort((a, b) => a.mes - b.mes);
}

function mesesDo(meses: Mes[], estado: AttendanceState): string {
  return listaE(meses.filter((m) => m.sessoes.includes(estado)).map((m) => MESES[m.mes - 1]));
}

/** aria-label gerado do dado: totais e os meses de cada estado que não é "presente". */
export function descreverGrade(g: AttendanceGrid): string {
  const meses = porMes(g);
  const partes = [`${g.present} presente`];
  if (g.justified > 0) partes.push(`${g.justified} ausência justificada (${mesesDo(meses, "ausencia_justificada")})`);
  if (g.absent > 0) partes.push(`${g.absent} ausente (${mesesDo(meses, "ausente")})`);
  if (g.outside > 0) partes.push(`${g.outside} fora do exercício (${mesesDo(meses, "fora_do_exercicio")}), sem marca de falta e fora da conta`);
  const primeiro = meses[0]?.mes;
  const ultimo = meses[meses.length - 1]?.mes;
  const periodo = primeiro && ultimo ? `, de ${MESES[primeiro - 1]} a ${MESES[ultimo - 1]} de ${g.year}` : ` de ${g.year}`;
  return `${g.sessions.length} sessões de votação${periodo}, uma marca por sessão: ${partes.join(", ")}`;
}

export function GradePresenca({ grade }: { grade: AttendanceGrid }) {
  const meses = porMes(grade);
  return (
    <>
      <div className="sv-pr" role="img" aria-label={descreverGrade(grade)}>
        {meses.map((m) => {
          const tudoFora = m.sessoes.every((s) => s === "fora_do_exercicio");
          return (
            <span className="sv-pr__m" key={m.mes}>
              <span className="sv-pr__ms">
                {m.sessoes.map((s, i) => (
                  <i key={i} className={CLASSE[s] || undefined} />
                ))}
              </span>
              <span className="sv-pr__l">
                {MESES_ABREV[m.mes - 1]}
                {tudoFora ? " · fora" : ""}
              </span>
            </span>
          );
        })}
      </div>
      <p className="sv-leg">
        <span>
          <i className="sv-pk" aria-hidden="true" />
          presente: {grade.present}
        </span>
        <span>
          <i className="sv-pk sv-pk--j" aria-hidden="true" />
          ausência justificada: {grade.justified}
        </span>
        <span>
          <i className="sv-pk sv-pk--au" aria-hidden="true" />
          ausente: {grade.absent}
        </span>
        <span>de {grade.total} sessões na conta</span>
        <span>
          <i className="sv-pk sv-pk--fx" aria-hidden="true" />
          fora do exercício: {grade.outside}, sem marca de falta e fora da conta
        </span>
      </p>
    </>
  );
}
