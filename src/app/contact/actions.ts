"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import { text } from "@/lib/form-data";
import type { ActionState } from "@/lib/form-state";
import { toActionState } from "@/server/action-state";
import { clientIp } from "@/server/auth/client-ip";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { submitContactMessage } from "@/server/modules/contact/messages";

export async function submitContactMessageAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  let number: string;
  try {
    const user = await getCurrentUser();
    const message = await submitContactMessage(
      db,
      { userId: user?.id ?? null, ip: clientIp(await headers(), getServerEnv().TRUSTED_PROXY_HOPS) },
      {
        idempotencyKey: text(formData, "idempotencyKey"),
        name: text(formData, "name"),
        email: text(formData, "email"),
        phone: text(formData, "phone"),
        subject: text(formData, "subject"),
        reference: text(formData, "reference"),
        message: text(formData, "message"),
        website: text(formData, "website"),
      },
    );
    number = message.number;
  } catch (error) {
    return toActionState(error);
  }
  redirect(`/contact?envoye=${encodeURIComponent(number)}#confirmation`);
}
