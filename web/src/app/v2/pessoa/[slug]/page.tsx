import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FOLLOW_COOKIE, parseFollows } from "@/components/sv/follow-shared";
import { FollowButton } from "@/components/sv/follow";
import { fmtDate, fmtDateTime, fmtInt } from "@/components/sv/fmt";
import { Lacuna, Nota, Resposta, Selo } from "@/components/sv/ui";
import { SEM_DADO } from "@/components/sv/estados";
import { COOKIE_TEXTO } from "@/components/sv/prefs-shared";
import { aguardaPosse, casaDoMandato, cobreLeis, fraseDesde, mandatoPrincipal, motivoPosse, rotuloGastos } from "@/components/sv/mandato";
import { brl, brlCurto, fonteTexto, hojeBR, ler, listaE, mesAno, statusLacuna } from "@/components/sv/pessoa/format";
import { GradePresenca } from "@/components/sv/pessoa/presenca";
import {
  Declaracoes,
  Falha,
  Linha,
  ListaVotos,
  RespostaEmendas,
  Sem,
  TabelaGastos,
  comissoesAtuais,
  fraseMudou,
  frasesPresenca,
  mesDoMandato,
  vmCampanha,
  vmEmendas,
  vmGastos,
  vmPatrimonio,
} from "@/components/sv/pessoa/secoes";
import { data, type AttendanceGrid, type OfficeSlug, type Stamp } from "@/lib/data";

const SLUG = /^[a-z0-9-]{1,120}$/;
// cache(): generateMetadata e a página leem a mesma pessoa numa só ida ao banco por requisição
const load = cache((slug: string) => (SLUG.test(slug) ? data.getPerson(slug) : Promise.resolve(null)));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const r = await load((await params).slug);
  return { title: r ? r.person.displayName : "Pessoa não encontrada" };
}

// O que cada cargo decide, em uma frase. Texto próprio, escrito a partir da Constituição Federal.
const ROLE: Record<OfficeSlug, string> = {
  presidente: "Chefia o governo federal, propõe o orçamento da União e sanciona ou veta as leis aprovadas pelo Congresso.",
  vice_presidente: "Substitui o presidente quando ele está fora ou impedido.",
  senador: "Vota leis federais, julga autoridades e aprova indicações do presidente. São três por estado.",
  deputado_federal: "Vota leis federais e o orçamento da União, e fiscaliza o governo federal.",
  governador: "Chefia o governo do estado, propõe o orçamento estadual e sanciona ou veta as leis estaduais.",
  vice_governador: "Substitui o governador quando ele está fora ou impedido.",
  deputado_estadual: "Vota leis e o orçamento do estado, e fiscaliza o governo estadual.",
  deputado_distrital: "Vota leis e o orçamento do Distrito Federal, e fiscaliza o governo distrital.",
  prefeito: "Chefia a prefeitura, propõe o orçamento da cidade e sanciona ou veta as leis municipais.",
  vice_prefeito: "Substitui o prefeito quando ele está fora ou impedido.",
  vereador: "Vota as leis e o orçamento da cidade, e fiscaliza a prefeitura.",
};

// Esfera em palavra, sem estilo próprio: "Esfera: Federal · Câmara dos Deputados".
const ESFERA: Record<OfficeSlug, string> = {
  presidente: "Federal · Presidência da República",
  vice_presidente: "Federal · Presidência da República",
  senador: "Federal · Senado Federal",
  deputado_federal: "Federal · Câmara dos Deputados",
  governador: "Estadual · Governo do estado",
  vice_governador: "Estadual · Governo do estado",
  deputado_estadual: "Estadual · Assembleia Legislativa",
  deputado_distrital: "Distrital · Câmara Legislativa",
  prefeito: "Municipal · Prefeitura",
  vice_prefeito: "Municipal · Prefeitura",
  vereador: "Municipal · Câmara Municipal",
};

// Cargos do Executivo não votam em plenário nem têm cota de gabinete de casa legislativa: a lacuna diz isso, não "não gastou".
const EXECUTIVO = new Set<OfficeSlug>(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
const MOTIVO_PLENARIO = "Este cargo não vota em sessões de plenário.";
const MOTIVO_COTA = "A cota de gabinete é verba de casa legislativa. Este cargo não a recebe.";

const STATUS_LABEL: Record<string, string> = { eleito_aguardando_posse: "eleito, aguardando posse", licenciado: "licenciado", afastado: "afastado", encerrado: "mandato encerrado", renunciou: "renunciou", cassado: "cassado" };
const FONTE_MANDATO: Record<string, string> = { tse: "TSE (Justiça Eleitoral)", camara: "Câmara dos Deputados", senado: "Senado Federal" };

export default async function Pessoa({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await load(slug);
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/v2/pessoa/${r.redirectTo}`);
  const person = r.person;
  const id = person.id;

  const follows = parseFollows((await cookies()).get(FOLLOW_COOKIE)?.value);
  const votou = follows.includes(slug);

  const hoje = hojeBR();
  const hojeIso = `${hoje.ano}-${String(hoje.mes).padStart(2, "0")}-${String(hoje.dia).padStart(2, "0")}`;

  const mandatosR = await ler(data.getMandates(id));
  const mandates = mandatosR.ok ? mandatosR.v : [];
  const main = mandatoPrincipal(mandates);
  // quem ainda não tomou posse não tem presença, gastos nem votos no cargo: lacuna com este motivo
  const posse = main && aguardaPosse(main) ? motivoPosse(main) : null;
  const office = main?.office ?? null;
  const legis = !office || !EXECUTIVO.has(office);
  const body = office === "deputado_federal" ? "camara" : office === "senador" ? "senado" : null;

  const stampDe = (ds: string | null): Promise<Stamp | null> => (ds ? data.getStamp(ds).catch(() => null) : Promise.resolve(null));

  // Presença e gastos: o ano corrente; se ele ainda está vazio (início de ano, recesso), o anterior. A tela diz qual ano é.
  const grade = async (): Promise<AttendanceGrid> => {
    const g = await data.getAttendanceGrid(id, hoje.ano);
    if (g.sessions.length > 0) return g;
    const g2 = await data.getAttendanceGrid(id, hoje.ano - 1);
    return g2.sessions.length > 0 ? g2 : g;
  };
  const gastos = async () => {
    const e = await data.listExpenses(id, { year: hoje.ano, limit: 1 });
    if (e.byCategory.length > 0) return { ano: hoje.ano, byCategory: e.byCategory };
    const e2 = await data.listExpenses(id, { year: hoje.ano - 1, limit: 1 });
    return { ano: e2.byCategory.length > 0 ? hoje.ano - 1 : hoje.ano, byCategory: e2.byCategory.length > 0 ? e2.byCategory : e.byCategory };
  };

  const [stats, gradeR, gastosR, cands, votes, laws, staff, campanha, emendas, comissoes, place, salarioFontes, refresh, sPres, sGastos, sVotos, sProp, sEquipe, sExtras, sBens, sContas, sEmendas, outros] = await Promise.all([
    ler(data.getStats(id, "career")),
    legis ? ler(grade()) : null,
    legis ? ler(gastos()) : null,
    ler(data.getCandidacies(id)),
    legis ? ler(data.listVotes(id, { scope: "lei", limit: 3 })) : null,
    ler(data.getLaws(id)),
    ler(data.listStaff(id)),
    ler(data.getCampaignFinance(id)),
    ler(data.listAmendmentsByPerson(id)),
    ler(data.getCommittees(id)),
    main ? ler(data.getPlace(main.placeIbge)) : null,
    main ? ler(data.getSalarySources(main.office)) : null,
    ler(data.latestRefresh()),
    stampDe(body === "camara" ? "camara.presenca" : body === "senado" ? "senado.votacoes" : null),
    stampDe(body ? `${body}.despesas` : null),
    stampDe(body ? `${body}.votacoes` : null),
    stampDe(body === "camara" ? "camara.proposicoes" : body === "senado" ? "senado.autorias" : null),
    stampDe(body === "camara" ? "camara.equipe" : null),
    stampDe("parlamento.extras"),
    stampDe("tse.bens"),
    stampDe("tse.contas"),
    stampDe("transparencia.emendas"),
    Promise.all(follows.filter((s) => s !== slug).map((s) => ler(data.getPerson(s)))),
  ]);

  const missing = stats.ok ? stats.v.missing : [];
  const lugar = place && place.ok ? place.v : null;
  const ufSigla = lugar?.uf ?? null;
  const ufNome = lugar?.kind === "uf" ? lugar.name : null;
  const fem = person.gender === "f";
  const fontesUsadas = new Set<string>();
  const usa = (s: Stamp | null) => {
    if (s && new Date(s.refreshedAt).getFullYear() >= 2000) fontesUsadas.add(s.source);
    return s;
  };
  // casa do mandato, citada como fonte quando o dado apareceu sem carimbo de leitura (fora da esfera federal)
  const casa = main ? casaDoMandato(main.office, ufSigla, main.placeLabel) : null;
  const F = (rotulo: string, s: Stamp | null, temDado = false) => `Fonte: ${fonteTexto(rotulo, usa(s), temDado ? casa : null)}.`;
  const consta: string[] = [];
  const naoConsta: string[] = [];
  const naoLido: string[] = []; // leitura que falhou: não entra em "Não consta"
  const marca = (tem: boolean, rotulo: string, falhou = false) => (tem ? consta : falhou ? naoLido : naoConsta).push(rotulo);
  const rotGastos = rotuloGastos(office);

  // ---------- cabeçalho ----------
  const partido = main ? (main.party.name && main.party.name !== main.party.acronym ? `${main.party.acronym} (${main.party.name})` : main.party.acronym) : null;
  const cargoLinha = main ? [main.officeName, ufSigla ?? main.placeLabel, partido, fraseDesde(main, fem)].filter(Boolean).join(" · ") : null;

  // ---------- 1. presença ----------
  const g = !posse && gradeR && gradeR.ok && gradeR.v.sessions.length > 0 ? gradeR.v : null;
  marca(!!g, "presença", !!gradeR && !gradeR.ok);
  const stPres = statusLacuna(missing, "presenca");
  // ---------- 2. gastos ----------
  const vmG = !posse && gastosR && gastosR.ok ? vmGastos(gastosR.v.byCategory, gastosR.v.ano) : null;
  marca(!!vmG, "gastos do gabinete", !!gastosR && !gastosR.ok);
  const stGastos = statusLacuna(missing, "gastos_gabinete");
  // ---------- 3. patrimônio ----------
  const vmP = cands.ok ? vmPatrimonio(cands.v) : null;
  marca(!!vmP, "bens declarados", !cands.ok);
  const anosP = vmP ? listaE(vmP.linhas.map((l) => String(l.ano))) : "";
  // ---------- 4. votos ----------
  const temVotos = !posse && !!votes && votes.ok && votes.v.items.length > 0;
  marca(temVotos, "votos", !!votes && !votes.ok);
  const stVotos = statusLacuna(missing, "votos");
  // ---------- 5. salário ----------
  const salario = stats.ok ? stats.v.salaryMonthlyCents : null;
  marca(salario !== null, "salário", !stats.ok);
  const fontesSal = salarioFontes && salarioFontes.ok ? salarioFontes.v : [];
  const dataSal = fontesSal.map((s) => s.updatedAt).sort().at(-1) ?? null;
  // ---------- 6. equipe ----------
  const nEquipe = staff.ok ? staff.v.length : 0;
  marca(nEquipe > 0, "equipe", !staff.ok);
  // ---------- 7. propostas ----------
  const principal = stats.ok ? stats.v.proposalsPrincipal : null;
  const coassinadas = stats.ok ? stats.v.proposalsCosigned : null;
  marca(principal !== null, "propostas", !stats.ok);
  const stProp = statusLacuna(missing, "propostas");
  // só lemos leis sancionadas de deputado federal e senador: fora disso (ou se a leitura falhou) não há frase sobre leis
  const nLeis = laws.ok && cobreLeis(office) ? laws.v.length : null;
  // ---------- 8. emendas ----------
  const vmE = emendas.ok ? vmEmendas(emendas.v, ufSigla, ufNome) : null;
  marca(!!vmE, "emendas", !emendas.ok);
  // ---------- 9. campanha ----------
  const vmC = campanha.ok ? vmCampanha(campanha.v) : null;
  marca(!!vmC, "contas de campanha", !campanha.ok);
  // ---------- 10. comissões ----------
  const atuais = comissoes.ok ? comissoesAtuais(comissoes.v, hojeIso) : [];
  const temComissoes = comissoes.ok && comissoes.v.length > 0;
  marca(temComissoes, "comissões", !comissoes.ok);
  // ---------- 11. promessas: sempre lacuna ----------
  naoConsta.push("o que prometeu");
  // ---------- 12. mês do mandato ----------
  const mes = main && main.status === "em_exercicio" ? mesDoMandato(main.startedOn, main.endsOn, hoje) : null;

  const lidoEm = refresh.ok ? refresh.v : null;
  const outras = outros
    .flatMap((o) => (o.ok && o.v && !o.v.redirectTo ? [o.v.person] : []))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  const fonteMandato = main ? (FONTE_MANDATO[main.statusSource] ?? "fonte oficial do mandato") : "";

  return (
    <div className="sv-pg sv-pg--pessoa">
      <div className="sv-cab">
        <p className="sv-vt">
          <Link href="/v2/acompanhando">
            <span aria-hidden="true">←</span>&nbsp;Voltar a Escolhidos
          </Link>
        </p>
        {votou && <p className="sv-cab__k">Você votou em</p>}
        <h1>{person.displayName}</h1>
        {cargoLinha ? (
          <p className="sv-cab__c">{cargoLinha}</p>
        ) : mandatosR.ok ? (
          <Lacuna>Não consta mandato carregado para esta pessoa.</Lacuna>
        ) : (
          <Lacuna>Não conseguimos ler o mandato agora.</Lacuna>
        )}
        {main && main.status !== "em_exercicio" && <p className="sv-cab__k">Situação do mandato: {STATUS_LABEL[main.status] ?? main.status.replaceAll("_", " ")}</p>}
        {main && <p className="sv-cab__k">Esfera: {ESFERA[main.office]}</p>}
        {main && (
          <p className="sv-cab__x">
            {ROLE[main.office]} <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
          </p>
        )}
        <div className="sv-cab__f">
          <FollowButton slug={person.slug} name={person.displayName} />
        </div>
        <p className="sv-ir">
          Ir para: <a href="#gastos">gastos do gabinete</a> <a href="#patrimonio">patrimônio</a>
        </p>
      </div>

      {/* 1 */}
      <Linha id="p1" numero={1} dom ancora="trabalho" pergunta="Foi trabalhar?" fonte={F(body === "senado" ? "votações nominais" : "presença em sessões de votação", sPres, !!g)}>
        {g ? (
          <>
            <div className="sv-bloco">
              <Resposta tamanho="r">{frasesPresenca(g).r}</Resposta>
              <p className="sv-t">{frasesPresenca(g).t}</p>
            </div>
            <div className="sv-bloco">
              <GradePresenca grade={g} />
              <Nota>Meses fora do exercício não contam.</Nota>
              <p>
                <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
              </p>
            </div>
          </>
        ) : posse ? (
          <Sem motivo={posse} />
        ) : gradeR && !gradeR.ok ? (
          <Falha />
        ) : (
          <Sem status={stPres.status} motivo={!legis ? MOTIVO_PLENARIO : stPres.motivo} />
        )}
      </Linha>

      {/* 2 */}
      <Linha id="p2" numero={2} dom ancora="gastos" pergunta="Quanto gastou o gabinete?" fonte={F(rotGastos, sGastos, !!vmG)}>
        {vmG ? (
          <>
            <div className="sv-bloco">
              <Resposta tamanho="r">
                {brlCurto(vmG.total)} em {vmG.ano}.
              </Resposta>
              <p className="sv-t">É verba pública para as despesas do mandato.</p>
              <p className="sv-selo__l">
                <Link href={`/p/${person.slug}#gastos`}>Ver nota por nota</Link>
              </p>
            </div>
            <div className="sv-bloco">
              <TabelaGastos vm={vmG} />
              <Nota>
                <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo> Categorias em ordem alfabética.
              </Nota>
            </div>
          </>
        ) : posse ? (
          <Sem motivo={posse} />
        ) : gastosR && !gastosR.ok ? (
          <Falha />
        ) : (
          <Sem status={stGastos.status} motivo={!legis ? MOTIVO_COTA : (stGastos.motivo ?? (body === "senado" ? "O Senado tem verba própria, com outra fonte." : null))} />
        )}
      </Linha>

      {/* 3 */}
      <Linha
        id="p3"
        numero={3}
        dom
        ancora="patrimonio"
        pergunta="O patrimônio declarado mudou?"
        fonte={F(vmP ? `bens declarados nas candidaturas de ${anosP}` : "bens declarados nas candidaturas", sBens)}
      >
        {vmP ? (
          <>
            <div className="sv-bloco">
              <Resposta tamanho="r">{fraseMudou(vmP)}</Resposta>
              <p className="sv-t">É o que a própria pessoa declarou à Justiça Eleitoral ao se candidatar. A declaração é de bens, não de renda. Aumento não quer dizer irregularidade.</p>
            </div>
            <div className="sv-bloco">
              <Declaracoes vm={vmP} />
              <Nota>Valores como declarados, sem correção pela inflação.</Nota>
              <p>
                <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
              </p>
            </div>
          </>
        ) : !cands.ok ? (
          <Falha />
        ) : (
          <Sem status={statusLacuna(missing, "patrimonio").status} motivo={statusLacuna(missing, "patrimonio").motivo} />
        )}
      </Linha>

      {/* 4 */}
      <Linha id="p4" numero={4} pergunta="Como votou?" fonte={F("votações nominais", sVotos, temVotos)}>
        {temVotos && votes && votes.ok ? (
          <div className="sv-bloco">
            <ListaVotos itens={votes.v.items} />
            <p className="sv-t">
              Mostrando {votes.v.items.length} de {fmtInt(votes.v.total)} {votes.v.total === 1 ? "voto" : "votos"} em leis, do mais recente para o mais antigo.
            </p>
            <p className="sv-selo__l">
              <Link href={`/p/${person.slug}#votos`}>Ver todos os votos</Link>
            </p>
          </div>
        ) : posse ? (
          <Sem motivo={posse} />
        ) : votes && !votes.ok ? (
          <Falha />
        ) : (
          <Sem status={stVotos.status} motivo={!legis ? MOTIVO_PLENARIO : stVotos.motivo} />
        )}
      </Linha>

      {/* 5 */}
      <Linha
        id="p5"
        numero={5}
        pergunta="Quanto recebe?"
        fonte={
          fontesSal.length > 0 ? (
            <>
              Fonte:{" "}
              {fontesSal.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ", "}
                  <a href={s.url} rel="noopener noreferrer">
                    {s.name}
                  </a>
                </span>
              ))}
              , lida em {fmtDate(dataSal)}.
            </>
          ) : (
            "Fonte: norma do subsídio do cargo, ainda não carregada."
          )
        }
      >
        {salario !== null && stats.ok ? (
          <div className="sv-bloco">
            <Resposta tamanho="m">
              {stats.v.salaryIsCeiling ? "Até " : ""}
              {brl(salario)} por mês, antes dos descontos.
            </Resposta>
            {stats.v.salaryIsCeiling && <p className="sv-t">É o teto do cargo, não o valor pago.</p>}
          </div>
        ) : !stats.ok ? (
          <Falha />
        ) : (
          <Sem status={statusLacuna(missing, "salario").status} motivo={statusLacuna(missing, "salario").motivo} />
        )}
      </Linha>

      {/* 6 */}
      <Linha id="p6" numero={6} pergunta="Quem trabalha no gabinete?" fonte={F("pessoal do gabinete", sEquipe, nEquipe > 0)}>
        {nEquipe > 0 ? (
          <div className="sv-bloco">
            <Resposta tamanho="m">
              {fmtInt(nEquipe)} {nEquipe === 1 ? "pessoa" : "pessoas"}.
            </Resposta>
            <p className="sv-selo__l">
              <Link href={`/p/${person.slug}#equipe`}>Ver nomes e salários</Link>
            </p>
          </div>
        ) : !staff.ok ? (
          <Falha />
        ) : (
          <Sem />
        )}
      </Linha>

      {/* 7 */}
      <Linha id="p7" numero={7} pergunta="O que propôs?" fonte={F("propostas apresentadas", sProp, principal !== null)}>
        {principal !== null ? (
          <div className="sv-bloco">
            <Resposta tamanho="m">
              {fmtInt(principal)} {principal === 1 ? "proposta" : "propostas"} como {fem ? "autora" : "autor"} principal
              {coassinadas !== null ? ` e ${fmtInt(coassinadas)} em coautoria` : ""}.
            </Resposta>
            {nLeis !== null && <p className="sv-t">{nLeis > 0 ? `${fmtInt(nLeis)} ${nLeis === 1 ? "virou lei" : "viraram lei"}.` : "Nenhuma virou lei entre as que lemos."}</p>}
          </div>
        ) : !stats.ok ? (
          <Falha />
        ) : (
          <Sem status={stProp.status} motivo={stProp.motivo} />
        )}
      </Linha>

      {/* 8 */}
      <Linha
        id="p8"
        numero={8}
        pergunta={ufNome ? `Mandou dinheiro para ${ufNome}?` : "Mandou dinheiro por emendas?"}
        fonte={F(vmE ? `emendas parlamentares de ${vmE.ano}` : "emendas parlamentares", sEmendas)}
      >
        {vmE ? <RespostaEmendas vm={vmE} /> : !emendas.ok ? <Falha /> : <Sem />}
      </Linha>

      {/* 9 */}
      <Linha
        id="p9"
        numero={9}
        pergunta={vmC ? `De onde veio o dinheiro da campanha de ${vmC.ano}?` : "De onde veio o dinheiro da campanha?"}
        fonte={F(vmC ? `contas de campanha de ${vmC.ano}` : "contas de campanha", sContas)}
      >
        {vmC ? (
          <div className="sv-bloco">
            <Resposta tamanho="m">
              {brlCurto(vmC.total)} no total.
              {vmC.origemCarregada && (vmC.publico > 0 ? ` ${brlCurto(vmC.publico)} veio de ${listaE(vmC.fundos)}, que é dinheiro público.` : " Nenhum valor veio dos fundos públicos (Fundo Eleitoral e Fundo Partidário).")}
            </Resposta>
            {vmC.origemCarregada ? (
              <table className="sv-g sv-g--s">
                <caption className="sv-vh">Origem dos recursos da campanha de {vmC.ano}, na ordem fixa da fonte</caption>
                <thead className="sv-vh">
                  <tr>
                    <th scope="col">Origem</th>
                    <th scope="col">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {vmC.origens.map((o) => (
                    <tr key={o.label}>
                      <th scope="row">{o.label}</th>
                      <td>{brl(o.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Lacuna>A origem dos recursos ainda não foi carregada.</Lacuna>
            )}
            <Nota>Só o total e a origem. Nomes de pessoas físicas que doaram não são publicados aqui.</Nota>
          </div>
        ) : !campanha.ok ? (
          <Falha />
        ) : (
          <Sem />
        )}
      </Linha>

      {/* 10 */}
      <Linha id="p10" numero={10} pergunta="Em que comissões está?" fonte={F("comissões", sExtras, temComissoes)}>
        {atuais.length > 0 ? (
          <div className="sv-bloco">
            <Resposta tamanho="m">{atuais.length === 1 ? "Uma comissão." : `${fmtInt(atuais.length)} comissões.`}</Resposta>
            <ul className="sv-t">
              {atuais.map((c) => (
                <li key={`${c.body}-${c.name}-${c.from}`}>
                  {c.name} ({c.role.toLowerCase()})
                </li>
              ))}
            </ul>
          </div>
        ) : temComissoes ? (
          <div className="sv-bloco">
            <p className="sv-t">Nenhuma comissão com participação atual na fonte.</p>
          </div>
        ) : !comissoes.ok ? (
          <Falha />
        ) : (
          <Sem />
        )}
      </Linha>

      {/* 11 */}
      <Linha id="p11" numero={11} pergunta="O que prometeu?" fonte={`Leitura das fontes: ${lidoEm ? fmtDateTime(lidoEm) : "data não registrada"}.`}>
        <div className="sv-bloco">
          <Lacuna motivo="As casas legislativas publicam votos e presença, não promessas.">{SEM_DADO}</Lacuna>
        </div>
      </Linha>

      {/* 12 */}
      <Linha
        id="p12"
        numero={12}
        pergunta="Falta muito do mandato?"
        fonte={
          main
            ? `Mandato de ${mesAno(main.startedOn)} a ${mesAno(main.endsOn)}, conforme ${fonteMandato}. Conta feita em ${fmtDate(hojeIso)}.`
            : mandatosR.ok
              ? "Sem mandato carregado."
              : "Não conseguimos ler o mandato agora."
        }
      >
        {mes ? (
          <p className="sv-t">
            {mes.nome} é o{" "}
            <span className="sv-agora">
              mês {mes.n} de {mes.m}
            </span>
            .
          </p>
        ) : !mandatosR.ok ? (
          <Falha />
        ) : (
          <div className="sv-bloco">
            <Lacuna motivo={posse ?? "O mandato não está em exercício, ou as datas não constam na fonte."}>Sem conta do tempo de mandato.</Lacuna>
          </div>
        )}
      </Linha>

      {/* o que consta */}
      <section className="sv-l3 sv-l3--dom" aria-labelledby="p13">
        <h2 className="sv-p" id="p13">
          O que consta e o que não consta?
        </h2>
        <ul className="sv-voltas">
          <li>
            <b>Consta:</b> {consta.length > 0 ? `${listaE(consta)}.` : "nada carregado para esta pessoa."}
          </li>
          <li>
            <b>Não consta:</b> {naoConsta.length > 0 ? `${listaE(naoConsta)}.` : "nada faltou."}
          </li>
          {naoLido.length > 0 && (
            <li>
              <b>Não conseguimos ler agora:</b> {listaE(naoLido)}.
            </li>
          )}
        </ul>
        <p className="sv-fonte">
          Leitura das fontes: {lidoEm ? fmtDateTime(lidoEm) : "data não registrada"}.{fontesUsadas.size > 0 ? ` Fontes usadas: ${listaE([...fontesUsadas].sort((a, b) => a.localeCompare(b, "pt-BR")))}.` : ""}
        </p>
      </section>

      <Selo lidoEm={lidoEm} />

      {outras.length > 0 && (
        <Linha id="p15" pergunta="E as outras pessoas em quem votei?" fonte={`Pessoas em ordem alfabética. ${COOKIE_TEXTO}`}>
          <p className="sv-selo__l">
            {outras.map((p) => (
              <Link key={p.slug} href={`/v2/pessoa/${p.slug}`}>
                Ver {p.displayName}
              </Link>
            ))}
          </p>
        </Linha>
      )}
    </div>
  );
}
