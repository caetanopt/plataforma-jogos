"use client";

import { useId, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { Label } from "@/components/ui/label";
import { SyncedSelect } from "@/components/forms/synced-fields";
import { cn } from "@/lib/utils";
import { selectClass, SelectShell } from "@/components/ui/select";

interface FolderOption {
  id: string;
  name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
  folders: FolderOption[];
}

// `font-normal`: no formulário de criação o select fica dentro do label (Medium).
const selectClassName = cn(selectClass, "font-normal");

/**
 * Os selects de espaço de trabalho e pasta têm de reagir um ao outro no
 * cliente (a pasta pertence a um único espaço de trabalho) — como
 * `apps/new/page.tsx` é um Server Component sem JS entre os dois `<select>`,
 * mudar de espaço de trabalho não atualizava a lista de pastas, que ficava
 * sempre presa às pastas do primeiro espaço de trabalho.
 *
 * `variant="editor"` é a versão da etapa Informações (gravação automática):
 * labels com `htmlFor`, duas colunas a partir de `sm` e os valores gravados
 * como ponto de partida.
 */
export function WorkspaceFolderFields({
  workspaces,
  singleWorkspaceId,
  defaultWorkspaceId,
  defaultFolderId,
  variant = "create",
}: {
  workspaces: WorkspaceOption[];
  singleWorkspaceId?: string;
  defaultWorkspaceId?: string;
  defaultFolderId?: string | null;
  variant?: "create" | "editor";
}) {
  const idPrefix = useId();
  const initialWorkspaceId = singleWorkspaceId ?? defaultWorkspaceId ?? workspaces[0]?.id ?? "";
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);

  // O espaço gravado pode mudar no servidor depois de uma gravação: o select
  // segue-o (o estado inicial do useState só vale na primeira renderização).
  const [followedDefault, setFollowedDefault] = useState(initialWorkspaceId);
  if (initialWorkspaceId !== followedDefault) {
    setFollowedDefault(initialWorkspaceId);
    setWorkspaceId(initialWorkspaceId);
  }

  const folders = workspaces.find((w) => w.id === workspaceId)?.folders ?? [];
  const folderDefault = defaultFolderId && folders.some((f) => f.id === defaultFolderId) ? defaultFolderId : "";

  const handleWorkspaceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    // Síncrono: a gravação automática lê o formulário a seguir, no mesmo
    // evento, e a pasta já tem de ser uma do novo espaço ("Sem pasta"), não
    // a do anterior — que o servidor recusaria.
    flushSync(() => setWorkspaceId(next));
  };

  const editor = variant === "editor";
  // No formulário de criação o label envolve o select: a distância ao texto
  // é a mesma do `Label` (mb-1.5).
  const shellClassName = editor ? undefined : "mt-1.5";
  const workspaceFieldId = `${idPrefix}-workspaceId`;
  const folderFieldId = `${idPrefix}-folderId`;

  const workspaceSelect = (
    <SelectShell className={shellClassName}>
      <select
        id={workspaceFieldId}
        name="workspaceId"
        required
        value={workspaceId}
        onChange={handleWorkspaceChange}
        className={selectClassName}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </SelectShell>
  );

  // `key`: as opções mudam com o espaço, e o `defaultValue` de um select já
  // montado não volta a ser aplicado.
  const folderSelect = (
    <SelectShell className={shellClassName}>
      <SyncedSelect
        key={workspaceId}
        id={folderFieldId}
        name="folderId"
        defaultValue={folderDefault}
        className={selectClassName}
      >
        <option value="">Sem pasta</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </SyncedSelect>
    </SelectShell>
  );

  if (editor) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={workspaceFieldId}>Espaço de trabalho</Label>
          {workspaceSelect}
        </div>
        <div>
          <Label htmlFor={folderFieldId}>Pasta</Label>
          {folderSelect}
        </div>
      </div>
    );
  }

  return (
    <>
      {singleWorkspaceId ? (
        <input type="hidden" name="workspaceId" value={singleWorkspaceId} />
      ) : (
        <label className="mt-3 block text-sm font-medium text-caetano-anthracite">
          Espaço de trabalho
          {workspaceSelect}
        </label>
      )}

      <label className="mt-3 block text-sm font-medium text-caetano-anthracite">
        Pasta (opcional)
        {folderSelect}
      </label>
    </>
  );
}
