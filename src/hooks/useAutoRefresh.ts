import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFichajes, fetchFichajesBatched } from '../services/apiService';
import { RawDataRow } from '../types';
import { logError, logWarning } from '../utils/logger';

interface AutoRefreshOptions {
    intervalMs?: number; // Default 120000 (2 mins)
    enabled?: boolean;
}

export const useAutoRefresh = (
    startDate: string,
    endDate: string,
    onDataFetched: (data: RawDataRow[]) => void,
    options: AutoRefreshOptions = {}
) => {
    const { intervalMs = 120000, enabled = true } = options;

    const [isRefetching, setIsRefetching] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
    const [error, setError] = useState<string | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const refreshData = useCallback(async () => {
        if (!startDate || !endDate) return;

        console.log('🔄 [AutoRefresh] Iniciando sincronización...');
        setIsRefetching(true);
        setError(null);

        try {
            // Reutilizamos fetchFichajes del servicio existente
            const rangeDays = Math.ceil(Math.abs(new Date(`${endDate}T23:59:59`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24));
            const data = rangeDays > 7
                ? await fetchFichajesBatched(startDate, endDate, '', '00:00', '23:59')
                : await fetchFichajes(startDate, endDate, '', '00:00', '23:59');
            onDataFetched(data);
            setLastUpdated(Date.now());
            console.log('✅ [AutoRefresh] Sincronización completada.');
        } catch (err: any) {
            logError('❌ [AutoRefresh] Error:', err);
            setError(err.message || 'Error de conexión');
        } finally {
            setIsRefetching(false);
        }
    }, [startDate, endDate, onDataFetched]);

    // 1. Intervalo de Polling
    useEffect(() => {
        if (!enabled) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        // Configurar intervalo
        intervalRef.current = setInterval(() => {
            // Solo ejecutar si la pestaña está visible para ahorrar recursos
            if (document.visibilityState === 'visible') {
                refreshData();
            }
        }, intervalMs);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [enabled, intervalMs, refreshData]);

    // 2. Refocus (Visibility Change)
    useEffect(() => {
        if (!enabled) return;

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // Si ha pasado más de 10 segs desde la última vez (para evitar rebote rápido)
                const timeSinceLast = Date.now() - lastUpdated;
                if (timeSinceLast > 10000) {
                    console.log('👁️ [AutoRefresh] Pestaña visible, forzando refresh...');
                    refreshData();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled, lastUpdated, refreshData]);

    return {
        isRefetching,
        lastUpdated,
        error,
        manualRefresh: refreshData
    };
};
