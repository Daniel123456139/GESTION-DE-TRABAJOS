import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMotivosAusencias, getCalendarioEmpresa, getOperarios, MotivoAusencia, CalendarioDia, Operario } from '../services/erpApi';
import { useMemo } from 'react';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { getFirebaseDb } from '../firebaseConfig';
import { firebaseCollections, getCollectionCandidates } from '../services/firebaseCollections';
import { logError, logWarning } from '../utils/logger';

// --- Keys ---
export const ERP_KEYS = {
    motivos: ['motivos'] as const,
    operarios: ['operarios'] as const,
    calendario: (start: string, end: string) => ['calendario', { start, end }] as const,
};

// --- Hooks ---

export const useMotivos = () => {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ERP_KEYS.motivos,
        queryFn: getMotivosAusencias,
        staleTime: 1000 * 60 * 60 * 24, // 24 horas (datos maestros muy estáticos)
    });

    return {
        motivos: data || [],
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refresh: refetch
    };
};

export const useOperarios = (onlyActive = true) => {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ERP_KEYS.operarios,
        queryFn: async () => {
            try {
                return await getOperarios();
            } catch (erpError) {
                const db = getFirebaseDb();
                const employeeCollections = getCollectionCandidates(
                    firebaseCollections.employees,
                    firebaseCollections.employeesFallbacks
                );

                let snapshot = null;
                let usedCollection = employeeCollections[0];
                for (const collectionName of employeeCollections) {
                    try {
                        await getDocs(query(collection(db, collectionName), limit(1)));
                        snapshot = await getDocs(collection(db, collectionName));
                        usedCollection = collectionName;
                        break;
                    } catch (collectionError) {
                        logWarning('Fallo leyendo colección de fallback', {
                            source: 'useOperarios.firebaseFallback',
                            operation: 'getDocs',
                            collection: collectionName,
                            reason: collectionError
                        });
                    }
                }

                if (!snapshot) {
                    logError(erpError, {
                        source: 'useOperarios.erpPrimaryAndFallback',
                        operation: 'getOperarios/getDocs',
                        collectionsTried: employeeCollections
                    });
                    throw erpError;
                }

                const fromFirestore = snapshot.docs
                    .map((doc) => {
                        const data = doc.data();
                        const idRaw = data.IDOperario ?? doc.id;
                        const idNum = parseInt(String(idRaw), 10);

                        if (Number.isNaN(idNum)) return null;

                        const activeValue = data.Activo ?? data.activo ?? true;
                        const activo = activeValue === true || activeValue === 1 || activeValue === '1' || activeValue === 'true';

                        return {
                            IDOperario: idNum,
                            DescOperario: data.DescOperario || data.nombre || `Empleado ${idNum}`,
                            IDDepartamento: parseInt(String(data.IDDepartamento ?? 0), 10) || 0,
                            DescDepartamento: data.DescDepartamento || data.Seccion || '',
                            Activo: activo,
                            Productivo: data.Productivo ?? true,
                            Flexible: data.Flexible ?? false,
                        } as Operario;
                    })
                    .filter((op): op is Operario => !!op);

                logWarning(`ERP no disponible, usando fallback Firestore ${usedCollection}:`, erpError);
                return fromFirestore;
            }
        },
        staleTime: 1000 * 60 * 5, // 5 minutos
    });

    const filteredOperarios = useMemo(() => {
        if (!data) return [];
        return data.filter(op => {
            // Excluir ID 999
            if (op.IDOperario === 999) return false;

            // Excluir empleados con "zzz" en descripción (dormidos/inactivos)
            if (op.DescOperario?.toLowerCase().includes('zzz')) return false;

            // Si onlyActive está activado, también filtrar por campo Activo
            if (onlyActive && !op.Activo) return false;

            return true;
        });
    }, [data, onlyActive]);

    return {
        operarios: filteredOperarios,
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refresh: refetch
    };
};

export const useCalendario = (startDate: string, endDate: string) => {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ERP_KEYS.calendario(startDate, endDate),
        queryFn: () => getCalendarioEmpresa(startDate, endDate),
        enabled: !!startDate && !!endDate, // Solo ejecutar si hay fechas
        staleTime: 1000 * 60 * 10, // 10 minutos
    });

    return {
        calendario: data || [],
        loading: isLoading,
        error: error ? (error as Error).message : null,
        refresh: refetch
    };
};
