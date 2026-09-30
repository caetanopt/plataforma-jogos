"use client";

import { useState } from "react";
import type { PublicLegalInfo, PublicLegalLink } from "@/features/play/types";

function ExternalLink({ link }: { link: PublicLegalLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent"
    >
      {link.label}
      <span className="sr-only"> (abre numa nova janela)</span>
    </a>
  );
}

function PrivacyContact({ email }: { email: string }) {
  return (
    <p>
      Contacto de privacidade:{" "}
      <a
        href={`mailto:${email}`}
        className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent"
      >
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
    <div className="space-y-1.5 text-xs text-game-muted">
      {legal.legalText && (
        <details>
          <summary className="cursor-pointer underline">Informação legal sobre o tratamento dos dados</summary>
          <p className="mt-1 whitespace-pre-line">{legal.legalText}</p>
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
    <footer className="space-y-2 rounded-game bg-game-surface px-4 py-3 text-center text-xs text-game-muted">
      <nav aria-label="Informação legal">
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
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
                className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent"
              >
                Regulamento
              </button>
            </li>
          )}
        </ul>
      </nav>
      {legal.privacyContactEmail && <PrivacyContact email={legal.privacyContactEmail} />}
      {regulationText && showRegulation && (
        <p id="regulation-text" className="whitespace-pre-line rounded-game bg-game-subtle p-3 text-left">
          {regulationText}
        </p>
      )}
    </footer>
  );
}
