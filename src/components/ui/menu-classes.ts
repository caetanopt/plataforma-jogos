import { cn } from "@/lib/utils";

/*
  Classes dos menus (DetailsMenu), num módulo sem "use client": importadas de
  details-menu.tsx por um Server Component, chegavam como referência de
  cliente (uma função) e a classe do botão ficava com o código dela em vez
  dos estilos.
*/

/** Estilo partilhado dos `<summary>` usados como botão de menu. */
export const summaryClass = cn(
  "flex h-8 w-8 cursor-pointer list-none select-none items-center justify-center rounded-lg [[open]>&]:bg-caetano-medium-gray-20",
  "text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
  // O Safari continua a desenhar o triângulo sem isto.
  "[&::-webkit-details-marker]:hidden",
);

/** Estilo partilhado dos itens dentro de um menu. */
export const menuItemClass = cn(
  "block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-caetano-anthracite",
  "transition-colors hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
);
