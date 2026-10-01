import type { ReactNode } from "react";

/**
 * Entrada de cada secção do backoffice: o conteúdo aparece e assenta ao mudar
 * de secção (Início, Aplicações, Leads...).
 *
 * Um template e não o layout: o Next remonta-o só quando o primeiro segmento
 * muda (node_modules/next/dist/docs/.../template.md) — dentro do editor de uma
 * campanha, ao passar de etapa, não volta a animar a página toda. Não é um
 * `loading.tsx` (ver skeleton.tsx): não muda a renderização nem o
 * `revalidatePath` das server actions.
 */
export default function BackofficeTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-enter">{children}</div>;
}
