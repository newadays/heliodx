/**
 * Firebase for the web client, configured from the repo's `.env.<mode>` files
 * (EXPO_PUBLIC_*, a prefix kept from earlier); `EXPO_PUBLIC_USE_EMULATORS=1`
 * (e.g. in `.env.development.local`) points every service at the local
 * Emulator Suite.
 */
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const env = import.meta.env;

const app = initializeApp({
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
/** Must match REGION in functions/src/config.ts. */
export const functions = getFunctions(app, "europe-west1");

export const USE_EMULATORS = env.EXPO_PUBLIC_USE_EMULATORS === "1";
if (USE_EMULATORS) {
  const host = window.location.hostname || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}
