"use client";

import type { ButtonHTMLAttributes } from "react";
import { buttonVariants, type ButtonVariant, type ButtonSize } from "@/components/ui/button";

interface ConfirmSubmitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  confirmMessage: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ConfirmSubmitButton({
  confirmMessage,
  variant = "danger",
  size = "sm",
  className,
  onClick,
  ...props
}: ConfirmSubmitButtonProps) {
  return (
    <button
      type="submit"
      className={buttonVariants({ variant, size, className })}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
}
