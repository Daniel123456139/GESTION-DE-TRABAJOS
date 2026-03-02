const env = import.meta.env;

const splitList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const unique = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

export const firebaseCollections = {
  users: env.VITE_FIREBASE_COLLECTION_USERS || 'USUARIOS',
  usersFallbacks: unique(['usuarios', 'USERS', ...splitList(env.VITE_FIREBASE_COLLECTION_USERS_FALLBACKS)]),

  employees: env.VITE_FIREBASE_COLLECTION_EMPLOYEES || 'EMPLEADOS_REF',
  employeesFallbacks: unique(['EMPLEADOS', ...splitList(env.VITE_FIREBASE_COLLECTION_EMPLOYEES_FALLBACKS)]),

  competencias: env.VITE_FIREBASE_COLLECTION_COMPETENCIAS || 'COMPETENCIAS',
  notas: env.VITE_FIREBASE_COLLECTION_NOTAS || 'NOTAS',
  sickLeaves: env.VITE_FIREBASE_COLLECTION_SICK_LEAVES || 'SICK_LEAVES',
  bajas: env.VITE_FIREBASE_COLLECTION_BAJAS || 'BAJAS',
  incidentLog: env.VITE_FIREBASE_COLLECTION_INCIDENT_LOG || 'INCIDENT_LOG',
  generatedPunches: env.VITE_FIREBASE_COLLECTION_APP_GENERATED_PUNCHES || 'APP_GENERATED_PUNCHES',
  accessLog: env.VITE_FIREBASE_COLLECTION_ACCESS_LOG || 'EMPLOYEE_ACCESS_LOG'
};

export const getCollectionCandidates = (
  primary: string,
  fallbacks: string[] = []
): string[] => unique([primary, ...fallbacks]);
