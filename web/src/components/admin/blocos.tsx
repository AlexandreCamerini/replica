import Link from "next/link";
import { FormRodada } from "./form-rodada.tsx";

/** Erro de leitura do banco: aviso sem detalhe técnico e sem números. */
export function BlocoErro() {
  return (
    <section className="adm-bloco" data-estado="erro_leitura" role="alert" aria-labelledby="adm-erro-t">
      <h2 id="adm-erro-t">Não foi possível ler o banco</h2>
      <p>A central não conseguiu consultar o banco agora. Nenhum número é mostrado até a leitura voltar. Tente de novo em instantes.</p>
    </section>
  );
}

/** Nenhuma rodada em `adm_rodadas`: o comando e o botão para abrir a primeira. */
export function BlocoVazio() {
  return (
    <section className="adm-bloco" data-estado="vazio" aria-labelledby="adm-vazio-t">
      <h2 id="adm-vazio-t">Nenhuma rodada ainda</h2>
      <p>Ainda não há rodada de coleta registrada. Abra a primeira por aqui ou pela linha de comando:</p>
      <pre className="adm-codigo">civico-etl admin rodada abrir --coletor ID --executar</pre>
      <FormRodada />
    </section>
  );
}

/** Território (UF ou município) sem nenhuma ficha. */
export function BlocoTerritorioSemFicha({ nome }: { nome: string }) {
  return (
    <section className="adm-bloco" data-estado="territorio_sem_ficha" aria-labelledby="adm-sf-t">
      <h2 id="adm-sf-t">{nome}</h2>
      <p>0 fichas neste território. Ele aparece vazio no mapa, sem preenchimento.</p>
    </section>
  );
}

const LINKS = [
  ["/admin", "Início"],
  ["/admin/fila", "Fila"],
  ["/admin/rodadas", "Rodadas"],
] as const;

/** Navegação da central (só links internos relativos ao site). */
export function Navegacao({ atual }: { atual: string }) {
  return (
    <header className="adm-topo">
      <p className="adm-marca-central">Central de coleta</p>
      <nav aria-label="Central de coleta">
        <ul className="adm-nav">
          {LINKS.map(([href, t]) => (
            <li key={href}>
              <Link href={href} aria-current={atual === href ? "page" : undefined}>
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
