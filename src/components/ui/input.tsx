import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          // A borda chega aos 3:1 de um controlo (WCAG 1.4.11); o cinza médio
          // ficava nos 2,2:1 sobre branco.
          "h-10 w-full rounded-lg border border-caetano-anthracite-60 bg-white px-3 text-sm text-caetano-anthracite shadow-xs",
          "transition-[border-color,box-shadow] duration-200 hover:border-caetano-anthracite-80",
          "placeholder:text-caetano-anthracite-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:border-caetano-deep-blue",
          "disabled:opacity-50",
          "aria-invalid:border-danger",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
