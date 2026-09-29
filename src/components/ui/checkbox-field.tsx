import type { InputHTMLAttributes, ReactNode } from "react";

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "name" | "children"> {
  name: string;
  children: ReactNode;
  labelClassName?: string;
}

/**
 * Checkbox com sentinela: um `<input type="hidden" value="">` com o mesmo
 * nome vai sempre no FormData, e a ação distingue "desmarcada" de "este
 * formulário não tem este campo" (`readCheckbox`). Sem ela, uma ação de
 * edição não sabia se devia desligar a opção ou mantê-la.
 */
export function CheckboxField({ name, children, labelClassName, className, ...props }: CheckboxFieldProps) {
  return (
    <label className={labelClassName ?? "flex items-center gap-2 text-sm text-caetano-anthracite"}>
      <input type="hidden" name={name} value="" />
      <input
        type="checkbox"
        name={name}
        className={className ?? "h-4 w-4 rounded border-caetano-medium-gray"}
        {...props}
      />
      {children}
    </label>
  );
}
