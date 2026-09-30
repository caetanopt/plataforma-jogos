import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    // Só o compilador do Next sabe carregar estas fontes (ver o stub).
    alias: { "next/font/google": fileURLToPath(new URL("./tests/stubs/next-font-google.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
