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
        let tries = 0;
        const t = setInterval(() => {
          const el = input();
          if (el && document.activeElement === el) return clearInterval(t);
          if (el && (loose() || tries === 0)) el.focus();
          if (++tries > 30) clearInterval(t);
        }, 100);
      }}
    />
  );
}
