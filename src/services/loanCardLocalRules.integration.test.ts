import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getFirestore,
  serverTimestamp, setDoc, terminate, updateDoc, writeBatch, type DocumentData,
} from 'firebase/firestore';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMonthId, toDateInputValue } from '@/utils/date';

// Isolated emulator project, no production configuration or credentials.
// RUN_MONTH_RULES_TESTS=true npm.cmd test -- src/services/loanCardLocalRules.integration.test.ts
const PROJECT = 'demo-kowalski-local-shapes';
const HOST = '127.0.0.1';
const PORT = 8180;
const enabled = process.env.RUN_MONTH_RULES_TESTS === 'true';
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'shapes-owner');
const db = getFirestore(app);
connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: { sub: 'owner' } });
const otherApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'shapes-other');
const otherDb = getFirestore(otherApp);
connectFirestoreEmulator(otherDb, HOST, PORT, { mockUserToken: { sub: 'other' } });
const anonApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'shapes-anon');
const anonDb = getFirestore(anonApp);
connectFirestoreEmulator(anonDb, HOST, PORT);
const adminApp = initializeAdminApp({ projectId: PROJECT }, 'shapes-admin');
const admin = getAdminFirestore(adminApp);
admin.settings({ host: `${HOST}:${PORT}`, ssl: false, credentials: { client_email: 'emulator@example.test', private_key: 'emulator' } });
vi.mock('@/lib/firebase', () => ({ db }));

const date = toDateInputValue();
const monthId = getMonthId();
const profilePath = 'users/owner';
const loanPath = `${profilePath}/loans/loan`;
const cardPath = `${profilePath}/creditCards/card`;
const movementPath = `${loanPath}/fundMovements/legacy`;
const monthPath = `${profilePath}/months/${monthId}`;
const loanRef = doc(db, loanPath);
const cardRef = doc(db, cardPath);
const movementRef = doc(db, movementPath);
function installments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `installment-${index + 1}`, number: index + 1, dueDate: date,
    amountCents: 100, paidCents: 0,
  }));
}
function loan(extra: DocumentData = {}): DocumentData {
  return {
    userId: 'owner', amountReceivedCents: 1000, totalToRepayCents: 1100,
    scheduleType: 'total-known', receivedDate: date, receivedMonthId: monthId,
    destinationCategory: 'necesidad', borrowedAvailableCents: 1000,
    borrowedAvailableByCategory: { necesidad: 1000, ocio: 0 }, paidCents: 0,
    fundMovementCount: 0, installments: installments(1), receiptTransactionId: 'receipt',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
  };
}
function card(extra: DocumentData = {}): DocumentData {
  return {
    userId: 'owner', issuer: 'Banco QA', name: 'Visa QA', creditLimitCents: 1000,
    currentDebtCents: 0, closingDay: 20, dueDay: 28,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
  };
}
function summary(extra: DocumentData = {}): DocumentData {
  return {
    id: 'statement', closingDate: '2026-09-20', dueDate: '2026-10-05',
    statementBalanceCents: 1000, minimumPaymentCents: 100,
    totalPaymentCents: 1000, paidCents: 0, ...extra,
  };
}
function movement(): DocumentData {
  return {
    userId: 'owner', loanId: 'loan', origin: 'necesidad', destination: 'ocio',
    amountCents: 100, transactionDate: date, serverDate: serverTimestamp(),
  };
}
async function seed(path: string, data: DocumentData) {
  const copy = { ...data };
  for (const key of ['createdAt', 'updatedAt', 'serverDate']) {
    if (key in copy) copy[key] = new Date();
  }
  await admin.doc(path).set(copy);
}
async function deny(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(operation).rejects.not.toThrow(/maximum of 1000|maximum.*calls/i);
}
function receipt() {
  return { type: 'loan', loanId: 'loan', amountCents: 1000, destinationCategory: 'necesidad',
    transactionDate: date, localDate: new Date().toISOString(), serverDate: serverTimestamp() };
}
async function createLoanFixture(extra: DocumentData = {}) {
  // Keep installment tests focused on shape, with the now-required atomic receipt/caps.
  const batch = writeBatch(db);
  batch.set(loanRef, loan(extra));
  batch.set(doc(db, `${monthPath}/transactions/receipt`), receipt());
  batch.update(doc(db, monthPath), { 'capsCents.necesidad': 2000, 'borrowedCapsCents.necesidad': 2000 });
  await batch.commit();
}
async function seedStatement(value = summary()) {
  await seed(`${cardPath}/statements/${value.id}`, { ...value, userId: 'owner', cardId: 'card',
    cardName: 'Visa QA', interestChargesCents: 0, recordedMonthId: monthId, createdAt: serverTimestamp() });
}

describe.skipIf(!enabled)('loans y creditCards: validación local en emulador', () => {
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
    await admin.doc(profilePath).set({ lastClosedMonth: monthId, savingsTotalCents: 10000, savingsGoals: [] });
    await seed(monthPath, {
      totalIncomeCents: 0, distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
      capsCents: { necesidad: 1000, ocio: 0 }, spentCents: { necesidad: 0, ocio: 0 },
      borrowedCapsCents: { necesidad: 1000, ocio: 0 }, loanFundedSpentCents: { necesidad: 0, ocio: 0 },
      ahorroContributedCents: 0, incomeCount: 0, closed: false,
    });
  });
  afterAll(async () => {
    await Promise.all([terminate(db), terminate(otherDb), terminate(anonDb), admin.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp), deleteApp(anonApp), deleteAdminApp(adminApp)]);
  });

  it('bloquea un movimiento nuevo incluso con préstamo y mes válidos', async () => {
    await seed(loanPath, loan());
    await deny(setDoc(movementRef, movement()));
  });
  it('bloquea movimientos huérfanos', async () => { await deny(setDoc(movementRef, movement())); });
  it('tampoco crea movimientos durante limpieza', async () => {
    await admin.doc(profilePath).update({ dataDeletionMode: 'reset' });
    await deny(setDoc(movementRef, movement()));
  });
  it('conserva lectura del movimiento antiguo por su dueño', async () => {
    await seed(movementPath, movement());
    expect((await getDoc(movementRef)).data()?.amountCents).toBe(100);
  });
  it('conserva aislamiento de lectura de movimientos', async () => {
    await seed(movementPath, movement());
    await deny(getDoc(doc(otherDb, movementPath)));
    await deny(getDoc(doc(anonDb, movementPath)));
  });
  it('no permite editar un movimiento antiguo', async () => {
    await seed(movementPath, movement());
    await deny(updateDoc(movementRef, { amountCents: 200 }));
  });
  it('no permite borrar un movimiento sin cancelar el préstamo', async () => {
    await seed(loanPath, loan()); await seed(movementPath, movement());
    await deny(deleteDoc(movementRef));
  });
  it('permite borrar movimiento antiguo al cancelar el préstamo sin usos', async () => {
    await seed(loanPath, loan({ fundMovementCount: 1 })); await seed(movementPath, movement());
    await seed(`${monthPath}/transactions/receipt`, receipt());
    const batch = writeBatch(db); batch.delete(movementRef); batch.delete(loanRef);
    batch.delete(doc(db, `${monthPath}/transactions/receipt`));
    batch.update(doc(db, monthPath), { 'capsCents.necesidad': 0, 'borrowedCapsCents.necesidad': 0 });
    await batch.commit(); expect((await getDoc(movementRef)).exists()).toBe(false);
  });
  it.each([
    ['mes cerrado', { closed: true }, {}],
    ['préstamo pagado', {}, { paidCents: 100 }],
    ['préstamo usado', {}, { borrowedAvailableCents: 900, borrowedAvailableByCategory: { necesidad: 900, ocio: 0 } }],
  ])('rechaza cancelación con movimiento cuando hay %s', async (_label, monthExtra, loanExtra) => {
    if (Object.keys(monthExtra).length) await admin.doc(monthPath).update(monthExtra);
    await seed(loanPath, loan(loanExtra)); await seed(movementPath, movement());
    const batch = writeBatch(db); batch.delete(movementRef); batch.delete(loanRef); await deny(batch.commit());
  });
  it.each(['reset', 'delete-account'])('conserva eliminación de movimiento en limpieza %s', async (mode) => {
    await seed(movementPath, movement()); await admin.doc(profilePath).update({ dataDeletionMode: mode });
    await deleteDoc(movementRef);
  });

  it.each([1, 360])('crea préstamo con %i cuotas', async (count) => {
    await createLoanFixture({ installments: installments(count) });
  });
  it.each([[], installments(361), {}, 'cuotas', null])('rechaza installments inválido en creación: %j', async (value) => {
    await deny(createLoanFixture({ installments: value }));
  });
  it.each([1, 360])('permite modificar una lista válida de %i cuotas sin cambiar longitud', async (count) => {
    const values = installments(count); await seed(loanPath, loan({ installments: values }));
    values[count - 1].paidCents = 25;
    await updateDoc(loanRef, { installments: values, updatedAt: serverTimestamp() });
  });
  it.each([[], installments(2), {}, 'cuotas', null, deleteField()])('rechaza lista eliminada, inválida o longitud distinta en update: %j', async (value) => {
    await seed(loanPath, loan());
    await deny(updateDoc(loanRef, { installments: value, updatedAt: serverTimestamp() }));
  });
  it('rechaza cambiar una lista legacy de 361 aunque conserve longitud', async () => {
    const values = installments(361); await seed(loanPath, loan({ installments: values }));
    values[360].paidCents = 1;
    await deny(updateDoc(loanRef, { installments: values, updatedAt: serverTimestamp() }));
  });
  it('conserva una lista legacy de 361 cuando no se modifica', async () => {
    await seed(loanPath, loan({ installments: installments(361) }));
    await updateDoc(loanRef, { paidCents: 1, updatedAt: serverTimestamp() });
  });
  it('documenta riesgo residual: no valida los campos internos de una cuota', async () => {
    await createLoanFixture({ installments: [{ sinEstructuraValidada: true }] });
  });

  const invalidSummaries: [string, unknown][] = [
    ['null', null], ['lista', []], ['string', 'statement'], ['mapa vacío', {}],
    ['ID vacío', summary({ id: '' })], ['ID no string', summary({ id: 1 })],
    ['ID excesivo', summary({ id: 'x'.repeat(201) })],
    ['corte mal formado', summary({ closingDate: '2026-13-20' })],
    ['vencimiento no string', summary({ dueDate: 5 })],
    ['saldo decimal', summary({ statementBalanceCents: 10.5 })],
    ['saldo cero', summary({ statementBalanceCents: 0 })],
    ['mínimo negativo', summary({ minimumPaymentCents: -1 })],
    ['mínimo no entero', summary({ minimumPaymentCents: '100' })],
    ['mínimo mayor al total', summary({ minimumPaymentCents: 1001 })],
    ['total cero', summary({ totalPaymentCents: 0 })],
    ['total decimal', summary({ totalPaymentCents: 10.5 })],
    ['pagado negativo', summary({ paidCents: -1 })],
    ['pagado booleano', summary({ paidCents: true })],
    ['pagado mayor al total', summary({ paidCents: 1001 })],
    ['campo extra', summary({ arbitrary: true })],
    ['campo obligatorio ausente', { ...summary(), totalPaymentCents: undefined }],
  ];
  // Remove missing fields rather than passing undefined to the Firestore SDK.
  delete (invalidSummaries.at(-1)![1] as DocumentData).totalPaymentCents;
  it.each(invalidSummaries)('rechaza activeStatement en creación: %s', async (_label, value) => {
    await seedStatement();
    await deny(setDoc(cardRef, card({ activeStatement: value, lastStatementClosingDate: '2026-09-20' })));
  });
  it.each(invalidSummaries)('rechaza activeStatement en actualización: %s', async (_label, value) => {
    await seed(cardPath, card());
    await seedStatement();
    await deny(updateDoc(cardRef, { activeStatement: value, lastStatementClosingDate: '2026-09-20', updatedAt: serverTimestamp() }));
  });
  it('permite crear tarjeta sin campos opcionales', async () => { await setDoc(cardRef, card()); });
  it('permite un resumen completo y fechas bien formadas en creación', async () => {
    await seedStatement();
    await setDoc(cardRef, card({ activeStatement: summary(), lastStatementClosingDate: '2026-09-20' }));
  });
  it('permite actualización y eliminación de ambos campos opcionales', async () => {
    await seed(cardPath, card());
    await seedStatement();
    await updateDoc(cardRef, { activeStatement: summary(), lastStatementClosingDate: '2026-09-20', updatedAt: serverTimestamp() });
    await updateDoc(cardRef, { activeStatement: deleteField(), lastStatementClosingDate: deleteField(), updatedAt: serverTimestamp() });
    expect((await getDoc(cardRef)).data()).not.toHaveProperty('activeStatement');
  });
  it('permite pagar parcialmente o completar el resumen sin exigir pago real (pendiente)', async () => {
    await seedStatement();
    await seed(cardPath, card({ activeStatement: summary(), lastStatementClosingDate: '2026-09-20' }));
    for (const paidCents of [500, 1000]) {
      const batch = writeBatch(db);
      batch.update(cardRef, { 'activeStatement.paidCents': paidCents, updatedAt: serverTimestamp() });
      batch.update(doc(db, `${cardPath}/statements/statement`), { paidCents });
      await batch.commit();
    }
  });
  it.each([null, 1, '', '2026-9-20', '2026-00-20', '2026-13-20', '2026-09-00', '2026-09-32'])('rechaza fecha de último corte en creación: %j', async (value) => {
    await deny(setDoc(cardRef, card({ lastStatementClosingDate: value })));
  });
  it.each([null, 1, '', '2026-9-20', '2026-00-20', '2026-13-20', '2026-09-00', '2026-09-32'])('rechaza fecha de último corte en actualización: %j', async (value) => {
    await seed(cardPath, card());
    await deny(updateDoc(cardRef, { lastStatementClosingDate: value, updatedAt: serverTimestamp() }));
  });
  it('permite restaurar un corte anterior sin imponer monotonía', async () => {
    await seedStatement(summary({ id: 'previous', closingDate: '2026-08-20' }));
    await seed(cardPath, card({ activeStatement: summary(), lastStatementClosingDate: '2026-09-20' }));
    await updateDoc(cardRef, { activeStatement: summary({ id: 'previous', closingDate: '2026-08-20' }), lastStatementClosingDate: '2026-08-20', updatedAt: serverTimestamp() });
  });
  it('conserva campos legacy inválidos cuando no cambian', async () => {
    await seed(cardPath, card({ activeStatement: 'legacy', lastStatementClosingDate: null }));
    await updateDoc(cardRef, { currentDebtCents: 100, updatedAt: serverTimestamp() });
    await deny(updateDoc(cardRef, { activeStatement: 1, updatedAt: serverTimestamp() }));
  });
  it('rechaza eliminar solo un campo opcional por romper correspondencia', async () => {
    await seed(cardPath, card({ activeStatement: summary(), lastStatementClosingDate: '2026-09-20' }));
    await deny(updateDoc(cardRef, { activeStatement: deleteField(), updatedAt: serverTimestamp() }));
  });
  it('permite deuda mayor a la línea pero rechaza un statement inexistente', async () => {
    await seed(cardPath, card());
    await updateDoc(cardRef, { currentDebtCents: 2000, updatedAt: serverTimestamp() });
    await deny(updateDoc(cardRef, { activeStatement: summary(), lastStatementClosingDate: '2026-09-20', updatedAt: serverTimestamp() }));
    expect((await admin.doc(`${cardPath}/statements/statement`).get()).exists).toBe(false);
  });
  it('conserva autorización por uid para préstamos y tarjetas', async () => {
    await deny(setDoc(doc(otherDb, loanPath), loan()));
    await deny(setDoc(doc(anonDb, cardPath), card()));
    await seed(cardPath, card());
    await deny(updateDoc(doc(otherDb, cardPath), { activeStatement: summary(), updatedAt: serverTimestamp() }));
  });

  it('flujo real: crea 360 cuotas, registra un pago y lo revierte', async () => {
    const { createLoan, recordLoanPayment } = await import('./loanService');
    const { deleteTransaction } = await import('./transactionService');
    const id = await createLoan('owner', {
      amountReceivedCents: 1000, receivedDate: date, scheduleType: 'fixed-known',
      installmentAmountCents: 100, installmentCount: 360, firstDueDate: date,
    });
    await recordLoanPayment('owner', monthId, id, {
      amountCents: 150, paymentDate: date, sourceCategory: 'necesidad', paymentMethod: 'Efectivo',
    });
    const payments = await admin.collection(`${profilePath}/loans/${id}/payments`).get();
    expect(payments.size).toBe(1);
    await deleteTransaction('owner', monthId, payments.docs[0].data().transactionId);
    expect((await admin.doc(`${profilePath}/loans/${id}`).get()).data()?.paidCents).toBe(0);
  });
  it('flujo real: confirma, paga, revierte y cancela un estado de tarjeta', async () => {
    const { confirmCreditCardStatement, recordCreditCardPayment, deleteCreditCardPayment, cancelLatestCreditCardStatement } = await import('./creditCardService');
    await seed(cardPath, card({ currentDebtCents: 1000 }));
    await confirmCreditCardStatement('owner', 'card', {
      closingDate: date, dueDate: '2027-01-05', statementBalanceCents: 1000,
      minimumPaymentCents: 100, totalPaymentCents: 1100, interestChargesCents: 100,
      recordedMonthId: monthId, recordedDate: date,
    });
    await recordCreditCardPayment('owner', 'card', { amountCents: 100, paymentDate: date, mode: 'minimum' });
    const payments = await admin.collection(`${cardPath}/payments`).get();
    await deleteCreditCardPayment('owner', 'card', payments.docs[0].id);
    const active = (await getDoc(cardRef)).data()?.activeStatement;
    await cancelLatestCreditCardStatement('owner', 'card', active.id);
    expect((await getDoc(cardRef)).data()).not.toHaveProperty('activeStatement');
    expect((await getDoc(cardRef)).data()).not.toHaveProperty('lastStatementClosingDate');
  });
});
