import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthBypassEnabled } from "@/server/auth/bypass";

describe("isAuthBypassEnabled", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nunca liga num build de produção, mesmo com DISABLE_AUTH=true", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(isAuthBypassEnabled({ DISABLE_AUTH: "true", NODE_ENV: "production" })).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  });

  it("liga só em desenvolvimento e só com o valor exato 'true'", () => {
    expect(isAuthBypassEnabled({ DISABLE_AUTH: "true", NODE_ENV: "development" })).toBe(true);
    expect(isAuthBypassEnabled({ DISABLE_AUTH: "1", NODE_ENV: "development" })).toBe(false);
    expect(isAuthBypassEnabled({ DISABLE_AUTH: "false", NODE_ENV: "development" })).toBe(false);
    expect(isAuthBypassEnabled({ NODE_ENV: "development" })).toBe(false);
  });
});
