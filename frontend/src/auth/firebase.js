import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';

/**
 * Firebase initialization for the React app.
 *
 * Config values come from Vite env vars (prefix `VITE_` so they're exposed to
 * the client bundle). Copy them from Firebase Console → Project Settings →
 * "Your apps" → Web app → SDK setup. They're safe to commit because Firebase
 * web config is public; we still keep them in .env.local so each environment
 * can point at its own project.
 *
 * Required vars (see .env.example):
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_APP_ID
 * Optional:
 *   VITE_FIREBASE_STORAGE_BUCKET
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

if (!isConfigured()) {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] Missing one or more VITE_FIREBASE_* env vars. ' +
      'Copy .env.example → .env.local in /frontend and fill in the values from Firebase Console.'
  );
}

// Reuse the existing app if Vite HMR re-evaluates this module.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// Persist the session in localStorage so a page reload keeps the user signed in.
// Wrap in try/catch — setPersistence rejects if env vars are missing or in SSR contexts.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  // eslint-disable-next-line no-console
  console.warn('[firebase] setPersistence failed:', err?.message);
});

export { app, auth };
