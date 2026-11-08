"use client";

import { clsx } from "clsx";
import { Monitor, Moon, Sun, Volume2, Pause } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTrigger,
  FieldError,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  Text,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "react-aria-components";
import { Button } from "./button";

type Theme = "system" | "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);
  const apply = (keys: Set<Key>) => {
    const t = ([...keys][0] as Theme) ?? "system";
    setTheme(t);
    // desliga transições durante a troca: sem isso os elementos atravessam 200ms com cores dos dois temas
    const root = document.documentElement;
    root.classList.add("theme-switching");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
    try {
      if (t === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {}
  };
  const opts: { id: Theme; label: string; Icon: typeof Sun }[] = [
    { id: "system", label: "Tema do sistema", Icon: Monitor },
    { id: "light", label: "Tema claro", Icon: Sun },
    { id: "dark", label: "Tema escuro", Icon: Moon },
  ];
  return (
    <ToggleButtonGroup
      aria-label="Tema"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[theme]}
      onSelectionChange={apply}
      className="inline-flex rounded-pill border border-border bg-surface p-0.5"
    >
      {opts.map(({ id, label, Icon }) => (
        <ToggleButton
          key={id}
          id={id}
          aria-label={label}
          className="grid size-9 place-items-center rounded-pill text-muted outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus data-[selected]:bg-surface-inverse data-[selected]:text-on-inverse"
        >
          <Icon aria-hidden className="size-4" />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Some quando o navegador não tem síntese de voz (não fica desabilitado). */
export function ListenButton() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => setSupported(typeof window !== "undefined" && "speechSynthesis" in window), []);
  if (!supported) return null;
  const toggle = () => {
    if (speaking) {
      speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = document.querySelector("main")?.textContent ?? "";
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.onend = () => setSpeaking(false);
    speechSynthesis.speak(u);
    setSpeaking(true);
  };
  return (
    <Button size="sm" variant="secondary" aria-pressed={speaking} onPress={toggle} icon={speaking ? <Pause aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}>
      {speaking ? "Pausar leitura" : "Ouvir a página"}
    </Button>
  );
}

export function EmailField({ errorMessage }: { errorMessage?: string }) {
  return (
    <TextField type="email" isRequired isInvalid={!!errorMessage} autoComplete="email" className="flex flex-col gap-1.5">
      <Label className="text-sm font-semibold text-fg">E-mail</Label>
      <Input
        className={clsx(
          "h-12 rounded-sm border-[1.5px] bg-surface px-4 text-base text-fg outline-none",
          "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus",
          errorMessage ? "border-danger" : "border-border-input",
        )}
      />
      <Text slot="description" className="text-xs text-muted">
        Mandamos um código de 6 dígitos. Não existe senha.
      </Text>
      <FieldError className="text-sm font-semibold text-danger">{errorMessage}</FieldError>
    </TextField>
  );
}

/**
 * Boas-vindas em 3 passos. Sem props é a vitrine (/design): botão que abre. Com `open`, é controlado
 * (primeira visita): sem trigger, "Pular" e Esc fecham, e `onStart` leva ao primeiro passo do fluxo.
 */
export function OnboardingDialog({
  open,
  onOpenChange,
  onStart,
}: { open?: boolean; onOpenChange?: (open: boolean) => void; onStart?: () => void } = {}) {
  const controlled = open !== undefined;
  const modal = (
    <ModalOverlay
      isOpen={controlled ? open : undefined}
      onOpenChange={controlled ? onOpenChange : undefined}
      isDismissable
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--surface-inverse),transparent_45%)] p-4"
    >
      <Modal className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-pop">
        <Dialog className="outline-none" aria-labelledby="onb-title">
          {({ close }) => (
            <>
              <Heading slot="title" id="onb-title" className="font-display text-display text-fg">
                Quem trabalha por você?
              </Heading>
              <ol className="mt-4 flex flex-col gap-3 text-sm text-fg">
                <li><strong>1. Diga onde mora.</strong> Cidade ou estado, no mapa ou na busca.</li>
                <li><strong>2. Veja quem está no cargo.</strong> Do vereador ao presidente.</li>
                <li><strong>3. Abra o perfil.</strong> Votos, presença, gastos e patrimônio, com a fonte oficial.</li>
              </ol>
              <p className="mt-4 rounded-sm bg-surface-sunken p-3 text-xs text-muted">
                Sem nota, sem ranking, sem opinião. Só o que os órgãos públicos publicam.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="ghost" onPress={close}>Pular</Button>
                <Button
                  variant="primary"
                  onPress={() => {
                    onStart?.();
                    close();
                  }}
                >
                  Achar minha cidade
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
  if (controlled) return modal;
  return (
    <DialogTrigger>
      <Button variant="secondary">Abrir boas-vindas</Button>
      {modal}
    </DialogTrigger>
  );
}
