import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const useEmulator =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === "true";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    (useEmulator ? "demo-kowalski-key" : undefined),
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    (useEmulator ? "kowalski-pwa.firebaseapp.com" : undefined),
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID ||
    (useEmulator ? "kowalski-pwa" : undefined),
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (useEmulator ? "kowalski-pwa.appspot.com" : undefined),
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    (useEmulator ? "000000000000" : undefined),
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    (useEmulator ? "1:000000000000:web:000000000000" : undefined),
};

function validateFirebaseConfig(config: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value.trim() === "") {
      throw new Error(`Firebase config missing: ${key}`);
    }
  }
}

validateFirebaseConfig(firebaseConfig);

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
