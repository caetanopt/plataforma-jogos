import { ArrowRight, Check, CircleCheck } from "lucide-react";
import { requirePagePermission } from "@/server/auth/page-guard";
import { prisma } from "@/server/db/client";
import { createCampaignAction } from "@/features/campaigns/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { WorkspaceFolderFields } from "@/components/backoffice/workspace-folder-fields";
import { GameTypeArtwork, GameTypeTile } from "@/components/backoffice/home-apps/game-type-art";
import { GameTypeOption, GameTypePicker } from "@/components/backoffice/home-apps/game-type-picker";
import type { CampaignType } from "@/generated/prisma/client";

const GAME_TYPES: Array<{
  type: CampaignType;
  label: string;
  description: string;
  /** O essencial de cada jogo, para escolher sem abrir o editor. */
  highlights: string[];
}> = [
  {
    type: "MEMORY",
    label: "Jogo da Memória",
    description: "Descubra os pares de cartas iguais no menor tempo possível.",
    highlights: ["Pares de imagem ou de texto", "Tempo limite e tentativas", "Pontuação e ranking"],
  },
  {
    type: "WHEEL",
    label: "Roda da Sorte",
    description: "Gire a roda e descubra o prémio, com resultado sempre validado no servidor.",
    highlights: ["Prémios com stock", "Peso por segmento", "Códigos de prémio"],
  },
  {
    type: "QUIZ",
    label: "Quiz Interativo",
    description: "Perguntas com pontuação, tempo e perfis de resultado personalizados.",
    highlights: ["Escolha única ou múltipla", "Tempo por pergunta", "Perfis de resultado"],
  },
];

/*
  Os campos de espaço e pasta vêm de WorkspaceFolderFields (partilhado com o
  editor), que já têm o aspeto dos outros seletores; aqui só a etiqueta em
  Medium, como o resto do formulário.
*/
const fieldsClass = "[&_label]:font-medium [&_label]:text-caetano-anthracite";

export default async function NewAppPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; folderId?: string }>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("campaign:create");

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    include: { folders: { where: { archivedAt: null }, orderBy: { name: "asc" } } },
  });

  const singleWorkspace = workspaces.length === 1 ? workspaces[0] : null;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        eyebrow="Nova aplicação"
        title="Escolha um tipo de jogo"
        description="Disponíveis nesta primeira fase: Jogo da Memória, Roda da Sorte e Quiz Interativo."
      />

      {params.error && (
        <div className="mb-6">
          <Alert variant="error">Não foi possível criar a aplicação. Verifique os dados.</Alert>
        </div>
      )}

      {workspaces.length === 0 ? (
        <Alert variant="info">
          Ainda não existe nenhum espaço de trabalho. Crie um em &quot;Espaços de trabalho&quot;
          antes de criar a primeira aplicação.
        </Alert>
      ) : (
        <GameTypePicker className="stagger grid grid-cols-1 gap-5 xl:grid-cols-3">
          {GAME_TYPES.map((game) => {
            const titleId = `game-type-${game.type.toLowerCase()}`;
            return (
              <GameTypeOption
                key={game.type}
                value={game.type}
                className={[
                  "relative flex rounded-3xl border border-caetano-medium-gray-40 bg-white shadow-xs",
                  "transition-[box-shadow,border-color,translate] duration-300 ease-(--ease-out-expo)",
                  "hover:border-caetano-medium-gray-60 hover:shadow-md motion-safe:hover:-translate-y-0.5",
                  // Selecionado: a borda passa ao azul profundo, com um halo do azul cyan.
                  "data-selected:border-caetano-deep-blue data-selected:shadow-md data-selected:ring-4 data-selected:ring-caetano-cyan-20",
                ].join(" ")}
              >
                <form
                  action={createCampaignAction}
                  aria-labelledby={titleId}
                  className="flex w-full flex-col sm:flex-row xl:flex-col"
                >
                  <input type="hidden" name="type" value={game.type} />

                  <div className="relative shrink-0">
                    <GameTypeArtwork
                      type={game.type}
                      size="lg"
                      className="h-40 rounded-t-3xl sm:h-full sm:min-h-56 sm:w-56 sm:rounded-l-3xl sm:rounded-tr-none xl:h-44 xl:min-h-0 xl:w-full xl:rounded-t-3xl xl:rounded-bl-none"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-caetano-deep-blue text-white opacity-0 shadow-md transition-[opacity,scale] duration-300 ease-(--ease-out-expo) motion-safe:scale-75 group-data-selected/type:opacity-100 motion-safe:group-data-selected/type:scale-100"
                    >
                      <Check size={16} strokeWidth={3} />
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-6">
                    <div className="flex items-center gap-3">
                      <GameTypeTile type={game.type} />
                      <h2 id={titleId} className="text-lg font-bold leading-tight text-caetano-deep-blue">
                        {game.label}
                      </h2>
                    </div>
                    <p className="mt-3 text-sm text-caetano-anthracite-80">{game.description}</p>

                    <ul className="mt-4 space-y-1.5 text-sm text-caetano-anthracite">
                      {game.highlights.map((highlight) => (
                        <li key={highlight} className="flex items-start gap-2">
                          <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-caetano-cyan" />
                          {highlight}
                        </li>
                      ))}
                    </ul>

                    <div className={`mt-auto pt-4 [&_label:first-of-type]:mt-0 ${fieldsClass}`}>
                      <WorkspaceFolderFields
                        workspaces={workspaces}
                        singleWorkspaceId={singleWorkspace?.id}
                        defaultFolderId={params.folderId}
                      />
                    </div>

                    <SubmitButton pendingLabel="A criar…" size="lg" className="mt-5 w-full">
                      Criar
                      <ArrowRight
                        size={18}
                        aria-hidden="true"
                        className="transition-transform duration-200 ease-(--ease-out-expo) motion-safe:group-hover/type:translate-x-0.5"
                      />
                    </SubmitButton>
                  </div>
                </form>
              </GameTypeOption>
            );
          })}
        </GameTypePicker>
      )}
    </div>
  );
}
