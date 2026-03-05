import { useState, useEffect, useRef, useCallback } from 'react';
import { getControlOfPorOperario, getOperarios, Operario } from '../services/erpApi';
import { JobControlEntry } from '../types';
import { useNotification } from '../components/shared/NotificationContext';
import { logError, logWarning } from '../utils/logger';

const JOB_DATA_TTL_MS = 5 * 60 * 1000;
const OPERARIOS_TTL_MS = 10 * 60 * 1000;

type JobDataCacheEntry = {
    timestamp: number;
    data: Record<string, JobControlEntry[]>;
};

type OperariosCacheEntry = {
    timestamp: number;
    data: Operario[];
};

const jobDataCache = new Map<string, JobDataCacheEntry>();
let operariosCache: OperariosCacheEntry | null = null;

const isAbortLikeError = (error: unknown): boolean => {
    if (!error) return false;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') return true;
    if (error instanceof Error) {
        if (error.name === 'AbortError') return true;
        return /abort(ed)?/i.test(error.message);
    }
    return false;
};

export const useJobData = (
    startDate: string,
    endDate: string,
    enabled: boolean = true
) => {
    const { showNotification } = useNotification();
    const [jobData, setJobData] = useState<Record<string, JobControlEntry[]>>({});
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
    const [debugInfo, setDebugInfo] = useState({
        totalOps: 0,
        activeOps: 0,
        opsWithData: 0,
        sampleOpId: 0 as number | undefined,
        lastError: null as string | null
    });

    const abortControllerRef = useRef<AbortController | null>(null);

    const fetchJobs = useCallback(async (forceRefresh: boolean = false) => {
        if (!enabled || !startDate || !endDate) return;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const now = Date.now();
        const rangeCacheKey = `${startDate}|${endDate}`;
        const cachedRange = jobDataCache.get(rangeCacheKey);

        if (!forceRefresh && cachedRange && now - cachedRange.timestamp < JOB_DATA_TTL_MS) {
            setJobData(cachedRange.data);
            setLoading(false);
            setProgress(null);
            setDebugInfo(prev => ({
                ...prev,
                opsWithData: Object.keys(cachedRange.data).length,
                lastError: null
            }));
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setLoading(true);
        setJobData({});
        // Reset debug info
        setDebugInfo(prev => ({ ...prev, totalOps: 0, activeOps: 0, opsWithData: 0, lastError: null }));

        try {
            const shouldRefreshOperarios = !operariosCache || (now - operariosCache.timestamp) >= OPERARIOS_TTL_MS;
            const operators = shouldRefreshOperarios
                ? await getOperarios(true)
                : operariosCache.data;

            if (shouldRefreshOperarios) {
                operariosCache = {
                    timestamp: Date.now(),
                    data: operators
                };
            }

            const activeOps = operators.filter(op => op.Activo);

            // Update debug info early
            setDebugInfo(prev => ({
                ...prev,
                totalOps: operators.length,
                activeOps: activeOps.length,
                sampleOpId: activeOps[0]?.IDOperario
            }));

            setProgress({ processed: 0, total: activeOps.length });

            const results: Record<string, JobControlEntry[]> = {};
            const BATCH_SIZE = 10;

            for (let i = 0; i < activeOps.length; i += BATCH_SIZE) {
                if (controller.signal.aborted) break;

                const batch = activeOps.slice(i, i + BATCH_SIZE);
                const batchPromises = batch.map(async (op) => {
                    try {
                        const entries = await getControlOfPorOperario(
                            String(op.IDOperario),
                            startDate,
                            endDate,
                            10000,
                            controller.signal
                        );
                        return { id: String(op.IDOperario), entries };
                    } catch (err) {
                        if (controller.signal.aborted || isAbortLikeError(err)) {
                            return { id: String(op.IDOperario), entries: [] };
                        }
                        logWarning(`Error fetching for op ${op.IDOperario}`, err);
                        return { id: String(op.IDOperario), entries: [] };
                    }
                });

                const batchResults = await Promise.all(batchPromises);

                batchResults.forEach(res => {
                    if (res.entries && res.entries.length > 0) {
                        results[res.id] = res.entries;
                    }
                });

                setProgress({
                    processed: Math.min(i + BATCH_SIZE, activeOps.length),
                    total: activeOps.length
                });
            }

            if (!controller.signal.aborted) {
                setJobData(results);
                setDebugInfo(prev => ({ ...prev, opsWithData: Object.keys(results).length }));
                jobDataCache.set(rangeCacheKey, {
                    timestamp: Date.now(),
                    data: results
                });
            }
        } catch (error: any) {
            logError("Error fetching jobs:", error);
            setDebugInfo(prev => ({ ...prev, lastError: String(error) }));
            showNotification("Error cargando datos de trabajos", "error");
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
                setProgress(null);
            }
        }
    }, [startDate, endDate, enabled, showNotification]);

    useEffect(() => {
        fetchJobs();
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [fetchJobs]);

    const refetch = useCallback(() => {
        fetchJobs(true);
    }, [fetchJobs]);

    return { jobData, loading, progress, debugInfo, refetch };
};
