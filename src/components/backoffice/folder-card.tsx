import Link from "next/link";
import { Folder as FolderIcon } from "lucide-react";
import {
  archiveFolderAction,
  deleteFolderAction,
  renameFolderAction,
  unarchiveFolderAction,
} from "@/features/folders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { DetailsMenu, menuItemClass } from "@/components/ui/details-menu";
import type { FolderSort, FolderTab } from "@/features/folders/view-params";

export function FolderCard({
  id,
  name,
  workspaceName,
  campaignCount,
  isArchived,
  canManage,
  tab,
  sort,
}: {
  id: string;
  name: string;
  workspaceName: string;
  campaignCount: number;
  isArchived: boolean;
  canManage: boolean;
  /** Vista atual, reenviada nas ações para o utilizador voltar onde estava. */
  tab: FolderTab;
  sort: FolderSort;
}) {
  return (
    <div className="relative">
      {/*
        Efeito de "papéis empilhados" por baixo do cartão: duas faixas
        decorativas, cada vez mais estreitas, que só espreitam na base. São
        puramente visuais — aria-hidden para não aparecerem a leitores de ecrã.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-x-6 -bottom-2 h-3 rounded-b-xl border border-t-0 border-caetano-medium-gray-40 bg-caetano-medium-gray-20"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-3 -bottom-1 h-3 rounded-b-xl border border-t-0 border-caetano-medium-gray-40 bg-white"
      />

      <article className="relative flex items-start gap-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4 transition-shadow focus-within:shadow-md hover:shadow-md">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-caetano-cyan-20 text-caetano-deep-blue"
          aria-hidden="true"
        >
          <FolderIcon size={20} />
        </span>

        <div className="min-w-0 flex-1">
          {/*
            O link cobre o cartão inteiro (área clicável generosa, WCAG 2.2
            "Target Size"), mas fica por baixo do menu "..." em z-index para
            que as ações continuem a ser acionáveis.
          */}
          <h3 className="truncate text-sm font-bold text-caetano-anthracite">
            <Link
              href={`/apps?folderId=${id}`}
              // O anel é desenhado pelo pseudo-elemento que cobre o cartão,
              // para o foco envolver o cartão inteiro e não só o texto.
              className="outline-none before:absolute before:inset-0 before:rounded-xl focus-visible:before:ring-2 focus-visible:before:ring-caetano-cyan focus-visible:before:ring-offset-2"
            >
              {name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-caetano-anthracite-80">{workspaceName}</p>
          <p className="mt-1 text-xs text-caetano-anthracite-80">
            {campaignCount === 1 ? "1 aplicação" : `${campaignCount} aplicações`}
            {isArchived ? " · arquivada" : ""}
          </p>
        </div>

        {canManage && (
          <div className="relative z-10 shrink-0">
            <DetailsMenu label={<span aria-hidden="true">⋯</span>} ariaLabel={`Ações da pasta ${name}`} panelClassName="w-64">
              <Link href={`/apps?folderId=${id}`} className={menuItemClass}>
                Ver aplicações
              </Link>

              <form action={renameFolderAction} className="flex gap-1 p-1">
                <input type="hidden" name="folderId" value={id} />
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="sort" value={sort} />
                <Input
                  name="name"
                  defaultValue={name}
                  required
                  maxLength={120}
                  aria-label={`Novo nome da pasta ${name}`}
                  className="h-8"
                />
                <Button type="submit" size="sm" variant="outline">
                  Guardar
                </Button>
              </form>

              <form action={isArchived ? unarchiveFolderAction : archiveFolderAction}>
                <input type="hidden" name="folderId" value={id} />
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="sort" value={sort} />
                <button type="submit" className={menuItemClass}>
                  {isArchived ? "Restaurar" : "Arquivar"}
                </button>
              </form>

              <form action={deleteFolderAction}>
                <input type="hidden" name="folderId" value={id} />
                <input type="hidden" name="tab" value={tab} />
                <input type="hidden" name="sort" value={sort} />
                <ConfirmSubmitButton
                  confirmMessage={`Eliminar a pasta "${name}"? Só é possível se estiver vazia.`}
                  variant="ghost"
                  size="sm"
                  className={`${menuItemClass} text-danger`}
                >
                  Eliminar
                </ConfirmSubmitButton>
              </form>
            </DetailsMenu>
          </div>
        )}
      </article>
    </div>
  );
}
