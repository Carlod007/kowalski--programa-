import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", async () => {
  const { initializeApp } = await import("firebase/app");
  const { connectAuthEmulator, getAuth } = await import("firebase/auth");
  const { connectFirestoreEmulator, getFirestore } = await import(
    "firebase/firestore"
  );
  const app = initializeApp(
    {
      apiKey: "demo-key",
      authDomain: "demo-kowalski-deletion.firebaseapp.com",
      projectId: "demo-kowalski-deletion",
    },
    "account-deletion-integration",
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { auth, db };
});

import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { deleteDoc, doc, setDoc, updateDoc } from "firebase/firestore";
import { initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { auth, db } from "@/lib/firebase";
import {
  deleteAllAccountData,
  resetAllUserData,
} from "./accountDataService";

const RUN_INTEGRATION =
  process.env.RUN_FIREBASE_EMULATOR_TESTS === "true";
const PROJECT_ID = "demo-kowalski-deletion";
const PASSWORD = "Prueba-segura-123";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const adminApp = initializeAdminApp({ projectId: PROJECT_ID }, "deletion-admin");
const adminDb = getAdminFirestore(adminApp);

async function clearEmulators(): Promise<void> {
  await Promise.all([
    fetch(
      `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
    fetch(
      `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: "DELETE" },
    ),
  ]);
}

async function seedCompleteUser(userId: string, email: string): Promise<void> {
  const batch = adminDb.batch();
  const month = adminDb.doc(`users/${userId}/months/2026-08`);
  const loan = adminDb.doc(`users/${userId}/loans/loan-1`);
  const card = adminDb.doc(`users/${userId}/creditCards/card-1`);

  batch.set(adminDb.doc(`users/${userId}`), {
    name: "Cuenta temporal",
    email,
    sources: [{ id: "salary", name: "Sueldo" }],
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    subcategories: { necesidad: ["Salud"], ocio: ["Salidas"] },
    paymentMethods: [{ id: "cash", name: "Efectivo", type: "cash" }],
    closingNotification: { day: 1, time: "18:00" },
    onboardingCompleted: true,
    lastClosedMonth: "2026-08",
    savingsTotalCents: 50_000,
    savingsGoals: [{ id: "goal-1", name: "Meta", targetCents: 10_000 }],
    fixedIncomes: [],
    essentialNeeds: [],
  });
  batch.set(month, {
    totalIncomeCents: 100_000,
    distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    capsCents: { necesidad: 50_000, ocio: 30_000 },
    spentCents: { necesidad: 10_000, ocio: 0 },
    ahorroContributedCents: 20_000,
    incomeCount: 1,
    closed: true,
  });
  batch.set(month.collection("transactions").doc("tx-1"), {
    type: "expense",
    amountCents: 10_000,
  });
  batch.set(month.collection("movements").doc("movement-1"), {
    userId,
    amountCents: 1_000,
  });
  batch.set(adminDb.doc(`users/${userId}/goalAllocations/allocation-1`), {
    userId,
    amountCents: 5_000,
  });
  batch.set(loan, { userId, paidCents: 1_000 });
  batch.set(loan.collection("payments").doc("payment-1"), { userId });
  batch.set(loan.collection("fundMovements").doc("movement-1"), { userId });
  batch.set(card, { userId, currentDebtCents: 12_000 });
  batch.set(card.collection("statements").doc("statement-1"), { userId });
  batch.set(card.collection("payments").doc("payment-1"), { userId });
  batch.set(adminDb.doc(`migrationBackups/${userId}_backup`), {
    uid: userId,
    snapshot: { legacy: true },
  });
  await batch.commit();
}

async function expectFinancialTreeDeleted(userId: string): Promise<void> {
  const paths = [
    `users/${userId}/months/2026-08`,
    `users/${userId}/months/2026-08/transactions/tx-1`,
    `users/${userId}/months/2026-08/movements/movement-1`,
    `users/${userId}/goalAllocations/allocation-1`,
    `users/${userId}/loans/loan-1`,
    `users/${userId}/loans/loan-1/payments/payment-1`,
    `users/${userId}/loans/loan-1/fundMovements/movement-1`,
    `users/${userId}/creditCards/card-1`,
    `users/${userId}/creditCards/card-1/statements/statement-1`,
    `users/${userId}/creditCards/card-1/payments/payment-1`,
    `migrationBackups/${userId}_backup`,
  ];
  const snapshots = await adminDb.getAll(
    ...paths.map((path) => adminDb.doc(path)),
  );
  expect(snapshots.every((snapshot) => !snapshot.exists)).toBe(true);
}

describe.skipIf(!RUN_INTEGRATION)("eliminación completa con emuladores", () => {
  beforeAll(() => {
    vi.stubGlobal("navigator", { onLine: true });
  });

  beforeEach(async () => {
    await signOut(auth);
    await clearEmulators();
  });

  it("reinicia incluso meses cerrados y conserva únicamente la cuenta", async () => {
    const email = "reset@example.test";
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      PASSWORD,
    );
    await seedCompleteUser(credential.user.uid, email);

    await expect(
      deleteDoc(doc(db, "users", credential.user.uid, "months", "2026-08")),
    ).rejects.toMatchObject({ code: "permission-denied" });

    const profile = await resetAllUserData(credential.user.uid, {
      name: "Cuenta temporal",
      email,
    });

    expect(profile.onboardingCompleted).toBe(false);
    expect(profile.savingsTotalCents).toBe(0);
    expect(auth.currentUser?.uid).toBe(credential.user.uid);
    await expectFinancialTreeDeleted(credential.user.uid);
    const storedProfile = await adminDb.doc(`users/${credential.user.uid}`).get();
    expect(storedProfile.data()).not.toHaveProperty("dataDeletionMode");
  });

  it("elimina los datos y después la cuenta autenticada", async () => {
    const email = "delete@example.test";
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      PASSWORD,
    );
    await seedCompleteUser(credential.user.uid, email);

    await reauthenticateWithCredential(
      credential.user,
      EmailAuthProvider.credential(email, PASSWORD),
    );
    await deleteAllAccountData(credential.user.uid);
    await deleteUser(credential.user);

    await expectFinancialTreeDeleted(credential.user.uid);
    expect(
      (await adminDb.doc(`users/${credential.user.uid}`).get()).exists,
    ).toBe(false);
    await expect(
      signInWithEmailAndPassword(auth, email, PASSWORD),
    ).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  it("reanuda una limpieza parcial y mantiene aislados a otros usuarios", async () => {
    const email = "resume@example.test";
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      PASSWORD,
    );
    await seedCompleteUser(credential.user.uid, email);

    const otherUserId = "another-user";
    await adminDb.doc(`users/${otherUserId}`).set({
      name: "Otro usuario",
      email: "other@example.test",
    });
    await adminDb.doc(`users/${otherUserId}/months/2026-08`).set({
      closed: false,
    });

    await expect(
      deleteDoc(doc(db, "users", otherUserId, "months", "2026-08")),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await updateDoc(doc(db, "users", credential.user.uid), {
      dataDeletionMode: "reset",
    });
    await deleteDoc(
      doc(
        db,
        "users",
        credential.user.uid,
        "months",
        "2026-08",
        "transactions",
        "tx-1",
      ),
    );
    await expect(
      setDoc(doc(db, "users", credential.user.uid, "months", "2026-09"), {
        closed: false,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await resetAllUserData(credential.user.uid, {
      name: "Cuenta temporal",
      email,
    });

    await expectFinancialTreeDeleted(credential.user.uid);
    expect(
      (await adminDb.doc(`users/${otherUserId}/months/2026-08`).get()).exists,
    ).toBe(true);
  });
});
