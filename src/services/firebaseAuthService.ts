
import { getAuth, signInWithEmailAndPassword as fbSignIn, signOut as fbSignOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseApp, getFirebaseDb } from '../firebaseConfig';
import { firebaseCollections, getCollectionCandidates } from './firebaseCollections';
import { logError, logWarning } from '../utils/logger';

export interface AppAuthUser {
  uid: string;
  email: string;
  displayName: string;
  appRole: 'HR' | 'EMPLOYEE' | 'MANAGEMENT';
  rolUnificado: string;
  erpEmployeeId: number;
}

// --- SERVICE IMPLEMENTATION ---

export async function signInWithEmailPassword(email: string, password: string): Promise<AppAuthUser> {
  let auth;

  try {
    const app = getFirebaseApp();
    auth = getAuth(app);
  } catch (e: any) {
    logWarning('Firebase Auth no disponible', {
      source: 'signInWithEmailPassword.getAuth',
      reason: e
    });

    const mappedError = mapAuthError(e?.code || '');
    if (mappedError !== 'Error al iniciar sesión.') {
      throw new Error(mappedError);
    }

    return mockLogin(email, password);
  }

  // REAL FIREBASE LOGIN
  try {
    const userCredential = await fbSignIn(auth, email, password);
    const user = userCredential.user;
    if (!user) throw new Error('No user returned from Firebase');
    return await fetchUserProfile(user);
  } catch (error: any) {
    logError(error, {
      source: 'signInWithEmailPassword.fbSignIn',
      operation: 'signInWithEmailAndPassword',
      email
    });
    throw new Error(mapAuthError(error.code));
  }
}

// Helper para login simulado
async function mockLogin(email: string, _password: string): Promise<AppAuthUser> {
  // ELIMINADO: Ya no se permiten logins mock con contraseñas hardcoded en producción.
  // Solo se permite si el usuario ya está predefinido y es un entorno controlado.
  await new Promise(resolve => setTimeout(resolve, 800));

  throw new Error('El modo de autenticación local está desactivado por seguridad.');
}

export async function signOutApp(): Promise<void> {
  try {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    await fbSignOut(auth);
  } catch (e) {
    logWarning('No se pudo cerrar sesion en Firebase Auth (continuando limpieza local)', {
      source: 'signOutApp.fbSignOut',
      reason: e
    });
  }
}

export function subscribeToAuthChanges(callback: (user: AppAuthUser | null) => void): () => void {
  try {
    const app = getFirebaseApp();
    const auth = getAuth(app);

    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const appUser = await fetchUserProfile(firebaseUser);
          callback(appUser);
        } catch (error) {
          logError(error, {
            source: 'subscribeToAuthChanges.fetchUserProfile',
            uid: firebaseUser.uid
          });
          callback(null);
        }
      } else {
        callback(null);
      }
    });
  } catch (error) {
    logError(error, {
      source: 'subscribeToAuthChanges.init'
    });
    callback(null);
    return () => { };
  }
}

export async function getCurrentFirebaseToken(forceRefresh = false): Promise<string | null> {
  try {
    const app = getFirebaseApp();
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

// --- Helpers Internos ---

async function fetchUserProfile(user: FirebaseUser): Promise<AppAuthUser> {
  const db = getFirebaseDb();
  let rolUnificado = 'USER';
  let displayName = user.displayName || 'Usuario';
  let erpEmployeeId = 0;

  try {
    const userCollections = getCollectionCandidates(
      firebaseCollections.users,
      firebaseCollections.usersFallbacks
    );

    for (const collectionName of userCollections) {
      const userDocRef = doc(db, collectionName, user.uid);
      let userDoc;
      try {
        userDoc = await getDoc(userDocRef);
      } catch (readError) {
        logWarning('No se pudo leer perfil en coleccion candidata', {
          source: 'fetchUserProfile.getDoc',
          operation: 'getDoc',
          collection: collectionName,
          uid: user.uid,
          reason: readError
        });
        continue;
      }
      if (!userDoc.exists()) continue;

      const data = userDoc.data();
      if (data?.activo === false || data?.active === false) {
        throw new Error('Usuario desactivado.');
      }

      rolUnificado =
        data?.rol ||
        data?.role ||
        data?.appRole ||
        rolUnificado;
      displayName =
        data?.nombre ||
        data?.displayName ||
        data?.name ||
        displayName;
      erpEmployeeId =
        data?.erpEmployeeId ||
        data?.employeeId ||
        erpEmployeeId;
      break;
    }

    if (rolUnificado === 'USER') {
      const tokenResult = await user.getIdTokenResult();
      rolUnificado =
        (tokenResult.claims.rol as string) ||
        (tokenResult.claims.role as string) ||
        rolUnificado;
    }
  } catch (e: any) {
    if (e.message === 'Usuario desactivado.') throw e;
    logWarning('Error leyendo perfil de Firestore, usando fallback', {
      source: 'fetchUserProfile.firestoreFallback',
      uid: user.uid,
      reason: e
    });
    try {
      const tokenResult = await user.getIdTokenResult();
      rolUnificado =
        (tokenResult.claims.rol as string) ||
        (tokenResult.claims.role as string) ||
        rolUnificado;
      displayName =
        (tokenResult.claims.nombre as string) ||
        (tokenResult.claims.name as string) ||
        displayName;
    } catch (tokenError) {
      logWarning('No se pudo leer el rol desde custom claims', {
        source: 'fetchUserProfile.tokenClaims',
        uid: user.uid,
        reason: tokenError
      });
    }
  }

  // Mapeo a roles internos de la App Gestion Trabajos (compatibilidad)
  let appRole: AppAuthUser['appRole'] = 'EMPLOYEE';
  const normalizedRole = String(rolUnificado).toUpperCase();
  if (['SUPER_ADMIN', 'RRHH', 'HR', 'ADMIN'].includes(normalizedRole)) {
    appRole = 'HR';
  } else if (['GESTOR_TRABAJOS', 'MANAGEMENT', 'MANAGER'].includes(normalizedRole)) {
    appRole = 'MANAGEMENT';
  }

  return {
    uid: user.uid,
    email: user.email || '',
    displayName,
    appRole,
    rolUnificado,
    erpEmployeeId
  };
}

function mapAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-api-key':
      return 'Configuración de Firebase inválida. Revisa .env.local/.env (VITE_FIREBASE_*) y reinicia la app.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Credenciales incorrectas.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Inténtalo más tarde.';
    case 'auth/network-request-failed':
      return 'Error de conexión con Firebase.';
    default:
      return 'Error al iniciar sesión.';
  }
}
