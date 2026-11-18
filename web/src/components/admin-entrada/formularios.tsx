"use client";

import { useState, type FormEvent } from "react";
import { Turnstile } from "@/components/account/turnstile";

// Formulários das páginas de entrada da central. Falam SÓ com as rotas de API da própria central (/admin/api/entrar (subcaminhos), JSON, mesma origem, `fetch` relativo): nenhuma server action
// (o Next roteia action pelo id, não pelo caminho) e nenhum provedor de login no navegador (o login é da própria central: D335).
// O widget Turnstile é o mesmo do site (components/account/turnstile.tsx); a CSP da central o libera só nas páginas de entrada, em modo produção.

type Resposta = { proximo?: string; erro?: string; segredo?: string; uri?: string };
type EstadoFator = { erro?: string; segredo?: string; uri?: string };

async function postar(url: string, corpo: Record<string, unknown>): Promise<Resposta> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), credentials: "same-origin", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Resposta;
    if (r.ok) return j;
    return { erro: j.erro ?? "Não foi possível concluir agora. Tente de novo." };
  } catch {
    return { erro: "Sem conexão com a central. Tente de novo." };
  }
}
const campo = (f: HTMLFormElement, nome: string): string => String(new FormData(f).get(nome) ?? "");

/** Envio com estado de pendência e erro; em sucesso com `proximo`, navega (navegação completa: os cookies da etapa vão junto). */
function useEnvio(acao: (f: HTMLFormElement) => Promise<Resposta>) {
  const [estado, setEstado] = useState<EstadoFator>({});
  const [pendente, setPendente] = useState(false);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget;
    setPendente(true);
    const r = await acao(f);
    if (r.proximo) {
      window.location.assign(r.proximo);
      return;
    }
    setPendente(false);
    setEstado(r);
  };
  return { estado, pendente, enviar };
}

function Alerta({ erro }: { erro?: string }) {
  return (
    <p role="alert" aria-live="assertive" className="adm-ajuda" data-estado={erro ? "erro" : undefined}>
      {erro ?? ""}
    </p>
  );
}

export function FormEmail({ aviso }: { aviso?: string }) {
  const { estado, pendente, enviar } = useEnvio((f) => postar("/admin/api/entrar/codigo", { email: campo(f, "email"), turnstile: campo(f, "cf-turnstile-response") }));
  const [email, setEmail] = useState("");
  return (
    <form onSubmit={enviar} className="adm-form" noValidate>
      <div className="adm-campo">
        <label htmlFor="adm-email">E-mail</label>
        <input id="adm-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(estado.erro)} />
      </div>
      {aviso && <p className="adm-ajuda">{aviso}</p>}
      <Turnstile />
      <Alerta erro={estado.erro} />
      <button type="submit" className="adm-botao" disabled={pendente} aria-busy={pendente}>
        {pendente ? "Enviando…" : "Mandar código"}
      </button>
    </form>
  );
}

export function FormCodigo() {
  const { estado, pendente, enviar } = useEnvio((f) => postar("/admin/api/entrar/verificar", { code: campo(f, "code") }));
  return (
    <form onSubmit={enviar} className="adm-form" noValidate>
      <div className="adm-campo">
        <label htmlFor="adm-codigo">Código de 6 números</label>
        <input id="adm-codigo" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus aria-invalid={Boolean(estado.erro)} />
      </div>
      <Alerta erro={estado.erro} />
      <button type="submit" className="adm-botao" disabled={pendente} aria-busy={pendente}>
        {pendente ? "Conferindo…" : "Entrar"}
      </button>
    </form>
  );
}

/** Fator já cadastrado: só o código do aplicativo. */
export function FormFatorVerificar() {
  const { estado, pendente, enviar } = useEnvio((f) => postar("/admin/api/entrar/fator/confirmar", { code: campo(f, "code") }));
  return (
    <form onSubmit={enviar} className="adm-form" noValidate>
      <div className="adm-campo">
        <label htmlFor="adm-totp">Código do aplicativo autenticador (6 números)</label>
        <input id="adm-totp" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus aria-invalid={Boolean(estado.erro)} />
      </div>
      <Alerta erro={estado.erro} />
      <button type="submit" className="adm-botao" disabled={pendente} aria-busy={pendente}>
        {pendente ? "Conferindo…" : "Confirmar"}
      </button>
    </form>
  );
}

/** Primeiro acesso: gera o segredo (rota de API), mostra em texto e como link `otpauth:`, e pede o primeiro código para confirmar o fator. Sem QR: evita uma biblioteca e o `data:` na CSP. */
export function FormFatorCadastro() {
  const [inicio, setInicio] = useState<EstadoFator>({});
  const [iniciando, setIniciando] = useState(false);
  const { estado, pendente, enviar } = useEnvio((f) => postar("/admin/api/entrar/fator/confirmar", { code: campo(f, "code") }));
  const comecar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIniciando(true);
    const r = await postar("/admin/api/entrar/fator/iniciar", {});
    setIniciando(false);
    if (r.proximo) window.location.assign(r.proximo);
    else setInicio(r);
  };
  const dados = inicio;
  if (!dados.segredo || !dados.uri) {
    return (
      <form onSubmit={comecar} className="adm-form">
        <Alerta erro={dados.erro} />
        <button type="submit" className="adm-botao" disabled={iniciando} aria-busy={iniciando}>
          {iniciando ? "Preparando…" : "Cadastrar autenticador"}
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={enviar} className="adm-form" noValidate>
      <p className="adm-ajuda">
        No aplicativo autenticador (Google Authenticator, 1Password, Authy), escolha digitar a chave e use esta, com o tipo &quot;baseada em tempo&quot;:
      </p>
      <p>
        <code>{(dados.segredo.match(/.{1,4}/g) ?? []).join(" ")}</code>
      </p>
      <p className="adm-ajuda">
        Se o autenticador está neste aparelho, <a href={dados.uri}>abra a chave direto nele</a>. A chave aparece só agora: se sair desta página, o cadastro recomeça com outra.
      </p>
      <div className="adm-campo">
        <label htmlFor="adm-totp-novo">Código do aplicativo (6 números)</label>
        <input id="adm-totp-novo" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus aria-invalid={Boolean(estado.erro)} />
      </div>
      <Alerta erro={estado.erro} />
      <button type="submit" className="adm-botao" disabled={pendente} aria-busy={pendente}>
        {pendente ? "Conferindo…" : "Confirmar e entrar"}
      </button>
    </form>
  );
}
