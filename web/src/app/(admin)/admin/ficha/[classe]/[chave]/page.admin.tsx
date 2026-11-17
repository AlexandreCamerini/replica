import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, Navegacao, Selo } from "@/components/admin/blocos";
import { BotaoPedido } from "@/components/admin/botao-pedido";
import { FormDecisao } from "@/components/admin/form-decisao";
import { ErroLeituraBanco, ErroNaoEncontrado, ficha } from "@/lib/admin/consultas";
import { estadoDaFicha, mostrarValor } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { nomeDeMunicipio } from "@/lib/admin/nomes-geo";
import { acaoDaDecisao, motivoDaReabertura, nomeDaClasse, nomeDoTerritorio, quemDecidiu, statusDoPedido, tipoDaPendencia } from "@/lib/admin/rotulos";
import { operadorAtual } from "@/lib/admin/sessao";
import { dataComRelativo } from "@/lib/admin/tempo";
import { TEXTO_MOTIVO, type MotivoSemMapa } from "@/lib/admin/tipos";

export const dynamic = "force-dynamic";

type Reg = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === "string" && v !== "" ? v : "não informado");
const decodifica = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export default async function PaginaFicha({ params }: { params: Promise<{ classe: string; chave: string }> }) {
  await exigirAdmin();
  const p = await params;
  const classe = decodifica(p.classe);
  const chave = decodifica(p.chave);
  try {
    const f = await ficha(classe, chave);
    const operador = await operadorAtual(); // quem decide é a sessão; a tela só mostra o nome
    const agora = new Date();
    const nomeMunicipio = f.territorio?.nivel === "municipio" ? await nomeDeMunicipio(f.territorio.ibge) : null;
    const territorio = f.territorio ? nomeDoTerritorio(f.territorio, nomeMunicipio) : null;
    const todasPropostas = f.campos.flatMap((c) => c.propostas as Reg[]);
    const semEvidencia = estadoDaFicha(todasPropostas) === "ficha_sem_evidencia";
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/fila" />
        <h1>{f.rotulo}</h1>
        <p className="adm-ajuda">
          {nomeDaClasse(f.classe)}. {territorio ? `Território: ${territorio}.` : `Sem território no mapa: ${f.motivoSemTerritorio ? TEXTO_MOTIVO[f.motivoSemTerritorio as MotivoSemMapa] ?? f.motivoSemTerritorio : "não resolvido"}`}
        </p>
        {f.fontes.length > 0 && <p className="adm-ajuda">Fontes vinculadas: {f.fontes.join(", ")}.</p>}

        <section className="adm-ensaio" aria-labelledby="adm-ensaio-t">
          <h2 id="adm-ensaio-t" className="stamp adm-selo">
            Parecer é ensaio
          </h2>
          <p className="adm-ajuda">Pareceres de IA são simulados e não aplicam nada. Decisão de pessoa só é registrada e aplicada pelo executor, depois do pedido.</p>
        </section>

        {semEvidencia && (
          <section className="adm-bloco" data-estado="ficha_sem_evidencia" aria-labelledby="adm-se-t">
            <h2 id="adm-se-t">Sem evidência válida</h2>
            <p>Nenhuma proposta desta ficha tem URL, trecho e hash juntos. A última falha de leitura e o motivo ficam no relatório da rodada que tentou a fonte.</p>
          </section>
        )}

        {f.campos.length === 0 && <p>Esta ficha não tem campos com valor, proposta ou pendência.</p>}
        {f.campos.map((c, i) => {
          const pend = c.pendencia as Reg | null;
          const aberta = pend !== null && pend.status === "aberta";
          const pendId = pend && typeof pend.id === "string" ? pend.id : null;
          const candidatos = [...new Set((c.propostas as Reg[]).map((pr) => pr.valor_candidato).filter((v) => v !== null && v !== undefined).map(mostrarValor))];
          return (
            <section key={c.campo} className="adm-bloco" aria-labelledby={`adm-campo-${i}`} data-campo={c.campo}>
              <h2 id={`adm-campo-${i}`}>Campo {c.campo}</h2>
              <p>
                Valor vigente: <strong>{mostrarValor(c.valorVigente)}</strong>
              </p>

              {pend && (
                <div>
                  <h3>Pendência</h3>
                  <p>Pergunta: {texto(pend.pergunta)}</p>
                  <p className="adm-ajuda">
                    {tipoDaPendencia(String(pend.tipo))}, {pend.status === "aberta" ? "aberta" : "decidida"}. Vence em {pend.vence_em ? dataComRelativo(pend.vence_em, agora) : "sem prazo"}.
                    {pend.reaberta === true && (
                      <>
                        {" "}
                        <Selo>Reaberta</Selo> {motivoDaReabertura(typeof pend.motivo_reabertura === "string" ? pend.motivo_reabertura : null)}
                      </>
                    )}
                  </p>
                </div>
              )}

              <h3>Propostas com evidência</h3>
              {(c.propostas as Reg[]).length === 0 && <p>Nenhuma proposta para este campo.</p>}
              <ul className="adm-lista">
                {(c.propostas as Reg[]).map((pr) => (
                  <li key={String(pr.id)} className="adm-item">
                    <p>
                      Hoje: <strong>{mostrarValor(pr.valor_vigente)}</strong>. Proposta: <strong>{mostrarValor(pr.valor_candidato)}</strong>.
                    </p>
                    <p className="adm-ajuda">
                      URL {texto(pr.url)}. Trecho: {texto(pr.trecho)}. Hash {texto(pr.conteudo_sha256)}. Lida em {dataComRelativo(pr.lida_em, agora)}; fonte declarou em {dataComRelativo(pr.fonte_declarada_em, agora)}.
                    </p>
                  </li>
                ))}
              </ul>

              <h3>Pareceres</h3>
              {(c.pareceres as Reg[]).length === 0 && <p>Nenhum parecer.</p>}
              <ul className="adm-lista">
                {(c.pareceres as Reg[]).map((pa) => (
                  <li key={String(pa.id)} className="adm-item" data-simulado={pa.simulado === true ? "true" : "false"}>
                    {pa.simulado === true && <Selo>Simulado</Selo>}{" "}
                    <span>
                      Parecer {texto(pa.modo)} ({texto(pa.modelo)}), {dataComRelativo(pa.criada_em, agora)}
                    </span>
                    <pre className="adm-codigo">{mostrarValor(pa.saida)}</pre>
                  </li>
                ))}
              </ul>

              <h3>Histórico de decisões</h3>
              {(c.decisoes as Reg[]).length === 0 && <p>Nenhuma decisão.</p>}
              <ul className="adm-lista">
                {(c.decisoes as Reg[]).map((d) => (
                  <li key={String(d.id)} className="adm-item">
                    {acaoDaDecisao(String(d.acao))} por {texto(d.decidido_por_nome)} ({quemDecidiu(String(d.decidido_por_tipo))}), {dataComRelativo(d.criada_em, agora)}.{" "}
                    {d.aplicada === true ? `Aplicada em ${dataComRelativo(d.aplicada_em, agora)}.` : "Não aplicada."} Justificativa: {texto(d.justificativa)}
                  </li>
                ))}
              </ul>

              <h3>Pedidos de decisão</h3>
              {(c.pedidosDecisao as Reg[]).length === 0 && <p>Nenhum pedido de decisão.</p>}
              <ul className="adm-lista">
                {(c.pedidosDecisao as Reg[]).map((pd) => (
                  <li key={String(pd.id)} className="adm-item">
                    {acaoDaDecisao(String(pd.acao))} por {texto(pd.por_nome)}: {statusDoPedido(String(pd.status))}
                    {pd.aplicar === true ? ", com pedido de aplicação" : ""}. {pd.erro ? `Erro do executor: ${texto(pd.erro)}.` : ""} ({dataComRelativo(pd.criado_em, agora)})
                  </li>
                ))}
              </ul>

              {aberta && pendId ? (
                <div>
                  <h3>Pedir decisão</h3>
                  <FormDecisao
                    pendenciaId={pendId}
                    operadorNome={operador.nome}
                    contexto={{ campo: c.campo, classe: f.classe, fichaRotulo: f.rotulo, territorio: territorio ?? "sem território no mapa", valorAtual: mostrarValor(c.valorVigente), candidatos }}
                  />
                  <h3>Pedir parecer</h3>
                  <BotaoPedido
                    rotulo="Pedir parecer"
                    endpoint="/admin/api/pedidos"
                    corpo={{ tipo: "parecer", parametros: { pendencia_id: pendId } }}
                    ajuda="Gera um parecer em modo ensaio (SIMULADO). Não aplica nada: as duas chaves dos agentes estão desligadas."
                  />
                </div>
              ) : pend ? (
                <p className="adm-ajuda">Pendência já decidida: sem ação aberta neste campo.</p>
              ) : null}
            </section>
          );
        })}
        <p>
          <Link href="/admin/fila" className="chip">
            Voltar à fila
          </Link>
        </p>
      </main>
    );
  } catch (e) {
    if (e instanceof ErroNaoEncontrado) notFound();
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin/fila" />
          <h1>Ficha</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
