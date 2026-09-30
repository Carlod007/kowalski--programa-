import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditCard } from "@/types/creditCard";

type Reference = { path: string; id: string };
type TestTransaction = {
  get: (ref: Reference) => Promise<{
    exists: () => boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  set: (ref: Reference, data: unknown) => void;
  update: (ref: Reference, data: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  set: vi.fn(),
  update: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({ db: "db" }));
vi.mock("firebase/firestore", () => {
  const reference = (...parts: (string | Reference)[]): Reference => {
    const path = parts
      .filter((part) => part !== "db")
      .map((part) => typeof part === "string" ? part : part.path)
      .join("/");
    return { path, id: path.split("/").at(-1)! };
  };
  return {
    collection: reference,
    doc: (...parts: (string | Reference)[]) =>
      parts.length === 1 ? reference(...parts, "purchase") : reference(...parts),
    increment: (amount: number) => ({ increment: amount }),
    serverTimestamp: () => "server-timestamp",
    runTransaction: mocks.runTransaction,
  };
});

import { registerCreditCardPurchase } from "./creditCardService";

const monthPath = "users/u/months/2026-09";
const cardPath = "users/u/creditCards/c";
const purchaseRef = { path: `${monthPath}/transactions/purchase`, id: "purchase" };
const input = {
  cardId: "c",
  category: "necesidad" as const,
  subcategory: "Compras",
  amountCents: 1234,
  date: "2026-09-25",
  description: "Compra de prueba",
  tags: ["hogar"],
};

function expectPurchaseWrites(category: "necesidad" | "ocio", amountCents: number, date = input.date) {
  expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
  expect(mocks.set).toHaveBeenCalledExactlyOnceWith(purchaseRef, {
    type: "expense",
    category,
    subcategory: input.subcategory,
    paymentMethod: "Banco · Visa",
    amountCents,
    transactionDate: date,
    serverDate: "server-timestamp",
    localDate: new Date().toISOString(),
    creditCardId: "c",
    creditCardName: "Banco · Visa",
    description: input.description,
    tags: input.tags,
  });
  expect(mocks.update.mock.calls).toEqual([
    [{ path: monthPath, id: "2026-09" }, { [`spentCents.${category}`]: { increment: amountCents } }],
    [{ path: cardPath, id: "c" }, {
      currentDebtCents: { increment: amountCents },
      updatedAt: "server-timestamp",
    }],
  ]);
}

function expectNoWrites() {
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
}

describe("registerCreditCardPurchase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 30));
    vi.clearAllMocks();
    mocks.docs.clear();
    const card: CreditCard = {
      userId: "u",
      issuer: "Banco",
      name: "Visa",
      creditLimitCents: 10000,
      currentDebtCents: 2000,
      closingDay: 20,
      dueDay: 28,
      createdAt: null,
      updatedAt: null,
    };
    mocks.docs.set(cardPath, { ...card });
    mocks.docs.set(monthPath, {
      closed: false,
      spentCents: { necesidad: 3000, ocio: 4000 },
    });
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: TestTransaction) => Promise<void>) => {
      await callback({
        get: async (ref) => ({
          exists: () => mocks.docs.has(ref.path),
          data: () => mocks.docs.get(ref.path),
        }),
        set: mocks.set,
        update: mocks.update,
      });
    });
  });

  afterEach(() => vi.useRealTimers());

  it.each(["necesidad", "ocio"] as const)(
    "registra la compra y aumenta solo la deuda y spentCents de %s en la misma transacción",
    async (category) => {
      await registerCreditCardPurchase("u", "2026-09", { ...input, category });
      expectPurchaseWrites(category, input.amountCents);
    },
  );

  it.each(["2026-09-19", "2026-09-20"])(
    "rechaza la fecha %s anterior o igual al último corte confirmado sin escribir",
    async (date) => {
      mocks.docs.set(cardPath, { ...mocks.docs.get(cardPath), lastStatementClosingDate: "2026-09-20" });
      await expect(registerCreditCardPurchase("u", "2026-09", { ...input, date }))
        .rejects.toThrow("La fecha pertenece a un estado de cuenta ya confirmado.");
      expectNoWrites();
    },
  );

  it("permite una compra el día siguiente al último corte confirmado", async () => {
    mocks.docs.set(cardPath, { ...mocks.docs.get(cardPath), lastStatementClosingDate: "2026-09-20" });
    await registerCreditCardPurchase("u", "2026-09", { ...input, date: "2026-09-21" });
    expectPurchaseWrites(input.category, input.amountCents, "2026-09-21");
  });

  it("rechaza un mes cerrado sin registrar historial ni modificar deuda o gasto", async () => {
    mocks.docs.set(monthPath, { ...mocks.docs.get(monthPath), closed: true });
    await expect(registerCreditCardPurchase("u", "2026-09", input))
      .rejects.toThrow("No se puede registrar una compra en un mes cerrado");
    expectNoWrites();
  });

  it("permite superar la línea y registra el importe completo; el aviso corresponde a la pantalla", async () => {
    mocks.docs.set(cardPath, { ...mocks.docs.get(cardPath), currentDebtCents: 9500 });
    await registerCreditCardPurchase("u", "2026-09", { ...input, amountCents: 1000 });
    expectPurchaseWrites(input.category, 1000);
  });

  it.each([0, -100])("rechaza el importe %s antes de iniciar una transacción", async (amountCents) => {
    await expect(registerCreditCardPurchase("u", "2026-09", { ...input, amountCents }))
      .rejects.toThrow("El monto debe ser mayor a 0");
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expectNoWrites();
  });
});
