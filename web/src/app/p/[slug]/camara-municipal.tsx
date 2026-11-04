import { ExternalLink } from "lucide-react";
import { Section } from "@/components/profile/ui";
import { SourceFooter } from "@/components/ui/data";
import type { CityCouncilInfo } from "@/lib/data";
import { count, date } from "@/lib/format";

// Vereador de câmara lida pelo SAPL (D126–D129): matérias, presença e votos como a câmara publica.
// Presença é a lista de quem estava: sem porcentagem, porque o SAPL não publica quantas sessões cada mandato deveria ter.
// Listas por data, nunca por desempenho.

export function CityCouncil({ info, f }: { info: CityCouncilInfo; f: boolean }) {
  const src = `SAPL · Câmara Municipal de ${info.city}`;
  const leg = info.legislature ? `${info.legislature}ª legislatura${info.legislatureStart ? ` (desde ${date(info.legislatureStart)})` : ""}` : "legislatura vigente";
  return (
    <Section id="camara-municipal" title={`Na Câmara Municipal de ${info.city}`} intro={`O que a câmara publica no SAPL sobre o mandato na ${leg}.`}>
      <ul className="flex flex-col divide-y divide-border" data-testid="sapl-itens">
        <li className="flex flex-col gap-1 py-3" data-dataset="propostas">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-fg">Projetos apresentados</h3>
            <p className="text-base tabular text-fg" data-testid="sapl-valor">
              {count(info.materias.principal)} como {f ? "primeira autora" : "primeiro autor"} · {count(info.materias.total - info.materias.principal)} como {f ? "coautora" : "coautor"}
            </p>
          </div>
          <p className="text-sm text-muted">Só projetos (indicação, requerimento e moção ficam fora), como a câmara registra no SAPL.</p>
          {info.materias.items.length > 0 && (
            <ol className="mt-2 flex flex-col gap-2">
              {info.materias.items.map((m) => (
                <li key={`${m.type}-${m.number}-${m.year}`} className="text-sm">
                  <span className="font-mono text-xs font-semibold text-fg">
                    {m.type} {m.number}/{m.year}
                  </span>
                  {m.presentedOn && <span className="ml-2 text-xs text-muted">{date(m.presentedOn)}</span>}
                  <span className="ml-2 text-xs text-muted">{m.principal ? (f ? "primeira autora" : "primeiro autor") : f ? "coautora" : "coautor"}</span>
                  <p className="text-fg">
                    {m.summary.slice(0, 220)}
                    {m.summary.length > 220 ? "…" : ""}{" "}
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-accent-text underline underline-offset-2">
                      ver no SAPL <ExternalLink aria-hidden className="size-3" />
                      <span className="sr-only">(abre em nova aba)</span>
                    </a>
                  </p>
                </li>
              ))}
            </ol>
          )}
          <SourceFooter source={src} href={info.baseUrl} updatedAt={info.loadedAt} />
        </li>
        <li className="flex flex-col gap-1 py-3" data-dataset="presenca">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-fg">Presença em sessões</h3>
            <p className="text-base tabular text-fg" data-testid="sapl-valor">
              {info.presence.sessions ? `na lista de ${count(info.presence.sessions)} ${info.presence.sessions === 1 ? "sessão" : "sessões"}` : <span aria-label="nenhum registro">—</span>}
            </p>
          </div>
          <p className="text-sm text-muted">
            {info.presence.sessions && info.presence.first && info.presence.last
              ? `Sessões de ${date(info.presence.first)} a ${date(info.presence.last)} em que o nome está na lista de presença. `
              : "O nome não aparece em nenhuma lista de presença registrada no SAPL. "}
            Sem porcentagem: o SAPL não publica quantas sessões cada mandato deveria ter (licença, suplência, posse).
          </p>
          <SourceFooter source={src} href={info.baseUrl} updatedAt={info.loadedAt} />
        </li>
        <li className="flex flex-col gap-1 py-3" data-dataset="votos">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-fg">Votos nominais</h3>
            <p className="text-base tabular text-fg" data-testid="sapl-valor">
              {info.votes ? count(info.votes.total) : <span aria-label="não registrado pela fonte">—</span>}
            </p>
          </div>
          {info.votes ? (
            <>
              <p className="text-sm text-muted">
                {info.votes.byValue.map((v) => `${v.label}: ${count(v.n)}`).join(" · ")}. Voto como a câmara escreve no SAPL.
              </p>
              {info.votes.items.length > 0 && (
                <ol className="mt-2 flex flex-col gap-1.5">
                  {info.votes.items.map((v, i) => (
                    <li key={i} className="text-sm text-fg">
                      <span className="font-semibold">{v.value}</span>
                      {v.votedAt && <span className="ml-2 text-xs text-muted">{date(v.votedAt)}</span>}
                      {v.description && <span className="block text-xs text-muted">{v.description.slice(0, 200)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">O SAPL da câmara não tem voto nominal registrado nesta legislatura.</p>
          )}
          <SourceFooter source={src} href={info.baseUrl} updatedAt={info.loadedAt} />
        </li>
      </ul>
    </Section>
  );
}
