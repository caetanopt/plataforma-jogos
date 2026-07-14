import { Brain, Disc3, ListChecks } from "lucide-react";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { assertCan } from "@/server/permissions";
import { createCampaignAction } from "@/features/campaigns/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { CampaignType } from "@/generated/prisma/client";

const GAME_TYPES: Array<{
  type: CampaignType;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  {
    type: "MEMORY",
    label: "Jogo da Memória",
    description: "Descubra os pares de cartas iguais no menor tempo possível.",
    icon: Brain,
  },
  {
    type: "WHEEL",
    label: "Roda da Sorte",
    description: "Gire a roda e descubra o prémio, com resultado sempre validado no servidor.",
    icon: Disc3,
  },
  {
    type: "QUIZ",
    label: "Quiz Interativo",
    description: "Perguntas com pontuação, tempo e perfis de resultado personalizados.",
    icon: ListChecks,
  },
];

export default async function NewAppPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; folderId?: string }>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  assertCan(context, "campaign:create");

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    include: { folders: { where: { archivedAt: null }, orderBy: { name: "asc" } } },
  });

  const singleWorkspace = workspaces.length === 1 ? workspaces[0] : null;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">Escolha um tipo de jogo</h1>
      <p className="mt-1 text-caetano-medium-gray">
        Disponíveis nesta primeira fase: Jogo da Memória, Roda da Sorte e Quiz Interativo.
      </p>

      {params.error && (
        <div className="mt-4">
          <Alert variant="error">Não foi possível criar a aplicação. Verifique os dados.</Alert>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className="mt-6">
          <Alert variant="info">
            Ainda não existe nenhum espaço de trabalho. Crie um em &quot;Espaços de trabalho&quot;
            antes de criar a primeira aplicação.
          </Alert>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAME_TYPES.map((game) => {
            const Icon = game.icon;
            return (
              <form
                key={game.type}
                action={createCampaignAction}
                className="flex flex-col rounded-xl border border-caetano-medium-gray/30 bg-white p-5"
              >
                <input type="hidden" name="type" value={game.type} />
                <Icon size={28} className="mb-3 text-caetano-cyan" aria-hidden="true" />
                <h2 className="font-semibold text-caetano-anthracite">{game.label}</h2>
                <p className="mt-1 flex-1 text-sm text-caetano-medium-gray">{game.description}</p>

                {singleWorkspace ? (
                  <input type="hidden" name="workspaceId" value={singleWorkspace.id} />
                ) : (
                  <label className="mt-3 block text-sm">
                    Espaço de trabalho
                    <select
                      name="workspaceId"
                      required
                      className="mt-1 h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
                    >
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="mt-3 block text-sm">
                  Pasta (opcional)
                  <select
                    name="folderId"
                    defaultValue={params.folderId ?? ""}
                    className="mt-1 h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
                  >
                    <option value="">Sem pasta</option>
                    {(singleWorkspace ?? workspaces[0]).folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>

                <Button type="submit" className="mt-4 w-full">
                  Criar
                </Button>
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}
