import nodemailer from "nodemailer";

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.MAIL_TRANSPORT === "smtp") {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const from = process.env.MAIL_FROM ?? "Plataforma de Jogos <no-reply@caetano.pt>";

  if (process.env.MAIL_TRANSPORT !== "smtp") {
    if (process.env.NODE_ENV === "production") {
      // Em produção, nunca escrever o corpo do e-mail nos logs — pode conter
      // um token de reset de password ou de convite. Isto é sobretudo um
      // aviso de configuração em falta (MAIL_TRANSPORT/SMTP_* não definidos):
      // o e-mail não está a ser entregue a ninguém.
      console.error(
        `[mail] MAIL_TRANSPORT não está definido como "smtp" em produção — e-mail para ${input.to} (assunto: "${input.subject}") NÃO foi enviado.`,
      );
      return;
    }
    console.log(
      `[mail:console] Para: ${input.to} | Assunto: ${input.subject}\n${input.text}`,
    );
    return;
  }

  await getTransporter().sendMail({ from, to: input.to, subject: input.subject, html: input.html, text: input.text });
}
