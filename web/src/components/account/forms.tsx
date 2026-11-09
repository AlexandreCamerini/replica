"use client";

import { clsx } from "clsx";
import { Bell, BellOff, Check } from "lucide-react";
import { useActionState } from "react";
import { deleteAccount, sendCode, submitSuggestion, toggleFollow, updateDigest, verifyCode, type FormState } from "@/lib/account";
import { Turnstile } from "./turnstile";

const input =
  "h-12 w-full rounded-sm border-[1.5px] border-border-input bg-surface px-4 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-[invalid=true]:border-danger";
const primary =
  "inline-flex h-12 items-center justify-center gap-2 rounded-pill bg-accent px-6 text-base font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60";

function Alert({ state }: { state: FormState }) {
  return (
    <p role="alert" aria-live="assertive" className={clsx("min-h-5 text-sm font-semibold", state.error ? "text-danger" : "text-transparent")}>
      {state.error ?? ""}
    </p>
  );
}

export function EmailStep({ volta, seguir }: { volta: string; seguir?: string }) {
  const [state, action, pending] = useActionState(sendCode, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-4" noValidate>
      <input type="hidden" name="volta" value={volta} />
      {seguir && <input type="hidden" name="seguir" value={seguir} />}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-email" className="text-sm font-semibold text-fg">
          E-mail
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          defaultValue={state.fields?.email}
          aria-invalid={Boolean(state.error)}
          aria-describedby="email-ajuda"
          className={input}
        />
        <span id="email-ajuda" className="text-xs text-muted">
          Mandamos um código de 6 números. Não existe senha.
        </span>
      </div>
      <label className="flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" name="consent" required className="mt-1 size-4 accent-[var(--accent)]" />
        <span>Concordo em receber, neste e-mail, o código de acesso e as novidades de quem eu acompanhar. Dá para parar a qualquer momento.</span>
      </label>
      <Turnstile />
      <Alert state={state} />
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Enviando…" : "Mandar código"}
      </button>
    </form>
  );
}

export function CodeStep({ volta, seguir }: { volta: string; seguir?: string }) {
  const [state, action, pending] = useActionState(verifyCode, {});
  return (
    <form action={action} className="flex max-w-md flex-col gap-4" noValidate>
      <input type="hidden" name="volta" value={volta} />
      {seguir && <input type="hidden" name="seguir" value={seguir} />}
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
        Código de 6 números
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          aria-invalid={Boolean(state.error)}
          className={clsx(input, "w-48 text-center font-mono text-2xl tracking-[0.4em]")}
        />
      </label>
      <Alert state={state} />
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Conferindo…" : "Entrar"}
      </button>
    </form>
  );
}

export function FollowButton({ slug, following, name }: { slug: string; following: boolean; name: string }) {
  const [state, action, pending] = useActionState(toggleFollow, {});
  return (
    <form action={action} className="contents">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="acao" value={following ? "parar" : "seguir"} />
      <button
        type="submit"
        disabled={pending}
        aria-pressed={following}
        aria-label={following ? `Deixar de acompanhar ${name}` : `Acompanhar ${name}`}
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60",
          following ? "border-[1.5px] border-accent bg-accent-soft text-accent-text" : "bg-accent text-on-accent",
        )}
      >
        {following ? <Check aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
        {following ? "Acompanhando" : "Acompanhar"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs font-semibold text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function DigestForm({ value }: { value: "daily" | "weekly" | "off" }) {
  const [state, action, pending] = useActionState(updateDigest, {});
  const opts = [
    { v: "daily", l: "Todo dia" },
    { v: "weekly", l: "Uma vez por semana" },
    { v: "off", l: "Não mandar e-mail" },
  ];
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-fg">Resumo por e-mail</legend>
        {opts.map((o) => (
          <label key={o.v} className="flex items-center gap-2 text-sm text-fg">
            <input type="radio" name="digest" value={o.v} defaultChecked={value === o.v} className="size-4 accent-[var(--accent)]" />
            {o.l}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus">
          Salvar
        </button>
        <span role="status" className="text-sm text-muted">
          {state.ok ? "Salvo." : state.error ?? ""}
        </span>
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-fg">Apaga sua conta, a lista de quem você acompanha e o histórico de e-mails. Não dá para desfazer.</p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
        Digite APAGAR para confirmar
        <input name="confirmar" autoComplete="off" className={clsx(input, "h-10 max-w-48")} aria-invalid={Boolean(state.error)} />
      </label>
      <Alert state={state} />
      <button type="submit" disabled={pending} className="inline-flex h-10 w-fit items-center gap-2 rounded-pill border-[1.5px] border-danger bg-surface px-4 text-sm font-semibold text-danger outline-none hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-focus">
        <BellOff aria-hidden className="size-4" /> Apagar minha conta
      </button>
    </form>
  );
}

const KINDS = [
  { v: "algo_errado", l: "Algo está errado" },
  { v: "informacao_faltando", l: "Falta uma informação" },
  { v: "fonte_de_dados", l: "Sei onde o dado é publicado" },
  { v: "ideia", l: "Ideia para o site" },
  { v: "outro", l: "Outro assunto" },
];
const RESPOSTA = { v: "direito_resposta", l: "Direito de resposta" };

export function SuggestionForm({ kind, person, personName, page, city, bodyHint }: { kind?: string; person?: string; personName?: string; page?: string; city?: string; bodyHint?: string }) {
  const [state, action, pending] = useActionState(submitSuggestion, {});
  if (state.ok)
    return (
      <div role="status" className="flex max-w-xl flex-col gap-2 rounded-md bg-accent-soft p-5 text-fg">
        <p className="font-semibold">Recebemos. Obrigado.</p>
        <p className="text-sm">Lemos tudo. Se for uma correção com fonte oficial, ela aparece publicada na página da pessoa, com a data.</p>
      </div>
    );
  const f = state.fields ?? {};
  return (
    <form action={action} className="flex max-w-xl flex-col gap-5" noValidate>
      {person && <input type="hidden" name="person" value={person} />}
      {page && <input type="hidden" name="page" value={page} />}
      {/* honeypot: invisível para pessoas e leitores de tela */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {personName && (
        <p className="rounded-sm bg-surface-sunken px-3 py-2 text-sm text-fg">
          Sobre: <strong>{personName}</strong>
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-fg">Sobre o que é?</legend>
        {(person ? [RESPOSTA, ...KINDS] : KINDS).map((k) => (
          <label key={k.v} className="flex items-center gap-2 text-sm text-fg">
            <input type="radio" name="kind" value={k.v} defaultChecked={(f.kind || kind || "algo_errado") === k.v} className="size-4 accent-[var(--accent)]" />
            {k.l}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sug-body" className="text-sm font-semibold text-fg">
          Mensagem
        </label>
        <textarea id="sug-body" name="body" required minLength={5} maxLength={5000} rows={6} defaultValue={f.body ?? bodyHint} className={clsx(input, "h-auto py-3")} aria-describedby="msg-ajuda" />
        <span id="msg-ajuda" className="text-xs text-muted">
          Se for correção, mande o link da fonte oficial. Isso acelera.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
          Seu nome
          <input name="name" required maxLength={120} autoComplete="name" defaultValue={f.name} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
          E-mail para resposta
          <input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={f.email} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-fg">
        Cidade (opcional)
        <input name="city" maxLength={120} autoComplete="address-level2" defaultValue={f.city ?? city} className={input} />
      </label>
      <Turnstile />
      <Alert state={state} />
      <p className="text-xs text-muted">Usamos o e-mail só para responder. Nome e e-mail são apagados 12 meses depois que a mensagem é resolvida.</p>
      <button type="submit" disabled={pending} className={clsx(primary, "w-fit")}>
        {pending ? "Enviando…" : "Enviar"}
      </button>
    </form>
  );
}
