import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, deleteDoc, deleteField, doc, getFirestore, serverTimestamp,
  setDoc, terminate, updateDoc, writeBatch, type DocumentData } from 'firebase/firestore';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMonthId, toDateInputValue } from '@/utils/date';

// Dedicated demo project. All admin fixtures and client operations use local emulator 8180.
const PROJECT = 'demo-kowalski-linked';
const base = `http://127.0.0.1:8180/emulator/v1/projects/${PROJECT}`;
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'linked-owner');
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8180, { mockUserToken: { sub: 'owner' } });
const otherApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'linked-other');
const otherDb = getFirestore(otherApp);
connectFirestoreEmulator(otherDb, '127.0.0.1', 8180, { mockUserToken: { sub: 'other' } });
const adminApp = initializeAdminApp({ projectId: PROJECT }, 'linked-admin');
const admin = getAdminFirestore(adminApp);
admin.settings({ host: '127.0.0.1:8180', ssl: false,
  credentials: { client_email: 'emulator@example.test', private_key: 'emulator' } });
vi.mock('@/lib/firebase', () => ({ db }));
const profile = 'users/owner';
const monthId = getMonthId();
const date = toDateInputValue();
const mp = `${profile}/months/${monthId}`;
const lp = `${profile}/loans/loan`;
const cp = `${profile}/creditCards/card`;
const sp = `${cp}/statements/statement`;
const tp = `${mp}/transactions/tx`;
const pp = `${lp}/payments/payment`;
const cpay = `${cp}/payments/payment`;
const zero = { necesidad: 0, ocio: 0 };
const ref = (path: string) => doc(db, path);
function month(extra: DocumentData = {}) {
  return { totalIncomeCents: 0, distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    capsCents: zero, borrowedCapsCents: zero, spentCents: zero, loanFundedSpentCents: zero,
    ahorroContributedCents: 0, incomeCount: 0, closed: false, ...extra };
}
function loan(extra: DocumentData = {}): DocumentData {
  return { userId: 'owner', amountReceivedCents: 1000, totalToRepayCents: 1100,
    scheduleType: 'total-known', receivedDate: date, receivedMonthId: monthId,
    destinationCategory: 'necesidad', receiptTransactionId: 'tx', borrowedAvailableCents: 1000,
    borrowedAvailableByCategory: { necesidad: 1000, ocio: 0 }, paidCents: 0, fundMovementCount: 0,
    installments: [{ id: 'one', number: 1, dueDate: date, amountCents: 1100, paidCents: 0 }],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra };
}
function receipt(extra: DocumentData = {}) {
  return { type: 'loan', loanId: 'loan', destinationCategory: 'necesidad', amountCents: 1000,
    transactionDate: date, localDate: new Date().toISOString(), serverDate: serverTimestamp(), ...extra };
}
function expense(extra: DocumentData = {}) {
  return { type: 'expense', amountCents: 100, category: 'necesidad', subcategory: 'Salud', paymentMethod: 'Efectivo',
    transactionDate: date, localDate: new Date().toISOString(), serverDate: serverTimestamp(), ...extra };
}
function loanPayment(extra: DocumentData = {}) {
  return { userId: 'owner', loanId: 'loan', transactionId: 'tx', monthId, amountCents: 100,
    sourceCategory: 'necesidad', paymentDate: date, serverDate: serverTimestamp(), ...extra };
}
function card(extra: DocumentData = {}) {
  return { userId: 'owner', issuer: 'Banco', name: 'Visa', creditLimitCents: 10000, currentDebtCents: 1000,
    closingDay: 20, dueDay: 28, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra };
}
function summary(extra: DocumentData = {}) {
  return { id: 'statement', closingDate: date, dueDate: date, statementBalanceCents: 1000,
    minimumPaymentCents: 100, totalPaymentCents: 1000, paidCents: 0, ...extra };
}
function statement(extra: DocumentData = {}) {
  return { ...summary(), userId: 'owner', cardId: 'card', cardName: 'Visa', interestChargesCents: 0,
    recordedMonthId: monthId, createdAt: serverTimestamp(), ...extra };
}
function cardPayment(extra: DocumentData = {}) {
  return { userId: 'owner', cardId: 'card', cardName: 'Visa', mode: 'other', amountCents: 100,
    statementAppliedCents: 0, paymentDate: date, serverDate: serverTimestamp(), ...extra };
}
async function seed(path: string, data: DocumentData) {
  const copy = { ...data };
  for (const key of ['createdAt', 'updatedAt', 'serverDate']) if (key in copy) copy[key] = new Date();
  await admin.doc(path).set(copy);
}
async function deny(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(operation).rejects.not.toThrow(/maximum of 1000|maximum.*calls/i);
}
function createLoanBatch(options: { loan?: DocumentData; tx?: DocumentData; caps?: DocumentData; omitTx?: boolean; omitCaps?: boolean } = {}) {
  const b = writeBatch(db);
  b.set(ref(lp), loan(options.loan));
  if (!options.omitTx) b.set(ref(tp), receipt(options.tx));
  if (!options.omitCaps) b.update(ref(mp), { capsCents: { necesidad: 1000, ocio: 0 },
    borrowedCapsCents: { necesidad: 1000, ocio: 0 }, ...options.caps });
  return b;
}
async function seedUnused(extra: DocumentData = {}) {
  await seed(lp, loan(extra)); await seed(tp, receipt());
  await seed(mp, month({ capsCents: { necesidad: 1000, ocio: 0 }, borrowedCapsCents: { necesidad: 1000, ocio: 0 } }));
}
function cancelLoanBatch(omitTx = false, omitCaps = false) {
  const b = writeBatch(db); b.delete(ref(lp));
  if (!omitTx) b.delete(ref(tp));
  if (!omitCaps) b.update(ref(mp), { capsCents: zero, borrowedCapsCents: zero });
  return b;
}
async function seedActive(extra: DocumentData = {}, statementExtra: DocumentData = {}) {
  await seed(sp, statement(statementExtra));
  await seed(cp, card({ activeStatement: summary(), lastStatementClosingDate: date, ...extra }));
}
function statementBatch(interest = 0, data: DocumentData = {}, txExtra: DocumentData = {}, omitTx = false) {
  const b = writeBatch(db);
  b.set(ref(sp), statement({ interestChargesCents: interest,
    ...(interest ? { interestTransactionId: 'tx' } : {}), ...data }));
  b.update(ref(cp), { activeStatement: summary(), lastStatementClosingDate: date,
    currentDebtCents: 1000 + interest, updatedAt: serverTimestamp() });
  if (interest && !omitTx) b.set(ref(tp), expense({ amountCents: interest, creditCardId: 'card',
    creditCardName: 'Visa', creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees', ...txExtra }));
  return b;
}
function cancelStatementBatch(deleteInterest = false) {
  const b = writeBatch(db); b.delete(ref(sp));
  b.update(ref(cp), { activeStatement: deleteField(), lastStatementClosingDate: deleteField(),
    currentDebtCents: 1000, updatedAt: serverTimestamp() });
  if (deleteInterest) b.delete(ref(tp));
  return b;
}

describe.skipIf(process.env.RUN_MONTH_RULES_TESTS !== 'true')('préstamos y tarjetas: contrapartidas en emulador', () => {
  beforeAll(async () => {
    const content = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const r = await fetch(`${base}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
    expect(r.ok, await r.text()).toBe(true);
  }, 30000);
  beforeEach(async () => {
    expect((await fetch(`${base}/databases/(default)/documents`, { method: 'DELETE' })).ok).toBe(true);
    await seed(profile, { savingsTotalCents: 10000, savingsGoals: [], lastClosedMonth: monthId });
    await seed(mp, month());
  });
  afterAll(async () => {
    await Promise.all([terminate(db), terminate(otherDb), admin.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp), deleteAdminApp(adminApp)]);
  });

  it.each(['necesidad', 'ocio'])('alta de préstamo con recibo y topes exactos en %s', async (category) => {
    const amounts = { ...zero, [category]: 1000 };
    await createLoanBatch({ loan: { destinationCategory: category, borrowedAvailableByCategory: amounts },
      tx: { destinationCategory: category }, caps: { capsCents: amounts, borrowedCapsCents: amounts } }).commit();
  });
  it('alta importada conserva fecha antigua y recibo en mes actual', async () => {
    await createLoanBatch({ loan: { importedExisting: true, receivedDate: '2020-01-01' } }).commit();
  });
  it.each([
    ['sin recibo', { omitTx: true }], ['sin topes', { omitCaps: true }],
    ['monto distinto', { tx: { amountCents: 999 } }], ['otro préstamo', { tx: { loanId: 'other' } }],
    ['destino distinto', { tx: { destinationCategory: 'ocio' } }],
    ['topes insuficientes', { caps: { capsCents: { necesidad: 999, ocio: 0 } } }],
    ['topes excesivos', { caps: { capsCents: { necesidad: 1001, ocio: 0 } } }],
    ['topes prestados incorrectos', { caps: { borrowedCapsCents: zero } }],
    ['otra categoría alterada', { caps: { capsCents: { necesidad: 1000, ocio: 1 } } }],
    ['referencia vacía', { loan: { receiptTransactionId: '' } }],
  ] as const)('rechaza alta: %s', async (_label, options) => { await deny(createLoanBatch(options).commit()); });
  it('no reutiliza un recibo anterior', async () => {
    await seed(tp, receipt()); await deny(createLoanBatch({ omitTx: true }).commit());
  });
  it.each(['cerrado', 'ausente'])('rechaza alta con mes %s', async (kind) => {
    if (kind === 'cerrado') await admin.doc(mp).update({ closed: true }); else await admin.doc(mp).delete();
    await deny(createLoanBatch().commit());
  });
  it('cancela préstamo con reversión exacta', async () => { await seedUnused(); await cancelLoanBatch().commit(); });
  it('cancelación legacy sin mapa por categoría conserva fallback de destino', async () => {
    await seedUnused(); await admin.doc(lp).update({ borrowedAvailableByCategory: (await import('firebase-admin/firestore')).FieldValue.delete() });
    await cancelLoanBatch().commit();
  });
  it('cancelación resta ambas categorías disponibles', async () => {
    await seedUnused({ borrowedAvailableByCategory: { necesidad: 600, ocio: 400 } });
    await seed(mp, month({ capsCents: { necesidad: 600, ocio: 400 }, borrowedCapsCents: { necesidad: 600, ocio: 400 } }));
    await cancelLoanBatch().commit();
  });
  it.each(['recibo', 'topes', 'pagado', 'usado', 'cerrado'])('rechaza cancelación sin elegibilidad o contrapartida: %s', async (kind) => {
    await seedUnused();
    if (kind === 'pagado') await admin.doc(lp).update({ paidCents: 1 });
    if (kind === 'usado') await admin.doc(lp).update({ borrowedAvailableCents: 999 });
    if (kind === 'cerrado') await admin.doc(mp).update({ closed: true });
    await deny(cancelLoanBatch(kind === 'recibo', kind === 'topes').commit());
  });
  it('riesgo aceptado: dos altas pueden compartir un solo incremento mensual', async () => {
    const b = createLoanBatch();
    b.set(ref(`${profile}/loans/second`), loan({ receiptTransactionId: 'second' }));
    b.set(ref(`${mp}/transactions/second`), receipt({ loanId: 'second' }));
    await b.commit();
  });

  it.each(['necesidad', 'ocio', 'ahorro'])('pago de préstamo con egreso coherente en %s', async (category) => {
    await seed(lp, loan()); const b = writeBatch(db);
    b.set(ref(pp), loanPayment({ sourceCategory: category }));
    b.set(ref(tp), expense({ loanId: 'loan', loanPaymentId: 'payment', category }));
    await b.commit(); // Parent balance is deliberately outside the new create contract.
  });
  it.each(['ausente', 'huérfano', 'monto', 'categoría', 'fecha', 'mes', 'cerrado', 'reutilizado'])('rechaza pago de préstamo con egreso %s', async (kind) => {
    if (kind !== 'huérfano') await seed(lp, loan());
    if (kind === 'cerrado') await admin.doc(mp).update({ closed: true });
    const tx = expense({ loanId: 'loan', loanPaymentId: 'payment' });
    if (kind === 'reutilizado') await seed(tp, tx);
    const b = writeBatch(db);
    b.set(ref(pp), loanPayment({ ...(kind === 'monto' ? { amountCents: 99 } : {}),
      ...(kind === 'categoría' ? { sourceCategory: 'ocio' } : {}),
      ...(kind === 'fecha' ? { paymentDate: '2000-01-01' } : {}),
      ...(kind === 'mes' ? { monthId: '2000-01' } : {}) }));
    if (!['ausente', 'reutilizado'].includes(kind)) b.set(ref(tp), tx);
    await deny(b.commit());
  });
  it.each(['válida', 'sin egreso', 'sin reversión exacta'])('reversión de pago de préstamo: %s', async (kind) => {
    await seed(lp, loan({ paidCents: 100 })); await seed(pp, loanPayment());
    await seed(tp, expense({ loanId: 'loan', loanPaymentId: 'payment' }));
    const b = writeBatch(db); b.delete(ref(pp));
    if (kind !== 'sin egreso') b.delete(ref(tp));
    b.update(ref(lp), { paidCents: kind === 'sin reversión exacta' ? 1 : 0, updatedAt: serverTimestamp() });
    if (kind === 'válida') await b.commit(); else await deny(b.commit());
  });

  it.each([0, 100])('alta de statement con intereses %i', async (interest) => {
    await seed(cp, card()); await statementBatch(interest).commit();
  });
  it('no impone vencimiento posterior al corte', async () => {
    await seed(cp, card()); await statementBatch().commit();
  });
  it.each(['tarjeta', 'mes', 'cerrado', 'cargo', 'monto', 'categoría', 'statement', 'tarjeta del cargo', 'reutilizado'])('rechaza statement con referencia inválida: %s', async (kind) => {
    if (kind !== 'tarjeta') await seed(cp, card());
    if (kind === 'mes') await admin.doc(mp).delete();
    if (kind === 'cerrado') await admin.doc(mp).update({ closed: true });
    if (kind === 'reutilizado') await seed(tp, expense({ creditCardId: 'card', creditCardStatementId: 'statement', creditCardChargeKind: 'interest-fees' }));
    await deny(statementBatch(100, {}, {
      ...(kind === 'monto' ? { amountCents: 99 } : {}), ...(kind === 'categoría' ? { category: 'ocio' } : {}),
      ...(kind === 'statement' ? { creditCardStatementId: 'another' } : {}),
      ...(kind === 'tarjeta del cargo' ? { creditCardId: 'another' } : {}),
    }, ['cargo', 'reutilizado'].includes(kind)).commit());
  });
  it('rechaza estado aislado sin actualizar resumen de tarjeta', async () => {
    await seed(cp, card()); await deny(setDoc(ref(sp), statement()));
  });
  it.each([0, 100])('cancela estado activo con reversión de intereses %i', async (interest) => {
    await seed(cp, card()); await statementBatch(interest).commit(); await cancelStatementBatch(interest > 0).commit();
  });
  it.each(['anterior', 'pagado', 'cerrado', 'sin reversión', 'sin quitar resumen'])('rechaza cancelación de estado: %s', async (kind) => {
    await seed(cp, card()); await statementBatch(100).commit();
    if (kind === 'anterior') await admin.doc(cp).update({ 'activeStatement.id': 'other' });
    if (kind === 'pagado') await admin.doc(sp).update({ paidCents: 1 });
    if (kind === 'cerrado') await admin.doc(mp).update({ closed: true });
    if (kind === 'sin quitar resumen') { await deny(deleteDoc(ref(sp))); return; }
    await deny(cancelStatementBatch(kind !== 'sin reversión').commit());
  });

  it('pago sin estado puede crearse y borrarse sin inventar mes o egreso', async () => {
    await seed(cp, card()); await setDoc(ref(cpay), cardPayment()); await deleteDoc(ref(cpay));
  });
  it('pago del estado activo puede crearse y borrarse', async () => {
    await seedActive(); await setDoc(ref(cpay), cardPayment({ statementId: 'statement', statementAppliedCents: 100 }));
    await deleteDoc(ref(cpay));
  });
  it.each(['huérfano', 'otra tarjeta', 'estado ausente', 'estado anterior', 'omite estado activo'])('rechaza pago de tarjeta: %s', async (kind) => {
    if (kind !== 'huérfano') await seedActive();
    if (kind === 'estado ausente') await admin.doc(sp).delete();
    if (kind === 'otra tarjeta') await admin.doc(sp).update({ cardId: 'another' });
    await deny(setDoc(ref(cpay), cardPayment(kind === 'omite estado activo' ? {} : {
      statementId: kind === 'estado anterior' ? 'old' : 'statement', statementAppliedCents: 100,
    })));
  });
  it('no borra pago de estado anterior al activo', async () => {
    await seedActive(); await seed(cpay, cardPayment({ statementId: 'old', statementAppliedCents: 100 }));
    await deny(deleteDoc(ref(cpay)));
  });
  it('puede borrar un pago previo sin statementId aunque ahora exista estado activo', async () => {
    await seedActive(); await seed(cpay, cardPayment()); await deleteDoc(ref(cpay));
  });

  it.each(['closingDate', 'dueDate', 'statementBalanceCents', 'minimumPaymentCents', 'totalPaymentCents', 'paidCents'])('rechaza resumen discrepante en %s', async (field) => {
    await seedActive(); const changed = field.endsWith('Date') ? '2020-01-01' : 500;
    await deny(updateDoc(ref(cp), { [`activeStatement.${field}`]: changed, updatedAt: serverTimestamp() }));
  });
  it('rechaza fecha de último corte discrepante', async () => {
    await seedActive(); await deny(updateDoc(ref(cp), { lastStatementClosingDate: '2020-01-01', updatedAt: serverTimestamp() }));
  });
  it('rechaza actualización del estado activo que deje su resumen discrepante', async () => {
    await seedActive(); await deny(updateDoc(ref(sp), { paidCents: 100 }));
  });
  it('riesgo aceptado: paidCents y resumen coherentes no prueban pago real', async () => {
    await seedActive(); const b = writeBatch(db);
    b.update(ref(sp), { paidCents: 100 }); b.update(ref(cp), { 'activeStatement.paidCents': 100, updatedAt: serverTimestamp() });
    await b.commit(); expect((await admin.collection(`${cp}/payments`).get()).empty).toBe(true);
  });
  it('riesgo aceptado: cancelar puede restaurar un estado que no sea el predecesor inmediato', async () => {
    await seedActive();
    const older = summary({ id: 'older', closingDate: '2020-01-01' });
    await seed(`${cp}/statements/older`, statement(older));
    await seed(`${cp}/statements/middle`, statement({ id: 'middle', closingDate: '2021-01-01' }));
    const b = writeBatch(db); b.delete(ref(sp));
    b.update(ref(cp), { activeStatement: older, lastStatementClosingDate: older.closingDate, updatedAt: serverTimestamp() });
    await b.commit();
  });
  it('riesgo aceptado: paidCents cero no acredita ausencia absoluta de pagos relacionados', async () => {
    const { recordCreditCardPayment, deleteCreditCardPayment, cancelLatestCreditCardStatement } = await import('./creditCardService');
    await seedActive({ currentDebtCents: 2000 });
    await recordCreditCardPayment('owner', 'card', { amountCents: 1000, paymentDate: date, mode: 'other' });
    const first = (await admin.collection(`${cp}/payments`).get()).docs[0].id;
    await recordCreditCardPayment('owner', 'card', { amountCents: 1000, paymentDate: date, mode: 'other' });
    await deleteCreditCardPayment('owner', 'card', first);
    await cancelLatestCreditCardStatement('owner', 'card', 'statement');
    expect((await admin.collection(`${cp}/payments`).get()).size).toBe(1);
  });
  it.each(['reset', 'delete-account'])('mantiene excepciones explícitas de limpieza %s', async (mode) => {
    await admin.doc(profile).update({ dataDeletionMode: mode });
    for (const path of [lp, pp, `${lp}/fundMovements/old`, sp, cpay]) await seed(path, { userId: 'owner' });
    const b = writeBatch(db); for (const path of [lp, pp, `${lp}/fundMovements/old`, sp, cpay]) b.delete(ref(path));
    await b.commit();
  });
  it('mantiene aislamiento por uid', async () => {
    await seedUnused(); await seedActive();
    for (const path of [lp, sp, cpay]) await deny(deleteDoc(doc(otherDb, path)));
  });
});
