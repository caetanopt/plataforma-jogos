"use client";

import { useState } from "react";

interface FolderOption {
  id: string;
  name: string;
}

interface WorkspaceOption {
  id: string;
  name: string;
  folders: FolderOption[];
}

/**
 * Os selects de espaço de trabalho e pasta têm de reagir um ao outro no
 * cliente (a pasta pertence a um único espaço de trabalho) — como
 * `apps/new/page.tsx` é um Server Component sem JS entre os dois `<select>`,
 * mudar de espaço de trabalho não atualizava a lista de pastas, que ficava
 * sempre presa às pastas do primeiro espaço de trabalho.
 */
export function WorkspaceFolderFields({
  workspaces,
  singleWorkspaceId,
  defaultFolderId,
}: {
  workspaces: WorkspaceOption[];
  singleWorkspaceId?: string;
  defaultFolderId?: string;
}) {
  const [workspaceId, setWorkspaceId] = useState(singleWorkspaceId ?? workspaces[0]?.id ?? "");
  const folders = workspaces.find((w) => w.id === workspaceId)?.folders ?? [];

  return (
    <>
      {singleWorkspaceId ? (
        <input type="hidden" name="workspaceId" value={singleWorkspaceId} />
      ) : (
        <label className="mt-3 block text-sm">
          Espaço de trabalho
          <select
            name="workspaceId"
            required
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
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
          key={workspaceId}
          name="folderId"
          defaultValue={folders.some((f) => f.id === defaultFolderId) ? defaultFolderId : ""}
          className="mt-1 h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
        >
          <option value="">Sem pasta</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
