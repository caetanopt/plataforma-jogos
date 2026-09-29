import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Um ficheiro "use server" só pode exportar funções assíncronas: uma
 * constante exportada passa no typecheck, no lint e nos testes, mas o Next
 * recusa o módulo em runtime e todas as páginas que usam essas ações dão
 * erro. Só o e2e o apanhava.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('ficheiros "use server"', () => {
  const files = sourceFiles(join(process.cwd(), "src")).filter((file) =>
    /^\s*["']use server["']/.test(readFileSync(file, "utf8")),
  );

  it("existem (o teste encontra-os)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("só exportam funções assíncronas (e tipos)", () => {
    const offending = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^export\s+(const|let|var|class|enum|default|function\b|\{)/.test(line))
        .map((line) => `${file.replace(process.cwd(), "")}: ${line.trim()}`),
    );
    expect(offending).toEqual([]);
  });
});
