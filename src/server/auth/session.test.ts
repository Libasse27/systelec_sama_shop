import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, findUnique, auditCreate, getSession } = vi.hoisted(() => ({
  redirect: vi.fn(),
  findUnique: vi.fn(),
  auditCreate: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirect(path);
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@/server/db/client", () => ({
  db: {
    user: { findUnique },
    auditLog: { create: auditCreate },
  },
}));

import { requirePermission } from "./session";

describe("autorisation de la fiche commande", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "staff-without-orders-read" } });
    findUnique
      .mockResolvedValueOnce({ id: "staff-without-orders-read", email: "staff@example.sn", name: "Staff", kind: "STAFF", isActive: true })
      .mockResolvedValueOnce({ isActive: true, roles: [] });
    auditCreate.mockResolvedValue({});
  });

  it("refuse réellement l'accès à la route protégée et journalise orders.read", async () => {
    await expect(requirePermission("orders.read", "/admin/commandes/order-secret"))
      .rejects.toThrow("redirect:/acces-refuse");

    expect(redirect).toHaveBeenCalledWith("/acces-refuse");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "authz.denied",
        entityType: "Permission",
        entityId: "orders.read",
        result: "DENIED",
      }),
    }));
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
