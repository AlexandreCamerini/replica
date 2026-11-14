import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/sv-como-funciona.css";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { fmtDate, fmtDateTime, fmtInt } from "@/components/sv/fmt";
import { JaValeLegenda, Lacuna, Nota, Proxima, Quadro, Resposta, VOTO_ORDEM, VotoMarca } from "@/components/sv/ui";
import { data } from "@/lib/data";

export const metadata: Metadata = { title: "Como funciona?" };

const VERIFY = [
  "O trecho citado existe, palavra por palavra, no texto oficial.",
  "O trecho sustenta a frase que escrevemos.",
  "Nada no resto do texto contradiz a frase.",
  "Um leitor comum entende o que muda e se já vale.",
  "Nenhuma palavra diz se a proposta é boa ou ruim.",
];

const NEVER = ["Dizer se uma proposta é boa ou ruim.", "Dar nota ou ordenar pessoas por desempenho.", "Usar cor para indicar voto, lado ou partido.", "Mostrar número que não está na fonte.", "Completar por dedução o que a fonte não publica."];

export default async function ComoFunciona() {
  const [sources, rules, corrections] = await Promise.all([data.listSourceStatus().catch(() => null), data.listPocketRules().catch(() => null), data.listCorrections().catch(() => null)]);
  const ordenadas = rules ? [...rules].sort((a, b) => b.version - a.version) : [];
  const current = ordenadas[0] ?? null;

  return (
    <div className="sv-pg sv-pg--cf">
      <div className="sv-folio sv-folio--dom">
        <h1>Como funciona?</h1>
        <p className="sv-intro">De onde vem cada informação, que regras seguimos e o que fazemos quando erramos.</p>
      </div>

      <Quadro id="nunca" variante="dom" numero={1} pergunta="O que nunca fazemos?" className="sv-c7">
        <ul className="sv-cf-l sv-cf-l--g">
          {NEVER.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Quadro>

      <Quadro id="voto" numero={2} pergunta="Como ler um voto?" className="sv-c5">
        <p className="sv-t">O voto aparece sempre como uma forma e uma palavra, na mesma ordem e no mesmo peso:</p>
        <ul className="sv-cf-v">
          {VOTO_ORDEM.map((f) => (
            <li key={f}>
              <VotoMarca forma={f} />
            </li>
          ))}
        </ul>
        <p className="sv-t">Sim é cheio, Não é hachurado, Abstenção é pontilhada e Sem voto é vazio. Sem voto registrado não é voto contra: a fonte publica só quem teve registro.</p>
        <p className="sv-t">Se uma proposta já vale aparece num círculo:</p>
        <JaValeLegenda />
      </Quadro>

      <Quadro id="verificacao" numero={3} pergunta="Como conferimos o que escrevemos?" className="sv-c7">
        <p className="sv-t">
          As explicações em linguagem simples são rascunhadas por inteligência artificial (IA) a partir do texto oficial. Antes de publicar, cada frase é conferida contra o trecho citado: por uma pessoa ou por agentes de IA independentes de quem escreveu. Cada resposta diz quem conferiu e quando.
        </p>
        <ol className="sv-cf-l sv-cf-l--n">
          {VERIFY.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <p className="sv-t">
          Se uma conferência falha, a resposta não é publicada e aparece como “ainda não conseguimos conferir”. Quando a conferência foi feita por agentes, nenhuma pessoa leu a explicação antes de publicarmos. Votos, presença e gastos não passam por essa conferência: vêm da fonte oficial, com a data da leitura. Pessoas e agentes erram: por isso todo erro apontado é conferido e corrigido aqui, com data e motivo.
        </p>
      </Quadro>

      <Quadro id="fontes" variante={sources && sources.length ? "padrao" : "lacuna"} numero={4} pergunta="De onde vêm os dados?" className="sv-c5" prova="Usamos só o que órgãos públicos publicam em formato aberto. A data é a da última carga de cada fonte.">
        {!sources ? (
          <Lacuna>{FALHOU_LEITURA}</Lacuna>
        ) : sources.length === 0 ? (
          <Lacuna motivo="Nenhuma fonte foi carregada ainda.">Ainda não temos esse dado.</Lacuna>
        ) : (
          <ul className="sv-cf-f">
            {sources.map((s) => (
              <li key={s.slug}>
                <a href={s.url} rel="noopener noreferrer">
                  {s.name}
                </a>
                <span className="sv-cf-f__m">
                  {s.datasets.length === 1 ? "1 conjunto de dados" : `${fmtInt(s.datasets.length)} conjuntos de dados`}
                  {s.lastRefreshedAt ? `, lida em ${fmtDateTime(s.lastRefreshedAt)}.` : ", ainda não lida."}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Quadro>

      <Quadro id="regras" variante={current ? "padrao" : "lacuna"} numero={5} pergunta="Que propostas entram?" className="sv-c7" prova="As regras ficam publicadas com data. Quando uma regra muda, a versão anterior continua nesta página.">
        {!rules ? (
          <Lacuna>{FALHOU_LEITURA}</Lacuna>
        ) : !current ? (
          <Lacuna>Não consta regra publicada.</Lacuna>
        ) : (
          <>
            <Resposta tamanho="m">Hoje entram as propostas sobre dinheiro, trabalho e benefícios (regra na versão {current.version}).</Resposta>
            <p className="sv-t">
              Na Câmara, as que a própria Casa classificou em: {current.themes.join("; ")}. No Senado, que não classifica por tema, as que têm no resumo uma destas palavras: {current.terms.join(", ")}.
            </p>
            <ul className="sv-cf-l">
              {ordenadas.map((r) => (
                <li key={r.version}>
                  Versão {r.version}, publicada em {fmtDate(r.publishedOn)}.
                </li>
              ))}
            </ul>
          </>
        )}
      </Quadro>

      <Quadro id="correcoes" numero={6} pergunta="O que corrigimos?" className="sv-c5">
        {!corrections ? (
          <Lacuna>{FALHOU_LEITURA}</Lacuna>
        ) : corrections.length === 0 ? (
          <Resposta tamanho="m">Nenhuma correção publicada até agora.</Resposta>
        ) : (
          <ul className="sv-cf-f">
            {corrections.map((c) => (
              <li key={`${c.key}-${c.correctedAt}`}>
                <Link href={`/decisao/${c.key}`}>{c.label}</Link>
                <span className="sv-cf-f__m">
                  Corrigida em {fmtDate(c.correctedAt)}: {c.note}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="sv-t">Viu um erro? Diga qual página, qual frase e o que a fonte oficial diz. Conferimos e, se for erro, corrigimos aqui com data e motivo.</p>
        <Link className="sv-enviar" href="/sugestoes">
          Apontar um erro
        </Link>
        <Nota>O formulário fica na versão atual do site.</Nota>
      </Quadro>

      <Proxima href="/" pergunta="O que está rolando?" />
    </div>
  );
}
