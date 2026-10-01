"use client";

import { useState, type ReactNode } from "react";
import { Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Device = "mobile" | "tablet" | "desktop";

const DEVICES: ReadonlyArray<{ id: Device; label: string; icon: LucideIcon }> = [
  { id: "mobile", label: "Telemóvel", icon: Smartphone },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "desktop", label: "Computador", icon: Monitor },
];

/*
  Cada aparelho: a largura máxima da moldura (ecrã de ~390 px no telemóvel,
  ~768 px no tablet, a coluna toda no computador), a moldura e o ecrã. Tudo
  com o prefixo `sm:`: num ecrã estreito o próprio ecrã já é o telemóvel, e
  fica só o jogo com os cantos arredondados.

  A pré-visualização corre na própria página, não num iframe: a largura
  aproxima a do aparelho, mas o jogo continua a ver a janela do browser.
*/
const FRAME_CLASS: Record<Device, string> = {
  mobile:
    "sm:max-w-[25.875rem] sm:rounded-[2.75rem] sm:bg-caetano-anthracite sm:p-3 sm:shadow-lg sm:ring-1 sm:ring-caetano-anthracite-80",
  tablet:
    "sm:max-w-[50rem] sm:rounded-[2.25rem] sm:bg-caetano-anthracite sm:p-4 sm:shadow-lg sm:ring-1 sm:ring-caetano-anthracite-80",
  desktop:
    "sm:max-w-full sm:overflow-hidden sm:rounded-2xl sm:border sm:border-caetano-medium-gray-40 sm:bg-white sm:shadow-lg",
};

const SCREEN_CLASS: Record<Device, string> = {
  // O espaço de cima fica por baixo da câmara, com o fundo do tema.
  mobile: "sm:min-h-[44rem] sm:rounded-[2.125rem] sm:border-0 sm:[&>*]:pt-14",
  tablet: "sm:min-h-[38rem] sm:rounded-[1.25rem] sm:border-0",
  desktop: "sm:min-h-[34rem] sm:rounded-none sm:border-0",
};

/**
 * Molduras de aparelho para a pré-visualização: telemóvel, tablet e
 * computador (CLAUDE.md §18).
 *
 * A árvore é a mesma nos três (só mudam as classes, e a barra do browser e a
 * câmara ocupam sempre o mesmo lugar): mudar de aparelho não reinicia a
 * simulação que está a decorrer.
 */
export function PreviewDeviceFrame({ address, children }: { address: string; children: ReactNode }) {
  const [device, setDevice] = useState<Device>("mobile");

  return (
    <div className="space-y-5">
      <div className="hidden justify-center sm:flex">
        <div
          role="group"
          aria-label="Aparelho da pré-visualização"
          className="inline-flex gap-1 rounded-xl border border-caetano-medium-gray-40 bg-white p-1 shadow-xs"
        >
          {DEVICES.map(({ id, label, icon: Icon }) => {
            const active = device === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setDevice(id)}
                className={cn(
                  "inline-flex h-10 cursor-pointer touch-manipulation items-center gap-2 rounded-lg px-3.5 text-sm font-medium",
                  "transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo)",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-1",
                  active
                    ? "bg-caetano-deep-blue text-white shadow-sm"
                    : "text-caetano-anthracite hover:bg-caetano-medium-gray-20 hover:text-caetano-deep-blue",
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "relative mx-auto w-full transition-[max-width,padding,border-radius] duration-500 ease-(--ease-out-expo)",
          FRAME_CLASS[device],
        )}
      >
        {/* A barra da janela do browser: só desenho. */}
        {device === "desktop" ? (
          <div
            aria-hidden="true"
            className="hidden h-10 items-center gap-3 border-b border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-4 sm:flex"
          >
            <span className="flex shrink-0 gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-caetano-medium-gray-60" />
              <span className="h-2.5 w-2.5 rounded-full bg-caetano-medium-gray-60" />
              <span className="h-2.5 w-2.5 rounded-full bg-caetano-medium-gray-60" />
            </span>
            <span className="mx-auto min-w-0 max-w-md flex-1 truncate rounded-full border border-caetano-medium-gray-40 bg-white px-3 py-1 text-center text-xs text-caetano-anthracite-80">
              {address}
            </span>
            <span className="w-[2.625rem] shrink-0" />
          </div>
        ) : null}
        {/* A câmara do aparelho: só desenho. */}
        {device !== "desktop" ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-1/2 z-10 hidden -translate-x-1/2 rounded-full sm:block",
              device === "mobile" ? "top-6 h-6 w-24 bg-caetano-anthracite" : "top-[0.4375rem] h-1.5 w-1.5 bg-caetano-anthracite-60",
            )}
          />
        ) : null}
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-caetano-medium-gray-40 [&>*]:flex-1",
            SCREEN_CLASS[device],
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
