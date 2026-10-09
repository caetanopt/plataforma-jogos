import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authBypassMode,
  isProductionDomainHost,
  LOGIN_DISABLED_IN_PRODUCTION,
} from "@/server/auth/bypass";

const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));

/** O deploy de produção do Vercel, como o Vercel o descreve ao servidor. */
const VERCEL_PRODUCTION = { VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" };

describe("authBypassMode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("DISABLE_AUTH nunca liga num build de produção", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(authBypassMode({ DISABLE_AUTH: "true", NODE_ENV: "production" }, false)).toBe("off");
    expect(error).toHaveBeenCalledOnce();
  });

  it("DISABLE_AUTH liga só em desenvolvimento e só com o valor exato 'true'", () => {
    expect(authBypassMode({ DISABLE_AUTH: "true", NODE_ENV: "development" }, false)).toBe("local");
    expect(authBypassMode({ DISABLE_AUTH: "1", NODE_ENV: "development" }, false)).toBe("off");
    expect(authBypassMode({ DISABLE_AUTH: "false", NODE_ENV: "development" }, false)).toBe("off");
    expect(authBypassMode({ NODE_ENV: "development" }, false)).toBe("off");
  });

  describe("login desligado em produção", () => {
    it("liga no deploy de produção do Vercel, sem precisar de DISABLE_AUTH", () => {
      expect(authBypassMode(VERCEL_PRODUCTION, true)).toBe("production-domain");
    });

    it("não liga nos previews, fora do Vercel, nem num next dev com as variáveis de produção", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(authBypassMode({ ...VERCEL_PRODUCTION, VERCEL_ENV: "preview" }, true)).toBe("off");
      expect(authBypassMode({ VERCEL_ENV: "production", NODE_ENV: "production" }, true)).toBe(
        "off",
      );
      // `vercel env pull --environment=production` seguido de `next dev`.
      expect(authBypassMode({ ...VERCEL_PRODUCTION, NODE_ENV: "development" }, true)).toBe("off");
      // A guarda do DISABLE_AUTH continua de pé num preview.
      expect(
        authBypassMode({ ...VERCEL_PRODUCTION, VERCEL_ENV: "preview", DISABLE_AUTH: "true" }, true),
      ).toBe("off");
      expect(error).toHaveBeenCalledOnce();
    });

    it("com o interruptor desligado, produção volta a exigir login", () => {
      expect(authBypassMode(VERCEL_PRODUCTION, false)).toBe("off");
    });

    it("o valor por omissão é o do interruptor", () => {
      expect(authBypassMode(VERCEL_PRODUCTION)).toBe(
        LOGIN_DISABLED_IN_PRODUCTION ? "production-domain" : "off",
      );
    });
  });
});

describe("isProductionDomainHost", () => {
  const env = { VERCEL_PROJECT_PRODUCTION_URL: "jogos.caetano.pt" };

  it("só o domínio de produção, sem distinguir maiúsculas", () => {
    expect(isProductionDomainHost("jogos.caetano.pt", env)).toBe(true);
    expect(isProductionDomainHost("Jogos.Caetano.PT", env)).toBe(true);
  });

  it("o URL próprio de um deploy, outro domínio ou outra porta pedem login", () => {
    expect(isProductionDomainHost("plataforma-jogos-3oigidd52-caetanopt.vercel.app", env)).toBe(
      false,
    );
    expect(isProductionDomainHost("jogos.caetano.pt.evil.test", env)).toBe(false);
    expect(isProductionDomainHost("jogos.caetano.pt:8443", env)).toBe(false);
  });

  it("sem host ou sem domínio de produção configurado, pede login", () => {
    expect(isProductionDomainHost(null, env)).toBe(false);
    expect(isProductionDomainHost("", env)).toBe(false);
    expect(isProductionDomainHost("jogos.caetano.pt", {})).toBe(false);
    expect(isProductionDomainHost("jogos.caetano.pt", { VERCEL_PROJECT_PRODUCTION_URL: " " })).toBe(
      false,
    );
  });
});

describe("isLoginBypassed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    headersMock.mockReset();
  });

  /** O modo é decidido ao carregar o módulo: carrega-o de novo com este ambiente. */
  async function loadWithEnv(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    return import("@/server/auth/bypass");
  }

  function requestTo(host: string) {
    headersMock.mockResolvedValue(new Headers({ host }));
  }

  it.runIf(LOGIN_DISABLED_IN_PRODUCTION)(
    "no deploy de produção, entra sem login só pelo domínio de produção",
    async () => {
      const { isLoginBypassed } = await loadWithEnv({
        ...VERCEL_PRODUCTION,
        VERCEL_PROJECT_PRODUCTION_URL: "jogos.caetano.pt",
      });

      requestTo("jogos.caetano.pt");
      expect(await isLoginBypassed()).toBe(true);

      requestTo("plataforma-jogos-3oigidd52-caetanopt.vercel.app");
      expect(await isLoginBypassed()).toBe(false);
    },
  );

  it("num preview, nem pelo domínio de produção", async () => {
    const { isLoginBypassed } = await loadWithEnv({
      ...VERCEL_PRODUCTION,
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "jogos.caetano.pt",
    });

    requestTo("jogos.caetano.pt");
    expect(await isLoginBypassed()).toBe(false);
  });
});
