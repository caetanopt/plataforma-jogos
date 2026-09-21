import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/*
  Os tons -80/-60/... da paleta Caetano são mais CLAROS do que a cor base, por
  isso o hover aclara e o estado premido volta à cor base (mais escura). Dá a
  leitura habitual de "afundar" sem sair da paleta oficial.
*/
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-caetano-deep-blue text-white shadow-sm hover:bg-caetano-deep-blue-80 active:bg-caetano-deep-blue active:shadow-none",
  // Branco sobre o azul cyan dá 2,5:1. O azul profundo sobre o mesmo fundo dá
  // 5,4:1 e cumpre a WCAG 2.2 AA sem sair da paleta.
  secondary:
    "bg-caetano-cyan text-caetano-deep-blue shadow-sm hover:bg-caetano-cyan-80 active:bg-caetano-cyan active:shadow-none",
  outline:
    "border border-caetano-medium-gray text-caetano-anthracite hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  ghost: "text-caetano-anthracite hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  danger: "bg-danger text-white shadow-sm hover:bg-danger-strong active:bg-danger-strong active:shadow-none",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    // O preflight do Tailwind v4 deixou de pôr `cursor: pointer` nos botões;
    // sem `cursor-pointer` explícito deixam de parecer clicáveis.
    "inline-flex cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-lg font-medium select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    // O afundar é movimento: fica fora para quem pediu movimento reduzido.
    "motion-safe:active:scale-[0.97]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
