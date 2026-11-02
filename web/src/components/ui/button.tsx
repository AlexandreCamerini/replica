"use client";

import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";

type Variant = "primary" | "secondary" | "ghost" | "inverse" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent border-accent data-[hovered]:bg-[color-mix(in_srgb,var(--accent),black_10%)]",
  secondary: "bg-surface text-fg border-border-input data-[hovered]:bg-surface-sunken",
  ghost: "bg-transparent text-fg border-transparent data-[hovered]:bg-surface-sunken",
  inverse: "bg-surface-inverse text-on-inverse border-surface-inverse data-[hovered]:opacity-90",
  danger: "bg-surface text-danger border-danger data-[hovered]:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export type ButtonProps = AriaButtonProps & {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function Button({ variant = "secondary", size = "md", icon, className, children, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={clsx(
        "relative inline-flex select-none items-center justify-center rounded-pill border-[1.5px] font-semibold whitespace-nowrap",
        "transition-colors outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus",
        "data-[pressed]:scale-[.98] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        // área de toque ≥ 44px mesmo no tamanho sm
        "before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {({ isPending }) => (
        <>
          {isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
          <span>{children}</span>
        </>
      )}
    </AriaButton>
  );
}
