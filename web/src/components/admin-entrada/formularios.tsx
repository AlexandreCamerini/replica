"use client";

import { useActionState } from "react";
import { Turnstile } from "@/components/account/turnstile";
import { confirmarFator, enviarCodigo, iniciarCadastroFator, verificarCodigo, type EstadoEntrada, type EstadoFator } from "@/lib/admin/entrada";

// Formulários das páginas de entrada da central. Só falam com as server actions de lib/admin/entrada.ts: nenhum fetch, nenhuma URL do Supabase no navegador.
// O widget Turnstile é o mesmo do site (components/account/turnstile.tsx); a CSP da central o libera só em modo produção.

function Alerta({ erro }: { erro?: string }) {
  return (
    <p role="alert" aria-live="assertive" className="adm-ajuda" data-estado={erro ? "erro" : undefined}>
      {erro ?? ""}
    </p>
  );
}

export function FormEmail({ aviso }: { aviso?: string }) {
  const [estado, acao, pendente] = useActionState<EstadoEntrada, FormData>(enviarCodigo, {});
  return (
    <form action={acao} className="adm-form" noValidate>
      <div className="adm-campo">
        <label htmlFor="adm-email">E-mail</label>
        <input id="adm-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} defaultValue={estado.email} aria-invalid={Boolean(estado.erro)} />
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
  const [estado, acao, pendente] = useActionState<EstadoEntrada, FormData>(verificarCodigo, {});
  return (
    <form action={acao} className="adm-form" noValidate>
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
  const [estado, acao, pendente] = useActionState<EstadoFator, FormData>(confirmarFator, {});
  return (
    <form action={acao} className="adm-form" noValidate>
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

/** Primeiro acesso: gera o QR (action), mostra, e pede o primeiro código para confirmar o fator. */
export function FormFatorCadastro() {
  const [estado, acao, pendente] = useActionState<EstadoFator, FormData>(confirmarFator, {});
  const [inicio, comecar, iniciando] = useActionState<EstadoFator, FormData>(async () => iniciarCadastroFator(), {});
  const dados = estado.fatorId ? estado : inicio;
  if (!dados.fatorId || !dados.qr) {
    return (
      <form action={comecar} className="adm-form">
        <Alerta erro={dados.erro} />
        <button type="submit" className="adm-botao" disabled={iniciando} aria-busy={iniciando}>
          {iniciando ? "Preparando…" : "Cadastrar autenticador"}
        </button>
      </form>
    );
  }
  return (
    <form action={acao} className="adm-form" noValidate>
      <input type="hidden" name="fatorId" value={dados.fatorId} />
      <input type="hidden" name="qr" value={dados.qr} />
      <input type="hidden" name="segredo" value={dados.segredo ?? ""} />
      {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URI (SVG) devolvido pelo Supabase: não há o que otimizar */}
      <img src={dados.qr} alt="QR code para o aplicativo autenticador" width={200} height={200} />
      <p className="adm-ajuda">
        Escaneie com um aplicativo autenticador (Google Authenticator, 1Password, Authy). Sem câmera, digite o segredo: <code>{dados.segredo}</code>
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
