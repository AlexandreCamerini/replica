import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { fmtInt } from "@/components/sv/fmt";
import { ESFERA } from "@/components/sv/pessoa/cargos";
import { carregarPessoa, contextoPessoa, inteiroPositivo, MOTIVO_PLENARIO } from "@/components/sv/pessoa/contexto";
import { ler, statusLacuna } from "@/components/sv/pessoa/format";
import { Falha, Linha, ListaVotos, Sem, SemCobertura } from "@/components/sv/pessoa/secoes";
import { CabecalhoSub, Paginacao } from "@/components/sv/pessoa/sub";
import { Lacuna, Nota, Selo } from "@/components/sv/ui";
import { data, type VoteScope } from "@/lib/data";

// Lista completa dos votos nominais da pessoa, do mais recente para o mais antigo. Padrão "só o que muda lei" (D265:
// esconde requerimento e urgência por voting_events.kind); "tudo" mostra todas. Voto = forma + palavra (VotoMarca).

const POR = 50;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await carregarPessoa((await params).slug);
  return { title: r ? `Votos · ${r.person.displayName}` : "Pessoa não encontrada" };
}

export default async function VotosPessoa({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await carregarPessoa(slug);
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/pessoa/${r.redirectTo}/votos`);
  const ctx = await contextoPessoa(r.person);
  const id = ctx.person.id;
  const scope: VoteScope = sp.tipo === "tudo" ? "tudo" : "lei";
  const pagina = inteiroPositivo(sp.pagina) ?? 1;

  const [votes, sVotos, stats, refresh] = await Promise.all([
    ctx.legis && !ctx.posse ? ler(data.listVotes(id, { scope, limit: POR, cursor: String((pagina - 1) * POR) })) : Promise.resolve(null),
    ctx.stampDe(ctx.body ? `${ctx.body}.votacoes` : null),
    ler(data.getStats(id, "career")),
    ler(data.latestRefresh()),
  ]);
  const st = statusLacuna(stats.ok ? stats.v.missing : [], "votos");
  const v = votes && votes.ok ? votes.v : null;
  // "tem voto": no recorte pedido ou escondido por ele (procedimento)
  const temVoto = !!v && v.total + v.hidden > 0;
  const base = `/pessoa/${ctx.person.slug}/votos`;
  const esfera = ctx.main ? ESFERA[ctx.main.office] : null;
  const fonte = ctx.fonteConjunto("votos", "votações nominais", sVotos, temVoto);
  const ultima = v ? Math.max(1, Math.ceil(v.total / POR)) : 1;

  return (
    <div className="sv-pg sv-pg--pessoa">
      <CabecalhoSub ctx={ctx} titulo={`Votos de ${ctx.person.displayName}`} esfera={esfera} />

      <Linha id="v1" numero={1} pergunta="Como votou?" fonte={fonte}>
        {temVoto && v ? (
          <div className="sv-bloco">
            <nav className="sv-escopo" aria-label="Que votações mostrar">
              <Link href={base} aria-current={scope === "lei" ? "page" : undefined}>
                Só o que muda lei
              </Link>
              <Link href={`${base}?tipo=tudo`} aria-current={scope === "tudo" ? "page" : undefined}>
                Tudo
              </Link>
            </nav>
            <p className="sv-t">
              {scope === "lei"
                ? `Só o que muda lei: esconde as votações de procedimento (requerimento e urgência), que decidem o andamento e não o texto.${v.hidden > 0 ? ` ${fmtInt(v.hidden)} ${v.hidden === 1 ? "votação de procedimento está escondida" : "votações de procedimento estão escondidas"}.` : ""}`
                : "Tudo: todas as votações nominais lidas, inclusive as de procedimento (requerimento e urgência)."}
            </p>
            {v.items.length > 0 ? (
              <>
                <ListaVotos itens={v.items} marcarProcedimento={scope === "tudo"} />
                <Paginacao base={base} params={{ tipo: scope === "tudo" ? "tudo" : null }} pagina={pagina} por={POR} total={v.total} nome={{ um: "voto", varios: "votos" }} ordem="do mais recente para o mais antigo" />
              </>
            ) : v.total === 0 ? (
              <Lacuna motivo="Há votos só em votações de procedimento.">Nenhum voto em votação que muda lei.</Lacuna>
            ) : (
              <>
                <Lacuna motivo={`Há ${fmtInt(v.total)} ${v.total === 1 ? "voto" : "votos"} neste recorte, em ${fmtInt(ultima)} ${ultima === 1 ? "página" : "páginas"}.`}>Esta página da lista não existe.</Lacuna>
                <p className="sv-selo__l">
                  <Link href={scope === "tudo" ? `${base}?tipo=tudo` : base}>Voltar à primeira página</Link>
                </p>
              </>
            )}
            <Nota>
              <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo> Cada voto leva à página da votação, com o placar.
            </Nota>
          </div>
        ) : ctx.posse ? (
          <Sem motivo={ctx.posse} />
        ) : votes && !votes.ok ? (
          <Falha />
        ) : (
          <SemCobertura cob={ctx.cob("votos")} oQue="voto nominal" status={st.status} motivo={!ctx.legis ? MOTIVO_PLENARIO : st.motivo} />
        )}
      </Linha>

      <Selo lidoEm={refresh.ok ? refresh.v : null} />
    </div>
  );
}
