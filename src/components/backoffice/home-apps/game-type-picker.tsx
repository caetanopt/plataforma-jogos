"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Escolha do tipo de jogo em "Criar aplicação".
 *
 * Cada tipo continua a ser um formulário próprio, com o seu botão Criar (é o
 * que os testes e quem usa o teclado esperam); isto só guarda qual dos
 * cartões está a ser trabalhado — o último onde se clicou ou para onde foi o
 * foco — e marca-o como selecionado. A marca é visual: o formulário de cada
 * cartão diz por si o que cria.
 */
const SelectedTypeContext = createContext<{
  selected: string | null;
  select: (value: string) => void;
}>({ selected: null, select: () => {} });

export function GameTypePicker({ children, className }: { children: ReactNode; className?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <SelectedTypeContext.Provider value={{ selected, select: setSelected }}>
      <div className={className}>{children}</div>
    </SelectedTypeContext.Provider>
  );
}

export function GameTypeOption({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const { selected, select } = useContext(SelectedTypeContext);
  const isSelected = selected === value;

  return (
    <div
      data-selected={isSelected || undefined}
      onPointerDownCapture={() => select(value)}
      onFocusCapture={() => select(value)}
      className={cn("group/type", className)}
    >
      {children}
    </div>
  );
}
