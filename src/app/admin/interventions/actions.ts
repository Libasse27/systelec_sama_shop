"use server";

import { db } from "@/server/db/client";
import { issueInvoice } from "@/server/modules/invoices/service";
import { addPart, removePart } from "@/server/modules/interventions/parts";
import { cancelIntervention, completeIntervention, saveReport, scheduleIntervention, startIntervention } from "@/server/modules/interventions/workflow";
import type { ActionState } from "@/lib/form-state";
import { int, text } from "@/lib/form-data";
import { adminAction } from "../_lib/action";

const path = (id: string) => `/admin/interventions/${id}`;

export async function scheduleAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await scheduleIntervention(db, actor, id, {
      technicianId: text(formData, "technicianId"),
      date: text(formData, "date"),
      time: text(formData, "time"),
      durationMinutes: int(formData, "durationMinutes"),
    });
    return "Intervention planifiée, client notifié.";
  });
}

export async function startAction(id: string): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await startIntervention(db, actor, id);
    return "Intervention démarrée.";
  });
}

export async function saveReportAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await saveReport(db, actor, id, {
      diagnosis: text(formData, "diagnosis"),
      workDone: text(formData, "workDone"),
      timeSpentMin: int(formData, "timeSpentMin"),
      observations: text(formData, "observations"),
    });
    return "Rapport enregistré.";
  });
}

export async function addPartAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await addPart(db, actor, id, { sku: text(formData, "sku"), label: text(formData, "label"), quantity: int(formData, "quantity") });
    return "Pièce ajoutée.";
  });
}

export async function removePartAction(id: string, partId: string): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await removePart(db, actor, partId);
    return "Pièce retirée.";
  });
}

export async function completeAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await completeIntervention(db, actor, id, { customerSignOff: text(formData, "customerSignOff") });
    return "Intervention terminée : elle peut être encaissée.";
  });
}

export async function cancelAction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    await cancelIntervention(db, actor, id, { reason: text(formData, "reason") });
    return "Intervention annulée.";
  });
}

export async function issueInvoiceAction(id: string): Promise<ActionState> {
  return adminAction(path(id), async (actor) => {
    const { number } = await issueInvoice(db, actor, id);
    return `Facture ${number} émise.`;
  });
}
