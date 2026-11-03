import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";

export const metadata: Metadata = {
  title: "Metodologia e fontes",
  description: "De onde vêm os números, como contamos, o que o traço significa e como pedir correção ou resposta.",
};

const TOC = [
  { id: "neutralidade", label: "Neutralidade" },
  { id: "fontes", label: "Fontes oficiais" },
  { id: "presenca", label: "Como contamos a presença" },
  { id: "traco", label: "O traço (—) não é zero" },
  { id: "identidade", label: "Uma pessoa, várias fontes" },
  { id: "atualizacao", label: "Atualização" },
  { id: "s-priv", label: "Privacidade" },
  { id: "s-resposta", label: "Direito de resposta e correção" },
];

const link = "font-semibold text-accent-text underline underline-offset-2";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-32 border-t border-border pt-6">
      <h2 id={`${id}-h`} className="mb-3 font-display text-2xl text-fg">
        {title}
      </h2>
      <div className="flex max-w-[68ch] flex-col gap-3 text-base text-fg">{children}</div>
    </section>
  );
}

const OFFICIAL = [
  { name: "Câmara dos Deputados · Dados Abertos", href: "https://dadosabertos.camara.leg.br/", brings: "deputados, votações nominais, orientações, proposições, cota parlamentar" },
  { name: "Senado Federal · Dados Abertos", href: "https://www12.senado.leg.br/dados-abertos", brings: "senadores, votações abertas" },
  { name: "TSE · Dados Abertos", href: "https://dadosabertos.tse.jus.br/", brings: "candidaturas e eleitos, bens declarados, votos, prestação de contas" },
  { name: "IBGE · Localidades e malhas", href: "https://servicodados.ibge.gov.br/api/docs/localidades", brings: "regiões, estados, municípios e seus contornos" },
];

const LAWS = [
  { name: "Constituição Federal", href: "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm" },
  { name: "Lei de Acesso à Informação (Lei 12.527/2011)", href: "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12527.htm" },
  { name: "Lei Geral de Proteção de Dados (Lei 13.709/2018)", href: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" },
  { name: "Direito de resposta (Lei 13.188/2015)", href: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13188.htm" },
];

export default function Page() {
  return (
    <Container>
      <PageHeader
        title="Metodologia e fontes"
        lead="O que este site mostra, de onde vem cada número, como ele é contado e o que fazemos quando alguém discorda."
      />
      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Neste texto" className="lg:sticky lg:top-32 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {TOC.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="inline-flex min-h-9 items-center rounded-pill bg-surface-sunken px-3 text-sm font-semibold text-fg outline-none hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus lg:bg-transparent lg:px-0 lg:hover:bg-transparent lg:hover:underline"
                >
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-8">
          <Section id="neutralidade" title="Neutralidade">
            <p>
              Aqui não há nota, ranking, selo de “bom” ou “ruim”, nem cor por partido. Os números aparecem do mesmo jeito para
              qualquer pessoa, e as listas seguem ordem alfabética ou cronológica, nunca de “melhor” para “pior”.
            </p>
            <p>
              Também não resumimos um mandato em uma frase e não recomendamos voto. Quando um número pode ser lido de mais de uma
              forma (por exemplo, votar com ou contra o partido), descrevemos o que aconteceu e deixamos a conclusão com você.
            </p>
            <p>
              Cada bloco de dados traz a fonte e a data da última conferência. Se algo aparece sem isso, é um erro nosso:{" "}
              <Link href="/sugestoes?tipo=erro" className={link}>
                avise
              </Link>
              .
            </p>
          </Section>

          <Section id="fontes" title="Fontes oficiais">
            <p>
              Usamos só dados que órgãos públicos publicam em formato aberto. Não compramos base, não raspamos redes sociais e não
              aceitamos dado enviado por terceiros sem uma fonte oficial que o confirme.
            </p>
            <ul className="flex flex-col gap-3">
              {OFFICIAL.map((s) => (
                <li key={s.href} className="rounded-sm border border-border bg-surface p-3">
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className={link}>
                    {s.name}
                  </a>
                  <p className="text-sm text-muted">Traz: {s.brings}.</p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">Base legal e normas que seguimos:</p>
            <ul className="flex flex-col gap-1 text-sm">
              {LAWS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className={link}>
                    {l.name}
                  </a>
                </li>
              ))}
            </ul>
            <p>
              A lista de cada carga, com a data da última e o que ainda não cobrimos, está em{" "}
              <Link href="/atualizacoes" className={link}>
                Como atualizamos
              </Link>
              . Quais prefeituras e câmaras publicam o quê está em{" "}
              <Link href="/dados-abertos" className={link}>
                Quem publica dados
              </Link>
              .
            </p>
          </Section>

          <Section id="presenca" title="Como contamos a presença">
            <p>
              Nenhuma das duas casas publica uma “lista de chamada” pronta no formato aberto. Calculamos a presença a partir das
              votações nominais do Plenário.
            </p>
            <ul className="ml-5 flex list-disc flex-col gap-1.5">
              <li>
                <strong>Sessão</strong> é cada evento do Plenário em que houve votação nominal.
              </li>
              <li>
                <strong>Presente</strong> é quem registrou voto naquela votação, inclusive abstenção, obstrução e o artigo 17.
              </li>
              <li>
                <strong>Ausente</strong> é quem tinha mandato em exercício e não registrou voto.
              </li>
              <li>
                <strong>Fora do exercício</strong> é o período em que o mandato não estava em exercício (licença, por exemplo). As
                casas não publicam o histórico completo de licenças, então este recorte é uma aproximação, e dizemos isso no bloco.
              </li>
            </ul>
            <p>
              Votação secreta ou sem registro nominal não entra na conta. No Senado, a API por senador marca como secretas muitas
              votações que são abertas; por isso só contamos as que a casa publica como abertas, e a presença do Senado pode
              aparecer como “—” com o motivo.
            </p>
            <p>
              Votar na linha da orientação do partido considera só votações em que o partido orientou “sim” ou “não”, na data do
              voto.
            </p>
          </Section>

          <Section id="traco" title="O traço (—) não é zero">
            <p>
              Zero é um fato: a pessoa fez algo zero vezes. O traço (—) significa que a fonte não publica aquele dado, ou que ainda
              não o carregamos. Nunca trocamos um pelo outro.
            </p>
            <p>
              Todo traço vem com o motivo ao lado: “a câmara não publica em formato aberto”, “carga em andamento”, “só no portal do
              órgão”. Quando uma cidade não tem dados de uma área, a página dela lista o que falta e por quê.
            </p>
            <p>
              Valores com teto, como o salário de vereadores sem dado publicado, aparecem com “até” e a regra que gera o limite.
              Não somamos nem fazemos média com traços.
            </p>
          </Section>

          <Section id="identidade" title="Uma pessoa, várias fontes">
            <p>
              A mesma pessoa aparece com nome civil no TSE, nome parlamentar na Câmara e outro registro no Senado, às vezes com a
              data de nascimento diferente. Para juntar os registros seguimos uma ordem fixa: código da própria fonte, título de
              eleitor (só como chave interna, nunca publicado), nome civil com nascimento e, por último, a cadeira ocupada com
              nome parlamentar igual ou mesmo nascimento.
            </p>
            <p>
              Nunca juntamos duas pessoas só porque os nomes são parecidos. Na dúvida, o par fica numa fila de revisão e continua
              separado até alguém conferir. Se você achar duas páginas da mesma pessoa, ou uma página com dois mandatos de pessoas
              diferentes,{" "}
              <Link href="/sugestoes?tipo=erro" className={link}>
                conte para nós
              </Link>
              ; o endereço antigo passa a levar para o certo.
            </p>
          </Section>

          <Section id="atualizacao" title="Atualização">
            <p>
              Cada fonte é lida em um ritmo próprio e a data da última leitura aparece no topo do site e em cada bloco. Se uma
              fonte está mais atrasada do que o esperado, a tabela de{" "}
              <Link href="/atualizacoes" className={link}>
                Como atualizamos
              </Link>{" "}
              mostra “fora do prazo”. Quando a fonte fica fora do ar, mantemos o dado anterior com a data antiga, em vez de apagar.
            </p>
          </Section>

          <Section id="s-priv" title="Privacidade">
            <p>
              Os dados de quem ocupa cargo vêm de bases públicas e dizem respeito ao exercício do mandato. Não publicamos CPF,
              título de eleitor, endereço residencial, telefone pessoal, nem dados de familiares.
            </p>
            <p>Sobre você, que lê o site:</p>
            <ul className="ml-5 flex list-disc flex-col gap-1.5">
              <li>Navegar não exige conta. O que você digita na busca não é guardado nem enviado a ferramentas de análise.</li>
              <li>
                Criar conta pede só o e-mail, para mandar o código de acesso e o resumo de quem você acompanha. Dá para apagar a
                conta e tudo que ela guarda em uma tela.
              </li>
              <li>
                Mensagens enviadas em “Sugerir ou corrigir” guardam nome e e-mail apenas para responder, e esses dois campos são
                apagados 12 meses depois que a mensagem é resolvida. Para limitar abuso, guardamos um resumo irreversível do seu
                endereço de rede por algumas horas.
              </li>
              <li>
                Usamos um cookie de sessão (quando você entra) e lembretes no seu navegador: tema claro ou escuro e se você já viu a
                apresentação inicial. Não há cookie de publicidade.
              </li>
            </ul>
            <p className="text-sm text-muted">
              Esta versão ainda roda fora de produção. Quando houver endereço público, a lista dos provedores que tratam dados (hospedagem,
              banco de dados e e-mail) entra aqui, com o país e a finalidade de cada um.
            </p>
            <p>
              Quer acessar, corrigir ou apagar o que guardamos sobre você? Use{" "}
              <Link href="/sugestoes?tipo=outro" className={link}>
                o formulário
              </Link>{" "}
              e diga “privacidade” no texto.
            </p>
          </Section>

          <Section id="s-resposta" title="Direito de resposta e correção">
            <p>
              No fim da página de cada pessoa há o link <strong>Direito de resposta</strong>. Qualquer pessoa citada, ou quem a
              represente, pode usá-lo para contestar um dado ou o modo como ele aparece.
            </p>
            <ol className="ml-5 flex list-decimal flex-col gap-1.5">
              <li>
                A mensagem é guardada com a data e a página da pessoa. Ela não aparece publicamente enquanto está em análise.
              </li>
              <li>
                Se a contestação traz uma fonte oficial que mostra o erro, corrigimos e publicamos o registro: o que estava,
                o que ficou, o motivo, a fonte e a data.
              </li>
              <li>
                Se o dado está certo segundo a fonte, mantemos e respondemos com o link de onde ele vem. Se a própria fonte está
                errada, indicamos o canal do órgão para corrigir lá; mudamos aqui quando a fonte mudar.
              </li>
              <li>Meta de resposta: 10 dias úteis. Pedidos de remoção de dado público do mandato não são atendidos, por serem informação de interesse público.</li>
            </ol>
            <p className="text-sm text-muted">
              Ainda não há uma área para publicar a nota da própria pessoa junto ao dado. Enquanto ela não existir, o pedido segue o
              caminho acima. Esta página será atualizada quando ela estiver pronta.
            </p>
            <p>
              Para outros assuntos (ideia, dado que falta, fonte nova), use{" "}
              <Link href="/sugestoes" className={link}>
                Sugerir ou corrigir
              </Link>
              .
            </p>
          </Section>
        </div>
      </div>
    </Container>
  );
}
