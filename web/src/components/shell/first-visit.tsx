"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingDialog } from "@/components/ui/misc";

const COOKIE = "onb";
// só na porta de entrada: quem chega por um link direto a um crachá não leva um modal na cara
const ENTRY = /^\/(representantes)?$/;

const seen = () => document.cookie.split("; ").some((c) => c === `${COOKIE}=1`);
const remember = () => {
  document.cookie = `${COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
};

/**
 * Apresentação de 3 passos na 1ª visita. Nasce fechada e só abre depois da hidratação: sem JavaScript a página
 * nunca é bloqueada. "Pular", Esc, clicar fora e o botão principal gravam um cookie de 1 ano; sem cookie, volta.
 */
export function FirstVisit() {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // só a tela de busca (sem cidade/estado escolhidos): quem veio por um link de cidade já sabe o que quer
    if (done || !ENTRY.test(path) || /[?&](cidade|uf)=/.test(location.search)) return;
    try {
      if (!seen()) setOpen(true);
    } catch {
      /* cookies bloqueados: não insiste */
    }
  }, [path, done]);

  return (
    <OnboardingDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setDone(true);
          try {
            remember();
          } catch {}
        }
      }}
      onStart={() => {
        // o modal devolve o foco a quem o abriu ao fechar (e pode fazê-lo depois da animação): tenta de novo até pegar,
        // mas só enquanto o foco está "solto" (body); se a pessoa já foi para outro lugar, não toma o foco dela
        const input = () => document.querySelector<HTMLInputElement>("main input[role=combobox]");
        const loose = () => !document.activeElement || document.activeElement === document.body || !!document.activeElement.closest("[role=dialog]");
        if (path !== "/representantes") router.push("/representantes");
        // BUG-027: o intervalo antigo parava no primeiro foco e só esperava 3 s. No dev server a rota /representantes leva mais que isso
        // para compilar, e o modal ainda devolvia o foco ao fechar depois do primeiro acerto. Agora: só age em /representantes, espera até 10 s
        // pelo campo, e só desiste depois de o foco ficar estável por 500 ms (ou se a pessoa foi para outro controle).
        let tries = 0;
        let mine: HTMLInputElement | null = null; // campo em que já pusemos o foco
        let stable = 0;
        const t = setInterval(() => {
          tries++;
          if (tries > 100) return clearInterval(t);
          if (location.pathname !== "/representantes") return;
          const el = input();
          if (!el) return;
          if (document.activeElement === el) {
            mine = el;
            if (++stable >= 5) clearInterval(t);
            return;
          }
          stable = 0;
          if (mine === el && !loose()) return clearInterval(t); // tinha o foco e a pessoa levou para outro lugar: não toma de volta
          if (mine !== el || loose()) {
            el.focus();
            mine = el;
          }
        }, 100);
      }}
    />
  );
}
