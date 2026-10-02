import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getFirestore,
  increment, serverTimestamp, setDoc, terminate, Timestamp, updateDoc, writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMonthId, toDateInputValue } from '@/utils/date';

// Dedicated demo project/port: never connects to production or clears other suites.
// Start the Firestore emulator with --port 8180 --project_id demo-kowalski-rules.
// On Windows, Java -Duser.language=en -Duser.country=US avoids missing es_PE bundles.
// RUN_MONTH_RULES_TESTS=true npm.cmd test -- src/services/monthTransactionRules.integration.test.ts
const PROJECT = 'demo-kowalski-rules';
const HOST = '127.0.0.1';
const PORT = 8180;
const enabled = process.env.RUN_MONTH_RULES_TESTS === 'true';
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'month-rules-owner');
const db = getFirestore(app);
connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: { sub: 'owner' } });
const otherApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'month-rules-other');
const otherDb = getFirestore(otherApp);
connectFirestoreEmulator(otherDb, HOST, PORT, { mockUserToken: { sub: 'other' } });
const anonApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'month-rules-anon');
const anonDb = getFirestore(anonApp);
connectFirestoreEmulator(anonDb, HOST, PORT);
const adminApp = initializeAdminApp({ projectId: PROJECT }, 'month-rules-admin');
const admin = getAdminFirestore(adminApp);
admin.settings({ host: `${HOST}:${PORT}`, ssl: false, credentials: { client_email: 'emulator@example.test', private_key: 'emulator' } });

vi.mock('@/lib/firebase', () => ({ db }));

const now = new Date();
const date = now.toISOString().slice(0, 10);
const monthId = date.slice(0, 7);
const firstDay = `${monthId}-01`;
const previousId = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const monthPath = `users/owner/months/${monthId}`;
const monthRef = doc(db, monthPath);
const txPath = `${monthPath}/transactions/tx`;
const txRef = doc(db, txPath);
const profilePath = 'users/owner';
const loanPath = 'users/owner/loans/loan';
const cardPath = 'users/owner/creditCards/card';
const zero = { necesidad: 0, ocio: 0 };
const percentages = { necesidad: 50, ocio: 30, ahorro: 20 };

function month(extra: DocumentData = {}): DocumentData {
  return {
    totalIncomeCents: 0, distribution: percentages, capsCents: zero, spentCents: zero,
    borrowedCapsCents: zero, loanFundedSpentCents: zero, ahorroContributedCents: 0,
    incomeCount: 0, closed: false, createdAt: serverTimestamp(), ...extra,
  };
}
function expense(extra: DocumentData = {}): DocumentData {
  return { type: 'expense', amountCents: 101, category: 'necesidad', subcategory: 'Salud',
    paymentMethod: 'Efectivo', transactionDate: date, localDate: now.toISOString(),
    serverDate: serverTimestamp(), ...extra };
}
function income(extra: DocumentData = {}): DocumentData {
  const { category: _category, subcategory: _subcategory, paymentMethod: _method, ...base } = expense();
  void _category; void _subcategory; void _method;
  return { ...base, type: 'income', source: 'Sueldo', sourceId: 'salary',
    distribution: { necesidad: 50, ocio: 30, ahorro: 21 }, ...extra };
}
function receipt(extra: DocumentData = {}): DocumentData {
  return { type: 'loan', loanId: 'loan', lender: 'Banco', destinationCategory: 'necesidad',
    amountCents: 1000, transactionDate: date, localDate: now.toISOString(),
    serverDate: serverTimestamp(), ...extra };
}
function loan(extra: DocumentData = {}): DocumentData {
  return { userId: 'owner', amountReceivedCents: 1000, totalToRepayCents: 1100,
    scheduleType: 'total-known', receivedDate: firstDay, receivedMonthId: monthId,
    destinationCategory: 'necesidad', receiptTransactionId: 'tx', borrowedAvailableCents: 1000,
    borrowedAvailableByCategory: { necesidad: 1000, ocio: 0 }, paidCents: 0, fundMovementCount: 0,
    installments: [{ id: '1', amountCents: 1100, paidCents: 0, dueDate: date, status: 'pending' }],
    createdAt: now, updatedAt: now, ...extra };
}
function card(extra: DocumentData = {}): DocumentData {
  return { userId: 'owner', issuer: 'Banco', name: 'Visa', creditLimitCents: 10000,
    currentDebtCents: 1000, closingDay: 20, dueDay: 28, createdAt: now, updatedAt: now, ...extra };
}
function statement(extra: DocumentData = {}): DocumentData {
  return { id: 'statement', userId: 'owner', cardId: 'card', cardName: 'Visa', closingDate: date, dueDate: date,
    statementBalanceCents: 1101, minimumPaymentCents: 100, totalPaymentCents: 1101,
    interestChargesCents: 101, recordedMonthId: monthId, interestTransactionId: 'tx',
    paidCents: 0, createdAt: serverTimestamp(), ...extra };
}
async function seed(path: string, data: DocumentData) {
  // Replace only SDK timestamp sentinels in fixtures; all writes are emulator-admin.
  const copy = { ...data };
  for (const key of ['createdAt', 'updatedAt', 'serverDate']) {
    if (key in copy) copy[key] = now;
  }
  await admin.doc(path).set(copy);
}
async function seedMonth(extra: DocumentData = {}) { await seed(monthPath, month(extra)); }
async function deny(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(operation).rejects.not.toThrow(/maximum of 1000|maximum.*calls/i);
}
function cardExpense(extra: DocumentData = {}) {
  return expense({ creditCardId: 'card', creditCardName: 'Visa', ...extra });
}
function fundedExpense(extra: DocumentData = {}) {
  return expense({ fundedByLoanId: 'loan', fundedByLoanName: 'Banco', ...extra });
}
function paymentExpense(extra: DocumentData = {}) {
  return expense({ loanId: 'loan', loanPaymentId: 'payment', ...extra });
}
async function seedPayment() {
  await seed(loanPath, loan({ paidCents: 101 }));
  await seed(`${loanPath}/payments/payment`, { userId: 'owner', loanId: 'loan', transactionId: 'tx',
    monthId, amountCents: 101, sourceCategory: 'necesidad', paymentDate: date, allocations: [] });
  await seed(txPath, paymentExpense());
}

describe.skipIf(!enabled)('months y transactions: reglas reales en emulador', () => {
  beforeAll(async () => {
    const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const response = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
    });
    expect(response.ok, await response.text()).toBe(true);
  }, 30000);
  beforeEach(async () => {
    const response = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    expect(response.ok).toBe(true);
    await seed(profilePath, { distribution: percentages, lastClosedMonth: previousId, savingsTotalCents: 10000 });
  });
  afterAll(async () => {
    await Promise.all([terminate(db), terminate(otherDb), terminate(anonDb), admin.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp), deleteApp(anonApp), deleteAdminApp(adminApp)]);
  });

  it('crea un mes vacío y permite su lectura al propietario', async () => {
    await setDoc(monthRef, month());
    expect((await getDoc(monthRef)).data()?.closed).toBe(false);
  });
  it.each([
    ['createdAt falso', { createdAt: Timestamp.fromMillis(0) }],
    ['campo extra', { userId: 'owner' }],
    ['directSavings prematuro', { directSavingsCents: 0 }],
    ['remainder prematuro', { remainder: { ocioToAhorroCents: 0 } }],
    ['cerrado', { closed: true }], ['ingreso inicial', { totalIncomeCents: 1 }],
    ['contador inicial', { incomeCount: 1 }], ['ahorro inicial', { ahorroContributedCents: 1 }],
    ['gasto inicial', { spentCents: { necesidad: 1, ocio: 0 } }],
    ['gasto prestado inicial', { loanFundedSpentCents: { necesidad: 1, ocio: 0 } }],
    ['categoría extra', { capsCents: { ...zero, ahorro: 0 } }],
    ['reparto incompleto', { distribution: { necesidad: 50, ocio: 50 } }],
    ['reparto incorrecto', { distribution: { necesidad: 50, ocio: 30, ahorro: 21 } }],
    ['reparto negativo', { distribution: { necesidad: -1, ocio: 51, ahorro: 50 } }],
    ['reparto decimal', { distribution: { necesidad: 49.5, ocio: 30.5, ahorro: 20 } }],
  ])('rechaza alta de mes: %s', async (_label, changes) => { await deny(setDoc(monthRef, month(changes))); });
  it.each(['2026-13', '2026-00', '26-09', 'nonsense', '2000-01', '2099-01'])('rechaza monthId %s', async (id) => {
    await deny(setDoc(doc(db, `users/owner/months/${id}`), month()));
  });
  it('rechaza mes sin un campo obligatorio', async () => {
    const data = month(); delete data.borrowedCapsCents;
    await deny(setDoc(monthRef, data));
  });
  it('hereda exactamente remanentes propios y prestados al cerrar el mes anterior en el lote', async () => {
    await seed(`users/owner/months/${previousId}`, month({ capsCents: { necesidad: 1000, ocio: 900 },
      spentCents: { necesidad: 300, ocio: 300 }, borrowedCapsCents: { necesidad: 200, ocio: 300 },
      loanFundedSpentCents: { necesidad: 100, ocio: 100 } }));
    const batch = writeBatch(db);
    batch.update(doc(db, `users/owner/months/${previousId}`), { closed: true, remainder: { ocioToAhorroCents: 400 } });
    batch.set(monthRef, month({ capsCents: { necesidad: 700, ocio: 200 }, borrowedCapsCents: { necesidad: 100, ocio: 200 } }));
    batch.update(doc(db, profilePath), { lastClosedMonth: monthId, savingsTotalCents: increment(400) });
    await batch.commit();
  });
  it.each(['sin cierre', 'inventada', 'reutilizada'])('rechaza herencia %s', async (kind) => {
    await seed(`users/owner/months/${previousId}`, month({ capsCents: { necesidad: 100, ocio: 0 }, closed: kind === 'reutilizada' }));
    const batch = writeBatch(db);
    if (kind === 'inventada') batch.update(doc(db, `users/owner/months/${previousId}`), { closed: true, remainder: { ocioToAhorroCents: 0 } });
    batch.set(monthRef, month({ capsCents: { necesidad: kind === 'inventada' ? 101 : 100, ocio: 0 } }));
    await deny(batch.commit());
  });
  it('sincroniza reparto sin ingresos y admite movimientos sucesivos', async () => {
    await seedMonth();
    await updateDoc(monthRef, { distribution: { necesidad: 70, ocio: 10, ahorro: 20 } });
    await updateDoc(monthRef, { totalIncomeCents: 1000, incomeCount: 1, 'capsCents.necesidad': 700, 'capsCents.ocio': 100, ahorroContributedCents: 200 });
    await updateDoc(monthRef, { 'spentCents.necesidad': 50, 'capsCents.ocio': 120, ahorroContributedCents: 210 });
    await deny(updateDoc(monthRef, { distribution: percentages }));
    await deny(updateDoc(monthRef, { incomeCount: 0, distribution: percentages }));
  });
  it.each([
    { totalIncomeCents: -1 }, { incomeCount: -1 }, { incomeCount: 0.5 }, { ahorroContributedCents: -1 },
    { directSavingsCents: -1 }, { 'capsCents.necesidad': -1 }, { 'spentCents.ocio': 0.5 },
    { 'borrowedCapsCents.ocio': '100' }, { 'loanFundedSpentCents.necesidad': -1 },
    { closed: 'false' }, { createdAt: Timestamp.fromMillis(0) }, { arbitrary: true },
    { capsCents: deleteField() }, { 'capsCents.ocio': deleteField() },
    { remainder: { ocioToAhorroCents: 0 } },
  ])('rechaza actualización de mes inválida %#', async (changes) => {
    await seedMonth(); await deny(updateDoc(monthRef, changes));
  });
  it('cierra con Ocio propio exacto; rechaza manipular saldos al cerrar o reabrir', async () => {
    await seedMonth({ capsCents: { necesidad: 0, ocio: 900 }, spentCents: { necesidad: 0, ocio: 300 },
      borrowedCapsCents: { necesidad: 0, ocio: 300 }, loanFundedSpentCents: { necesidad: 0, ocio: 100 } });
    await deny(updateDoc(monthRef, { closed: true }));
    await deny(updateDoc(monthRef, { closed: true, remainder: { ocioToAhorroCents: 600 } }));
    await deny(updateDoc(monthRef, { closed: true, 'capsCents.ocio': 1000, remainder: { ocioToAhorroCents: 400 } }));
    await updateDoc(monthRef, { closed: true, remainder: { ocioToAhorroCents: 400 } });
    await deny(updateDoc(monthRef, { closed: false }));
    await deny(updateDoc(monthRef, { 'spentCents.ocio': 301 }));
    await deny(updateDoc(monthRef, { remainder: { ocioToAhorroCents: 401 } }));
  });
  it('añade remainder una sola vez al mes cerrado que no lo tenía', async () => {
    await seedMonth({ closed: true });
    await deny(updateDoc(monthRef, { remainder: { ocioToAhorroCents: 1 } }));
    await updateDoc(monthRef, { remainder: { ocioToAhorroCents: 0 } });
    await deny(updateDoc(monthRef, { remainder: deleteField() }));
    await deny(updateDoc(monthRef, { remainder: { ocioToAhorroCents: 1 } }));
  });
  it.each(['income', 'direct', 'expense', 'savings', 'goal'])('crea variante %s', async (kind) => {
    await seedMonth();
    const data = kind === 'income' ? income() : kind === 'direct'
      ? income({ isDirectSavings: true, distribution: { necesidad: 0, ocio: 0, ahorro: 101 } })
      : kind === 'savings' ? expense({ category: 'ahorro' })
      : kind === 'goal' ? expense({ category: 'ahorro', goalId: 'goal' }) : expense({ tags: ['salud', 'casa'] });
    await setDoc(txRef, data);
    expect((await getDoc(txRef)).data()?.amountCents).toBe(101);
  });
  it('crea recibo junto con el préstamo real', async () => {
    await seedMonth(); const batch = writeBatch(db);
    batch.set(doc(db, loanPath), loan({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    batch.set(txRef, receipt());
    batch.update(monthRef, { 'capsCents.necesidad': 1000, 'borrowedCapsCents.necesidad': 1000 });
    await batch.commit();
  });
  it('crea gasto financiado con la disminución atómica de fondos del préstamo', async () => {
    await seedMonth(); await seed(loanPath, loan());
    const batch = writeBatch(db); batch.set(txRef, fundedExpense());
    batch.update(doc(db, loanPath), { borrowedAvailableCents: 899, 'borrowedAvailableByCategory.necesidad': 899, updatedAt: serverTimestamp() });
    batch.update(monthRef, { 'spentCents.necesidad': 101, 'loanFundedSpentCents.necesidad': 101 });
    await batch.commit();
  });
  it('crea pago de préstamo con su historial vinculado', async () => {
    await seedMonth(); await seed(loanPath, loan()); const batch = writeBatch(db);
    batch.set(txRef, paymentExpense());
    batch.set(doc(db, `${loanPath}/payments/payment`), { userId: 'owner', loanId: 'loan', transactionId: 'tx',
      monthId, amountCents: 101, sourceCategory: 'necesidad', paymentDate: date, serverDate: serverTimestamp() });
    batch.update(doc(db, loanPath), { paidCents: 101, updatedAt: serverTimestamp() });
    await batch.commit();
  });
  it('crea compra de tarjeta aunque exceda su línea, con deuda atómica', async () => {
    await seedMonth(); await seed(cardPath, card({ currentDebtCents: 10000 }));
    const batch = writeBatch(db); batch.set(txRef, cardExpense());
    batch.update(doc(db, cardPath), { currentDebtCents: 10101, updatedAt: serverTimestamp() });
    await batch.commit();
  });
  it('crea intereses con el estado de cuenta del mismo lote', async () => {
    await seedMonth(); await seed(cardPath, card()); const batch = writeBatch(db);
    batch.set(txRef, cardExpense({ creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' }));
    batch.set(doc(db, `${cardPath}/statements/statement`), statement());
    // Match the complete summary written by confirmCreditCardStatement.
    batch.update(doc(db, cardPath), { currentDebtCents: 1101, activeStatement: {
      id: 'statement', closingDate: date, dueDate: date, statementBalanceCents: 1101,
      minimumPaymentCents: 100, totalPaymentCents: 1101, paidCents: 0,
    }, lastStatementClosingDate: date, updatedAt: serverTimestamp() });
    await batch.commit();
  });
  it.each([
    { amountCents: -1 }, { amountCents: 0 }, { amountCents: 1.5 }, { category: 'libre' },
    { transactionDate: '2000-01-01' }, { transactionDate: `${monthId}-32` },
    { transactionDate: '2099-12-31' }, { transactionDate: `${previousId}-01` },
    { serverDate: Timestamp.fromMillis(0) }, { localDate: 'ayer' }, { transactionTime: '12:00' },
    { userId: 'owner' }, { type: 'unknown' }, { subcategory: 1 }, { paymentMethod: false },
    { loanId: 'loan' }, { loanPaymentId: 'payment' }, { fundedByLoanId: 'loan' }, { fundedByLoanName: 'Banco' },
    { creditCardId: 'card' }, { creditCardName: 'Visa' }, { creditCardChargeKind: 'interest-fees' },
    { creditCardStatementId: 'statement' }, { tags: [1] }, { tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
    { tags: ['x'.repeat(25)] }, { goalId: 'goal' },
  ])('rechaza alta inválida de transacción %#', async (changes) => {
    await seedMonth(); await deny(setDoc(txRef, expense(changes)));
  });
  it.each([
    { distribution: { necesidad: 50, ocio: 30, ahorro: 20 } },
    { distribution: { necesidad: 51, ocio: 30, ahorro: 20 } },
    { distribution: { necesidad: -1, ocio: 30, ahorro: 72 } },
    { distribution: { necesidad: 50.5, ocio: 30, ahorro: 20.5 } },
    { isDirectSavings: true }, { isDirectSavings: 'true' }, { source: 3 },
    { category: 'ahorro' },
  ])('rechaza ingreso inválido %#', async (changes) => {
    await seedMonth(); await deny(setDoc(txRef, income(changes)));
  });
  it('rechaza vínculos inexistentes o sin su actualización atómica', async () => {
    await seedMonth(); await seed(loanPath, loan()); await seed(cardPath, card());
    for (const data of [receipt(), fundedExpense(), paymentExpense(), cardExpense(),
      cardExpense({ creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' })]) {
      await deny(setDoc(txRef, data));
    }
  });
  it('permite el primer día del mes y fechas en el margen de tres días', async () => {
    await seedMonth(); await setDoc(txRef, expense({ transactionDate: firstDay }));
    for (const offset of [-3, 3]) {
      const edge = new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
      const id = edge.slice(0, 7);
      await seed(`users/owner/months/${id}`, month());
      await setDoc(doc(db, `users/owner/months/${id}/transactions/edge${offset}`), expense({ transactionDate: edge }));
    }
    const far = new Date(now.getTime() + 5 * 86400000).toISOString().slice(0, 10);
    const id = far.slice(0, 7); await seed(`users/owner/months/${id}`, month());
    await deny(setDoc(doc(db, `users/owner/months/${id}/transactions/future`), expense({ transactionDate: far })));
  });
  it('edita metadatos, importe, etiquetas y fecha del gasto; elimina opcionales', async () => {
    await seedMonth(); await seed(txPath, expense());
    await updateDoc(txRef, { amountCents: 200, subcategory: 'Casa', paymentMethod: 'Transferencia', description: 'Corregido', tags: ['casa'], transactionDate: firstDay });
    await updateDoc(txRef, { description: deleteField(), tags: deleteField() });
  });
  it.each([
    { type: 'income' }, { category: 'ocio' }, { serverDate: serverTimestamp() }, { localDate: 'otro' },
    { loanId: 'loan' }, { fundedByLoanId: 'loan' }, { creditCardId: 'card' }, { goalId: 'goal' },
    { transactionTime: '12:00' }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 0.1 },
    { amountCents: deleteField() }, { subcategory: 42 }, { paymentMethod: [] }, { tags: [true] },
    { transactionDate: '2000-01-01' }, { description: 12 }, { arbitrary: 1 },
  ])('rechaza edición de gasto inválida %#', async (changes) => {
    await seedMonth(); await seed(txPath, expense()); await deny(updateDoc(txRef, changes));
  });
  it('edita ingreso usando las proporciones anteriores y conserva centavos', async () => {
    await seedMonth(); await seed(txPath, income());
    await updateDoc(txRef, { amountCents: 202, distribution: { necesidad: 100, ocio: 60, ahorro: 42 }, source: 'Extra', description: 'Corrección' });
    await updateDoc(txRef, { sourceId: deleteField(), transactionDate: firstDay });
    await deny(updateDoc(txRef, { amountCents: 203 }));
    await deny(updateDoc(txRef, { distribution: { necesidad: 101, ocio: 60, ahorro: 41 } }));
    await deny(updateDoc(txRef, { isDirectSavings: true }));
  });
  it('edita ingreso directo conservando todo en Ahorro', async () => {
    await seedMonth(); await seed(txPath, income({ isDirectSavings: true, distribution: { necesidad: 0, ocio: 0, ahorro: 101 } }));
    await updateDoc(txRef, { amountCents: 202, distribution: { necesidad: 0, ocio: 0, ahorro: 202 } });
  });
  it('no edita recibos de préstamo', async () => {
    await seedMonth(); await seed(txPath, receipt()); await deny(updateDoc(txRef, { description: 'Otro' }));
  });
  it('congela monto y fecha del pago de préstamo, permite descripción', async () => {
    await seedMonth(); await seedPayment();
    await updateDoc(txRef, { description: 'Nota' });
    await deny(updateDoc(txRef, { amountCents: 102 }));
    const alternate = date === firstDay ? `${monthId}-02` : firstDay;
    await deny(updateDoc(txRef, { transactionDate: alternate }));
    await deny(updateDoc(txRef, { loanPaymentId: 'different' }));
  });
  it('gasto financiado: no cambia monto y no admite fecha anterior a recepción', async () => {
    await seedMonth(); await seed(loanPath, loan({ receivedDate: `${monthId}-02` }));
    await seed(txPath, fundedExpense({ transactionDate: `${monthId}-02` }));
    await updateDoc(txRef, { description: 'Nota' });
    await deny(updateDoc(txRef, { amountCents: 102 }));
    await deny(updateDoc(txRef, { transactionDate: firstDay }));
  });
  it('edita compra no confirmada con deuda atómica, bloquea cambios dentro de estado confirmado', async () => {
    await seedMonth(); await seed(cardPath, card()); await seed(txPath, cardExpense());
    await deny(updateDoc(txRef, { amountCents: 202 }));
    const batch = writeBatch(db); batch.update(txRef, { amountCents: 202 });
    batch.update(doc(db, cardPath), { currentDebtCents: 1101, updatedAt: serverTimestamp() }); await batch.commit();
    await admin.doc(cardPath).update({ lastStatementClosingDate: date });
    await deny(updateDoc(txRef, { description: 'No permitido' }));
    await deny(deleteDoc(txRef));
  });
  it('rechaza trasladar compra a un período confirmado', async () => {
    await seedMonth(); await seed(cardPath, card({ lastStatementClosingDate: firstDay }));
    await seed(txPath, cardExpense({ transactionDate: `${monthId}-02` }));
    await deny(updateDoc(txRef, { transactionDate: firstDay }));
  });
  it('intereses no se editan ni borran aisladamente', async () => {
    await seedMonth(); await seed(cardPath, card());
    await seed(txPath, cardExpense({ creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' }));
    await deny(updateDoc(txRef, { description: 'No' })); await deny(deleteDoc(txRef));
  });
  it('revierte compra solo con descuento atómico de deuda', async () => {
    await seedMonth(); await seed(cardPath, card()); await seed(txPath, cardExpense());
    await deny(deleteDoc(txRef)); const batch = writeBatch(db); batch.delete(txRef);
    batch.update(doc(db, cardPath), { currentDebtCents: 899, updatedAt: serverTimestamp() }); await batch.commit();
  });
  it('revierte gasto financiado solo restaurando fondos del préstamo', async () => {
    await seedMonth(); await seed(loanPath, loan({ borrowedAvailableCents: 899, borrowedAvailableByCategory: { necesidad: 899, ocio: 0 } }));
    await seed(txPath, fundedExpense()); await deny(deleteDoc(txRef));
    const batch = writeBatch(db); batch.delete(txRef);
    batch.update(doc(db, loanPath), { borrowedAvailableCents: 1000, 'borrowedAvailableByCategory.necesidad': 1000, updatedAt: serverTimestamp() }); await batch.commit();
  });
  it('revierte pago solo borrando el pago y descontando lo pagado del préstamo', async () => {
    await seedMonth(); await seedPayment(); await deny(deleteDoc(txRef));
    const batch = writeBatch(db); batch.delete(txRef); batch.delete(doc(db, `${loanPath}/payments/payment`));
    batch.update(doc(db, loanPath), { paidCents: 0, updatedAt: serverTimestamp() }); await batch.commit();
  });
  it('cancela recibo solo al cancelar el préstamo sin uso', async () => {
    await seedMonth({ capsCents: { necesidad: 1000, ocio: 0 }, borrowedCapsCents: { necesidad: 1000, ocio: 0 } });
    await seed(loanPath, loan()); await seed(txPath, receipt()); await deny(deleteDoc(txRef));
    const batch = writeBatch(db); batch.delete(txRef); batch.delete(doc(db, loanPath));
    batch.update(monthRef, { capsCents: zero, borrowedCapsCents: zero }); await batch.commit();
  });
  it('revierte intereses mediante el estado activo sin pagos y la deuda', async () => {
    await seedMonth(); await seed(cardPath, card({ activeStatement: { id: 'statement' } }));
    await seed(`${cardPath}/statements/statement`, statement());
    await seed(txPath, cardExpense({ creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' }));
    const batch = writeBatch(db); batch.delete(txRef); batch.delete(doc(db, `${cardPath}/statements/statement`));
    batch.update(doc(db, cardPath), { currentDebtCents: 899, activeStatement: deleteField(), updatedAt: serverTimestamp() }); await batch.commit();
  });
  it('bloquea transacciones cuando el mes no existe, está cerrado o se cierra en el mismo lote', async () => {
    await deny(setDoc(txRef, expense())); await seedMonth({ closed: true }); await seed(txPath, expense());
    await deny(setDoc(doc(db, `${monthPath}/transactions/new`), expense()));
    await deny(updateDoc(txRef, { description: 'No' })); await deny(deleteDoc(txRef));
    await seedMonth(); const batch = writeBatch(db); batch.set(doc(db, `${monthPath}/transactions/new`), expense());
    batch.update(monthRef, { closed: true, remainder: { ocioToAhorroCents: 0 } }); await deny(batch.commit());
  });
  it.each(['other', 'anonymous'])('aísla lecturas y escrituras de %s', async (kind) => {
    await seedMonth(); await seed(txPath, expense()); const client = kind === 'other' ? otherDb : anonDb;
    await deny(getDoc(doc(client, monthPath))); await deny(getDoc(doc(client, txPath)));
    await deny(setDoc(doc(client, `users/owner/months/${previousId}`), month()));
    await deny(updateDoc(doc(client, monthPath), { incomeCount: 1 }));
    await deny(deleteDoc(doc(client, monthPath)));
    await deny(setDoc(doc(client, `${monthPath}/transactions/new`), expense()));
    await deny(updateDoc(doc(client, txPath), { description: 'No' })); await deny(deleteDoc(doc(client, txPath)));
  });
  it.each(['reset', 'delete-account'])('bloquea altas/ediciones y permite borrar durante %s', async (mode) => {
    await seedMonth({ closed: true }); await seed(txPath, receipt());
    await admin.doc(profilePath).update({ dataDeletionMode: mode });
    await deny(setDoc(doc(db, `users/owner/months/${previousId}`), month()));
    await deny(updateDoc(monthRef, { remainder: { ocioToAhorroCents: 0 } }));
    await deny(setDoc(doc(db, `${monthPath}/transactions/new`), expense()));
    await deny(updateDoc(txRef, { description: 'No' }));
    await deleteDoc(txRef); await deleteDoc(monthRef);
    expect((await getDoc(monthRef)).exists()).toBe(false);
    await seedMonth(); await seed(txPath, expense());
    await deny(setDoc(doc(db, `${monthPath}/transactions/new`), expense()));
    await deny(updateDoc(txRef, { description: 'No' }));
    await deny(updateDoc(monthRef, { incomeCount: 1 }));
  });
  it('no borra meses fuera de eliminación; permite borrar transacciones ordinarias de mes abierto', async () => {
    await seedMonth(); await seed(txPath, expense()); await deny(deleteDoc(monthRef)); await deleteDoc(txRef);
  });
  it('LEGACY: gasto normal y edición de descripción conservan mapas antiguos, migración y remainder antiguo', async () => {
    await seedMonth({ capsCents: { necesidad: 1000, ocio: 500, ahorro: 999 },
      spentCents: { necesidad: 10, ocio: 0, ahorro: 77 }, migrationMarker: true,
      remainder: { oldNecesidad: 123, oldOcio: 456 } });
    await seed(txPath, expense({ transactionTime: '13:15', migrationMarker: 'old' }));
    await updateDoc(txRef, { description: 'Corrección compatible' });
    const batch = writeBatch(db); batch.set(doc(db, `${monthPath}/transactions/new`), expense());
    batch.update(monthRef, { 'spentCents.necesidad': increment(101) }); await batch.commit();
    await updateDoc(monthRef, { 'capsCents.ocio': increment(10) });
    const stored = (await getDoc(monthRef)).data()!;
    expect(stored.spentCents).toEqual({ necesidad: 111, ocio: 0, ahorro: 77 });
    expect(stored.capsCents.ahorro).toBe(999);
    expect(stored.migrationMarker).toBe(true);
    expect(stored.remainder).toEqual({ oldNecesidad: 123, oldOcio: 456 });
    expect((await getDoc(txRef)).data()).toMatchObject({ description: 'Corrección compatible', transactionTime: '13:15', migrationMarker: 'old' });
    await deny(updateDoc(monthRef, { 'spentCents.ahorro': 0 }));
    await deny(updateDoc(monthRef, { migrationMarker: false }));
    await deny(updateDoc(txRef, { transactionTime: '14:00' }));
  });
  it('LEGACY: no valida campos sin cambios aunque tengan tipos antiguos', async () => {
    await seedMonth({ totalIncomeCents: 'legacy', directSavingsCents: -5 });
    await seed(txPath, expense({ amountCents: 'legacy', localDate: 'old-format', tags: [123] }));
    await updateDoc(txRef, { description: 'Solo descripción' });
    await updateDoc(monthRef, { 'spentCents.necesidad': 101 });
    await deny(updateDoc(txRef, { amountCents: -1 }));
    await deny(updateDoc(monthRef, { totalIncomeCents: -1 }));
  });
  it('rechaza fechas de calendario inexistentes y tipos de fecha incorrectos', async () => {
    await seedMonth();
    for (const bad of [null, 42, '', `${monthId}-00`, `${monthId}-31`, '2025-02-29', '2024-02-30']) {
      // 31 may be a real day in the current month, so select it only for short months.
      if (bad === `${monthId}-31` && new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate() === 31) continue;
      await deny(setDoc(txRef, expense({ transactionDate: bad })));
    }
  });
  it('exige ambos valores al incorporar un mapa opcional a un mes legacy', async () => {
    const data = month(); delete data.borrowedCapsCents;
    await seed(monthPath, data);
    await deny(updateDoc(monthRef, { borrowedCapsCents: { necesidad: 0 } }));
    await updateDoc(monthRef, { borrowedCapsCents: zero });
  });
  it('no modifica remainder legacy ya presente en un mes cerrado', async () => {
    await seedMonth({ closed: true, remainder: { legacy: 100 }, migrationMarker: true });
    await deny(updateDoc(monthRef, { remainder: { ocioToAhorroCents: 0 } }));
    await deny(updateDoc(monthRef, { closed: false }));
  });
  it('no permite convertir préstamos o compras de tarjeta en ahorro', async () => {
    await seedMonth(); await seed(loanPath, loan()); await seed(cardPath, card());
    for (const data of [fundedExpense({ category: 'ahorro' }), cardExpense({ category: 'ahorro' }),
      receipt({ destinationCategory: 'ahorro' }), fundedExpense({ loanId: 'loan', loanPaymentId: 'payment' }),
      paymentExpense({ creditCardId: 'card', creditCardName: 'Visa' })]) await deny(setDoc(txRef, data));
  });
  it.each(['paid', 'not-active'])('no revierte intereses de estado %s', async (kind) => {
    await seedMonth(); await seed(cardPath, card({ activeStatement: { id: kind === 'not-active' ? 'other' : 'statement' } }));
    await seed(`${cardPath}/statements/statement`, statement({ paidCents: kind === 'paid' ? 10 : 0 }));
    await seed(txPath, cardExpense({ creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' }));
    const batch = writeBatch(db); batch.delete(txRef); batch.delete(doc(db, `${cardPath}/statements/statement`));
    batch.update(doc(db, cardPath), { currentDebtCents: 899, updatedAt: serverTimestamp() }); await deny(batch.commit());
  });
  it('SERVICIO: cierre con salto de meses y herencia de datos legacy', async () => {
    const { checkAndCloseMonth } = await import('./monthService');
    const localMonth = getMonthId();
    const oldId = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)).toISOString().slice(0, 7);
    await admin.doc(profilePath).update({ lastClosedMonth: oldId });
    await seed(`users/owner/months/${oldId}`, month({ capsCents: { necesidad: 1000, ocio: 900, ahorro: 100 },
      spentCents: { necesidad: 300, ocio: 300, ahorro: 50 }, borrowedCapsCents: { necesidad: 200, ocio: 300 },
      loanFundedSpentCents: { necesidad: 100, ocio: 100 }, remainder: { legacy: 42 }, migrationMarker: true }));
    await checkAndCloseMonth('owner');
    const next = (await getDoc(doc(db, `users/owner/months/${localMonth}`))).data()!;
    expect(next.capsCents).toEqual({ necesidad: 700, ocio: 200 });
    expect(next.borrowedCapsCents).toEqual({ necesidad: 100, ocio: 200 });
    expect((await getDoc(doc(db, `users/owner/months/${oldId}`))).data()?.remainder).toEqual({ ocioToAhorroCents: 400 });
  });
  it('SERVICIO: crear, financiar desde otra categoría, revertir, pagar y cancelar préstamo', async () => {
    const { createLoan, registerLoanFundedExpense, recordLoanPayment, cancelUnusedLoan } = await import('./loanService');
    const { deleteTransaction } = await import('./transactionService');
    const localDate = toDateInputValue(); const localMonth = getMonthId();
    const localPath = `users/owner/months/${localMonth}`;
    await seed(localPath, month());
    const id = await createLoan('owner', { lender: 'Banco', amountReceivedCents: 1000, receivedDate: localDate,
      scheduleType: 'total-known', totalToRepayCents: 1100, installmentCount: 1, firstDueDate: localDate });
    // The shared loan fund initially belongs to Necesidad; Ocio must also work.
    await registerLoanFundedExpense('owner', localMonth, { loanId: id, category: 'ocio', subcategory: 'Salida',
      paymentMethod: 'Efectivo', amountCents: 101, date: localDate, tags: ['prueba'] });
    const financed = (await admin.collection(`${localPath}/transactions`).where('fundedByLoanId', '==', id).get()).docs[0];
    expect(financed.exists).toBe(true);
    await deleteTransaction('owner', localMonth, financed.id);
    await recordLoanPayment('owner', localMonth, id, { amountCents: 101, paymentDate: localDate,
      sourceCategory: 'necesidad', paymentMethod: 'Efectivo' });
    const payment = (await admin.collection(`${localPath}/transactions`).where('type', '==', 'expense').get()).docs[0];
    await deleteTransaction('owner', localMonth, payment.id);
    await cancelUnusedLoan('owner', id);
    expect((await admin.doc(`users/owner/loans/${id}`).get()).exists).toBe(false);
    expect((await admin.collection(`${localPath}/transactions`).get()).empty).toBe(true);
  });
  it('SERVICIO: compra de tarjeta, edición, corrección de fecha y reversión', async () => {
    const { createCreditCard, registerCreditCardPurchase } = await import('./creditCardService');
    const { updateExpense, deleteTransaction } = await import('./transactionService');
    const { updateTransactionTiming } = await import('./transactionTimingService');
    const localDate = toDateInputValue(); const localMonth = getMonthId();
    const localPath = `users/owner/months/${localMonth}`; await seed(localPath, month());
    const id = await createCreditCard('owner', { issuer: 'Banco', name: 'Visa', creditLimitCents: 100, closingDay: 20, dueDay: 28 });
    await registerCreditCardPurchase('owner', localMonth, { cardId: id, category: 'necesidad', subcategory: 'Salud', amountCents: 101, date: localDate });
    const purchase = (await admin.collection(`${localPath}/transactions`).get()).docs[0];
    await updateExpense('owner', localMonth, purchase.id, { amountCents: 202, subcategory: 'Salud', paymentMethod: 'Banco Visa', tags: ['prueba'] });
    await updateTransactionTiming('owner', localMonth, purchase.id, `${localMonth}-01`);
    await deleteTransaction('owner', localMonth, purchase.id);
    expect((await admin.doc(`users/owner/creditCards/${id}`).get()).data()?.currentDebtCents).toBe(0);
  });
  it('SERVICIO: confirmar y revertir estado de cuenta con intereses', async () => {
    const { confirmCreditCardStatement, cancelLatestCreditCardStatement } = await import('./creditCardService');
    const localDate = toDateInputValue(); const localMonth = getMonthId();
    await seed(`users/owner/months/${localMonth}`, month()); await seed(cardPath, card());
    const dueDate = toDateInputValue(new Date(now.getTime() + 86400000 * 10));
    await confirmCreditCardStatement('owner', 'card', { closingDate: localDate, dueDate,
      statementBalanceCents: 1101, minimumPaymentCents: 100, totalPaymentCents: 1101,
      interestChargesCents: 101, recordedMonthId: localMonth, recordedDate: localDate });
    const recorded = (await admin.collection(`${cardPath}/statements`).get()).docs[0];
    await cancelLatestCreditCardStatement('owner', 'card', recorded.id);
    expect((await admin.doc(cardPath).get()).data()?.currentDebtCents).toBe(1000);
    expect((await admin.collection(`users/owner/months/${localMonth}/transactions`).get()).empty).toBe(true);
  });
});
