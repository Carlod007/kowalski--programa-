import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  update: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => ({
  doc: (...parts: (string | { path: string })[]) => ({
    path: parts
      .filter((p) => p !== "db")
      .map((p) => (typeof p === "string" ? p : p.path))
      .join("/"),
  }),
  getDoc: async (ref: { path: string }) => ({
    exists: () => mocks.docs.has(ref.path),
    data: () => mocks.docs.get(ref.path),
  }),
  setDoc: async (ref: { path: string }, data: unknown) =>
    mocks.set(ref.path, data),
  updateDoc: async (ref: { path: string }, data: unknown) =>
    mocks.update(ref.path, data),
  runTransaction: async (_db: unknown, callback: (t: unknown) => unknown) =>
    callback({
      get: async (ref: { path: string }) => ({
        exists: () => mocks.docs.has(ref.path),
        data: () => mocks.docs.get(ref.path),
      }),
      update: (ref: { path: string }, data: unknown) =>
        mocks.update(ref.path, data),
    }),
}));

import {
  assertNoDuplicateCatalogNames,
  findDuplicateCatalogName,
  hasDuplicateCatalogName,
  normalizeCatalogName,
  propagatePaymentMethodRename,
  propagateSubcategoryRename,
} from "./masterTables";
import {
  renamePaymentMethod,
  renameSubcategory,
  saveIncomeSourcesCatalog,
  savePaymentMethodsCatalog,
  saveSubcategoriesCatalog,
} from "@/services/userService";

describe("masterTables y propagación en userService (F4)", () => {
  beforeEach(() => {
    mocks.docs.clear();
    mocks.update.mockClear();
    mocks.set.mockClear();
  });

  describe("normalización y bloqueo de duplicados con trim().toLocaleLowerCase('es')", () => {
    it("detecta duplicados ignorando mayúsculas/minúsculas y espacios extremos", () => {
      expect(normalizeCatalogName("  Alquiler  ")).toBe("alquiler");
      expect(
        hasDuplicateCatalogName(["Alquiler", "Comida"], "  alquiler "),
      ).toBe(true);
      expect(
        hasDuplicateCatalogName(["Alquiler", "Comida"], "ALQUILER", "Alquiler"),
      ).toBe(false);
      expect(findDuplicateCatalogName(["Yape", "  yape "])).toBe("yape");
    });

    it("assertNoDuplicateCatalogNames lanza error cuando hay duplicados en el catálogo", () => {
      expect(() =>
        assertNoDuplicateCatalogNames(
          ["Sueldo", "  sueldo  "],
          "fuentes de ingreso",
        ),
      ).toThrow(/Ya existe "sueldo"/i);
    });
  });

  describe("propagación de renombrado en estructuras de perfil", () => {
    it("propagateSubcategoryRename actualiza subcategories, essentialNeeds, subcategoryBudgets y expenseTemplates de la misma categoría", () => {
      const result = propagateSubcategoryRename(
        {
          subcategories: {
            necesidad: ["Comida", "Alquiler"],
            ocio: ["Salidas", "Comida"],
          },
          essentialNeeds: [
            { id: "n1", name: "Comida", monthlyAmountCents: 60_000 },
            { id: "n2", name: "Alquiler", monthlyAmountCents: 120_000 },
          ],
          subcategoryBudgets: [
            {
              category: "necesidad",
              subcategory: "Comida",
              monthlyLimitCents: 80_000,
            },
            {
              category: "ocio",
              subcategory: "Comida",
              monthlyLimitCents: 30_000,
            },
          ],
          expenseTemplates: [
            {
              id: "t1",
              description: "Menú diario",
              category: "necesidad",
              subcategory: "Comida",
              amountCents: 1_500,
              paymentMethod: "Yape",
            },
            {
              id: "t2",
              description: "Cena viernes",
              category: "ocio",
              subcategory: "Comida",
              amountCents: 5_000,
              paymentMethod: "Yape",
            },
          ],
        },
        "necesidad",
        "Comida",
        "Alimentación",
      );

      expect(result.subcategories.necesidad).toEqual([
        "Alimentación",
        "Alquiler",
      ]);
      // Ocio no se altera porque el renombrado fue en Necesidad
      expect(result.subcategories.ocio).toEqual(["Salidas", "Comida"]);
      expect(result.essentialNeeds).toEqual([
        { id: "n1", name: "Alimentación", monthlyAmountCents: 60_000 },
        { id: "n2", name: "Alquiler", monthlyAmountCents: 120_000 },
      ]);
      expect(result.subcategoryBudgets).toEqual([
        {
          category: "necesidad",
          subcategory: "Alimentación",
          monthlyLimitCents: 80_000,
        },
        {
          category: "ocio",
          subcategory: "Comida",
          monthlyLimitCents: 30_000,
        },
      ]);
      expect(result.expenseTemplates).toEqual([
        expect.objectContaining({ id: "t1", subcategory: "Alimentación" }),
        expect.objectContaining({ id: "t2", subcategory: "Comida" }),
      ]);
    });

    it("propagatePaymentMethodRename actualiza paymentMethods y expenseTemplates", () => {
      const result = propagatePaymentMethodRename(
        {
          paymentMethods: [
            { id: "pm1", name: "Yape", type: "digital" },
            { id: "pm2", name: "Efectivo", type: "cash" },
          ],
          expenseTemplates: [
            {
              id: "t1",
              description: "Menú",
              category: "necesidad",
              subcategory: "Comida",
              amountCents: 1_500,
              paymentMethod: "Yape",
            },
          ],
        },
        "Yape",
        "Yape BCP",
      );

      expect(result.paymentMethods).toEqual([
        { id: "pm1", name: "Yape BCP", type: "digital" },
        { id: "pm2", name: "Efectivo", type: "cash" },
      ]);
      expect(result.expenseTemplates).toEqual([
        expect.objectContaining({ id: "t1", paymentMethod: "Yape BCP" }),
      ]);
    });
  });

  describe("operaciones atómicas en userService", () => {
    it("saveSubcategoriesCatalog propaga el renombrado en una sola transacción atómica y rechaza duplicados", async () => {
      mocks.docs.set("users/u", {
        subcategories: {
          necesidad: ["Comida", "Alquiler"],
          ocio: ["Streaming"],
        },
        essentialNeeds: [
          { id: "n1", name: "Comida", monthlyAmountCents: 50_000 },
        ],
        subcategoryBudgets: [
          {
            category: "necesidad",
            subcategory: "Comida",
            monthlyLimitCents: 60_000,
          },
        ],
        expenseTemplates: [
          {
            id: "t1",
            description: "Almuerzo",
            category: "necesidad",
            subcategory: "Comida",
            amountCents: 1_500,
            paymentMethod: "Yape",
          },
        ],
      });

      await expect(
        saveSubcategoriesCatalog("u", {
          subcategories: {
            necesidad: ["Alquiler", "  alquiler "],
            ocio: ["Streaming"],
          },
          essentialNeeds: [],
        }),
      ).rejects.toThrow(/Ya existe "alquiler"/i);

      await saveSubcategoriesCatalog("u", {
        subcategories: {
          necesidad: ["Alimentación", "Alquiler"],
          ocio: ["Streaming"],
        },
        essentialNeeds: [
          { id: "n1", name: "Alimentación", monthlyAmountCents: 50_000 },
        ],
        renames: [
          {
            category: "necesidad",
            oldName: "Comida",
            newName: "Alimentación",
          },
        ],
      });

      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update).toHaveBeenCalledWith("users/u", {
        subcategories: {
          necesidad: ["Alimentación", "Alquiler"],
          ocio: ["Streaming"],
        },
        essentialNeeds: [
          { id: "n1", name: "Alimentación", monthlyAmountCents: 50_000 },
        ],
        subcategoryBudgets: [
          {
            category: "necesidad",
            subcategory: "Alimentación",
            monthlyLimitCents: 60_000,
          },
        ],
        expenseTemplates: [
          expect.objectContaining({
            id: "t1",
            subcategory: "Alimentación",
          }),
        ],
      });
    });

    it("savePaymentMethodsCatalog detecta el renombrado por id y lo propaga a expenseTemplates en la misma transacción", async () => {
      mocks.docs.set("users/u", {
        paymentMethods: [
          { id: "pm-1", name: "Yape", type: "digital" },
          { id: "pm-2", name: "Efectivo", type: "cash" },
        ],
        expenseTemplates: [
          {
            id: "t1",
            description: "Pasaje",
            category: "necesidad",
            subcategory: "Transporte",
            amountCents: 500,
            paymentMethod: "Yape",
          },
        ],
      });

      await savePaymentMethodsCatalog("u", {
        paymentMethods: [
          { id: "pm-1", name: "Yape / Plin", type: "digital" },
          { id: "pm-2", name: "Efectivo", type: "cash" },
        ],
      });

      expect(mocks.update).toHaveBeenCalledWith("users/u", {
        paymentMethods: [
          { id: "pm-1", name: "Yape / Plin", type: "digital" },
          { id: "pm-2", name: "Efectivo", type: "cash" },
        ],
        expenseTemplates: [
          expect.objectContaining({
            id: "t1",
            paymentMethod: "Yape / Plin",
          }),
        ],
      });
    });

    it("renameSubcategory y renamePaymentMethod validan duplicados y propagan referencias", async () => {
      mocks.docs.set("users/u", {
        subcategories: {
          necesidad: ["Comida", "Alquiler"],
          ocio: ["Salidas"],
        },
        essentialNeeds: [
          { id: "n1", name: "Comida", monthlyAmountCents: 50_000 },
        ],
        subcategoryBudgets: [],
        paymentMethods: [
          { id: "pm-1", name: "Yape", type: "digital" },
          { id: "pm-2", name: "Efectivo", type: "cash" },
        ],
        expenseTemplates: [],
      });

      await expect(
        renameSubcategory("u", "necesidad", "Comida", "  alquiler "),
      ).rejects.toThrow(/existe/i);

      await expect(
        renamePaymentMethod("u", "Yape", " efectivo "),
      ).rejects.toThrow(/existe/i);

      await expect(
        saveIncomeSourcesCatalog("u", {
          sources: [
            { id: "s1", name: "Sueldo" },
            { id: "s2", name: "  SUELDO " },
          ],
          fixedIncomes: [],
        }),
      ).rejects.toThrow(/Ya existe "SUELDO"/i);
    });
  });
});
