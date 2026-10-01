"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink as ExternalLinkIcon } from "lucide-react";
import type { PublicLegalInfo, PublicLegalLink } from "@/features/play/types";

// Alvo de pelo menos 24 px (WCAG 2.2, 2.5.8) e o foco na cor de destaque.
const legalLinkClass =
  "inline-flex min-h-6 items-center gap-1 rounded-sm underline decoration-1 underline-offset-4 transition-colors duration-150 hover:text-game-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent";

function ExternalLink({ link }: { link: PublicLegalLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={legalLinkClass}
    >
      {link.label}
      <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only"> (abre numa nova janela)</span>
    </a>
  );
}

function PrivacyContact({ email }: { email: string }) {
  return (
    <p>
      Contacto de privacidade:{" "}
      <a href={`mailto:${email}`} className={legalLinkClass}>
        {email}
      </a>
    </p>
  );
}

/**
 * Junto ao formulário de leads: a informação do art. 13.º do RGPD tem de
 * estar à mão no momento em que os dados são pedidos, e antes o formulário
 * recolhia nome, e-mail e telefone sem aviso nenhum.
 */
export function PrivacyNotice({ legal }: { legal: PublicLegalInfo }) {
  const privacyPolicy = legal.links.find((link) => link.key === "privacyPolicyUrl");
  if (!legal.legalText && !privacyPolicy && !legal.privacyContactEmail) return null;

  return (
    <div className="space-y-1.5 border-t border-game-border pt-4 text-xs leading-relaxed text-game-muted">
      {legal.legalText && (
        <details className="group">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm underline decoration-1 underline-offset-4 hover:text-game-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent [&::-webkit-details-marker]:hidden">
            Informação legal sobre o tratamento dos dados
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-[rotate] duration-200 ease-(--ease-out-expo) group-open:rotate-180"
            />
          </summary>
          <p className="mt-1.5 whitespace-pre-line motion-safe:animate-fade-in">{legal.legalText}</p>
        </details>
      )}
      {privacyPolicy && (
        <p>
          <ExternalLink link={privacyPolicy} />
        </p>
      )}
      {legal.privacyContactEmail && <PrivacyContact email={legal.privacyContactEmail} />}
    </div>
  );
}

/** Rodapé do jogo: links legais, contacto de privacidade e regulamento. */
export function LegalFooter({ legal, regulationText }: { legal: PublicLegalInfo; regulationText: string | null }) {
  const [showRegulation, setShowRegulation] = useState(false);
  if (legal.links.length === 0 && !legal.privacyContactEmail && !regulationText) return null;

  return (
    // Com fundo próprio: sobre uma imagem de fundo, o texto tem de se ler.
    <footer className="space-y-1.5 rounded-game-lg border border-game-border bg-game-surface px-4 py-3 text-center text-xs text-game-muted shadow-(--game-elevation-sm)">
      <nav aria-label="Informação legal">
        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {legal.links.map((link) => (
            <li key={link.key}>
              <ExternalLink link={link} />
            </li>
          ))}
          {regulationText && (
            <li>
              <button
                type="button"
                onClick={() => setShowRegulation((value) => !value)}
                aria-expanded={showRegulation}
                aria-controls="regulation-text"
                className={`${legalLinkClass} cursor-pointer`}
              >
                Regulamento
                <ChevronDown
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 transition-[rotate] duration-200 ease-(--ease-out-expo) ${showRegulation ? "rotate-180" : ""}`}
                />
              </button>
            </li>
          )}
        </ul>
      </nav>
      {legal.privacyContactEmail && <PrivacyContact email={legal.privacyContactEmail} />}
      {regulationText && showRegulation && (
        <p
          id="regulation-text"
          className="whitespace-pre-line rounded-game bg-game-subtle p-4 text-left leading-relaxed text-game-subtle-text motion-safe:animate-fade-in"
        >
          {regulationText}
        </p>
      )}
    </footer>
  );
}
