import { useMemo } from 'react';
import { JobControlEntry, ProcessedDataRow } from '../types';
import { parseErpDateTime, timeToDecimalHours } from '../utils/datetime';
import {
    ImproductiveScope,
    shouldIncludeImproductiveByScope
} from '../data/improductiveArticles';

export interface ProductivityMetrics {
    totalHours: number;
    productiveHours: number;
    unproductiveHours: number;
    incidenceHours: number;
    averageProductivity: number;
    totalHoursWorkedInJobs: number;
    topActions: { name: string; value: number }[];
    topEmployees: { name: string; value: number; total: number; pct: number }[];
}

const getJobArticleId = (job: any): string => {
    return (
        job?.IDArticulo ??
        job?.Articulo ??
        job?.IdArticulo ??
        job?.idArticulo ??
        job?.CodigoArticulo ??
        job?.CodArticulo ??
        ''
    );
};

const getJobArticleDesc = (job: any): string => {
    return (
        job?.DescArticulo ??
        job?.DescripcionArticulo ??
        job?.Descripcion ??
        job?.DescOperacion ??
        ''
    );
};

const getJobDurationHours = (job: JobControlEntry): number => {
    if (job.FechaInicio && job.HoraInicio && job.FechaFin && job.HoraFin) {
        const start = parseErpDateTime(job.FechaInicio, job.HoraInicio);
        const end = parseErpDateTime(job.FechaFin, job.HoraFin);
        const hoursByRange = timeToDecimalHours(start, end);
        if (Number.isFinite(hoursByRange) && hoursByRange > 0) {
            return hoursByRange;
        }
    }

    const rawDuration = (job as unknown as { Duracion?: number | string | null }).Duracion;
    const normalizedDuration = typeof rawDuration === 'string'
        ? Number(rawDuration.replace(',', '.'))
        : Number(rawDuration);

    if (Number.isFinite(normalizedDuration) && normalizedDuration > 0) {
        return normalizedDuration;
    }

    return 0;
};

export const calculateProductivityMetrics = (
    jobData: Record<string, JobControlEntry[]> | null,
    datasetResumen: ProcessedDataRow[] | null,
    validEmpIds: Set<string> | null = null,
    improductiveScope: ImproductiveScope = 'all'
): ProductivityMetrics => {
    if (!jobData || !datasetResumen) return {
        totalHours: 0,
        productiveHours: 0,
        unproductiveHours: 0,
        incidenceHours: 0,
        averageProductivity: 0,
        totalHoursWorkedInJobs: 0,
        topActions: [],
        topEmployees: []
    };

    let totalHours = 0;
    let productiveHours = 0;
    let unproductiveHours = 0;
    let incidenceHours = 0;
    let totalPresenceHours = 0;

    const actionMap = new Map<string, number>();
    const empMap = new Map<string, { name: string, unprod: number, total: number }>();

    // 1. Process Jobs
    Object.values(jobData).flat().forEach(job => {
        const empId = String(job.IDOperario || 'Unknown');
        if (validEmpIds && !validEmpIds.has(empId)) return;

        const duration = getJobDurationHours(job);

        const articleId = getJobArticleId(job);
        const articleDesc = getJobArticleDesc(job);
        const isImproductive = shouldIncludeImproductiveByScope(articleId, articleDesc, improductiveScope);

        if (isImproductive) {
            unproductiveHours += duration;
            const desc = articleDesc || articleId || 'Sin Descripcion';
            actionMap.set(desc, (actionMap.get(desc) || 0) + duration);
        }

        const empName = job.DescOperario || 'Desconocido';
        const current = empMap.get(empId) || { name: empName, unprod: 0, total: 0 };
        current.total += duration;
        if (isImproductive) current.unprod += duration;
        empMap.set(empId, current);
    });

    // 2. Process Incidences (TAJ)
    datasetResumen.forEach(row => {
        const empId = String(row.operario);
        if (validEmpIds && !validEmpIds.has(empId)) return;

        const rowPresence = (row.horasTotalesConJustificacion || 0) + (row.horasExceso || 0);
        totalPresenceHours += rowPresence;

        if (row.hTAJ > 0) {
            incidenceHours += row.hTAJ;
            const key = "TIEMPO DE TORNO (TAJ)";
            actionMap.set(key, (actionMap.get(key) || 0) + row.hTAJ);

            const current = empMap.get(empId) || { name: row.nombre, unprod: 0, total: 0 };
            current.total += row.hTAJ;
            current.unprod += row.hTAJ;
            empMap.set(empId, current);
        }
    });

    const totalTrackedHours = Array.from(empMap.values()).reduce((sum, e) => sum + e.total, 0);
    totalHours = totalTrackedHours > 0 ? totalTrackedHours : totalPresenceHours;
    productiveHours = Math.max(0, totalHours - unproductiveHours - incidenceHours);

    const topActions = Array.from(actionMap.entries())
        .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

    const topEmployees = Array.from(empMap.values())
        .map(e => ({
            name: e.name,
            value: Number(e.unprod.toFixed(2)),
            total: Number(e.total.toFixed(2)),
            pct: e.total > 0 ? (e.unprod / e.total) * 100 : 0
        }))
        .filter(e => e.total > 0 || e.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

    return {
        totalHours,
        productiveHours,
        unproductiveHours,
        incidenceHours,
        averageProductivity: totalPresenceHours > 0 ? (productiveHours / totalPresenceHours) * 100 : 0,
        totalHoursWorkedInJobs: totalHours,
        topActions,
        topEmployees
    };
};

export const useProductivityMetrics = (
    jobData: Record<string, JobControlEntry[]> | null,
    datasetResumen: ProcessedDataRow[] | null,
    validEmpIds: Set<string> | null = null,
    improductiveScope: ImproductiveScope = 'all'
) => {
    return useMemo(() =>
        calculateProductivityMetrics(jobData, datasetResumen, validEmpIds, improductiveScope),
        [jobData, datasetResumen, validEmpIds, improductiveScope]);
};
