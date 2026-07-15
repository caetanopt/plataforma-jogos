import { requireOrgContext } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { inviteUserAction, removeMembershipAction, updateMembershipAction } from "@/features/users/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/labels";

const ERROR_MESSAGES: Record<string, string> = {
  validation: "Verifique os dados do convite.",
  already_member: "Este utilizador já pertence à organização.",
  last_admin: "Tem de existir pelo menos um administrador na organização.",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await requireOrgContext();
  assertCan(context, "user:manage");
  const search = await searchParams;

  const memberships = await prisma.membership.findMany({
    where: { organizationId: context.organizationId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">Utilizadores</h1>
      <p className="mt-1 text-caetano-medium-gray">
        Convide colegas e defina o papel de cada um na organização.
      </p>

      {search.error && (
        <div className="mt-4">
          <Alert variant="error">{ERROR_MESSAGES[search.error] ?? "Não foi possível concluir a operação."}</Alert>
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-caetano-medium-gray/30 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-caetano-medium-gray/20 text-left text-xs uppercase text-caetano-medium-gray">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Permissões extra</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-caetano-medium-gray/10">
            {memberships.map((membership) => (
              <tr key={membership.id}>
                <td className="px-4 py-3">{membership.user.name}</td>
                <td className="px-4 py-3 text-caetano-medium-gray">{membership.user.email}</td>
                <td className="px-4 py-3">{MEMBERSHIP_ROLE_LABELS[membership.role]}</td>
                <td className="px-4 py-3 text-xs text-caetano-medium-gray">
                  {membership.canPublish && "Publicar "}
                  {membership.canExportLeads && "Exportar leads"}
                </td>
                <td className="px-4 py-3">
                  <details>
                    <summary className="cursor-pointer text-caetano-cyan">Editar</summary>
                    <form action={updateMembershipAction} className="mt-2 w-56 space-y-2">
                      <input type="hidden" name="membershipId" value={membership.id} />
                      <select
                        name="role"
                        defaultValue={membership.role}
                        className="h-9 w-full rounded-lg border border-caetano-medium-gray px-2 text-sm"
                      >
                        {Object.entries(MEMBERSHIP_ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          name="canPublish"
                          defaultChecked={membership.canPublish}
                          className="h-4 w-4 rounded border-caetano-medium-gray"
                        />
                        Pode publicar (Editor)
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          name="canExportLeads"
                          defaultChecked={membership.canExportLeads}
                          className="h-4 w-4 rounded border-caetano-medium-gray"
                        />
                        Pode exportar leads (Analista)
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Guardar
                      </Button>
                    </form>
                    <form action={removeMembershipAction} className="mt-2">
                      <input type="hidden" name="membershipId" value={membership.id} />
                      <ConfirmSubmitButton
                        confirmMessage={`Remover ${membership.user.name} da organização?`}
                        size="sm"
                      >
                        Remover
                      </ConfirmSubmitButton>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(context, "user:manage") && (
        <div className="mt-8 max-w-md rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Convidar utilizador</h2>
          <form action={inviteUserAction} className="space-y-3">
            <div>
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="role">Papel</Label>
              <select
                id="role"
                name="role"
                defaultValue="VIEWER"
                className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
              >
                {Object.entries(MEMBERSHIP_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="canPublish" className="h-4 w-4 rounded border-caetano-medium-gray" />
              Pode publicar (aplica-se ao papel Editor)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="canExportLeads" className="h-4 w-4 rounded border-caetano-medium-gray" />
              Pode exportar leads (aplica-se ao papel Analista)
            </label>
            <Button type="submit">Enviar convite</Button>
          </form>
        </div>
      )}
    </div>
  );
}
