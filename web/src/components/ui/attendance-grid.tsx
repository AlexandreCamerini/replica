import type { AttendanceGrid as Grid, AttendanceState } from "@/lib/data";

// U08: a presença de cada sessão deliberativa em padrão de voto (nunca cor).
// cheio = presente · vazio = ausente · hachura = ausência justificada · pontilhado = fora do exercício (não é falta).
const PATTERN: Record<AttendanceState, { cls: string; word: string }> = {
  presente: { cls: "vS", word: "presente" },
  ausente: { cls: "vX", word: "ausente" },
  ausencia_justificada: { cls: "vN", word: "ausência justificada" },
  fora_do_exercicio: { cls: "vA", word: "fora do exercício" },
};

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function AttendanceGrid({ grid }: { grid: Grid }) {
  if (!grid.sessions.length) return null;
  return (
    <div data-testid="grade-presenca" className="mt-6">
      <h3 className="text-base font-semibold text-fg">Sessão por sessão em {grid.year}</h3>
      <p className="mt-1 text-sm text-fg" data-testid="grade-total">
        <span className="tabular font-semibold">{grid.present}</span> presenças em <span className="tabular font-semibold">{grid.total}</span> sessões deliberativas
        {grid.outside > 0 && <span className="text-muted"> · {grid.outside} fora do exercício, que não contam como falta</span>}
      </p>
      <ul role="list" aria-label={`Presença em cada sessão deliberativa de ${grid.year}`} className="mt-3 flex flex-wrap gap-1">
        {grid.sessions.map((s, i) => (
          <li key={`${s.date}-${i}`} className="leading-none">
            <span role="img" aria-label={`${br(s.date)}: ${PATTERN[s.state].word}`} title={`${br(s.date)}: ${PATTERN[s.state].word}`} className={`sq ${PATTERN[s.state].cls}`} />
          </li>
        ))}
      </ul>
      <ul role="list" aria-label="Legenda" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(Object.keys(PATTERN) as AttendanceState[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className={`sq ${PATTERN[k].cls}`} /> {PATTERN[k].word}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Cada quadrado é uma sessão, na ordem das datas. Sessão fora do exercício não entra na conta de presença.</p>
    </div>
  );
}
