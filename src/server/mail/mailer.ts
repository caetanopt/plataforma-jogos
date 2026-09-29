import nodemailer from "nodemailer";

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Falha de envio sem os dados da mensagem. O erro do nodemailer traz o
 * destinatário (`rejected`, `rejectedErrors[].recipient`, a resposta do
 * servidor) e o Next imprime-o inteiro nos logs. Fica só o código.
 */
export class MailDeliveryError extends Error {
  constructor(cause: unknown) {
    const { code, responseCode } = (cause ?? {}) as { code?: string; responseCode?: number };
    super(`Falha no envio de e-mail (${code ?? "desconhecido"}${responseCode ? ` ${responseCode}` : ""})`);
    this.name = "MailDeliveryError";
  }
}

/** Tolerante a maiúsculas e espaços: "SMTP" ou " smtp" no Vercel contam. */
function usesSmtp(): boolean {
  return process.env.MAIL_TRANSPORT?.trim().toLowerCase() === "smtp";
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    // Os valores por omissão (até 2 minutos) passam o tempo máximo de uma
    // função serverless: o pedido morria antes de o erro ser tratado.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const from = process.env.MAIL_FROM ?? "Plataforma de Jogos <no-reply@caetano.pt>";

  if (!usesSmtp()) {
    if (process.env.NODE_ENV === "production") {
      // Aviso de configuração, sem nada da mensagem: o destinatário é um dado
      // pessoal e o corpo leva o token de reposição ou de convite.
      console.error('[mail] MAIL_TRANSPORT não é "smtp" em produção — o e-mail NÃO foi enviado.');
      return;
    }
    // Só em desenvolvimento: o link com o token aparece no terminal local.
    console.log(`[mail:console] Para: ${input.to} | Assunto: ${input.subject}\n${input.text}`);
    return;
  }

  try {
    await getTransporter().sendMail({ from, to: input.to, subject: input.subject, html: input.html, text: input.text });
  } catch (error) {
    throw new MailDeliveryError(error);
  }
}
