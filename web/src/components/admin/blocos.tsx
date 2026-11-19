import Link from "next/link";
import type { ReactNode } from "react";
import { FALHA_BANCO, type Falha } from "../../lib/admin/falhas.ts";
import { BotaoSair } from "./botao-sair.tsx";
import { FormRodada } from "./form-rodada.tsx";

/** Selo carimbado (design v1: palavra em mono maiúsculo, borda 1,5 px). A cor vem do `data-estado` do bloco em volta (admin.css); a palavra vai escrita, nunca só a cor. */
export function Selo({ children }: { children: ReactNode }) {
  return <span className="stamp adm-selo">{children}</span>;
}

/** Erro de leitura do banco numa PÁGINA (o servidor não leu): aviso sem detalhe técnico e sem números, com o que fazer. */
export function BlocoErro({ falha = FALHA_BANCO }: { falha?: Falha }) {
  return (
    <section className="adm-bloco" data-estado="erro_leitura" role="alert" aria-labelledby="adm-erro-t">
      <Selo>Erro de leitura</Selo>
      <h2 id="adm-erro-t">{falha.titulo}</h2>
      <p>A central não conseguiu consultar o banco agora. Nenhum número é mostrado até a leitura voltar.</p>
      <p className="adm-ajuda">{falha.acao}</p>
    </section>
  );
}

/** Nenhuma rodada em `adm_rodadas`. Com `comFormulario` (início), traz o formulário de abrir rodada; em /admin/rodadas o formulário é permanente e fica fora deste bloco. */
export function BlocoVazio({ comFormulario = true }: { comFormulario?: boolean }) {
  return (
    <section className="adm-bloco" data-estado="vazio" aria-labelledby="adm-vazio-t">
      <h2 id="adm-vazio-t">Nenhuma rodada ainda</h2>
      <p>Ainda não há rodada de coleta registrada. Abra a primeira {comFormulario ? "por aqui" : "no formulário abaixo"} ou pela linha de comando:</p>
      <pre className="adm-codigo">civico-etl admin rodada abrir --coletor ID --executar</pre>
      {comFormulario && <FormRodada />}
    </section>
  );
}

/** Território (UF ou município) sem nenhuma ficha. */
export function BlocoTerritorioSemFicha({ nome }: { nome: string }) {
  return (
    <section className="adm-bloco" data-estado="territorio_sem_ficha" aria-labelledby="adm-sf-t">
      <h2 id="adm-sf-t">{nome}</h2>
      <p>0 fichas neste território. Ele aparece vazio no mapa, sem preenchimento: só o 0 escrito.</p>
    </section>
  );
}

const LINKS = [
  ["/admin", "Início"],
  ["/admin/fila", "Fila"],
  ["/admin/rodadas", "Rodadas"],
] as const;

/** Navegação da central: links internos (relativos ao site) no formato `.chip` do design v1; a página atual leva aria-current. */
export function Navegacao({ atual }: { atual: string }) {
  return (
    <header className="adm-topo">
      <p className="adm-marca-central">Central de coleta</p>
      <nav aria-label="Central de coleta">
        <ul className="adm-nav">
          {LINKS.map(([href, t]) => (
            <li key={href}>
              <Link href={href} className="chip" aria-current={atual === href ? "page" : undefined}>
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {process.env.ADMIN_CENTRAL === "producao" && <BotaoSair />}
    </header>
  );
}

/** Alternador de visão (Coleta/Revisão): `.chip` com aria-current, rotulado "Visão do mapa". Fica junto do mapa. */
export function AlternadorVisao({ visao, hrefColeta, hrefRevisao }: { visao: "coleta" | "revisao"; hrefColeta: string; hrefRevisao: string }) {
  return (
    <nav aria-label="Visão do mapa" className="adm-visao">
      <Link href={hrefColeta} className="chip" aria-current={visao === "coleta" ? "page" : undefined}>
        Coleta
      </Link>
      <Link href={hrefRevisao} className="chip" aria-current={visao === "revisao" ? "page" : undefined}>
        Revisão
      </Link>
    </nav>
  );
}
