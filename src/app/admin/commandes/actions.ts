"use server";

import { db } from "@/server/db/client";
import { changeOrderStatus } from "@/server/modules/orders/status";
import type { ActionState } from "@/lib/form-state";
import { text } from "@/lib/form-data";
import { ORDER_STATUS_LABELS } from "@/lib/labels";
import { adminAction } from "../_lib/action";

export async function changeOrderStatusAction(orderId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const status = text(formData, "status");
  return adminAction(`/admin/commandes/${orderId}`, async (actor) => {
    await changeOrderStatus(db, actor, orderId, { status, comment: text(formData, "comment") });
    return `Commande passée à « ${ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]} ».`;
  });
}
