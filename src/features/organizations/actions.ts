"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { privacySettingsShape } from "@/lib/validation/organization";
import { emptyToNull, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { partialResult, type ActionResult } from "@/lib/forms/action-result";

/** Contacto de privacidade da organização (Configurações, §24). */
export async function updatePrivacySettingsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updatePrivacySettings", async () => {
    const context = await requireOrgContext();
    assertCan(context, "organization:manage");

    const { data, fieldErrors } = parsePartial(privacySettingsShape, {
      privacyContactEmail: readOptional(formData, "privacyContactEmail"),
    });
    const savedSomething = data.privacyContactEmail !== undefined;

    if (savedSomething) {
      await prisma.organization.update({
        where: { id: context.organizationId },
        data: { privacyContactEmail: emptyToNull(data.privacyContactEmail) },
      });

      // O e-mail é da organização, não de um titular, mas fica fora dos
      // metadados: basta saber que mudou.
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Organization",
        entityId: context.organizationId,
        result: "SUCCESS",
        metadata: { fields: ["privacyContactEmail"] },
      });

      revalidatePath("/settings");
    }

    return partialResult(fieldErrors, savedSomething);
  });
}
