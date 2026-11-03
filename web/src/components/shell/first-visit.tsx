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
        // depois do close(): o modal devolve o foco ao que estava antes, e isso vence um foco dado cedo demais
        const focusCity = () => document.querySelector<HTMLInputElement>("main input[role=combobox]")?.focus();
        if (path !== "/representantes") {
          router.push("/representantes");
          const t = setInterval(() => {
            if (document.querySelector("main input[role=combobox]")) {
              clearInterval(t);
              setTimeout(focusCity, 50);
            }
          }, 100);
          setTimeout(() => clearInterval(t), 5000);
        } else setTimeout(focusCity, 50);
      }}
    />
  );
}
