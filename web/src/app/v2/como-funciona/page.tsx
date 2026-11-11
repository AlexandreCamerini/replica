import type { Metadata } from "next";
import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/components/sv/fmt";
import { Gap, Item, Label, List, Row, Src } from "@/components/sv/ui";
import { data } from "@/lib/data";

export const metadata: Metadata = { title: "Como funciona" };

const VERIFY = [
  "O trecho citado existe, palavra por palavra, no texto oficial.",
  "O trecho sustenta a frase que escrevemos.",
  "Nada no resto do texto contradiz a frase.",
  "Um leitor comum entende o que muda e se já vale.",
  "Nenhuma palavra diz se a proposta é boa ou ruim.",
];

const NEVER = ["Dizer se uma proposta é boa ou ruim.", "Dar nota ou ordenar pessoas por desempenho.", "Usar cor para indicar voto, lado ou partido.", "Mostrar número que não está na fonte.", "Completar por dedução o que a fonte não publica."];

export default async function ComoFunciona() {
  const [sources, rules, corrections] = await Promise.all([data.listSourceStatus(), data.listPocketRules(), data.listCorrections()]);
  const current = [...rules].sort((a, b) => b.version - a.version)[0] ?? null;

  return (
    <>
      <div className="sv-grid is-5-7">
        <div>
          <h1 className="sv-title">Como funciona</h1>
          <p className="sv-lead sv-mt-2">De onde vem cada informação, que regras seguimos e o que fazemos quando erramos.</p>

          <div className="sv-mt-5">
            <Label>O que nunca fazemos</Label>
            <List>
              {NEVER.map((t) => (
                <div key={t} className="sv-row" style={{ fontWeight: 500, fontSize: 16 }}>
                  {t}
                </div>
              ))}
            </List>
          </div>

          <div className="sv-mt-5" id="verificacao">
            <Label>Como conferimos o que escrevemos</Label>
            <p className="sv-mt-1" style={{ fontSize: 15.5, lineHeight: 1.45 }}>
              As explicações em linguagem simples são rascunhadas por inteligência artificial (IA) a partir do texto oficial. Antes de publicar, cada frase é conferida contra o trecho citado: por uma pessoa ou por agentes de IA independentes de quem escreveu. Cada resposta diz quem conferiu e quando.
            </p>
            <List>
              {VERIFY.map((t) => (
                <div key={t} className="sv-row" style={{ fontWeight: 500, fontSize: 16 }}>
                  {t}
                </div>
              ))}
            </List>
            <p className="sv-mt-2" style={{ fontSize: 15.5, lineHeight: 1.45 }}>
              Se uma conferência falha, a resposta não é publicada e aparece como “ainda não conseguimos conferir”. Quando a conferência foi feita por agentes, nenhuma pessoa leu a explicação antes de publicarmos. Votos, presença e gastos não passam por essa conferência: vêm da fonte oficial, com a data da leitura. Pessoas e agentes erram: por isso todo erro apontado é conferido e corrigido aqui, com data e motivo.
            </p>
          </div>

          <div className="sv-mt-5">
            <Label>Como ler um voto</Label>
            <p className="sv-mt-1" style={{ fontSize: 15.5, lineHeight: 1.45 }}>
              O voto aparece sempre como uma forma e uma palavra. Sim é cheio, Não é hachurado, abstenção é pontilhada e sem voto é vazio. Sem voto registrado não é voto contra: a fonte publica só quem teve registro.
            </p>
          </div>
        </div>

        <div>
          <section id="fontes">
            <Label>Fontes e última leitura</Label>
            {sources.length === 0 ? (
              <Gap>Não consta. Nenhuma fonte carregada.</Gap>
            ) : (
              <List>
                {sources.map((s) => (
                  <Item key={s.slug} href={s.url} title={s.name} note={`${s.datasets.length} conjuntos de dados`} value={s.lastRefreshedAt ? fmtDateTime(s.lastRefreshedAt) : "ainda não lida"} />
                ))}
              </List>
            )}
            <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
              Usamos só o que órgãos públicos publicam em formato aberto.
            </p>
          </section>

          <section id="regras" className="sv-mt-5">
            <Label>Regra de escolha das propostas{current ? `, versão ${current.version}` : ""}</Label>
            {current ? (
              <>
                <p className="sv-mt-1" style={{ fontSize: 15.5, lineHeight: 1.45 }}>
                  Hoje entram as propostas sobre dinheiro, trabalho e benefícios. Na Câmara, as que a própria Casa classificou em: {current.themes.join("; ")}. No Senado, que não classifica por tema, as que têm no resumo uma destas palavras: {current.terms.join(", ")}.
                </p>
                <List>
                  {[...rules]
                    .sort((a, b) => b.version - a.version)
                    .map((r) => (
                      <Row key={r.version} label={`Versão ${r.version}`} value={`publicada em ${fmtDate(r.publishedOn)}`} />
                    ))}
                </List>
              </>
            ) : (
              <Gap>Não consta regra publicada.</Gap>
            )}
          </section>

          <section id="correcoes" className="sv-mt-5">
            <Label>Correções</Label>
            {corrections.length === 0 ? (
              <Gap>Nenhuma correção publicada até agora.</Gap>
            ) : (
              <List>
                {corrections.map((c) => (
                  <Item key={`${c.key}-${c.correctedAt}`} href={`/v2/decisao/${c.key}`} title={c.label} note={c.note} value={fmtDate(c.correctedAt)} />
                ))}
              </List>
            )}
            <p className="sv-mt-2" style={{ fontSize: 15.5, lineHeight: 1.45 }}>
              Viu um erro? Diga qual página, qual frase e o que a fonte oficial diz. Conferimos e, se for erro, corrigimos aqui com data e motivo.
            </p>
            <Link className="sv-btn sv-mt-2" href="/sugestoes">
              Apontar um erro
            </Link>
          </section>
        </div>
      </div>
      <Src>As regras ficam publicadas com data. Quando uma regra muda, a versão anterior continua nesta página.</Src>
    </>
  );
}
