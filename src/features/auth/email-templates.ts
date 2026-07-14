const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export function passwordResetEmail(resetToken: string) {
  const link = `${appUrl()}/reset-password/${resetToken}`;
  return {
    subject: "Recuperação de password — Plataforma de Jogos Caetano",
    text: `Recebemos um pedido de recuperação de password. Aceda a ${link} para definir uma nova password. Se não foi você, ignore este e-mail.`,
    html: `<p>Recebemos um pedido de recuperação de password.</p><p><a href="${link}">Definir nova password</a></p><p>Se não foi você, ignore este e-mail.</p>`,
  };
}

export function inviteUserEmail(setupToken: string, organizationName: string) {
  const link = `${appUrl()}/reset-password/${setupToken}`;
  return {
    subject: `Convite para a Plataforma de Jogos — ${organizationName}`,
    text: `Foi convidado para a organização ${organizationName}. Aceda a ${link} para definir a sua password e ativar a conta.`,
    html: `<p>Foi convidado para a organização <strong>${organizationName}</strong>.</p><p><a href="${link}">Definir password e ativar a conta</a></p>`,
  };
}
