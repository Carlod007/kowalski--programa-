export const USER_FINANCIAL_DATA_TREE = [
  {
    collection: "months",
    children: ["transactions", "movements"],
    stage: "Eliminando meses y movimientos…",
  },
  {
    collection: "loans",
    children: ["payments", "fundMovements"],
    stage: "Eliminando préstamos…",
  },
  {
    collection: "creditCards",
    children: ["statements", "payments"],
    stage: "Eliminando tarjetas…",
  },
] as const;

export const USER_FLAT_DATA_COLLECTIONS = [
  {
    collection: "goalAllocations",
    stage: "Eliminando metas e historial…",
  },
] as const;

export const GLOBAL_USER_DATA_COLLECTIONS = [
  {
    collection: "migrationBackups",
    ownerField: "uid",
    stage: "Eliminando respaldos anteriores…",
  },
] as const;

export const PENDING_ACCOUNT_DELETION_KEY =
  "kowalski:pending-account-deletion";

export function rememberPendingAccountDeletion(userId: string): void {
  try {
    localStorage.setItem(PENDING_ACCOUNT_DELETION_KEY, userId);
  } catch {
    // Firestore conserva el marcador principal si storage no está disponible.
  }
}

export function forgetPendingAccountDeletion(): void {
  try {
    localStorage.removeItem(PENDING_ACCOUNT_DELETION_KEY);
  } catch {
    // La cuenta ya puede continuar eliminándose sin este respaldo local.
  }
}

export function getPendingAccountDeletionUserId(): string | null {
  try {
    return localStorage.getItem(PENDING_ACCOUNT_DELETION_KEY);
  } catch {
    return null;
  }
}

export function chunkForDeletion<T>(items: T[], batchSize = 400): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 500) {
    throw new Error("El tamaño del lote debe estar entre 1 y 500");
  }

  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    chunks.push(items.slice(start, start + batchSize));
  }
  return chunks;
}
