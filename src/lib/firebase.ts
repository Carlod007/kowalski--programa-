import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBlCO0iqbUmTrxRmIzPrNW_osrvq5vXF8A",
  authDomain: "kowalski-pwa.firebaseapp.com",
  projectId: "kowalski-pwa",
  storageBucket: "kowalski-pwa.firebasestorage.app",
  messagingSenderId: "904750302469",
  appId: "1:904750302469:web:1eb72e42b78a8f045c236c",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
