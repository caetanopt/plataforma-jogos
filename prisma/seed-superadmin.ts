import { newPasswordSchema } from "../src/lib/validation/auth";

/**
 * Decide o que o seed faz à password do superadmin.
 *
 * A regra que isto protege: uma password só é escrita no output quando foi
 * gerada aqui E o seed corre num terminal interativo fora de CI. Em qualquer
 * outro caso — GitHub Actions, Vercel, output redirecionado para ficheiro — a
 * saída fica guardada em logs que outras pessoas leem. Foi assim que a
 * password de produção ficou exposta num log do GitHub Actions.
 *
 * Fora desse caso, a password tem de vir de `SEED_SUPERADMIN_PASSWORD` (em CI,
 * um secret do repositório), que quem corre o seed já conhece.
 */

export type SuperAdminPasswordPlan =
  | { kind: "keep" }
  | { kind: "create"; password: string; reveal: boolean }
  | { kind: "reset"; password: string }
  | { kind: "error"; message: string };

export interface SuperAdminPasswordInput {
  userExists: boolean;
  /**
   * `SEED_SUPERADMIN_PASSWORD`. A string vazia conta como ausente: é o que o
   * GitHub Actions passa quando o secret não está definido.
   */
  providedPassword: string | undefined;
  /** `SEED_SUPERADMIN_RESET_PASSWORD=true`: substituir a password de um utilizador existente. */
  resetRequested: boolean;
  /** Resultado de `canRevealSecrets`. */
  canReveal: boolean;
  generatePassword: () => string;
}

export function planSuperAdminPassword(input: SuperAdminPasswordInput): SuperAdminPasswordPlan {
  const provided = input.providedPassword ? input.providedPassword : undefined;

  if (provided !== undefined) {
    const parsed = newPasswordSchema.safeParse(provided);
    if (!parsed.success) {
      // A mensagem do Zod descreve a regra, nunca o valor recebido.
      return {
        kind: "error",
        message: `SEED_SUPERADMIN_PASSWORD inválida: ${parsed.error.issues[0]?.message ?? "formato inválido"}`,
      };
    }
  }

  if (input.resetRequested) {
    if (provided === undefined) {
      return {
        kind: "error",
        message:
          "Foi pedida a reposição da password do superadmin, mas SEED_SUPERADMIN_PASSWORD não está definida.",
      };
    }
    return input.userExists
      ? { kind: "reset", password: provided }
      : { kind: "create", password: provided, reveal: false };
  }

  // Sem pedido explícito, uma password existente nunca é tocada — correr o
  // seed outra vez (por exemplo, só para aplicar migrações) é inofensivo.
  if (input.userExists) return { kind: "keep" };

  if (provided !== undefined) return { kind: "create", password: provided, reveal: false };

  if (!input.canReveal) {
    return {
      kind: "error",
      message:
        "O superadmin ainda não existe e o seed está a correr em CI ou fora de um terminal interativo, por isso " +
        "uma password gerada não pode ser mostrada sem ficar num log. Defina SEED_SUPERADMIN_PASSWORD (em CI, como secret) " +
        "e volte a correr o seed.",
    };
  }

  return { kind: "create", password: input.generatePassword(), reveal: true };
}

/**
 * Verdadeiro só num terminal interativo fora de CI. O GitHub Actions define
 * `GITHUB_ACTIONS=true` e `CI=true`; o Vercel define `CI=1`.
 */
export function canRevealSecrets(
  env: Record<string, string | undefined>,
  isTTY: boolean | undefined,
): boolean {
  const ci = env.CI;
  const inCi = Boolean(env.GITHUB_ACTIONS) || (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0");
  return isTTY === true && !inCi;
}
