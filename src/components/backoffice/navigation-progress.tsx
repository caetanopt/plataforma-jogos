"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import Link, { useLinkStatus } from "next/link";

/**
 * Barra de progresso de navegação.
 *
 * O Next 16 não expõe um evento global de navegação: `useLinkStatus` só
 * funciona dentro de um `<Link>` e reporta apenas esse link
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md).
 * Por isso a barra vive num contexto e cada `ProgressLink` inclui um filho
 * invisível que reporta o seu estado pendente para cima.
 *
 * Complementa — não substitui — os ficheiros `loading.tsx`: a barra cobre a
 * fase em que a rota ainda está a ser obtida (rede lenta, rota não
 * pré-carregada) e o `loading.tsx` cobre a fase de carregamento dos dados.
 */

interface NavigationProgressContextValue {
  setPending: (id: string, pending: boolean) => void;
}

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null);

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const setPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      if (pending === current.has(id)) return current;
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ setPending }), [setPending]);

  return (
    <NavigationProgressContext.Provider value={value}>
      <NavigationProgressBar active={pendingIds.size > 0} />
      {children}
    </NavigationProgressContext.Provider>
  );
}

function NavigationProgressBar({ active }: { active: boolean }) {
  return (
    <div
      // A barra é decoração: o anúncio de que a página mudou é responsabilidade
      // da própria página, não de um indicador visual.
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 transition-opacity duration-150 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`h-full bg-caetano-cyan ${
          active ? "motion-safe:animate-nav-progress w-full motion-reduce:w-full" : "w-0"
        }`}
      />
    </div>
  );
}

let linkCounter = 0;

function PendingReporter() {
  const { pending } = useLinkStatus();
  const context = useContext(NavigationProgressContext);
  // Um id estável por instância, para que dois links pendentes não se anulem.
  const [id] = useState(() => `link-${(linkCounter += 1)}`);

  useEffect(() => {
    if (!context) return;
    context.setPending(id, pending);
    return () => context.setPending(id, false);
  }, [context, id, pending]);

  return null;
}

/**
 * `<Link>` que alimenta a barra de progresso.
 *
 * Usar nas superfícies de navegação principais. Para links que não mudam de
 * rota (âncoras, filtros por query string) o `<Link>` normal chega.
 */
export function ProgressLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <PendingReporter />
    </Link>
  );
}
