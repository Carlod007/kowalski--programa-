import {
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildInitialUserProfile } from "@/services/userService";
import type {
  DataDeletionMode,
  User as UserProfile,
} from "@/types/user";
import {
  chunkForDeletion,
  GLOBAL_USER_DATA_COLLECTIONS,
  USER_FINANCIAL_DATA_TREE,
  USER_FLAT_DATA_COLLECTIONS,
} from "@/utils/dataDeletion";

const DELETE_BATCH_SIZE = 400;

export type DataDeletionProgress = {
  stage: string;
  deletedDocuments: number;
};

type ProgressCallback = (progress: DataDeletionProgress) => void;

function assertOnline(): void {
  if (!navigator.onLine) {
    throw new Error(
      "Necesitas conexión a Internet para borrar los datos de forma segura.",
    );
  }
}

async function deleteReferences(
  references: DocumentReference<DocumentData>[],
  stage: string,
  progress: DataDeletionProgress,
  onProgress?: ProgressCallback,
): Promise<void> {
  for (const chunk of chunkForDeletion(references, DELETE_BATCH_SIZE)) {
    const batch = writeBatch(db);
    chunk.forEach((reference) => batch.delete(reference));
    await batch.commit();
    progress.deletedDocuments += chunk.length;
    progress.stage = stage;
    onProgress?.({ ...progress });
  }
}

async function deleteFlatCollection(
  parent: DocumentReference<DocumentData>,
  collectionName: string,
  stage: string,
  progress: DataDeletionProgress,
  onProgress?: ProgressCallback,
): Promise<void> {
  const snapshot = await getDocsFromServer(collection(parent, collectionName));
  await deleteReferences(
    snapshot.docs.map((item) => item.ref),
    stage,
    progress,
    onProgress,
  );
}

async function deleteParentCollection(
  userReference: DocumentReference<DocumentData>,
  collectionName: string,
  childCollections: string[],
  stage: string,
  progress: DataDeletionProgress,
  onProgress?: ProgressCallback,
): Promise<void> {
  const snapshot = await getDocsFromServer(
    collection(userReference, collectionName),
  );

  for (const parentDocument of snapshot.docs) {
    for (const childCollection of childCollections) {
      await deleteFlatCollection(
        parentDocument.ref,
        childCollection,
        stage,
        progress,
        onProgress,
      );
    }
  }

  await deleteReferences(
    snapshot.docs.map((item) => item.ref),
    stage,
    progress,
    onProgress,
  );
}

async function deleteGlobalUserCollection(
  userId: string,
  collectionName: string,
  ownerField: string,
  stage: string,
  progress: DataDeletionProgress,
  onProgress?: ProgressCallback,
): Promise<void> {
  const snapshot = await getDocsFromServer(
    query(collection(db, collectionName), where(ownerField, "==", userId)),
  );
  await deleteReferences(
    snapshot.docs.map((item) => item.ref),
    stage,
    progress,
    onProgress,
  );
}

async function markDeletion(
  userId: string,
  mode: DataDeletionMode,
): Promise<void> {
  await updateDoc(doc(db, "users", userId), {
    dataDeletionMode: mode,
    dataDeletionStartedAt: serverTimestamp(),
  });
}

/**
 * Borra todo el árbol financiero conocido. El orden hijos -> padres evita
 * documentos huérfanos, y cada paso es idempotente para poder reintentarlo.
 */
async function purgeFinancialData(
  userId: string,
  onProgress?: ProgressCallback,
): Promise<number> {
  const userReference = doc(db, "users", userId);
  const progress: DataDeletionProgress = {
    stage: "Preparando la limpieza…",
    deletedDocuments: 0,
  };
  onProgress?.({ ...progress });

  for (const entry of USER_FINANCIAL_DATA_TREE) {
    await deleteParentCollection(
      userReference,
      entry.collection,
      [...entry.children],
      entry.stage,
      progress,
      onProgress,
    );
  }
  for (const entry of USER_FLAT_DATA_COLLECTIONS) {
    await deleteFlatCollection(
      userReference,
      entry.collection,
      entry.stage,
      progress,
      onProgress,
    );
  }
  for (const entry of GLOBAL_USER_DATA_COLLECTIONS) {
    await deleteGlobalUserCollection(
      userId,
      entry.collection,
      entry.ownerField,
      entry.stage,
      progress,
      onProgress,
    );
  }

  return progress.deletedDocuments;
}

export async function resetAllUserData(
  userId: string,
  identity: Pick<UserProfile, "name" | "email">,
  onProgress?: ProgressCallback,
): Promise<UserProfile> {
  assertOnline();
  await markDeletion(userId, "reset");
  const deletedDocuments = await purgeFinancialData(userId, onProgress);

  const blankProfile = buildInitialUserProfile(identity);
  onProgress?.({ stage: "Restableciendo la configuración…", deletedDocuments });
  await setDoc(doc(db, "users", userId), blankProfile);
  return blankProfile;
}

export async function deleteAllAccountData(
  userId: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  assertOnline();
  await markDeletion(userId, "delete-account");
  const deletedDocuments = await purgeFinancialData(userId, onProgress);
  onProgress?.({ stage: "Eliminando el perfil…", deletedDocuments });
  await deleteDoc(doc(db, "users", userId));
}

export async function restorePendingAccountDeletion(
  userId: string,
  identity: Pick<UserProfile, "name" | "email">,
): Promise<void> {
  await setDoc(doc(db, "users", userId), {
    ...buildInitialUserProfile(identity),
    dataDeletionMode: "delete-account",
    dataDeletionStartedAt: serverTimestamp(),
  });
}
