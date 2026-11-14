import type { Metadata } from "next";
import { COOKIE_TEXTO, ESFERAS_COOKIE, UF_COOKIE, readPrefs, ufOptions } from "@/components/sv/prefs";
import { LeituraAssembleia, carregarAssembleia } from "@/components/sv/ajustes/leitura-assembleia";
import { FALHOU_LEITURA } from "@/components/sv/estados";
import { Lacuna, Notice, Pergunta, Proxima, Quadro, Selo, Fonte } from "@/components/sv/ui";
import { data } from "@/lib/data";
import type { Place } from "@/lib/data";
import { salvarEsferas, salvarUf } from "./actions";

// página pessoal (preferências em cookie): fora de busca mesmo com o resto da Direção 2 aberto à busca (D316)
export const metadata: Metadata = { title: "Ajustes", robots: { index: false, follow: false } };

const VOLTAR = "/ajustes";
const FORM_ESFERAS = "aj-esferas";

export default async function Ajustes({ searchParams }: { searchParams: Promise<{ erro?: string | string[] }> }) {
  const [prefs, ufsLidas, sp] = await Promise.all([readPrefs(), ufOptions().catch(() => null), searchParams]);
  const ufs = ufsLidas ?? [];
  // erro devolvido pelas ações (lista fechada): o banco estava fora e nada foi gravado
  const erroGravar = sp.erro === "leitura";
  const { uf, esferas } = prefs;
  const semUf = uf === null;

  // Sem JavaScript não há como carregar a lista depois: usa a UF já guardada. Falha ou lista vazia: cai no campo de código.
  const [assembleia, cidades] = await Promise.all([
    uf ? carregarAssembleia(uf.sigla) : Promise.resolve({ info: null, falhou: false }),
    uf ? data.listMunicipalities(uf.sigla).catch((): Place[] => []) : Promise.resolve([] as Place[]),
  ]);
  const cidadeGuardada = esferas.cidade ? (cidades.find((c) => c.ibge === esferas.cidade) ?? null) : null;
  const lidoEm = assembleia.info?.items.map((i) => i.refreshedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

  return (
    <div className="sv-pg sv-pg--ajustes">
      <div className="sv-topq sv-gu">
        <h1>O que eu quero acompanhar?</h1>
        {erroGravar && <Notice label="Nada foi guardado">Não conseguimos ler a lista de estados agora, então sua escolha não foi guardada. Tente de novo em alguns minutos.</Notice>}
        {uf ? (
          <p className="sv-t">
            Seu estado: <b>{uf.nome} ({uf.sigla})</b>.
          </p>
        ) : prefs.ufFalhou ? (
          <Lacuna motivo="O estado guardado neste navegador depende da lista de estados, que não pôde ser lida.">{FALHOU_LEITURA}</Lacuna>
        ) : (
          <p className="sv-t">Você ainda não escolheu um estado. Escolha o seu para ver a Assembleia e a Câmara da sua região.</p>
        )}
        <form action={salvarUf} className={`sv-form-d2 sv-aj-uf${semUf ? " sv-aj-uf--destaque" : ""}`} id="trocar-estado" aria-labelledby="aj-uf-t">
          <input type="hidden" name="voltar" value={VOLTAR} />
          <h2 className="sv-sub" id="aj-uf-t">
            {semUf ? "Escolha seu estado" : "Trocar estado"}
          </h2>
          <label className="sv-aj-rot" htmlFor="aj-uf-sel">
            Estado
          </label>
          {ufsLidas === null && <Lacuna motivo="A lista de estados não pôde ser lida agora.">{FALHOU_LEITURA}</Lacuna>}
          <select id="aj-uf-sel" name="uf" className="sv-campo" defaultValue={uf?.sigla ?? ""} aria-describedby="aj-uf-d">
            <option value="">{uf ? "Nenhum estado (limpar a escolha)" : "Escolha um estado"}</option>
            {ufs.map((o) => (
              <option key={o.sigla} value={o.sigla}>
                {o.nome} ({o.sigla})
              </option>
            ))}
          </select>
          <button type="submit" className="sv-enviar">
            Guardar estado
          </button>
          <p className="sv-nota" id="aj-uf-d">
            Trocar de estado apaga a cidade guardada. {COOKIE_TEXTO}
          </p>
        </form>
      </div>

      {/* Os controles das esferas ficam nas três seções e apontam para este formulário pelo atributo form: funciona sem JavaScript. */}
      <section className="sv-l3 sv-l3--dom sv-ga" aria-labelledby="aj-j1">
        <h2 className="sv-p" id="aj-j1">
          Congresso (federal)
        </h2>
        <div className="sv-bloco">
          <div className="sv-chk">
            <p className="sv-chk__t">Ligado: Câmara e Senado.</p>
            <span className="sv-chk__w">sempre ligado</span>
          </div>
          <p className="sv-t">Desligar não é possível para o Congresso.</p>
        </div>
        <p className="sv-t">É o que decide as leis do país.</p>
      </section>

      <section className="sv-l3 sv-l3--dom sv-gb" aria-labelledby="aj-j2">
        <h2 className="sv-p" id="aj-j2">
          Assembleia Legislativa do meu estado (estadual)
        </h2>
        <div className="sv-bloco">
          <div className="sv-chk">
            <input type="checkbox" id="aj-est" name="estadual" form={FORM_ESFERAS} defaultChecked={esferas.estadual} aria-describedby="aj-est-d" />
            <label htmlFor="aj-est">Acompanhar a Assembleia{uf ? ` de ${uf.sigla}` : " do meu estado"}</label>
          </div>
          <p className="sv-t">Para mudar, marque ou tire a marca da caixa e toque em “Guardar escolhas”.</p>
          {uf ? (
            <>
              <Pergunta as="h3">O que lemos da Assembleia de {uf.sigla}</Pergunta>
              <LeituraAssembleia uf={uf.sigla} info={assembleia.info} falhou={assembleia.falhou} />
              <p className="sv-t">A pauta da Assembleia não faz parte do que lemos hoje.</p>
            </>
          ) : (
            <p className="sv-t">
              Escolha seu estado para ver a Assembleia. <a href="#trocar-estado">Escolher estado</a>.
            </p>
          )}
        </div>
        <p className="sv-t" id="aj-est-d">
          {uf ? `Só a Assembleia de ${uf.sigla}, o estado guardado. Para ver outro estado, use “Trocar estado” no topo.` : "Ligado por padrão. Só aparece depois que você escolher um estado."}
        </p>
        {uf && assembleia.info?.source && (
          <Fonte>
            Fonte: <a href={assembleia.info.source.url}>{assembleia.info.source.name}</a>
          </Fonte>
        )}
      </section>

      <section className="sv-l3 sv-l3--dom sv-gc" aria-labelledby="aj-j3">
        <h2 className="sv-p" id="aj-j3">
          Câmara Municipal da minha cidade (municipal)
        </h2>
        <div className="sv-bloco">
          <div className="sv-chk">
            <input type="checkbox" id="aj-mun" name="municipal" form={FORM_ESFERAS} defaultChecked={!semUf && esferas.municipal} disabled={semUf} aria-describedby="aj-mun-d" />
            <label htmlFor="aj-mun">Acompanhar a Câmara Municipal{semUf ? " (escolha o estado primeiro)" : ""}</label>
          </div>
          <p className="sv-t">{semUf ? "Escolha seu estado primeiro: a lista de cidades depende dele." : "Para mudar, marque ou tire a marca da caixa e toque em “Guardar escolhas”."}</p>
          <div className="sv-cid">
            <label htmlFor="aj-cid">{cidades.length > 0 || semUf ? "Cidade" : "Cidade (código do IBGE, 7 dígitos)"}</label>
            {semUf ? (
              <input type="text" id="aj-cid" disabled placeholder="escolha o estado primeiro" aria-describedby="aj-mun-d" />
            ) : cidades.length > 0 ? (
              <select id="aj-cid" name="cidade" form={FORM_ESFERAS} className="sv-campo" defaultValue={esferas.cidade ?? ""} aria-describedby="aj-mun-d">
                <option value="">Nenhuma cidade escolhida</option>
                {esferas.cidade && !cidadeGuardada && <option value={esferas.cidade}>Código {esferas.cidade}</option>}
                {cidades.map((c) => (
                  <option key={c.ibge} value={c.ibge}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" id="aj-cid" name="cidade" form={FORM_ESFERAS} inputMode="numeric" pattern="\d{7}" maxLength={7} defaultValue={esferas.cidade ?? ""} aria-describedby="aj-mun-d" />
            )}
            <p className="sv-nota">
              {semUf
                ? "Quando ligado: aparece o que a Câmara da cidade publica, com a data da leitura."
                : cidades.length > 0
                  ? `Cidades de ${uf?.nome}. Para outra cidade de outro estado, troque o estado antes.`
                  : "Não conseguimos listar as cidades agora. Digite o código do IBGE da cidade (7 dígitos, começa com o código do seu estado)."}
            </p>
          </div>
          {semUf && esferas.municipal && <input type="hidden" name="municipal" value="on" form={FORM_ESFERAS} />}
        </div>
        <p className="sv-t" id="aj-mun-d">
          Só lemos as câmaras que publicam num sistema aberto. Nem todas têm dados atuais.
        </p>
      </section>

      <form action={salvarEsferas} id={FORM_ESFERAS} className="sv-aj-env sv-ge" aria-label="Guardar escolhas das esferas">
        <input type="hidden" name="voltar" value={VOLTAR} />
        <input type="hidden" name="esferas" value="1" />
        <button type="submit" className="sv-enviar">
          Guardar escolhas
        </button>
      </form>

      <Quadro id="aj-j4" variante="fio" pergunta="Onde fica a minha escolha?" className="sv-gd" prova="Fonte: ajustes guardados neste navegador.">
        <p className="sv-t">{COOKIE_TEXTO}</p>
        <ul className="sv-aj-ck">
          <li>
            <b>Estado</b> <code>{UF_COOKIE}</code>: a sigla do estado que você escolheu.
          </li>
          <li>
            <b>Esferas</b> <code>{ESFERAS_COOKIE}</code>: se a Assembleia e a Câmara Municipal estão ligadas ou desligadas.
          </li>
          <li>
            <b>Cidade</b> também em <code>{ESFERAS_COOKIE}</code>: o código do IBGE da cidade escolhida.
          </li>
        </ul>
        <p className="sv-t">Apagar os cookies do navegador volta tudo ao início: sem estado, com a Assembleia ligada e a Câmara Municipal desligada.</p>
      </Quadro>

      <Selo id="aj-j5" className="sv-gs" lidoEm={lidoEm} />
      <Proxima href="/" pergunta="O que está rolando?" className="sv-gn" />
    </div>
  );
}
