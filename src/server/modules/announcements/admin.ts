import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertPermission, type Actor } from "@/server/authz/service";
import { AppError } from "@/server/errors";
import { MAX_ANNOUNCEMENTS, announcementItemSchema, announcementsSchema, settingsDefaults, type SettingValue } from "@/server/modules/settings/schemas";
import { modifySetting } from "@/server/modules/settings/service";
import { parseInput } from "@/server/validation";

export type Announcements = SettingValue<"announcements">;
export type Announcement = Announcements["items"][number];

const PERMISSION = "announcements.manage";
const LABEL = "Annonce";

/** Validation d'une saisie : l'identifiant est ajouté ici, la forme est celle du schéma de stockage. */
function validated(id: string, input: unknown): Announcement {
  const fields = typeof input === "object" && input !== null ? input : {};
  return parseInput(announcementItemSchema, { ...fields, id }, LABEL);
}

/**
 * Valeur de départ quand la valeur stockée est invalide : on garde les annonces valides (identifiants
 * distincts, au plus MAX_ANNOUNCEMENTS) et la durée si elle est valide ; le reste est écarté.
 */
function recoverStored(stored: unknown): Announcements {
  const record = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const raw = Array.isArray(record.items) ? (record.items as unknown[]) : [];
  const valid = raw.flatMap((item) => {
    const parsed = announcementItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const items = valid.filter((item, index) => valid.findIndex((other) => other.id === item.id) === index).slice(0, MAX_ANNOUNCEMENTS);
  const rotation = announcementsSchema.shape.rotationSeconds.safeParse(record.rotationSeconds);
  return { items, rotationSeconds: rotation.success ? rotation.data : settingsDefaults.announcements.rotationSeconds };
}

/** Annonces pour l'écran d'administration, avec le nombre d'annonces invalides écartées de la lecture (0 si tout est valide). */
export async function getAnnouncements(client: PrismaClient, actor: Actor): Promise<Announcements & { dropped: number }> {
  await assertPermission(client, actor, PERMISSION);
  const row = await client.siteSetting.findUnique({ where: { key: "announcements" } });
  if (!row) return { ...settingsDefaults.announcements, dropped: 0 };
  const parsed = announcementsSchema.safeParse(row.value);
  if (parsed.success) return { ...parsed.data, dropped: 0 };
  const recovered = recoverStored(row.value);
  const stored = typeof row.value === "object" && row.value !== null && Array.isArray((row.value as { items?: unknown }).items) ? (row.value as { items: unknown[] }).items.length : 0;
  // Au moins 1 : une valeur invalide hors des éléments (durée, forme) doit aussi être signalée.
  return { ...recovered, dropped: Math.max(stored - recovered.items.length, 1) };
}

/** Modifie les annonces sous verrou ; une valeur stockée invalide est récupérée (annonces valides conservées). */
const modifyAnnouncements = (mutate: (current: Announcements) => unknown, actorId: string, client: PrismaClient) =>
  modifySetting("announcements", mutate, actorId, client, recoverStored);

/** Ajoute une annonce en fin de liste ; l'identifiant est créé côté serveur. */
export async function addAnnouncement(client: PrismaClient, actor: Actor, input: unknown): Promise<Announcement> {
  await assertPermission(client, actor, PERMISSION);
  const created = validated(randomUUID(), input);
  await modifyAnnouncements((current) => parseInput(announcementsSchema, { ...current, items: [...current.items, created] }, "Annonces"), actor.id, client);
  return created;
}

/** Remplace les champs d'une annonce existante (NOT_FOUND sinon). */
export async function updateAnnouncement(client: PrismaClient, actor: Actor, id: string, input: unknown): Promise<Announcement> {
  await assertPermission(client, actor, PERMISSION);
  const updated = validated(id, input);
  await modifyAnnouncements(
    (current) => {
      if (!current.items.some((item) => item.id === id)) throw new AppError("NOT_FOUND", "Annonce introuvable.");
      return parseInput(announcementsSchema, { ...current, items: current.items.map((item) => (item.id === id ? updated : item)) }, "Annonces");
    },
    actor.id,
    client,
  );
  return updated;
}

/** Supprime une annonce (NOT_FOUND si elle n'existe pas). */
export async function deleteAnnouncement(client: PrismaClient, actor: Actor, id: string): Promise<void> {
  await assertPermission(client, actor, PERMISSION);
  await modifyAnnouncements(
    (current) => {
      if (!current.items.some((item) => item.id === id)) throw new AppError("NOT_FOUND", "Annonce introuvable.");
      return { ...current, items: current.items.filter((item) => item.id !== id) };
    },
    actor.id,
    client,
  );
}

/** Durée d'affichage de chaque annonce, en secondes (4 à 20). */
export async function saveRotation(client: PrismaClient, actor: Actor, rotationSeconds: unknown): Promise<void> {
  await assertPermission(client, actor, PERMISSION);
  await modifyAnnouncements((current) => parseInput(announcementsSchema, { ...current, rotationSeconds }, "Rotation"), actor.id, client);
}
