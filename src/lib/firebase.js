// Projeto Firebase do Primárias: contas (login por matrícula) e banco do app.
// As coleções começam com "prim_" e as regras estão em firestore.rules.
// O cache local é ilimitado porque o líder pode juntar fotos sem internet:
// tudo fica guardado no aparelho e sobe sozinho quando a rede volta.
// Com VITE_DEMO=1 (npm run demo) o app roda sem Firebase, com os dados só no
// navegador (modo demonstração).
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import { CONFIG_FIREBASE } from './firebase-config.js';

export const firebaseConfigured = import.meta.env.VITE_DEMO !== '1';

let auth;
let db;
if (firebaseConfigured) {
  const app = initializeApp(CONFIG_FIREBASE);
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: CACHE_SIZE_UNLIMITED })
  });
}

export { auth, db };
