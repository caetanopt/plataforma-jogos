import { afterEach, describe, expect, it, vi } from "vitest";
import { runAction, UNEXPECTED_ERROR_MESSAGE } from "@/server/actions/run-action";
import { PermissionDeniedError } from "@/server/permissions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAction", () => {
  it("um erro inesperado não afirma que nada foi gravado, e o log leva só o nome do erro", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runAction("teste", async () => {
      // Ex.: a auditoria falha depois de a alteração já estar gravada.
      throw new TypeError("valor com dados pessoais: ana@example.pt");
    });

    expect(result).toMatchObject({ status: "error", message: UNEXPECTED_ERROR_MESSAGE });
    expect(UNEXPECTED_ERROR_MESSAGE).not.toMatch(/não foram guardadas/);
    expect(logged).toHaveBeenCalledWith("[action:teste] erro inesperado (TypeError)");
  });

  it("falta de permissão tem mensagem própria", async () => {
    const result = await runAction("teste", async () => {
      throw new PermissionDeniedError("campaign:edit");
    });

    expect(result).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });
  });
});
