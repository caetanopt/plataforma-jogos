import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm text-caetano-anthracite",
          "placeholder:text-caetano-medium-gray",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:border-caetano-cyan",
          "disabled:opacity-50",
          "aria-invalid:border-red-500",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
