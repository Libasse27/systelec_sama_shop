import type { PrismaClient } from "@/generated/prisma/client";
import { DEMO_PREFIX } from "@/server/modules/catalog/demo";

/**
 * Zones et point de retrait de DÉMONSTRATION (D5) : frais et adresses fictifs, marqués « [DÉMO] ».
 * SYSTELEC saisit les vraies valeurs dans l'administration (Livraison et retrait).
 */
export async function seedDemoDelivery(client: PrismaClient): Promise<void> {
  const zones = [
    { name: `${DEMO_PREFIX} Zone A`, fee: 1_500, freeAbove: 200_000, leadTimeText: "Sous 24 h (démonstration)", position: 0 },
    { name: `${DEMO_PREFIX} Zone B`, fee: 3_000, freeAbove: null, leadTimeText: "Sous 48 h (démonstration)", position: 1 },
  ];
  for (const zone of zones) {
    await client.deliveryZone.upsert({ where: { name: zone.name }, create: zone, update: {} });
  }
  const point = { name: `${DEMO_PREFIX} Boutique`, address: "Adresse de démonstration", hours: "Lun–sam (démonstration)" };
  await client.pickupPoint.upsert({ where: { name: point.name }, create: point, update: {} });
}
