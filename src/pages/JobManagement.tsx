
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getControlOfPorOperario } from '../services/erpApi';
import { JobControlEntry, RawDataRow, ProcessedDataRow } from '../types';
import { CalendarioDia } from '../services/erpApi';
import { format, differenceInMinutes } from 'date-fns';
import { useNotification } from '../components/shared/NotificationContext';
import { ChevronDown, ChevronUp, RefreshCw, AlertTriangle, Smartphone, Layers, Search, FileText, CheckCircle2, Clock, Target, Activity } from 'lucide-react';
import { exportWeeklyJobAuditToPDF } from '../services/jobAuditExportService';
import { getImproductiveArticle, isAssumedImproductiveArticle, isEmbalajeImproductiveArticle } from '../data/improductiveArticles';

import PriorityAnalysisModal from '../components/job/PriorityAnalysisModal';
import { parseExcelFile, parseHojaFinalFile, exportWorkbookToFile } from '../services/excelPriorityService';
import { applyMacrosToWorkbook, extractHojaFinalFromWorkbook } from '../services/excelMacroService';
import { analyzeEmployeeWorks, calculateGlobalStats } from '../services/priorityAnalysisService';
import PriorityDashboard from './PriorityDashboard';
import { normalizeDateKey, extractTimeHHMM, extractTimeHHMMSS, parseErpDateTime } from '../utils/datetime';
import { parseLocalDateTime } from '../utils/localDate';
import { useImproductiveReport } from '../hooks/useImproductiveReport';
import { generateImproductivosExcel } from '../services/excelGenerator';
import SmartDateInput from '../components/shared/SmartDateInput';
import { logError, logWarning } from '../utils/logger';



const normalizeDateStr = (raw?: string | null): string => normalizeDateKey(raw || '');

const normalizeTimeStr = (raw?: string | null): string => extractTimeHHMM(raw || '');

const isEntrada = (entrada: boolean | number): boolean => entrada === true || entrada === 1;

const isIncidentRow = (row: RawDataRow): boolean => {
    return row.MotivoAusencia !== null && row.MotivoAusencia !== 0 && row.MotivoAusencia !== 1 && row.MotivoAusencia !== 14;
};

const toMinutes = (hhmm: string): number => {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

const formatShortDate = (dateStr: string): string => {
    try {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}`;
    } catch (error) {
        logWarning('No se pudo formatear fecha corta', {
            source: 'JobManagement.formatShortDate',
            dateStr,
            reason: error
        });
        return dateStr;
    }
};

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

const normalizeShiftCode = (value: unknown): 'M' | 'TN' | null => {
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;

    if (normalized === 'M' || normalized === 'MANANA' || normalized === 'MAÑANA') {
        return 'M';
    }

    if (
        normalized === 'TN' ||
        normalized === 'T' ||
        normalized === 'TARDE' ||
        normalized === 'TARDE/NOCHE' ||
        normalized === 'TARDE NOCHE' ||
        normalized === 'NOCHE'
    ) {
        return 'TN';
    }

    return null;
};

const resolveEmployeeShiftCode = (presenceRow?: ProcessedDataRow): 'M' | 'TN' => {
    const normalized = normalizeShiftCode(presenceRow?.turnoAsignado);
    return normalized || 'M';
};

const resolveJobShiftCode = (
    job: JobControlEntry,
    fallbackShift: 'M' | 'TN',
    shiftFromFichajes?: 'M' | 'TN'
): 'M' | 'TN' => {
    if (shiftFromFichajes) {
        return shiftFromFichajes;
    }

    const directShift =
        normalizeShiftCode(job['IDTipoTurno']) ||
        normalizeShiftCode(job['TurnoTexto']) ||
        normalizeShiftCode(job['DescTurno']);

    if (directShift) {
        return directShift;
    }

    return fallbackShift;
};

const shiftBadgeClass = (shift: 'M' | 'TN'): string => {
    return shift === 'TN'
        ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
        : 'bg-amber-100 text-amber-700 border-amber-200';
};

const csvEscape = (value: unknown): string => {
    let str = String(value ?? '');
    const trimmed = str.trimStart();
    // Mitiga CSV Injection en Excel/Sheets
    if (['=', '+', '-', '@'].includes(trimmed.charAt(0))) {
        str = `'${str}`;
    }
    if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
};

interface JobManagementProps {
    startDate: string;
    setStartDate: (v: string) => void;
    endDate: string;
    setEndDate: (v: string) => void;
    startTime?: string;
    endTime?: string;
    erpData: RawDataRow[];
    datasetResumen: ProcessedDataRow[];
    isReloading: boolean;
    departmentFilteredEmployees: any[];
    selectedDepartment: string;
    setSelectedDepartment: (v: string) => void;
    computedDepartments: string[];
    employeeCalendarsByDate: Map<number, Map<string, CalendarioDia>> | null;
    lastUpdated: number;
    reloadFromServer: () => void | Promise<void>;
}

export const JobManagement: React.FC<JobManagementProps> = ({
    startDate, setStartDate,
    endDate, setEndDate,
    startTime, endTime,
    erpData, datasetResumen, isReloading,
    departmentFilteredEmployees, selectedDepartment, setSelectedDepartment, computedDepartments,
    employeeCalendarsByDate, lastUpdated, reloadFromServer
}) => {
    // PERSISTENCE KEYS
    const STORAGE_KEY = 'jobAuditState';

    // 1. Initialize State from Storage if available
    const getStoredState = () => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            logError("Error reading jobAuditState", e);
            return null;
        }
    };

    const storedState = getStoredState();

    const [showDebug, setShowDebug] = useState(false);
    const [searchFilter, setSearchFilter] = useState<string>('');
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<number>>(new Set());
    const [showOnlyAnomalous, setShowOnlyAnomalous] = useState(false);
    const [sortKey, setSortKey] = useState<'gap' | 'worked' | 'empId' | 'name' | 'shift'>('gap');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [shiftFilter, setShiftFilter] = useState<'all' | 'M' | 'TN'>('all');


    // Estados para Análisis de Prioridades
    const [showPriorityModal, setShowPriorityModal] = useState(false);
    const [showPriorityDashboard, setShowPriorityDashboard] = useState(false);
    const [priorityAnalysisData, setPriorityAnalysisData] = useState<{
        globalStats: any;
        employeeData: any[];
        dateRange: { startDate: string; endDate: string };
    } | null>(null);

    const { showNotification } = useNotification();
    const [jobData, setJobData] = useState<Record<string, JobControlEntry[]>>({});
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [jobProgress, setJobProgress] = useState<{ processed: number; total: number } | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    // New Hook for Excel Report
    const { generateReportData, loading: loadingExcel, progress: excelProgress } = useImproductiveReport();

    // 2. Restore selectedDepartment on mount if exists in storage
    useEffect(() => {
        if (storedState?.selectedDepartment && storedState.selectedDepartment !== 'all') {
            setSelectedDepartment(storedState.selectedDepartment);
        }
    }, []); // Run once on mount

    const rangeDays = useMemo(() => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
        const diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(0, diff) + 1;
    }, [startDate, endDate]);

    const rangeStartDateTime = useMemo(() => {
        const timeStr = extractTimeHHMMSS(startTime || '00:00:00') || '00:00:00';
        return parseLocalDateTime(startDate, timeStr);
    }, [startDate, startTime]);

    const rangeEndDateTime = useMemo(() => {
        const timeStr = extractTimeHHMMSS(endTime || '23:59:59') || '23:59:59';
        const end = parseLocalDateTime(endDate, timeStr);
        end.setMilliseconds(999);
        return end;
    }, [endDate, endTime]);

    const clipIntervalToRange = (start: Date, end: Date) => {
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
        const clippedStart = start < rangeStartDateTime ? rangeStartDateTime : start;
        const clippedEnd = end > rangeEndDateTime ? rangeEndDateTime : end;
        if (clippedEnd <= clippedStart) return null;
        return { start: clippedStart, end: clippedEnd };
    };

    // 3. Persist State Changes (Preferences only)
    useEffect(() => {
        const stateToSave = {
            selectedDepartment
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    }, [selectedDepartment]);
    const abortControllerRef = useRef<AbortController | null>(null);

    const productiveEmployees = useMemo(() => {
        // Mostrar todos para ver los no productivos
        return departmentFilteredEmployees;
    }, [departmentFilteredEmployees]);

    const productiveEmployeeIdsKey = useMemo(
        () => productiveEmployees.map(e => String(e.id)).sort().join(','),
        [productiveEmployees]
    );

    const vacationDaysByEmployee = useMemo(() => {
        const map = new Map<number, number>();
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (employeeCalendarsByDate && employeeCalendarsByDate.size > 0) {
            employeeCalendarsByDate.forEach((dateMap, empId) => {
                let count = 0;
                const iter = new Date(start);
                while (iter <= end) {
                    const dStr = format(iter, 'yyyy-MM-dd');
                    const tipoDia = dateMap.get(dStr)?.TipoDia;
                    // TipoDia is number, so check for 2 only
                    if (String(tipoDia) === '2') count += 1;
                    iter.setDate(iter.getDate() + 1);
                }
                if (count > 0) map.set(empId, count);
            });
            return map;
        }

        const byEmployee = new Map<number, Set<string>>();
        erpData.forEach(row => {
            const date = normalizeDateStr(row.Fecha);
            if (!date || date < startDate || date > endDate) return;
            if (Number(row.TipoDiaEmpresa) !== 2) return;
            const empId = row.IDOperario;
            if (!byEmployee.has(empId)) byEmployee.set(empId, new Set());
            byEmployee.get(empId)!.add(date);
        });
        byEmployee.forEach((dates, empId) => {
            if (dates.size > 0) map.set(empId, dates.size);
        });
        return map;
    }, [employeeCalendarsByDate, erpData, startDate, endDate]);

    const recordedIncidentsByEmployee = useMemo(() => {
        const map = new Map<number, {
            date: string;
            start: string;
            end: string;
            durationHours: number;
            durationHoursInt: number;
            motivoId: number;
            motivoDesc?: string;
            endsNextDay: boolean;
        }[]>();

        const rowsByEmployee = new Map<number, RawDataRow[]>();
        erpData.forEach(row => {
            const date = normalizeDateStr(row.Fecha);
            if (!date || date < startDate || date > endDate) return;
            const empId = row.IDOperario;
            if (!rowsByEmployee.has(empId)) rowsByEmployee.set(empId, []);
            rowsByEmployee.get(empId)!.push(row);
        });

        rowsByEmployee.forEach((rows, empId) => {
            const sorted = [...rows].sort((a, b) => {
                const aDate = normalizeDateStr(a.Fecha);
                const bDate = normalizeDateStr(b.Fecha);
                if (aDate !== bDate) return aDate.localeCompare(bDate);
                return normalizeTimeStr(a.Hora).localeCompare(normalizeTimeStr(b.Hora));
            });

            const incidents: {
                date: string;
                start: string;
                end: string;
                durationHours: number;
                durationHoursInt: number;
                motivoId: number;
                motivoDesc?: string;
                endsNextDay: boolean;
            }[] = [];

            sorted.forEach((row, idx) => {
                if (!isIncidentRow(row)) return;
                const date = normalizeDateStr(row.Fecha);
                const inicio = normalizeTimeStr(row.Inicio || '');
                const fin = normalizeTimeStr(row.Fin || '');

                let start = inicio;
                let end = fin;

                if (!start || !end) {
                    const endCandidate = normalizeTimeStr(row.Hora || '');
                    if (!end) end = endCandidate;

                    if (!start) {
                        let startCandidate = '';
                        for (let k = idx - 1; k >= 0; k--) {
                            if (normalizeDateStr(sorted[k].Fecha) !== date) break;
                            if (isEntrada(sorted[k].Entrada)) {
                                startCandidate = normalizeTimeStr(sorted[k].Hora || '');
                                break;
                            }
                        }
                        start = startCandidate || end;
                    }
                }

                if (!start || !end) return;

                const startMin = toMinutes(start);
                let endMin = toMinutes(end);
                let endsNextDay = false;
                if (endMin < startMin) {
                    endMin += 1440;
                    endsNextDay = true;
                }
                const durationHours = Math.max(0, (endMin - startMin) / 60);
                const durationHoursInt = durationHours > 0 ? Math.max(1, Math.round(durationHours)) : 0;

                incidents.push({
                    date,
                    start,
                    end,
                    durationHours,
                    durationHoursInt,
                    motivoId: Number(row.MotivoAusencia),
                    motivoDesc: row.DescMotivoAusencia || undefined,
                    endsNextDay
                });
            });

            if (incidents.length > 0) map.set(empId, incidents);
        });

        return map;
    }, [erpData, startDate, endDate]);

    const shiftFromFichajes = useMemo(() => {
        const perEmployeeTotals = new Map<number, { M: number; TN: number }>();
        const perEmployeeDateCounts = new Map<number, Map<string, { M: number; TN: number }>>();

        erpData.forEach(row => {
            const employeeId = Number(row.IDOperario);
            if (!Number.isFinite(employeeId)) return;

            const shift = normalizeShiftCode(row.IDTipoTurno);
            if (!shift) return;

            const dateKey = normalizeDateStr(row.Fecha);

            const totals = perEmployeeTotals.get(employeeId) || { M: 0, TN: 0 };
            totals[shift] += 1;
            perEmployeeTotals.set(employeeId, totals);

            if (!dateKey) return;

            const dateMap = perEmployeeDateCounts.get(employeeId) || new Map<string, { M: number; TN: number }>();
            const dateCounts = dateMap.get(dateKey) || { M: 0, TN: 0 };
            dateCounts[shift] += 1;
            dateMap.set(dateKey, dateCounts);
            perEmployeeDateCounts.set(employeeId, dateMap);
        });

        const byEmployee = new Map<number, 'M' | 'TN'>();
        perEmployeeTotals.forEach((counts, employeeId) => {
            byEmployee.set(employeeId, counts.TN > counts.M ? 'TN' : 'M');
        });

        const byEmployeeDate = new Map<number, Map<string, 'M' | 'TN'>>();
        perEmployeeDateCounts.forEach((dateMap, employeeId) => {
            const resolvedDateMap = new Map<string, 'M' | 'TN'>();
            dateMap.forEach((counts, dateKey) => {
                resolvedDateMap.set(dateKey, counts.TN > counts.M ? 'TN' : 'M');
            });
            byEmployeeDate.set(employeeId, resolvedDateMap);
        });

        return { byEmployee, byEmployeeDate };
    }, [erpData]);

    // BATCH FETCHING STRATEGY
    const fetchJobsForVisibleEmployees = async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setLoadingJobs(true);
        const newJobData: Record<string, JobControlEntry[]> = {};
        const targetEmployees = productiveEmployees;

        if (targetEmployees.length === 0) {
            setLoadingJobs(false);
            return;
        }

        // Concurrency Limiter (Batch size 5)
        const batchSize = 5;
        const employeeIds = targetEmployees.map(e => e.id.toString());
        const timeoutMs = rangeDays > 7 ? 60000 : 10000;

        setJobProgress({ processed: 0, total: employeeIds.length });

        try {
            for (let i = 0; i < employeeIds.length; i += batchSize) {
                const batch = employeeIds.slice(i, i + batchSize);
                const promises = batch.map(async (id) => {
                    try {
                        const jobs = await getControlOfPorOperario(id, startDate, endDate, timeoutMs, abortControllerRef.current?.signal);
                        if (abortControllerRef.current?.signal.aborted) return;
                        newJobData[id] = jobs;
                    } catch (e) {
                        if ((e as Error).name !== 'AbortError') {
                            logError(`Error fetching jobs for ${id}`, e);
                        }
                    }
                });
                await Promise.all(promises);

                setJobProgress({
                    processed: Math.min(i + batch.length, employeeIds.length),
                    total: employeeIds.length
                });
            }
            // Single state update after all batches complete — avoids recalculating comparisonRows per batch
            if (!abortControllerRef.current?.signal.aborted) {
                setJobData({ ...newJobData });
            }
            showNotification(`Análisis de trabajos completado.`, 'success');
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                logError("Error global fetching jobs", error);
                showNotification("Error obteniendo datos del ERP.", 'error');
            }
        } finally {
            setLoadingJobs(false);
            setJobProgress(null);
        }
    };

    // Auto-load jobs when dates or global data refresh happens
    useEffect(() => {
        if (!isReloading && startDate && endDate) {
            setJobData({});
            fetchJobsForVisibleEmployees();
        }
    }, [startDate, endDate, lastUpdated, selectedDepartment, productiveEmployeeIdsKey]);

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const handleSearch = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            showNotification('Rango de fechas inválido.', 'error');
            return;
        }
        setJobData({});
        // We only fetch jobs because presence is managed globally by HrLayout
        await fetchJobsForVisibleEmployees();
    };

    const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

    // LOGIC: TIME COVERED (UNION) calculation + UNCOVERED GAPS
    type UncoveredGap = {
        date: string;       // yyyy-MM-dd
        startTime: string;  // HH:mm
        endTime: string;    // HH:mm
        startDate: Date;
        endDate: Date;
        durationMinutes: number;
    };

    type CoverageResult = {
        coveredHours: number;
        gaps: UncoveredGap[];
    };

    const calculateTimeCoveredWithGaps = (jobs: JobControlEntry[], shiftCode: 'M' | 'TN'): CoverageResult => {
        const emptyResult: CoverageResult = { coveredHours: 0, gaps: [] };
        if (jobs.length === 0) return emptyResult;

        // 1. Convert to intervals
        const intervals = jobs.map(j => {
            const start = parseErpDateTime(j.FechaInicio, j.HoraInicio);
            const end = parseErpDateTime(j.FechaFin, j.HoraFin);
            return clipIntervalToRange(start, end);
        }).filter(i => i !== null) as { start: Date, end: Date }[];

        if (intervals.length === 0) return emptyResult;

        // 2. Sort by start time
        intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

        // 3. Merge intervals logic
        let coveredMinutes = 0;
        const mergedIntervals: { start: Date, end: Date }[] = [];
        let currentInterval = { start: new Date(intervals[0].start.getTime()), end: new Date(intervals[0].end.getTime()) };

        for (let i = 1; i < intervals.length; i++) {
            const nextInterval = intervals[i];

            if (nextInterval.start <= currentInterval.end) {
                if (nextInterval.end > currentInterval.end) {
                    currentInterval.end = new Date(nextInterval.end.getTime());
                }
            } else {
                coveredMinutes += differenceInMinutes(currentInterval.end, currentInterval.start);
                mergedIntervals.push({ ...currentInterval });
                currentInterval = { start: new Date(nextInterval.start.getTime()), end: new Date(nextInterval.end.getTime()) };
            }
        }
        coveredMinutes += differenceInMinutes(currentInterval.end, currentInterval.start);
        mergedIntervals.push({ ...currentInterval });

        // 4. Calculate uncovered gaps per day comparing against shift schedule
        const shiftStartHour = shiftCode === 'M' ? 7 : 15;
        const shiftEndHour = shiftCode === 'M' ? 15 : 23;

        // Collect all unique dates from merged intervals
        const datesSet = new Set<string>();
        mergedIntervals.forEach(iv => {
            const d = new Date(iv.start);
            while (d <= iv.end) {
                datesSet.add(format(d, 'yyyy-MM-dd'));
                d.setDate(d.getDate() + 1);
            }
        });
        // Also include dates from range
        const rangeIterDate = new Date(rangeStartDateTime);
        while (rangeIterDate <= rangeEndDateTime) {
            datesSet.add(format(rangeIterDate, 'yyyy-MM-dd'));
            rangeIterDate.setDate(rangeIterDate.getDate() + 1);
        }

        const gaps: UncoveredGap[] = [];

        datesSet.forEach(dateStr => {
            const [y, m, d] = dateStr.split('-').map(Number);
            const shiftStart = new Date(y, m - 1, d, shiftStartHour, 0, 0);
            const shiftEnd = new Date(y, m - 1, d, shiftEndHour, 0, 0);

            // Get merged intervals that fall within this day's shift
            const dayIntervals = mergedIntervals
                .map(iv => {
                    const clippedStart = iv.start < shiftStart ? shiftStart : iv.start;
                    const clippedEnd = iv.end > shiftEnd ? shiftEnd : iv.end;
                    if (clippedEnd > clippedStart) return { start: clippedStart, end: clippedEnd };
                    return null;
                })
                .filter(Boolean) as { start: Date, end: Date }[];

            // Sort day intervals by start
            dayIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

            // Find gaps within the shift
            let cursor = shiftStart;
            dayIntervals.forEach(iv => {
                if (iv.start > cursor) {
                    const gapDurationMin = differenceInMinutes(iv.start, cursor);
                    if (gapDurationMin >= 5) { // Only show gaps >= 5 minutes
                        gaps.push({
                            date: dateStr,
                            startTime: format(cursor, 'HH:mm'),
                            endTime: format(iv.start, 'HH:mm'),
                            startDate: new Date(cursor.getTime()),
                            endDate: new Date(iv.start.getTime()),
                            durationMinutes: gapDurationMin
                        });
                    }
                }
                if (iv.end > cursor) {
                    cursor = iv.end;
                }
            });
            // Check gap after last interval until shift end
            if (cursor < shiftEnd) {
                const gapDurationMin = differenceInMinutes(shiftEnd, cursor);
                if (gapDurationMin >= 5) {
                    gaps.push({
                        date: dateStr,
                        startTime: format(cursor, 'HH:mm'),
                        endTime: format(shiftEnd, 'HH:mm'),
                        startDate: new Date(cursor.getTime()),
                        endDate: new Date(shiftEnd.getTime()),
                        durationMinutes: gapDurationMin
                    });
                }
            }
        });

        // Sort gaps chronologically
        gaps.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

        return { coveredHours: coveredMinutes / 60, gaps };
    };

    // Backward-compatible wrapper
    const calculateTimeCovered = (jobs: JobControlEntry[]) => {
        return calculateTimeCoveredWithGaps(jobs, 'M').coveredHours;
    };

    const comparisonRows = useMemo(() => {
        return productiveEmployees.map(emp => {
            const presenceRow = datasetResumen.find(r => r.operario === emp.id);
            const employeeShift = shiftFromFichajes.byEmployee.get(emp.id) || resolveEmployeeShiftCode(presenceRow);

            const vacationDays = vacationDaysByEmployee.get(emp.id) || 0;
            const sickLeaveHours = presenceRow ? (presenceRow.hITAT || 0) + (presenceRow.hITEC || 0) : 0;
            const sickLeaveType = presenceRow?.hITAT ? 'ITAT' : (presenceRow?.hITEC ? 'ITEC' : '');
            const recordedIncidents = recordedIncidentsByEmployee.get(emp.id) || [];

            // Calcular Presencia Total (Tiempo en planta + Justificado)
            // Usamos horasTotalesConJustificacion (TOTAL) + horasExceso.
            // horasTotalesConJustificacion ya incluye presencia + justificadas + TAJ,
            // y NO debemos sumar festivas de nuevo para evitar doble conteo.
            const totalPresence = presenceRow ?
                (presenceRow.horasTotalesConJustificacion || 0) +
                (presenceRow.horasExceso || 0) : 0;

            const jobs = jobData[emp.id] || [];

            // 1. Suma de Tiempos (Coste / Producción)
            let totalJobTimeMinutes = 0;
            let improductiveTimeMinutes = 0;
            let hasAnomalousOverlap = false;

            const jobIntervalsByConflictKey: Record<string, { start: number, end: number, jobRef: JobControlEntry }[]> = {};
            const anomalyConflicts: {
                key: string;
                overlapMinutes: number;
                currentStart: string;
                currentEnd: string;
                previousStart: string;
                previousEnd: string;
                currentOrder: string;
                previousOrder: string;
                currentArticle: string;
                previousArticle: string;
            }[] = [];

            jobs.forEach(job => {
                const s = parseErpDateTime(job.FechaInicio, job.HoraInicio);
                const e = parseErpDateTime(job.FechaFin, job.HoraFin);
                const clipped = clipIntervalToRange(s, e);
                if (!clipped) return;
                const d = differenceInMinutes(clipped.end, clipped.start);
                if (d > 0) {
                    totalJobTimeMinutes += d;
                    if (getImproductiveArticle(getJobArticleId(job), getJobArticleDesc(job))) {
                        improductiveTimeMinutes += d;
                    }

                    const orderId = job.NOrden || (job as any).IdOrdenFabricacion || (job as any).IDOrdenFabricacion || (job as any).IDOrden || '';
                    const articleId = getJobArticleId(job);
                    const conflictKeys = new Set<string>();
                    if (orderId) conflictKeys.add(`OF:${orderId}`);
                    if (articleId) conflictKeys.add(`ART:${articleId}`);

                    if (conflictKeys.size > 0) {
                        const startTs = clipped.start.getTime();
                        const endTs = clipped.end.getTime();

                        for (const key of conflictKeys) {
                            if (!jobIntervalsByConflictKey[key]) jobIntervalsByConflictKey[key] = [];

                            for (const interval of jobIntervalsByConflictKey[key]) {
                                const overlapStart = Math.max(startTs, interval.start);
                                const overlapEnd = Math.min(endTs, interval.end);
                                const overlapDurationMinutes = Math.round((overlapEnd - overlapStart) / 60000);

                                if (overlapStart < overlapEnd && overlapDurationMinutes >= 2) {
                                    hasAnomalousOverlap = true;
                                    anomalyConflicts.push({
                                        key,
                                        overlapMinutes: overlapDurationMinutes,
                                        currentStart: format(clipped.start, 'yyyy-MM-dd HH:mm:ss'),
                                        currentEnd: format(clipped.end, 'yyyy-MM-dd HH:mm:ss'),
                                        previousStart: format(new Date(interval.start), 'yyyy-MM-dd HH:mm:ss'),
                                        previousEnd: format(new Date(interval.end), 'yyyy-MM-dd HH:mm:ss'),
                                        currentOrder: String(orderId || ''),
                                        previousOrder: String(interval.jobRef.NOrden || interval.jobRef.IDOrden || ''),
                                        currentArticle: String(articleId || ''),
                                        previousArticle: String(getJobArticleId(interval.jobRef) || '')
                                    });
                                }
                            }

                            jobIntervalsByConflictKey[key].push({ start: startTs, end: endTs, jobRef: job });
                        }
                    }
                }
            });
            const totalJobTimeProduced = totalJobTimeMinutes / 60;
            const improductiveTimeProduced = improductiveTimeMinutes / 60;

            // 2. Tiempo Cubierto (Línea de tiempo real sin duplicar solapes) + Gaps
            const coverageResult = calculateTimeCoveredWithGaps(jobs, employeeShift);
            const totalTimeCovered = coverageResult.coveredHours;
            const uncoveredGaps = coverageResult.gaps;

            // Caso de anomalia (misma OF/ART con solape):
            // El usuario solicita que al haber multitask se muestre el tiempo total imputado (bruto) siempre
            const effectiveCoveredForUi = totalJobTimeProduced;

            // GAPS: Si la presencia es mayor que el tiempo cubierto por trabajos
            const timeGap = Math.max(0, totalPresence - effectiveCoveredForUi);

            // OVERLAP/MULTITASKING Coefficient
            const overlapRatio = totalTimeCovered > 0 ? totalJobTimeProduced / totalTimeCovered : 0;

            return {
                emp,
                shiftCode: employeeShift,
                presenceRow,
                totalPresence,
                jobs,
                totalJobTimeProduced,
                improductiveTimeProduced,
                totalTimeCovered,
                effectiveCoveredForUi,
                timeGap,
                overlapRatio,
                vacationDays,
                sickLeaveHours,
                sickLeaveType,
                recordedIncidents,
                hasAnomalousOverlap,
                anomalyConflicts,
                uncoveredGaps
            };
        });
    }, [productiveEmployees, datasetResumen, jobData, vacationDaysByEmployee, recordedIncidentsByEmployee, shiftFromFichajes]);

    // Filtrado adicional por búsqueda y selección de empleados
    const filteredRows = useMemo(() => {
        let filtered = comparisonRows;

        // Si hay empleados seleccionados, mostrar solo esos
        if (selectedEmployeeIds.size > 0) {
            filtered = filtered.filter(row => selectedEmployeeIds.has(row.emp.id));
        }

        // Búsqueda por nombre/ID
        if (searchFilter.trim()) {
            const search = searchFilter.toLowerCase();
            filtered = filtered.filter(row =>
                row.emp.name.toLowerCase().includes(search) ||
                row.emp.id.toString().includes(search)
            );
        }

        // Filtro por turno (desde IDTipoTurno en fichajes)
        if (shiftFilter !== 'all') {
            filtered = filtered.filter(row => row.shiftCode === shiftFilter);
        }

        return filtered;
    }, [comparisonRows, searchFilter, selectedEmployeeIds, shiftFilter]);

    const sortedRows = useMemo(() => {
        const rows = [...filteredRows];
        const dir = sortDir === 'asc' ? 1 : -1;

        rows.sort((a, b) => {
            if (sortKey === 'empId') {
                return (a.emp.id - b.emp.id) * dir;
            }
            if (sortKey === 'name') {
                return a.emp.name.localeCompare(b.emp.name) * dir;
            }
            if (sortKey === 'shift') {
                const shiftOrder: Record<'M' | 'TN', number> = { M: 0, TN: 1 };
                return (shiftOrder[a.shiftCode] - shiftOrder[b.shiftCode]) * dir;
            }
            if (sortKey === 'worked') {
                return (a.effectiveCoveredForUi - b.effectiveCoveredForUi) * dir;
            }
            return (a.timeGap - b.timeGap) * dir;
        });

        return rows;
    }, [filteredRows, sortKey, sortDir]);

    const displayedRows = useMemo(() => {
        if (!showOnlyAnomalous) return sortedRows;
        return sortedRows.filter(row => row.hasAnomalousOverlap);
    }, [sortedRows, showOnlyAnomalous]);

    const anomalousCount = useMemo(
        () => sortedRows.filter(row => row.hasAnomalousOverlap).length,
        [sortedRows]
    );

    const handleExportAnomaliesCsv = () => {
        const anomalousRows = sortedRows.filter(row => row.hasAnomalousOverlap);
        if (anomalousRows.length === 0) {
            showNotification('No hay anomalias para exportar.', 'warning');
            return;
        }

        const headers = [
            'ID_OPERARIO',
            'OPERARIO',
            'DEPARTAMENTO',
            'PRODUCTIVO_ERP',
            'CLAVE_CONFLICTO',
            'SOLAPE_MIN',
            'OF_ACTUAL',
            'OF_PREVIA',
            'ART_ACTUAL',
            'ART_PREVIO',
            'INICIO_ACTUAL',
            'FIN_ACTUAL',
            'INICIO_PREVIO',
            'FIN_PREVIO',
            'TOTAL_IMPUTADO_H',
            'TOTAL_CUBIERTO_REAL_H'
        ];

        const lines = [headers.join(';')];

        anomalousRows.forEach(row => {
            if (!row.anomalyConflicts.length) {
                lines.push([
                    row.emp.id,
                    csvEscape(row.emp.name),
                    csvEscape(row.emp.department),
                    row.emp.productivo === false ? 'false' : 'true',
                    'N/A',
                    '0',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    '',
                    row.totalJobTimeProduced.toFixed(2),
                    row.totalTimeCovered.toFixed(2)
                ].join(';'));
                return;
            }

            row.anomalyConflicts.forEach(conflict => {
                lines.push([
                    row.emp.id,
                    csvEscape(row.emp.name),
                    csvEscape(row.emp.department),
                    row.emp.productivo === false ? 'false' : 'true',
                    csvEscape(conflict.key),
                    conflict.overlapMinutes,
                    csvEscape(conflict.currentOrder),
                    csvEscape(conflict.previousOrder),
                    csvEscape(conflict.currentArticle),
                    csvEscape(conflict.previousArticle),
                    conflict.currentStart,
                    conflict.currentEnd,
                    conflict.previousStart,
                    conflict.previousEnd,
                    row.totalJobTimeProduced.toFixed(2),
                    row.totalTimeCovered.toFixed(2)
                ].join(';'));
            });
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `anomalias_misma_of_art_${startDate}_${endDate}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 0);

        showNotification(`CSV de anomalias exportado (${anomalousRows.length} empleados).`, 'success');
    };

    // Estadísticas Globales para el Panel Superior
    const globalStats = useMemo(() => {
        const totalPresence = comparisonRows.reduce((acc, row) => acc + row.totalPresence, 0);
        const totalCovered = comparisonRows.reduce((acc, row) => acc + row.effectiveCoveredForUi, 0);
        const totalImputed = comparisonRows.reduce((acc, row) => acc + row.totalJobTimeProduced, 0);
        const totalImproductiveProduced = comparisonRows.reduce((acc, row) => acc + row.improductiveTimeProduced, 0);

        // La ocupación (efficiency) ahora se puede ver visualmente relacionada al tiempo imputado vs presencia
        // pero para porcentaje mantenemos el tiempo real cubierto para que no pase de 100% lógicamente en el donut
        const occupancyRaw = totalPresence > 0 ? (totalCovered / totalPresence) * 100 : 0;
        const occupancy = clampPercent(occupancyRaw);
        const totalGap = Math.max(0, totalPresence - totalCovered);

        return {
            totalPresence,
            totalCovered,
            totalImputed,
            totalImproductiveProduced,
            occupancy,
            totalGap
        };
    }, [comparisonRows]);


    const toggleExpand = React.useCallback((id: number) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);

    // Handler para exportar reporte a PDF
    const handleExportPDF = async (onlyAnomalous: boolean = false) => {
        try {
            const rowsToExport = onlyAnomalous
                ? sortedRows.filter(row => row.hasAnomalousOverlap)
                : sortedRows;

            if (rowsToExport.length === 0) {
                showNotification(
                    onlyAnomalous
                        ? 'No hay empleados anómalos para exportar.'
                        : 'No hay datos para exportar.',
                    'warning'
                );
                return;
            }

            showNotification(
                onlyAnomalous ? 'Generando PDF de anomalias...' : 'Generando reporte PDF...',
                'info'
            );

            const employeeData = rowsToExport.map(row => ({
                operario: row.emp.id,
                nombre: row.emp.name,
                departamento: row.emp.department,
                totalPresence: row.totalPresence,
                totalCovered: row.totalTimeCovered,
                totalJobTimeProduced: row.totalJobTimeProduced,
                overlapRatio: row.overlapRatio,
                timeGap: row.timeGap,
                occupancy: row.totalPresence > 0 ? (row.effectiveCoveredForUi / row.totalPresence) * 100 : 0
            }));

            const totalPresenceExport = rowsToExport.reduce((acc, row) => acc + row.totalPresence, 0);
            const totalCoveredExport = rowsToExport.reduce((acc, row) => acc + row.effectiveCoveredForUi, 0);
            const totalImputedExport = rowsToExport.reduce((acc, row) => acc + row.totalJobTimeProduced, 0);
            const totalImproductiveExport = rowsToExport.reduce((acc, row) => acc + row.improductiveTimeProduced, 0);
            const totalGapExport = Math.max(0, totalPresenceExport - totalCoveredExport);
            const occupancyExport = totalPresenceExport > 0 ? (totalCoveredExport / totalPresenceExport) * 100 : 0;
            const avgEfficiency = rowsToExport.length > 0 ? totalCoveredExport / rowsToExport.length : 0;

            await exportWeeklyJobAuditToPDF(
                {
                    totalPresence: totalPresenceExport,
                    totalCovered: totalCoveredExport,
                    totalImputed: totalImputedExport,
                    totalImproductiveProduced: totalImproductiveExport,
                    totalGap: totalGapExport,
                    occupancy: clampPercent(occupancyExport),
                    avgEfficiency,
                    employeeCount: rowsToExport.length
                },
                employeeData,
                {
                    startDate,
                    endDate,
                    department: selectedDepartment,
                    includeEmployeeDetails: true,
                    watermark: onlyAnomalous ? 'SOLO ANOMALIAS' : undefined
                }
            );

            showNotification('✅ Reporte PDF generado correctamente', 'success');
        } catch (error) {
            logError('Error exportando PDF:', error);
            showNotification('❌ Error al generar el ranking', 'error');
        }
    };


    const handleExportImproductivosExcel = async () => {
        try {
            // 1. Fetch and processed data using the hook
            // Updated to match new return type { data, allArticleIds }
            const result = await generateReportData(
                startDate,
                endDate,
                extractTimeHHMMSS(startTime || '00:00:00') || '00:00:00',
                extractTimeHHMMSS(endTime || '23:59:59') || '23:59:59'
            );

            // 2. Generate Excel
            if (result && result.data && result.data.length > 0) {
                await generateImproductivosExcel(result.data, result.allArticleIds, { start: startDate, end: endDate });
                showNotification('✅ Excel de Improductivos generado correctamente', 'success');
            } else {
                showNotification('⚠️ No hay datos para generar el reporte', 'warning');
            }
        } catch (error) {
            logError('Error exporting Excel:', error);
            // Error notification is already handled by the hook/service but duplication here is safe
        }
    };


    const runPriorityAnalysisInternal = async (
        analysisStartDate: string,
        analysisEndDate: string,
        priorityArticles: any[]
    ) => {
        // 1. Usar trabajos ya cargados
        const allJobs: Record<string, JobControlEntry[]> = {};
        for (const empId of Object.keys(jobData)) {
            if (jobData[empId] && jobData[empId].length > 0) {
                allJobs[empId] = jobData[empId];
            }
        }

        if (Object.keys(allJobs).length === 0) {
            showNotification('No hay datos de trabajos para analizar. Cargue primero los datos de trabajos.', 'error');
            return;
        }

        console.log(`✅ Trabajos cargados: ${Object.keys(allJobs).length} empleados`);

        // 2. Analizar trabajos vs prioridades
        const analysisDate = new Date(analysisEndDate);
        const employeeDepartments: Record<string, string> = {};
        departmentFilteredEmployees.forEach(emp => {
            employeeDepartments[String(emp.id)] = emp.department || 'Sin sección';
        });

        const employeeAnalysis = analyzeEmployeeWorks(
            allJobs,
            priorityArticles,
            analysisDate,
            employeeDepartments
        );
        const globalStats = calculateGlobalStats(employeeAnalysis);

        console.log(`✅ Análisis completado: ${employeeAnalysis.length} empleados con datos`);

        // 🔍 DIAGNÓSTICO: Si el resultado está vacío, mostrar info de debugging
        if (employeeAnalysis.length === 0 || globalStats.totalArticulos === 0) {
            const primerArticuloExcel = priorityArticles[0]?.articulo || 'N/A';
            const primerEmpleadoId = Object.keys(allJobs)[0];
            const primerTrabajo = allJobs[primerEmpleadoId]?.[0];
            const primerArticuloERP = primerTrabajo?.IDArticulo || 'N/A';
            const totalTrabajosERP = Object.values(allJobs).reduce((sum, jobs) => sum + jobs.length, 0);

            logError('❌ DIAGNÓSTICO: No se encontraron coincidencias');
            showNotification(
                `⚠️ DIAGNÓSTICO: No se encontraron coincidencias.\n\n` +
                `Excel: ${priorityArticles.length} artículos (ej: "${primerArticuloExcel}")\n` +
                `ERP: ${totalTrabajosERP} trabajos (ej: "${primerArticuloERP}")\n\n` +
                `Los códigos no coinciden. Revisa la consola (F12) para más detalles.`,
                'error'
            );
        }

        // 3. Guardar resultados y mostrar dashboard
        setPriorityAnalysisData({
            globalStats,
            employeeData: employeeAnalysis,
            dateRange: {
                startDate: analysisStartDate,
                endDate: analysisEndDate
            }
        });

        setShowPriorityModal(false);
        setShowPriorityDashboard(true);

        if (employeeAnalysis.length > 0) {
            showNotification(
                `Análisis completado: ${globalStats.totalArticulos} artículos analizados`,
                'success'
            );
        }
    };

    const handleExecutePriorityAnalysis = async (
        analysisStartDate: string,
        analysisEndDate: string,
        excelFile: File
    ) => {
        try {
            showNotification('Procesando archivo Excel ("BASE DATOS")...', 'info');
            const priorityArticles = await parseExcelFile(excelFile);
            await runPriorityAnalysisInternal(analysisStartDate, analysisEndDate, priorityArticles);
        } catch (error) {
            logError('❌ Error en análisis estándar:', error);
            showNotification(`Error: ${(error as Error).message}`, 'error');
        }
    };

    const handleExecuteWithMacros = async (
        analysisStartDate: string,
        analysisEndDate: string,
        excelFile: File
    ) => {
        try {
            showNotification('Ejecutando macros en el servidor local...', 'info');

            // 1. Aplicar macros al archivo original
            const workbook = await applyMacrosToWorkbook(excelFile);

            // 2. Extraer los artículos de la "HOJA FINAL" generada
            const priorityArticles = extractHojaFinalFromWorkbook(workbook);

            showNotification(`Macros ejecutadas. Se generaron ${priorityArticles.length} artículos en HOJA FINAL.`, 'success');

            // 3. Exportar el excel para el usuario (como "despues macros.xlsx")
            await exportWorkbookToFile(workbook, 'despues macros.xlsx');

            // 4. Ejecutar análisis
            await runPriorityAnalysisInternal(analysisStartDate, analysisEndDate, priorityArticles);
        } catch (error) {
            logError('❌ Error ejecutando macros:', error);
            showNotification(`Error en macros: ${(error as Error).message}`, 'error');
        }
    };

    const handleExecuteWithHojaFinal = async (
        analysisStartDate: string,
        analysisEndDate: string,
        excelFile: File
    ) => {
        try {
            showNotification('Procesando archivo con "HOJA FINAL"...', 'info');
            const priorityArticles = await parseHojaFinalFile(excelFile);
            await runPriorityAnalysisInternal(analysisStartDate, analysisEndDate, priorityArticles);
        } catch (error) {
            logError('❌ Error parseando HOJA FINAL:', error);
            showNotification(`Error: ${(error as Error).message}`, 'error');
        }
    };

    return (
        <div className="p-8 bg-slate-50 min-h-screen">
            <header className="mb-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                        <div>
                            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-600 to-orange-600 flex items-center gap-2">
                                <Layers className="text-orange-500 w-8 h-8" />
                                Auditoría de Trabajos
                            </h1>
                            <p className="text-slate-500 mt-1 text-sm">
                                Análisis de cobertura de jornada vs imputaciones de fabricación (Datos Reales ERP)
                            </p>
                        </div>
                        <button
                            onClick={() => setShowPriorityModal(true)}
                            className="flex items-center gap-3 px-6 py-3 ml-0 md:ml-4 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200 transition-all hover:scale-105 active:scale-95 group"
                        >
                            <Target className="w-5 h-5 group-hover:animate-pulse" />
                            <div className="text-left">
                                <span className="block text-sm font-black tracking-wide">DASHBOARD INTERACTIVO</span>
                                <span className="block text-[10px] text-indigo-100 uppercase tracking-wider">Análisis de Prioridades y Desviaciones</span>
                            </div>
                        </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 custom-filters mt-4 md:mt-0">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Desde</label>
                            <SmartDateInput
                                value={startDate}
                                onChange={setStartDate}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-[180px]"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Hasta</label>
                            <SmartDateInput
                                value={endDate}
                                onChange={setEndDate}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-[180px]"
                            />
                        </div>

                        <div className="min-w-[180px]">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Sección</label>
                            <select
                                value={selectedDepartment}
                                onChange={(e) => setSelectedDepartment(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="all">Todas las secciones</option>
                                {computedDepartments.map(dept => (
                                    <option key={dept} value={dept}>{dept}</option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-[160px]">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Turno</label>
                            <select
                                value={shiftFilter}
                                onChange={(e) => setShiftFilter(e.target.value as 'all' | 'M' | 'TN')}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="all">Todos</option>
                                <option value="M">Mañana (M)</option>
                                <option value="TN">Tarde/Noche (TN)</option>
                            </select>
                        </div>

                        <div className="min-w-[250px]">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Buscar Empleado</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Nombre o ID..."
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                            {selectedEmployeeIds.size > 0 && (
                                <button
                                    onClick={() => setSelectedEmployeeIds(new Set())}
                                    className="text-xs text-blue-600 mt-1 hover:underline"
                                >
                                    Limpiar selección ({selectedEmployeeIds.size})
                                </button>
                            )}
                        </div>

                        <div className="min-w-[220px]">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Ordenar por</label>
                            <select
                                value={sortKey}
                                onChange={(e) => setSortKey(e.target.value as 'gap' | 'worked' | 'empId' | 'name' | 'shift')}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="gap">Tiempo sin trabajar</option>
                                <option value="worked">Tiempo trabajado</option>
                                <option value="shift">Turno</option>
                                <option value="empId">Numero de empleado</option>
                                <option value="name">Nombre</option>
                            </select>
                        </div>

                        <div className="min-w-[140px]">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 ml-1">Direccion</label>
                            <select
                                value={sortDir}
                                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="desc">Descendente</option>
                                <option value="asc">Ascendente</option>
                            </select>
                        </div>

                        <button
                            onClick={handleSearch}
                            disabled={isReloading || loadingJobs}
                            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white font-medium shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5
                                ${isReloading || loadingJobs ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        >
                            {(isReloading || loadingJobs) ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            {isReloading ? 'Calculando Presencia...' : (loadingJobs ? 'Analizando Trabajos...' : 'Auditar')}
                        </button>

                        {loadingJobs && jobProgress?.total ? (
                            <div className="min-w-[220px]">
                                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                    <span>Procesados {jobProgress.processed}/{jobProgress.total}</span>
                                    <span>{Math.round((jobProgress.processed / jobProgress.total) * 100)}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-all"
                                        style={{ width: `${Math.round((jobProgress.processed / jobProgress.total) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}

                        {loadingExcel && excelProgress > 0 ? (
                            <div className="min-w-[220px]">
                                <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                                    <span>Generando Excel</span>
                                    <span>{excelProgress}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                                    <div
                                        className="h-full bg-emerald-500 transition-all"
                                        style={{ width: `${excelProgress}%` }}
                                    />
                                </div>
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-100/50 rounded-xl border border-slate-200/60 shadow-inner">
                            <div className="flex flex-col mr-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter leading-none mb-1">Herramientas de</span>
                                <span className="text-xs font-black text-indigo-600 uppercase tracking-wider leading-none">Exportación</span>
                            </div>


                            <button
                                onClick={handleExportImproductivosExcel}
                                disabled={loadingExcel}
                                className={`flex items-center gap-2 px-3 py-1.5 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5
                                    ${loadingExcel ? 'bg-slate-400 cursor-wait' : 'bg-green-600 hover:bg-green-700'}`}
                                title="Exportar Excel de Improductivos por Sección"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                {loadingExcel ? 'Generando...' : 'Excel Improductivos'}
                            </button>

                            <button
                                onClick={() => handleExportPDF(false)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5"
                                title="Exportar auditoria completa"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                PDF Auditoria
                            </button>

                            <button
                                onClick={() => handleExportPDF(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5"
                                title="Exportar solo empleados con anomalia de misma OF/ART"
                            >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                PDF Anomalias
                            </button>

                            <button
                                onClick={handleExportAnomaliesCsv}
                                className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5"
                                title="Exportar CSV tecnico de anomalias para depuracion"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                CSV Anomalias
                            </button>

                            {/* Nuevos botones de Dashboard Improductivos */}
                            <button
                                onClick={() => window.open('/gestion-trabajos/improductivos?view=section', '_blank')}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all hover:-translate-y-0.5 border border-red-400/30"
                                title="Abrir Dashboard de Improductivos por Sección"
                            >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Dash. Secciones
                            </button>
                            <button
                                onClick={() => window.open('/gestion-trabajos/improductivos?view=activity', '_blank')}
                                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all hover:-translate-y-0.5 border border-rose-400/30"
                                title="Abrir Dashboard de Improductivos por Actividad"
                            >
                                <Activity className="w-3.5 h-3.5" />
                                Dash. Actividades
                            </button>
                        </div>

                        <button
                            onClick={() => setShowDebug(!showDebug)}
                            className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2"
                        >
                            {showDebug ? 'Ocultar Debug' : 'Debug'}
                        </button>

                        <button
                            onClick={() => setShowOnlyAnomalous(prev => !prev)}
                            className={`text-xs font-bold px-2 py-1 rounded border transition-colors ${showOnlyAnomalous ? 'text-orange-700 border-orange-300 bg-orange-50' : 'text-slate-500 border-slate-200 hover:text-slate-700'}`}
                            title="Mostrar solo empleados con anomalias de solape en misma OF/ART"
                        >
                            {showOnlyAnomalous ? `Solo anomalias (${anomalousCount})` : `Ver solo anomalias (${anomalousCount})`}
                        </button>
                    </div>
                </div>
            </header>

            {/* Global Summary Stats - NUEVO */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 mt-4 animate-fadeIn">
                {/* Ocupación Global (Donut Chart) */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-6 transition-all hover:shadow-md col-span-1 md:col-span-1">
                    <div className="relative w-24 h-24 flex-shrink-0">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle
                                cx="48"
                                cy="48"
                                r="40"
                                stroke="currentColor"
                                strokeWidth="8"
                                fill="transparent"
                                className="text-slate-100"
                            />
                            <circle
                                cx="48"
                                cy="48"
                                r="40"
                                stroke="currentColor"
                                strokeWidth="8"
                                fill="transparent"
                                strokeDasharray={2 * Math.PI * 40}
                                strokeDashoffset={2 * Math.PI * 40 * (1 - globalStats.occupancy / 100)}
                                strokeLinecap="round"
                                className="text-indigo-600 transition-all duration-1000 ease-out"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-black text-slate-800">{globalStats.occupancy.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Cobertura Real</h3>
                        <p className="text-2xl font-black text-slate-800" title={`Tiempo Imputado Total: ${globalStats.totalImputed.toFixed(1)}h`}>
                            {globalStats.totalCovered.toFixed(1)}h
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">
                            Imp: {globalStats.totalImputed.toFixed(1)}h / Pres: {globalStats.totalPresence.toFixed(1)}h
                        </p>
                    </div>
                </div>

                {/* KPI BLOCKS */}
                <div className="col-span-1 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 1. Tiempo Productivo */}
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <CheckCircle2 className="w-16 h-16 text-emerald-600" />
                        </div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Tiempo Productivo</h3>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-black text-emerald-600">
                                {(globalStats.totalCovered - globalStats.totalImproductiveProduced).toFixed(1)}h
                            </p>
                            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                {clampPercent(globalStats.totalPresence > 0 ? (((globalStats.totalCovered - globalStats.totalImproductiveProduced) / globalStats.totalPresence) * 100) : 0).toFixed(0)}%
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Trabajo real efectivo (neto)</p>
                    </div>

                    {/* 2. Tiempo Improductivo */}
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <Clock className="w-16 h-16 text-amber-600" />
                        </div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Tiempo Improductivo</h3>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-black text-amber-600">{globalStats.totalImproductiveProduced.toFixed(1)}h</p>
                            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                {clampPercent(globalStats.totalPresence > 0 ? ((globalStats.totalImproductiveProduced / globalStats.totalPresence) * 100) : 0).toFixed(0)}%
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Limpieza, Mantenimiento, etc.</p>
                    </div>

                    {/* 3. Tiempo No Empleado (GAP) */}
                    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3 opacity-10">
                            <AlertTriangle className="w-16 h-16 text-red-600" />
                        </div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">No Cubierto (GAP)</h3>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-black text-red-600">{globalStats.totalGap.toFixed(1)}h</p>
                            <span className="text-xs font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                {clampPercent(globalStats.totalPresence > 0 ? ((globalStats.totalGap / globalStats.totalPresence) * 100) : 0).toFixed(0)}%
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Tiempo pagado sin actividad</p>
                    </div>
                </div>
            </div>

            {/* List */}
            < div className="space-y-4" >
                {
                    displayedRows.length === 0 && comparisonRows.length > 0 && (
                        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 border-dashed">
                            <p className="text-slate-400 font-medium">
                                {showOnlyAnomalous
                                    ? 'No hay empleados con anomalia de misma OF/ART para este filtro.'
                                    : `No se encontraron empleados que coincidan con la búsqueda "${searchFilter}"`}
                            </p>
                            <button
                                onClick={() => {
                                    setSearchFilter('');
                                    setShowOnlyAnomalous(false);
                                }}
                                className="mt-3 text-sm text-blue-600 hover:underline"
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    )
                }
                {
                    displayedRows.map(({ emp, shiftCode, totalPresence, totalTimeCovered, effectiveCoveredForUi, totalJobTimeProduced, improductiveTimeProduced, jobs, timeGap, overlapRatio, vacationDays, sickLeaveHours, sickLeaveType, recordedIncidents, hasAnomalousOverlap, uncoveredGaps }) => {
                        const isMissingJobs = totalPresence > 0.5 && effectiveCoveredForUi === 0;
                        const isBigGap = timeGap > 0.5; // > 30 min gap
                        const hasHighOverlap = overlapRatio > 1.05 && !hasAnomalousOverlap; // Multitask real
                        const hasPresence = totalPresence > 0.05;
                        const hasCoverage = effectiveCoveredForUi > 0.05;
                        const hasOverCoverage = effectiveCoveredForUi > totalPresence + 0.05;
                        const isNoPresenceButWork = !hasPresence && hasCoverage;
                        const hasVacation = vacationDays > 0;
                        const hasSickLeave = sickLeaveHours > 0;
                        const hasRecordedIncidents = recordedIncidents.length > 0;
                        const gapLabel = isNoPresenceButWork
                            ? 'SIN JORNADA'
                            : hasOverCoverage
                                ? 'REVISION'
                                : timeGap > 0.05
                                    ? timeGap.toFixed(2) + 'h'
                                    : 'OK';
                        const gapClass = (isNoPresenceButWork || hasOverCoverage)
                            ? 'text-amber-600'
                            : isBigGap
                                ? 'text-red-500'
                                : 'text-slate-300';

                        const isUnproductive = emp.productivo === false;

                        return (
                            <div key={emp.id} className={`rounded-xl shadow-sm border overflow-hidden transition-all hover:shadow-md group ${hasAnomalousOverlap ? 'bg-orange-50/40 border-orange-200' : (isUnproductive ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200')}`}>
                                <div
                                    className="p-5 cursor-pointer flex flex-col lg:flex-row gap-6 items-center"
                                    onClick={() => toggleExpand(emp.id)}
                                >
                                    {/* Operario Info */}
                                    <div className="w-full lg:w-1/4 flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-inner transition-colors duration-500
                                        ${hasAnomalousOverlap ? 'bg-orange-100 text-orange-700' : (isMissingJobs || isBigGap ? 'bg-red-100 text-red-600' : 'bg-emerald-50 text-emerald-600')}`}>
                                            {emp.id}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-800 text-lg leading-tight group-hover:text-indigo-600 transition-colors">{emp.name}</h3>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                                <span className="text-slate-500 text-xs font-medium bg-slate-100 px-2 py-0.5 rounded-md">{emp.department}</span>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${shiftBadgeClass(shiftCode)}`}>
                                                    TURNO {shiftCode}
                                                </span>
                                                {emp.productivo === false && (
                                                    <span className="text-rose-700 text-[10px] font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">IMPRODUCTIVO</span>
                                                )}
                                                {hasHighOverlap && <span className="text-indigo-600 text-[10px] font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">MULTITASK {(overlapRatio * 100).toFixed(0)}%</span>}
                                                {hasAnomalousOverlap && (
                                                    <span className="text-orange-700 text-[10px] font-bold bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" /> MISMA OF/ART
                                                    </span>
                                                )}
                                                {improductiveTimeProduced > 0 && (
                                                    <span className="text-amber-700 text-[10px] font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                                        IMPROD. {improductiveTimeProduced.toFixed(2)}h
                                                    </span>
                                                )}
                                                {showDebug && <span className="text-xs font-mono text-purple-600 ml-2">[{jobs.length} regs / ID:{emp.id}]</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Bars Visualization */}
                                    <div className="w-full lg:flex-1 flex flex-col gap-3 relative">
                                        {/* Presencia (Jornada) */}
                                        <div className="flex items-center gap-3 relative z-10">
                                            <div className="w-24 text-xs font-bold text-slate-500 text-right uppercase tracking-wider">Jornada</div>
                                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative shadow-inner">
                                                <div
                                                    className="h-full bg-emerald-500 rounded-full relative"
                                                    style={{ width: `${Math.min((totalPresence / 10) * 100, 100)}%` }}
                                                ></div>
                                            </div>
                                            <div className="w-16 text-right font-mono font-bold text-emerald-600 text-sm">
                                                {totalPresence.toFixed(2)}h
                                            </div>
                                        </div>

                                        {/* Cobertura (Tiempo Tocado) */}
                                        <div className="flex items-center gap-3 relative z-10">
                                            <div className="w-24 text-xs font-bold text-slate-500 text-right uppercase tracking-wider">
                                                Cobertura
                                            </div>
                                            <div
                                                className={`flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative shadow-inner group-hover/bar:h-4 transition-all`}
                                                title={hasAnomalousOverlap
                                                    ? `Tiempo Imputado (Bruto): ${totalJobTimeProduced.toFixed(2)}h\nCaso anomalo en misma OF/ART (sin compresion)`
                                                    : `Tiempo Imputado (Bruto): ${totalJobTimeProduced.toFixed(2)}h\nTiempo Cubierto (Real): ${totalTimeCovered.toFixed(2)}h`}
                                            >
                                                {/* Fondo: Total Producido (Opaco) */}
                                                <div
                                                    className={`absolute top-0 left-0 h-full transition-all ${hasAnomalousOverlap ? 'bg-orange-300' : 'bg-indigo-300'}`}
                                                    style={{ width: `${Math.min((totalJobTimeProduced / 10) * 100, 100)}%` }}
                                                ></div>
                                                {/* Frente: Cobertura Real (Sólido) */}
                                                <div
                                                    className="h-full bg-blue-600 rounded-full relative transition-all"
                                                    style={{ width: `${Math.min((effectiveCoveredForUi / 10) * 100, 100)}%` }}
                                                ></div>
                                            </div>
                                            <div className="w-16 flex flex-col items-end justify-center">
                                                <span className="font-mono font-bold text-blue-600 text-sm leading-none">{effectiveCoveredForUi.toFixed(2)}h</span>
                                                {totalJobTimeProduced > effectiveCoveredForUi + 0.05 && (
                                                    <span className={`text-[9px] font-bold mt-1 leading-none ${hasAnomalousOverlap ? 'text-orange-600' : 'text-indigo-500'}`}>
                                                        Imp: {totalJobTimeProduced.toFixed(2)}h
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {(hasVacation || hasSickLeave || hasRecordedIncidents) && (
                                            <div className="flex flex-wrap gap-2 text-[11px]">
                                                {hasVacation && (
                                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 font-semibold">
                                                        Vacaciones {vacationDays}d
                                                    </span>
                                                )}
                                                {hasSickLeave && (
                                                    <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded border border-rose-100 font-semibold">
                                                        Baja {sickLeaveType || 'IT'} {sickLeaveHours.toFixed(1)}h
                                                    </span>
                                                )}
                                                {recordedIncidents.map((inc, idx) => (
                                                    <span key={`${emp.id}-inc-${idx}`} className="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100 font-semibold">
                                                        {formatShortDate(inc.date)} · INC {String(inc.motivoId).padStart(2, '0')} · {inc.start}-{inc.end}{inc.endsNextDay ? ' (+1)' : ''} · {inc.durationHoursInt}h
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Summary & Alerts */}
                                    <div className="w-full lg:w-1/5 flex justify-end items-center gap-4 border-l border-slate-100 pl-6">
                                        <div className="text-right bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                                            <div className="text-[10px] text-amber-600 font-bold uppercase tracking-widest mb-1">Improductivo</div>
                                            <div className={`text-xl font-black ${improductiveTimeProduced > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                                                {improductiveTimeProduced.toFixed(2)}h
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Sin Cubrir</div>
                                            <div className={`text-2xl font-black ${gapClass}`}>
                                                {gapLabel}
                                            </div>
                                        </div>
                                        <div className="w-8 flex justify-center">
                                            {expandedRows.has(emp.id) ? (
                                                <ChevronUp className="w-5 h-5 text-slate-400" />
                                            ) : (
                                                <ChevronDown className="w-5 h-5 text-slate-400" />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Alerts Banner */}
                                {(isMissingJobs || isBigGap || hasOverCoverage || hasAnomalousOverlap) && (
                                    <div className="px-5 pb-3 flex flex-wrap gap-2 text-xs">
                                        {hasAnomalousOverlap && <span className="bg-orange-50 text-orange-700 px-2 py-1 rounded border border-orange-100 flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> SOLAPE EN MISMA OF/ART</span>}
                                        {isMissingJobs && <span className="bg-red-50 text-red-700 px-2 py-1 rounded border border-red-100 flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> SIN IMPUTACIONES</span>}
                                        {isBigGap && effectiveCoveredForUi > 0 && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100 flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> HUECO DE {timeGap.toFixed(2)}h</span>}
                                        {isNoPresenceButWork && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100 flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> IMPUTADO SIN JORNADA</span>}
                                        {hasOverCoverage && !isNoPresenceButWork && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100 flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> IMPUTACION &gt; PRESENCIA</span>}
                                    </div>
                                )}

                                {/* Detailed List */}
                                {expandedRows.has(emp.id) && (
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-5 animate-fadeIn">
                                        {showDebug && (
                                            <div className="mb-4 p-4 bg-slate-900 rounded-lg overflow-x-auto">
                                                <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Raw API Data Debug</h4>
                                                <pre className="text-[10px] font-mono text-green-400 whitespace-pre">
                                                    {JSON.stringify(jobs.slice(0, 3), null, 2)}
                                                    {jobs.length > 3 && `\n... y ${jobs.length - 3} más`}
                                                    {jobs.length === 0 && "\n[No Data Returned from API]"}
                                                </pre>
                                            </div>
                                        )}

                                        {jobs.length > 0 ? (
                                            <table className="w-full text-sm text-left border-separate border-spacing-0">
                                                <thead className="text-slate-400 font-semibold text-xs uppercase tracking-wider">
                                                    <tr>
                                                        <th className="px-4 py-2 border-b border-slate-200">Orden</th>
                                                        <th className="px-4 py-2 border-b border-slate-200">Operación</th>
                                                        <th className="px-4 py-2 border-b border-slate-200">Artículo</th>
                                                        <th className="px-4 py-2 border-b border-slate-200 text-center">Cant.</th>
                                                        <th className="px-4 py-2 border-b border-slate-200">Horario</th>
                                                        <th className="px-4 py-2 border-b border-slate-200 text-center">Turno</th>
                                                        <th className="px-4 py-2 border-b border-slate-200 text-right">Duración</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="text-slate-600">
                                                    {(() => {
                                                        // Build unified timeline: jobs + uncovered gaps
                                                        type TimelineItem =
                                                            | { type: 'job'; sortTime: number; job: JobControlEntry; idx: number }
                                                            | { type: 'gap'; sortTime: number; gap: typeof uncoveredGaps[0] };

                                                        const timeline: TimelineItem[] = [];

                                                        // Add jobs
                                                        [...jobs]
                                                            .sort((a, b) => {
                                                                const aStart = parseErpDateTime(a.FechaInicio, a.HoraInicio).getTime();
                                                                const bStart = parseErpDateTime(b.FechaInicio, b.HoraInicio).getTime();
                                                                return aStart - bStart;
                                                            })
                                                            .forEach((job, idx) => {
                                                                const start = parseErpDateTime(job.FechaInicio, job.HoraInicio);
                                                                timeline.push({ type: 'job', sortTime: start.getTime(), job, idx });
                                                            });

                                                        // Add uncovered gaps
                                                        uncoveredGaps.forEach(gap => {
                                                            timeline.push({ type: 'gap', sortTime: gap.startDate.getTime(), gap });
                                                        });

                                                        // Sort all by time
                                                        timeline.sort((a, b) => a.sortTime - b.sortTime);

                                                        return timeline.map((item, timeIdx) => {
                                                            if (item.type === 'gap') {
                                                                const g = item.gap;
                                                                const durationH = g.durationMinutes / 60;
                                                                const durationLabel = g.durationMinutes >= 60
                                                                    ? `${durationH.toFixed(2)}h`
                                                                    : `${g.durationMinutes}min`;
                                                                return (
                                                                    <tr key={`gap-${timeIdx}`} className="bg-red-50 border-l-4 border-l-red-500 animate-fadeIn">
                                                                        <td className="px-4 py-2.5 border-b border-red-200 font-bold text-red-600 text-xs">
                                                                            <span className="flex items-center gap-1.5">
                                                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                                                SIN CUBRIR
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2.5 border-b border-red-200 text-red-500 text-xs italic" colSpan={2}>
                                                                            Tramo sin actividad registrada
                                                                        </td>
                                                                        <td className="px-4 py-2.5 border-b border-red-200 text-center text-red-400 text-xs">—</td>
                                                                        <td className="px-4 py-2.5 border-b border-red-200 font-mono text-red-600 text-xs font-bold">
                                                                            {g.startTime} - {g.endTime}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 border-b border-red-200 text-center text-red-400 text-[10px]">
                                                                            {formatShortDate(g.date)}
                                                                        </td>
                                                                        <td className="px-4 py-2.5 border-b border-red-200 text-right font-bold text-red-600">
                                                                            {durationLabel}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            }

                                                            // Render regular job row
                                                            const job = item.job;
                                                            const start = parseErpDateTime(job.FechaInicio, job.HoraInicio);
                                                            const end = parseErpDateTime(job.FechaFin, job.HoraFin);
                                                            const duration = !isNaN(start.getTime()) && !isNaN(end.getTime())
                                                                ? differenceInMinutes(end, start) / 60
                                                                : 0;
                                                            const articleId = getJobArticleId(job);
                                                            const improductiveInfo = getImproductiveArticle(articleId, getJobArticleDesc(job));
                                                            const isAssumedImproductive = improductiveInfo
                                                                ? isAssumedImproductiveArticle(improductiveInfo)
                                                                : false;
                                                            const isEmbalajeImproductive = improductiveInfo
                                                                ? isEmbalajeImproductiveArticle(improductiveInfo)
                                                                : false;
                                                            const shiftDateKey = !isNaN(start.getTime()) ? format(start, 'yyyy-MM-dd') : '';
                                                            const shiftFromFichajeByDate = shiftFromFichajes.byEmployeeDate.get(emp.id)?.get(shiftDateKey);
                                                            const jobShift = resolveJobShiftCode(job, shiftCode, shiftFromFichajeByDate);
                                                            const isNormalValidJob = !improductiveInfo;
                                                            const rowHighlightClass = isNormalValidJob
                                                                ? 'bg-slate-100/90 border-l-4 border-l-slate-400 font-bold text-slate-700 hover:bg-slate-200/80'
                                                                : `${isEmbalajeImproductive ? 'bg-pink-50/70' : isAssumedImproductive ? 'bg-emerald-50/70' : 'bg-amber-50/60'} hover:bg-white`;

                                                            return (
                                                                <tr key={`job-${item.idx}`} className={`transition-colors ${rowHighlightClass}`}>
                                                                    <td className={`px-4 py-3 border-b border-slate-100 font-mono ${isNormalValidJob ? 'font-bold text-slate-700 bg-slate-100/80' : 'font-medium text-slate-900 bg-white/50'}`}>{job.NOrden}</td>
                                                                    <td className="px-4 py-3 border-b border-slate-100">{job.DescOperacion}</td>
                                                                    <td className="px-4 py-3 border-b border-slate-100 text-xs">
                                                                        <div className="flex items-center gap-2">
                                                                            <span>{articleId}</span>
                                                                            {improductiveInfo && (
                                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${isEmbalajeImproductive ? 'bg-pink-100 text-pink-800 border-pink-200' : isAssumedImproductive ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                                                                                    Improductivo
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        {improductiveInfo && (
                                                                            <div className={`text-[10px] mt-1 ${isEmbalajeImproductive ? 'text-pink-700' : isAssumedImproductive ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                                                {improductiveInfo.desc}
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-4 py-3 border-b border-slate-100 text-center font-mono">
                                                                        <span className="text-blue-600 font-bold">{job.QBuena ?? 0}</span>
                                                                        <span className="text-slate-400 mx-1">/</span>
                                                                        <span className="text-slate-500">{job.QFabricar ?? 0}</span>
                                                                    </td>
                                                                    <td className="px-4 py-3 border-b border-slate-100 font-mono text-xs">
                                                                        {!isNaN(start.getTime()) ? format(start, 'HH:mm') : '??'} - {!isNaN(end.getTime()) ? format(end, 'HH:mm') : '??'}
                                                                    </td>
                                                                    <td className="px-4 py-3 border-b border-slate-100 text-center">
                                                                        <span className={`inline-flex items-center justify-center min-w-[44px] px-2 py-1 rounded text-[11px] font-bold border ${shiftBadgeClass(jobShift)}`}>
                                                                            {jobShift}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-4 py-3 border-b border-slate-100 text-right font-bold text-slate-800">
                                                                        {duration.toFixed(2)}h
                                                                    </td>
                                                                </tr>
                                                            );
                                                        });
                                                    })()}
                                                </tbody>
                                                <tfoot className="bg-slate-100 text-xs uppercase">
                                                    <tr>
                                                        <td colSpan={6} className="px-4 py-2 text-right text-slate-500">Tiempo Imputado (Suma):</td>
                                                        <td className="px-4 py-2 text-right font-bold text-slate-700">{totalJobTimeProduced.toFixed(2)}h</td>
                                                    </tr>
                                                    {improductiveTimeProduced > 0 && (
                                                        <tr>
                                                            <td colSpan={6} className="px-4 py-2 text-right text-amber-700 font-bold border-t border-amber-100">Tiempo Improductivo (Suma):</td>
                                                            <td className="px-4 py-2 text-right font-bold text-amber-700 border-t border-amber-100">{improductiveTimeProduced.toFixed(2)}h</td>
                                                        </tr>
                                                    )}
                                                    {!hasAnomalousOverlap ? (
                                                        <tr>
                                                            <td colSpan={6} className="px-4 py-2 text-right text-blue-600 font-bold border-t border-slate-200">Tiempo Cubierto (Sin Solapes):</td>
                                                            <td className="px-4 py-2 text-right font-bold text-blue-600 border-t border-slate-200">{totalTimeCovered.toFixed(2)}h</td>
                                                        </tr>
                                                    ) : (
                                                        <tr>
                                                            <td colSpan={6} className="px-4 py-2 text-right text-orange-700 font-bold border-t border-orange-200">Caso anomalo misma OF/ART:</td>
                                                            <td className="px-4 py-2 text-right font-bold text-orange-700 border-t border-orange-200">Usando bruto {totalJobTimeProduced.toFixed(2)}h</td>
                                                        </tr>
                                                    )}
                                                </tfoot>
                                            </table>
                                        ) : (
                                            <div className="text-center py-8 text-slate-400 flex flex-col items-center gap-2">
                                                <Smartphone className="w-8 h-8 opacity-50" />
                                                <p>No hay imputaciones de trabajo registradas para este periodo.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                }

                {
                    comparisonRows.length === 0 && (
                        <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 border-dashed">
                            <p className="text-slate-400 font-medium">No se encontraron empleados con actividad en este periodo.</p>
                        </div>
                    )
                }
            </div>



            {/* Modal de Análisis de Prioridades */}
            <PriorityAnalysisModal
                isOpen={showPriorityModal}
                onClose={() => setShowPriorityModal(false)}
                onExecute={handleExecutePriorityAnalysis}
                onExecuteWithMacros={handleExecuteWithMacros}
                onExecuteWithHojaFinal={handleExecuteWithHojaFinal}
            />

            {/* Dashboard de Prioridades */}
            {showPriorityDashboard && priorityAnalysisData && (
                <div className="fixed inset-0 z-50 bg-slate-50 overflow-auto">
                    <PriorityDashboard
                        globalStats={priorityAnalysisData.globalStats}
                        employeeData={priorityAnalysisData.employeeData}
                        dateRange={priorityAnalysisData.dateRange}
                        onBack={() => setShowPriorityDashboard(false)}
                    />
                    <button
                        onClick={() => setShowPriorityDashboard(false)}
                        className="fixed top-4 right-4 px-4 py-2 bg-white rounded-lg shadow-lg hover:bg-slate-100 transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            )}
        </div>
    );
};
