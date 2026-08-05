#!/usr/bin/env node
/**
 * Migración puntual: cuentas creadas con una versión vieja de la app
 * guardaron el ahorro puro de un ingreso en `capsCents.ahorro`, un campo
 * que el esquema actual (MonthCaps) ya no declara ni lee en ningún lado del
 * código de src/. Ese monto nunca llegó a `ahorroContributedCents` (del
 * mes) ni a `savingsTotalCents` (del perfil), que son los campos que la
 * app sí muestra. La plata no está perdida, está en un campo muerto.
 *
 * Este script NUNCA toca más cuentas que las pasadas por --uid. No existe
 * modo "todas las cuentas".
 *
 * Modos (compuestos con flags, nunca automáticos):
 *   (sin flags)  Dry-run. Solo lee y muestra el diagnóstico. No escribe nada.
 *   --apply      Acredita el monto faltante a ahorroContributedCents y
 *                savingsTotalCents dentro de una transacción, y deja una
 *                marca de migración (ahorroCapsMigration). NO borra
 *                capsCents.ahorro.
 *   --cleanup    Borra capsCents.ahorro, pero SOLO en meses que ya tengan
 *                la marca de migración (de una corrida anterior con
 *                --apply). No se puede combinar con --apply en la misma
 *                corrida: primero aplicá, revisá en la app/consola que
 *                todo se ve bien, y recién después corré --cleanup aparte.
 *
 * Antes de escribir nada, cada mes se clasifica según si
 * necesidad+ocio+ahorroContributedCents ya es igual a totalIncomeCents
 * (en cuyo caso capsCents.ahorro NO se suma de nuevo, solo se documenta)
 * o si falta exactamente ese monto (caso real encontrado: se acredita).
 * Cualquier otro caso se reporta como "unexplained-mismatch" y el script
 * no toca ese mes.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json \
 *     node scripts/migrate-caps-ahorro.mjs --uid=<UID> [--uid=<UID2>] [--apply|--cleanup]
 *
 * La credencial de servicio nunca debe vivir dentro del repo (ver
 * .gitignore) ni pasarse a nadie, incluido este asistente.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "node:fs";

const MIGRATION_VERSION = 1;

function parseArgs() {
  const uids = [];
  let apply = false;
  let cleanup = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--uid=")) uids.push(arg.slice("--uid=".length));
    else if (arg === "--apply") apply = true;
    else if (arg === "--cleanup") cleanup = true;
    else {
      console.error(`Argumento desconocido: ${arg}`);
      process.exit(1);
    }
  }

  if (uids.length === 0) {
    console.error(
      "Uso: node migrate-caps-ahorro.mjs --uid=<UID> [--uid=<UID2>...] [--apply | --cleanup]",
    );
    process.exit(1);
  }
  if (apply && cleanup) {
    console.error(
      "No combines --apply y --cleanup en la misma corrida. Aplicá, revisá, y recién después limpiá.",
    );
    process.exit(1);
  }

  return { uids, apply, cleanup };
}

function initAdmin() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath || !fs.existsSync(keyPath)) {
    console.error(
      "Definí GOOGLE_APPLICATION_CREDENTIALS apuntando a tu service account key (un archivo fuera del repo).",
    );
    process.exit(1);
  }
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
  return getFirestore();
}

/**
 * Clasifica un mes sin escribir nada.
 */
function diagnoseMonth(monthId, data) {
  const orphaned = data.capsCents?.ahorro;
  if (!orphaned || orphaned <= 0) return null; // nada que migrar en este mes

  const alreadyMigrated = data.ahorroCapsMigration?.version === MIGRATION_VERSION;

  const necesidad = data.capsCents?.necesidad ?? 0;
  const ocio = data.capsCents?.ocio ?? 0;
  const ahorroContributed = data.ahorroContributedCents ?? 0;
  const totalIncome = data.totalIncomeCents ?? 0;

  const sumWithoutOrphan = necesidad + ocio + ahorroContributed;
  const sumWithOrphan = sumWithoutOrphan + orphaned;

  if (alreadyMigrated) {
    return {
      monthId,
      status: "already-migrated",
      orphaned,
      creditedPreviously: data.ahorroCapsMigration.creditedCents,
    };
  }
  if (sumWithoutOrphan === totalIncome) {
    // Ya está contabilizado sin el campo huérfano: no hay que sumarlo de
    // nuevo, solo documentarlo/limpiarlo.
    return { monthId, status: "already-accounted", orphaned, sumWithoutOrphan, totalIncome };
  }
  if (sumWithOrphan === totalIncome) {
    return {
      monthId,
      status: "needs-credit",
      orphaned,
      creditCents: orphaned,
      sumWithoutOrphan,
      totalIncome,
    };
  }
  return {
    monthId,
    status: "unexplained-mismatch",
    orphaned,
    sumWithoutOrphan,
    sumWithOrphan,
    totalIncome,
  };
}

async function backupMonth(db, uid, monthId, rawData) {
  const backupId = `${uid}_${monthId}_v${MIGRATION_VERSION}_${Date.now()}`;
  await db.collection("migrationBackups").doc(backupId).set({
    uid,
    monthId,
    migrationVersion: MIGRATION_VERSION,
    snapshot: rawData,
    backedUpAt: FieldValue.serverTimestamp(),
  });
  return backupId;
}

async function applyCredit(db, userRef, monthRef, diagnosis) {
  await db.runTransaction(async (tx) => {
    const freshMonthSnap = await tx.get(monthRef);
    const freshData = freshMonthSnap.data();
    if (freshData.ahorroCapsMigration?.version === MIGRATION_VERSION) {
      return; // ya migrado por una corrida anterior: idempotente, no repetir
    }
    tx.update(monthRef, {
      ahorroContributedCents: FieldValue.increment(diagnosis.creditCents),
      ahorroCapsMigration: {
        version: MIGRATION_VERSION,
        creditedCents: diagnosis.creditCents,
        migratedAt: FieldValue.serverTimestamp(),
      },
    });
    tx.update(userRef, {
      savingsTotalCents: FieldValue.increment(diagnosis.creditCents),
    });
  });
}

async function cleanupMonth(monthRef) {
  await monthRef.update({
    "capsCents.ahorro": FieldValue.delete(),
  });
}

async function run() {
  const { uids, apply, cleanup } = parseArgs();
  const db = initAdmin();

  for (const uid of uids) {
    console.log(`\n=== Usuario ${uid} ===`);
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      console.log("  Perfil no encontrado, se salta.");
      continue;
    }
    console.log(`  savingsTotalCents actual: ${userSnap.data().savingsTotalCents ?? 0}`);

    const monthsSnap = await userRef.collection("months").get();
    let totalCreditCents = 0;
    let monthsTouched = 0;

    for (const monthDoc of monthsSnap.docs) {
      const rawData = monthDoc.data();
      const diagnosis = diagnoseMonth(monthDoc.id, rawData);
      if (!diagnosis) continue;

      console.log(`  Mes ${diagnosis.monthId}:`, diagnosis);

      if (diagnosis.status === "needs-credit") {
        totalCreditCents += diagnosis.creditCents;
        monthsTouched++;

        if (apply) {
          const backupId = await backupMonth(db, uid, diagnosis.monthId, rawData);
          console.log(`    Backup guardado en migrationBackups/${backupId}`);
          await applyCredit(db, userRef, monthDoc.ref, diagnosis);
          console.log(`    -> Acreditado ${diagnosis.creditCents} cents. capsCents.ahorro NO se borró.`);
        }
      }

      if (cleanup) {
        const isMigrated =
          diagnosis.status === "already-migrated" ||
          (diagnosis.status === "needs-credit" && apply);
        if (isMigrated) {
          await cleanupMonth(monthDoc.ref);
          console.log(`    -> capsCents.ahorro eliminado (ya estaba migrado).`);
        } else {
          console.log(
            `    -> No se limpia: todavía no tiene marca de migración confirmada.`,
          );
        }
      }
    }

    console.log(
      `  Total a acreditar en esta corrida: ${totalCreditCents} cents (S/${(totalCreditCents / 100).toFixed(2)}) en ${monthsTouched} mes(es).`,
    );
    if (!apply && !cleanup) console.log("  [DRY-RUN] No se escribió nada.");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
