import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getFirestore,
  serverTimestamp, setDoc, terminate, updateDoc, writeBatch, type DocumentData,
} from 'firebase/firestore';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMonthId } from '@/utils/date';

// Only isolated emulator fixtures; never uses production configuration or credentials.
// Shares the existing Firestore emulator port, but not the months suite's demo project.
// RUN_MONTH_RULES_TESTS=true npm.cmd test -- src/services/userLastClosedMonthRules.integration.test.ts
const PROJECT = 'demo-kowalski-user-marker';
const HOST = '127.0.0.1';
const PORT = 8180;
const enabled = process.env.RUN_MONTH_RULES_TESTS === 'true';
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'marker-owner');
const db = getFirestore(app);
connectFirestoreEmulator(db, HOST, PORT, { mockUserToken: { sub: 'owner' } });
const otherApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'marker-other');
const otherDb = getFirestore(otherApp);
connectFirestoreEmulator(otherDb, HOST, PORT, { mockUserToken: { sub: 'other' } });
const anonApp = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, 'marker-anon');
const anonDb = getFirestore(anonApp);
connectFirestoreEmulator(anonDb, HOST, PORT);
const adminApp = initializeAdminApp({ projectId: PROJECT }, 'marker-admin');
const admin = getAdminFirestore(adminApp);
admin.settings({ host: `${HOST}:${PORT}`, ssl: false, credentials: { client_email: 'emulator@example.test', private_key: 'emulator' } });

vi.mock('@/lib/firebase', () => ({ db }));
const { buildInitialUserProfile } = await import('./userService');

const currentId = getMonthId();
function shiftedMonth(offset: number): string {
  const [year, month] = currentId.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}
const previousId = shiftedMonth(-1);
const profilePath = 'users/owner';
const profileRef = doc(db, profilePath);
const monthPath = (id: string) => `${profilePath}/months/${id}`;
const currentRef = doc(db, monthPath(currentId));
const previousRef = doc(db, monthPath(previousId));
const identity = { name: 'Cuenta de prueba', email: 'owner@example.test' };
const zero = { necesidad: 0, ocio: 0 };

function emptyMonth(extra: DocumentData = {}): DocumentData {
  return {
    totalIncomeCents: 0, distribution: { necesidad: 50, ocio: 30, ahorro: 20 },
    capsCents: zero, spentCents: zero, borrowedCapsCents: zero, loanFundedSpentCents: zero,
    ahorroContributedCents: 0, incomeCount: 0, closed: false, createdAt: serverTimestamp(), ...extra,
  };
}
function previousMonth(extra: DocumentData = {}): DocumentData {
  // Own Ocio remainder: max(0, 1000 - 200) - max(0, 400 - 100) = 500.
  return emptyMonth({
    capsCents: { necesidad: 0, ocio: 1000 }, spentCents: { necesidad: 0, ocio: 400 },
    borrowedCapsCents: { necesidad: 0, ocio: 200 }, loanFundedSpentCents: { necesidad: 0, ocio: 100 },
    ...extra,
  });
}
async function seedMonth(id: string, data = emptyMonth()) {
  await admin.doc(monthPath(id)).set({ ...data, createdAt: new Date() });
}
async function seedPrevious(data = previousMonth()) {
  await admin.doc(profilePath).update({ lastClosedMonth: previousId });
  await seedMonth(previousId, data);
  await seedMonth(currentId);
}
async function deny(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(operation).rejects.not.toThrow(/maximum of 1000|maximum.*calls/i);
}
async function assertMarker(value: string | null) {
  expect((await getDoc(profileRef)).data()?.lastClosedMonth).toBe(value);
}

describe.skipIf(!enabled)('users.lastClosedMonth: transiciones reales en emulador', () => {
  beforeAll(async () => {
    vi.stubGlobal('navigator', { onLine: true });
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
    await admin.doc(profilePath).set(buildInitialUserProfile(identity));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await Promise.all([terminate(db), terminate(otherDb), terminate(anonDb), admin.terminate()]);
    await Promise.all([deleteApp(app), deleteApp(otherApp), deleteApp(anonApp), deleteAdminApp(adminApp)]);
  });

  it('crea una cuenta con marcador null', async () => {
    await admin.doc(profilePath).delete();
    await setDoc(profileRef, buildInitialUserProfile(identity));
    await assertMarker(null);
  });
  it.each([currentId, 1, false, {}, []])('rechaza marcador inicial distinto de null: %j', async (value) => {
    await admin.doc(profilePath).delete();
    await deny(setDoc(profileRef, { lastClosedMonth: value }));
    expect((await getDoc(profileRef)).exists()).toBe(false);
  });
  it('rechaza crear una cuenta sin marcador', async () => {
    await admin.doc(profilePath).delete();
    await deny(setDoc(profileRef, { name: 'Perfil incompleto' }));
  });
  it('inicializa con un mes actual que ya existe, sin escribir ese mes', async () => {
    await seedMonth(currentId);
    await updateDoc(profileRef, { lastClosedMonth: currentId });
    await assertMarker(currentId);
    expect((await getDoc(currentRef)).data()?.closed).toBe(false);
  });
  it('inicializa y crea el mes actual en el mismo lote', async () => {
    const batch = writeBatch(db);
    batch.set(currentRef, emptyMonth());
    batch.update(profileRef, { lastClosedMonth: currentId });
    await batch.commit();
    await assertMarker(currentId);
    expect((await getDoc(currentRef)).exists()).toBe(true);
  });
  it('inicializa un perfil legacy sin lastClosedMonth', async () => {
    await admin.doc(profilePath).update({ lastClosedMonth: FieldValue.delete() });
    await seedMonth(currentId);
    await updateDoc(profileRef, { lastClosedMonth: currentId });
    await assertMarker(currentId);
  });
  it('avanza cerrando el mes anterior con remainder exacto en el mismo lote', async () => {
    await seedPrevious();
    const batch = writeBatch(db);
    batch.update(previousRef, { closed: true, remainder: { ocioToAhorroCents: 500 } });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await batch.commit();
    await assertMarker(currentId);
    expect((await getDoc(previousRef)).data()?.remainder).toEqual({ ocioToAhorroCents: 500 });
  });
  it('permite remainder cero cuando el gasto propio supera el tope propio', async () => {
    await seedPrevious(previousMonth({ spentCents: { necesidad: 0, ocio: 1200 } }));
    const batch = writeBatch(db);
    batch.update(previousRef, { closed: true, remainder: { ocioToAhorroCents: 0 } });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await batch.commit();
    await assertMarker(currentId);
  });
  it('cierra un mes legacy sin desglose de fondos prestados', async () => {
    const data = previousMonth();
    delete data.borrowedCapsCents;
    delete data.loanFundedSpentCents;
    await seedPrevious(data);
    const batch = writeBatch(db);
    batch.update(previousRef, { closed: true, remainder: { ocioToAhorroCents: 600 } });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await batch.commit();
    await assertMarker(currentId);
  });
  it.each([true, false])('avanza si el mes previo estaba cerrado; remainder previo presente: %s', async (hasRemainder) => {
    await seedPrevious(previousMonth({ closed: true, ...(hasRemainder ? { remainder: { ocioToAhorroCents: 500 } } : {}) }));
    await updateDoc(profileRef, { lastClosedMonth: currentId });
    await assertMarker(currentId);
  });
  it('avanza si el documento del mes previo no existe', async () => {
    await admin.doc(profilePath).update({ lastClosedMonth: previousId });
    await seedMonth(currentId);
    await updateDoc(profileRef, { lastClosedMonth: currentId });
    await assertMarker(currentId);
  });
  it('admite saltar varios meses y cerrar el último mes registrado', async () => {
    const oldId = shiftedMonth(-6);
    await admin.doc(profilePath).update({ lastClosedMonth: oldId });
    await seedMonth(oldId, previousMonth());
    await seedMonth(currentId);
    const batch = writeBatch(db);
    batch.update(doc(db, monthPath(oldId)), { closed: true, remainder: { ocioToAhorroCents: 500 } });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await batch.commit();
    await assertMarker(currentId);
  });
  it('rechaza avanzar sin cerrar el mes previo abierto', async () => {
    await seedPrevious();
    await deny(updateDoc(profileRef, { lastClosedMonth: currentId }));
    await assertMarker(previousId);
    expect((await getDoc(previousRef)).data()?.closed).toBe(false);
  });
  it('rechaza el marcador aunque el lote modifique otro mes', async () => {
    await seedPrevious();
    const batch = writeBatch(db);
    batch.update(currentRef, { 'capsCents.necesidad': 100 });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await deny(batch.commit());
    await assertMarker(previousId);
    expect((await getDoc(currentRef)).data()?.capsCents.necesidad).toBe(0);
  });
  it.each([
    ['inventado', { ocioToAhorroCents: 501 }],
    ['sin separar dinero prestado', { ocioToAhorroCents: 600 }],
    ['negativo', { ocioToAhorroCents: -1 }],
    ['decimal', { ocioToAhorroCents: 500.5 }],
    ['texto', { ocioToAhorroCents: '500' }],
    ['extra', { ocioToAhorroCents: 500, extra: 0 }],
    ['sin importe', {}],
  ])('rechaza cierre con remainder %s y conserva el marcador', async (_label, remainder) => {
    await seedPrevious();
    const batch = writeBatch(db);
    batch.update(previousRef, { closed: true, remainder });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await deny(batch.commit());
    await assertMarker(previousId);
    expect((await getDoc(previousRef)).data()?.closed).toBe(false);
  });
  it('rechaza cerrar sin remainder', async () => {
    await seedPrevious();
    const batch = writeBatch(db);
    batch.update(previousRef, { closed: true });
    batch.update(profileRef, { lastClosedMonth: currentId });
    await deny(batch.commit());
    await assertMarker(previousId);
  });
  it('rechaza retroceder aunque el mes destino exista', async () => {
    // Keep the destination current, so this tests monotonicity rather than the date window.
    await admin.doc(profilePath).update({ lastClosedMonth: shiftedMonth(1) });
    await seedMonth(currentId);
    await deny(updateDoc(profileRef, { lastClosedMonth: currentId }));
    await assertMarker(shiftedMonth(1));
  });
  it.each([shiftedMonth(-6), shiftedMonth(6)])('rechaza destino fuera del mes actual: %s', async (target) => {
    await seedMonth(target);
    await deny(updateDoc(profileRef, { lastClosedMonth: target }));
    await assertMarker(null);
  });
  it.each(['2026-00', '2026-13', '2026-1', '2026/09', 'invalid', '', 1, false, {}, []])('rechaza tipo o formato de marcador: %j', async (target) => {
    await seedMonth(currentId);
    await deny(updateDoc(profileRef, { lastClosedMonth: target }));
    await assertMarker(null);
  });
  it('rechaza apuntar a un mes inexistente después de la escritura', async () => {
    await deny(updateDoc(profileRef, { lastClosedMonth: currentId }));
    await assertMarker(null);
  });
  it('rechaza volver a null sin limpieza previamente activa', async () => {
    await seedPrevious(previousMonth({ closed: true }));
    await deny(updateDoc(profileRef, { lastClosedMonth: null }));
    await assertMarker(previousId);
  });
  it('rechaza activar limpieza y borrar el marcador en la misma escritura', async () => {
    await seedPrevious(previousMonth({ closed: true }));
    await deny(updateDoc(profileRef, { lastClosedMonth: null, dataDeletionMode: 'reset' }));
    await assertMarker(previousId);
  });
  it('rechaza eliminar el campo lastClosedMonth', async () => {
    await deny(updateDoc(profileRef, { lastClosedMonth: deleteField() }));
    await assertMarker(null);
  });
  it.each(['reset', 'delete-account'])('admite null al restablecer un perfil con limpieza previa: %s', async (mode) => {
    await admin.doc(profilePath).update({ lastClosedMonth: previousId, dataDeletionMode: mode });
    await setDoc(profileRef, buildInitialUserProfile(identity));
    await assertMarker(null);
  });
  it('rechaza eliminar el campo incluso con limpieza activa', async () => {
    await admin.doc(profilePath).update({ lastClosedMonth: previousId, dataDeletionMode: 'reset' });
    await deny(updateDoc(profileRef, { lastClosedMonth: deleteField() }));
    await assertMarker(previousId);
  });
  it('rechaza avanzar durante una limpieza activa', async () => {
    await admin.doc(profilePath).update({ lastClosedMonth: previousId, dataDeletionMode: 'reset' });
    await seedMonth(currentId);
    await deny(updateDoc(profileRef, { lastClosedMonth: currentId }));
    await assertMarker(previousId);
  });
  it('rechaza borrar el mes destino y avanzar al mismo tiempo', async () => {
    await admin.doc(profilePath).update({ dataDeletionMode: 'reset' });
    await seedMonth(currentId);
    const batch = writeBatch(db);
    batch.delete(currentRef);
    batch.update(profileRef, { lastClosedMonth: currentId });
    await deny(batch.commit());
    await assertMarker(null);
    expect((await getDoc(currentRef)).exists()).toBe(true);
  });
  it('conserva el mismo marcador sin imponer un cierre', async () => {
    await seedPrevious();
    await updateDoc(profileRef, { lastClosedMonth: previousId, name: 'Nuevo nombre' });
    await assertMarker(previousId);
  });
  it('no valida otros campos ni un marcador legacy que no cambia', async () => {
    await admin.doc(profilePath).update({ lastClosedMonth: 'legacy' });
    await updateDoc(profileRef, { name: 'Nuevo nombre', savingsTotalCents: 123, savingsGoals: [], extra: true });
    expect((await getDoc(profileRef)).data()).toMatchObject({ lastClosedMonth: 'legacy', savingsTotalCents: 123, extra: true });
  });
  it.each(['other', 'anonymous'])('rechaza actualizar el perfil ajeno: %s', async (actor) => {
    await seedMonth(currentId);
    await deny(updateDoc(doc(actor === 'other' ? otherDb : anonDb, profilePath), { lastClosedMonth: currentId }));
    await assertMarker(null);
  });
  it.each(['other', 'anonymous'])('rechaza crear el perfil ajeno: %s', async (actor) => {
    await admin.doc(profilePath).delete();
    await deny(setDoc(doc(actor === 'other' ? otherDb : anonDb, profilePath), buildInitialUserProfile(identity)));
  });
  it('SERVICIO: primera inicialización e invocación repetida', async () => {
    const { checkAndCloseMonth } = await import('./monthService');
    await checkAndCloseMonth('owner');
    await checkAndCloseMonth('owner');
    await assertMarker(currentId);
    expect((await getDoc(currentRef)).data()?.closed).toBe(false);
  });
  it.each(['missing', 'closed', 'open'])('SERVICIO: avanza con mes previo %s y crea el actual', async (state) => {
    const { checkAndCloseMonth } = await import('./monthService');
    const oldId = shiftedMonth(-4);
    await admin.doc(profilePath).update({ lastClosedMonth: oldId });
    if (state !== 'missing') await seedMonth(oldId, previousMonth({ closed: state === 'closed' }));
    await checkAndCloseMonth('owner');
    await assertMarker(currentId);
    const next = (await getDoc(currentRef)).data()!;
    expect(next.closed).toBe(false);
    if (state === 'open') {
      expect((await getDoc(doc(db, monthPath(oldId)))).data()?.remainder).toEqual({ ocioToAhorroCents: 500 });
      expect(next.capsCents.ocio).toBe(100);
    }
  });
  it('SERVICIO: actualiza solo el marcador con mes previo cerrado y actual existente', async () => {
    const { checkAndCloseMonth } = await import('./monthService');
    await seedPrevious(previousMonth({ closed: true }));
    const before = (await getDoc(currentRef)).data();
    await checkAndCloseMonth('owner');
    await assertMarker(currentId);
    expect((await getDoc(currentRef)).data()).toEqual(before);
  });
  it('SERVICIO: reinicia datos y deja el marcador null', async () => {
    const { resetAllUserData } = await import('./accountDataService');
    await seedPrevious(previousMonth({ closed: true }));
    await resetAllUserData('owner', identity);
    await assertMarker(null);
    expect((await getDoc(previousRef)).exists()).toBe(false);
    expect((await getDoc(currentRef)).exists()).toBe(false);
  });
  it('SERVICIO: restaura el perfil de una eliminación de cuenta pendiente', async () => {
    const { restorePendingAccountDeletion } = await import('./accountDataService');
    await admin.doc(profilePath).update({ lastClosedMonth: previousId, dataDeletionMode: 'delete-account' });
    await restorePendingAccountDeletion('owner', identity);
    await assertMarker(null);
    expect((await getDoc(profileRef)).data()?.dataDeletionMode).toBe('delete-account');
  });
  it('conserva la eliminación del perfil durante limpieza de cuenta', async () => {
    await updateDoc(profileRef, { dataDeletionMode: 'delete-account' });
    await deleteDoc(profileRef);
    expect((await getDoc(profileRef)).exists()).toBe(false);
  });
});
