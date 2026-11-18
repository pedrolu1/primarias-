// Projeto Firebase do Primárias: contas (login por matrícula) e banco do app.
// As coleções começam com "prim_" e as regras estão em firestore.rules.
// O cache local é ilimitado porque o líder pode juntar fotos sem internet:
// tudo fica guardado no aparelho e sobe sozinho quando a rede volta.
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import { CONFIG_FIREBASE } from './firebase-config.js';

// As chaves vêm de src/lib/firebase-config.js; variáveis VITE_FIREBASE_* (arquivo
// .env ou o build) têm prioridade. Com VITE_DEMO=1 (npm run demo), o app ignora
// as chaves e roda no modo demonstração, com os dados só no navegador.
const doAmbiente = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const demo = import.meta.env.VITE_DEMO === '1';
const firebaseConfig = demo ? {} : doAmbiente.apiKey ? doAmbiente : CONFIG_FIREBASE || {};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app;
let auth;
let db;
if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
  if (appCheckKey) initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckKey), isTokenAutoRefreshEnabled: true });
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED })
  });
}

export { app, auth, db };
