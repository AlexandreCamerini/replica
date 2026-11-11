import type { Metadata } from "next";
import { COOKIE_TEXTO, readPrefs, ufOptions } from "@/components/sv/prefs";
import { salvarEsferas, salvarUf } from "./actions";

// Versão mínima e funcional (sem JS): a tela D2 de Ajustes será feita por outro agente em cima destas ações e classes.
export const metadata: Metadata = { title: "Ajustes" };

export default async function Ajustes() {
  const [prefs, ufs] = await Promise.all([readPrefs(), ufOptions()]);
  const { uf, esferas } = prefs;
  return (
    <div className="sv-pg sv-pg--ajustes">
      <div className="sv-topq">
        <h1>O que eu quero acompanhar?</h1>
        <p className="sv-t">{uf ? <>Seu estado: <b>{uf.nome} ({uf.sigla})</b>.</> : "Você ainda não escolheu um estado."}</p>
        <p className="sv-nota">{COOKIE_TEXTO}</p>
      </div>

      <section className="sv-l3 sv-l3--dom" aria-labelledby="aj-uf">
        <h2 className="sv-p" id="aj-uf">
          Meu estado
        </h2>
        <form action={salvarUf} className="sv-form-d2">
          <input type="hidden" name="voltar" value="/v2/ajustes" />
          <label className="sv-sub" htmlFor="aj-uf-sel">
            Estado
          </label>
          <select id="aj-uf-sel" name="uf" className="sv-campo" defaultValue={uf?.sigla ?? ""}>
            <option value="">Nenhum estado escolhido</option>
            {ufs.map((o) => (
              <option key={o.sigla} value={o.sigla}>
                {o.nome} ({o.sigla})
              </option>
            ))}
          </select>
          <button type="submit" className="sv-enviar">
            Guardar estado
          </button>
        </form>
        <p className="sv-t">Trocar de estado apaga a cidade guardada.</p>
      </section>

      <section className="sv-l3 sv-l3--dom" aria-labelledby="aj-esf">
        <h2 className="sv-p" id="aj-esf">
          O que aparece para mim
        </h2>
        <form action={salvarEsferas} className="sv-form-d2">
          <input type="hidden" name="voltar" value="/v2/ajustes" />
          <input type="hidden" name="esferas" value="1" />
          <div className="sv-chk">
            <input type="checkbox" id="aj-fed" checked disabled aria-describedby="aj-fed-d" />
            <label htmlFor="aj-fed">Congresso (federal): Câmara e Senado.</label>
            <span className="sv-chk__w">sempre ligado</span>
          </div>
          <p className="sv-nota" id="aj-fed-d">
            É o que decide as leis do país.
          </p>
          <div className="sv-chk">
            <input type="checkbox" id="aj-est" name="estadual" defaultChecked={esferas.estadual} />
            <label htmlFor="aj-est">Assembleia Legislativa {uf ? `de ${uf.sigla}` : "do meu estado"} (estadual)</label>
          </div>
          <div className="sv-chk">
            <input type="checkbox" id="aj-mun" name="municipal" defaultChecked={esferas.municipal} aria-describedby="aj-mun-d" />
            <label htmlFor="aj-mun">Câmara Municipal da minha cidade (municipal)</label>
          </div>
          <div className="sv-cid">
            <label htmlFor="aj-cid">Cidade (código IBGE de 7 dígitos)</label>
            <input type="text" id="aj-cid" name="cidade" inputMode="numeric" pattern="\d{7}" defaultValue={esferas.cidade ?? ""} aria-describedby="aj-mun-d" />
          </div>
          <p className="sv-nota" id="aj-mun-d">
            Só lemos as câmaras que publicam num sistema aberto. Nem todas têm dados atuais.
          </p>
          <button type="submit" className="sv-enviar">
            Guardar escolhas
          </button>
        </form>
      </section>
    </div>
  );
}
