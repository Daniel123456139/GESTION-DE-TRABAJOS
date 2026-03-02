import { useState, useMemo, useEffect, useRef } from 'react';
import {
    ProcessedDataRow,
    Role
} from '../types';
import { useOperarios, useMotivos, useCalendario } from './useErp';
import { useFichajes } from './useFichajes';
import { useProcessDataWorker } from './useProcessDataWorker';
import { getCalendarioOperario, CalendarioDia } from '../services/erpApi';
import logger from '../utils/logger';

export interface UseHrPortalDataProps {
    startDate: string;
    endDate: string;
}

export const useHrPortalData = ({ startDate, endDate }: UseHrPortalDataProps) => {


    // 1. Cargar Datos Maestros y Fichajes desde ERP (via TanStack Query)
    const { loading: loadingMotivos } = useMotivos();
    const { operarios, loading: loadingOperarios } = useOperarios(false);
    const { calendario: companyCalendarDays, loading: loadingCalendario } = useCalendario(startDate, endDate);

    // Fichajes y Mutaciones
    const {
        erpData,
        isLoading: isLoadingFichajes,
        isFetching: isFetchingFichajes,
        dataUpdatedAt,
        error: fichajesError,
        refresh: refreshErpData
    } = useFichajes(startDate, endDate);

    // 5. Lógica de Calendarios (Estado local temporal)
    const [employeeCalendarsByDate, setEmployeeCalendarsByDate] = useState<Map<number, Map<string, CalendarioDia>>>(new Map());
    const [isFetchingCalendars, setIsFetchingCalendars] = useState(false);
    const [calendarsVersion, setCalendarsVersion] = useState(0);

    // Filtros UI
    const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
    const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

    // No synthetic punches anymore
    const erpDataWithSynthetic = erpData;

    const allUsers = useMemo(() => {
        return operarios.map(op => ({
            id: op.IDOperario,
            name: op.DescOperario,
            role: Role.Employee,
            department: op.DescDepartamento || 'General',
            flexible: op.Flexible,
            productivo: op.Productivo
        }));
    }, [operarios]);

    const analysisRange = useMemo(() => {
        if (!startDate || !endDate) return undefined;
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T23:59:59`);
        return { start, end };
    }, [startDate, endDate]);

    const holidaysSet = useMemo(() => {
        const set = new Set<string>();
        companyCalendarDays.forEach(day => {
            if (String(day.TipoDia) === '1') {
                const cleanDate = day.Fecha?.includes('T') ? day.Fecha.split('T')[0] : day.Fecha;
                if (cleanDate) set.add(cleanDate);
            }
        });
        return set;
    }, [companyCalendarDays]);

    const employeeCalendarTipoDiaRecord = useMemo(() => {
        const record: Record<number, Record<string, number>> = {};
        employeeCalendarsByDate.forEach((dateMap, employeeId) => {
            const dayRecord: Record<string, number> = {};
            dateMap.forEach((day, date) => {
                dayRecord[date] = Number(day.TipoDia ?? 0);
            });
            record[employeeId] = dayRecord;
        });
        return record;
    }, [employeeCalendarsByDate]);

    const employeeCalendarsKey = `v${calendarsVersion}`;

    // 6. Procesamiento de Datos (Worker)
    const { result: processedData, status } = useProcessDataWorker(
        erpDataWithSynthetic,
        allUsers,
        analysisRange,
        holidaysSet,
        dataUpdatedAt,
        employeeCalendarTipoDiaRecord,
        employeeCalendarsKey
    );
    const isProcessing = status === 'processing';

    // 7. Agrupar Datos para el Resumen y Ausencias
    const { datasetResumen, datasetAusencias } = useMemo(() => {
        let processed: ProcessedDataRow[] = processedData;

        if (selectedEmployeeIds.length > 0) {
            const ids = new Set(selectedEmployeeIds.map(id => Number(id)));
            processed = processed.filter(p => ids.has(p.operario));
        } else if (selectedDepartment !== 'all' && selectedDepartment !== 'TODOS') {
            processed = processed.filter(p => p.colectivo === selectedDepartment);
        }

        const resumen: ProcessedDataRow[] = [];
        const ausencias: ProcessedDataRow[] = [];

        processed.forEach(p => {
            const resolvedAbsentDays = p.absentDays || [];

            if (resolvedAbsentDays.length === 0) {
                resumen.push(p);
                return;
            }

            ausencias.push({
                ...p,
                absentDays: resolvedAbsentDays
            });
        });

        return { datasetResumen: resumen, datasetAusencias: ausencias };
    }, [processedData, selectedEmployeeIds, selectedDepartment]);

    // Lógica de carga de calendarios por empleado
    const lastFetchParams = useRef<string>('');
    const calendarAbortController = useRef<AbortController | null>(null);

    useEffect(() => {
        const fetchParams = `${startDate}|${endDate}|${operarios.length}`;
        if (lastFetchParams.current === fetchParams) return;
        lastFetchParams.current = fetchParams;

        const timer = setTimeout(() => {
            const updateCalendar = async () => {
                if (operarios.length === 0) return;
                setIsFetchingCalendars(true);

                if (calendarAbortController.current) {
                    calendarAbortController.current.abort();
                }
                calendarAbortController.current = new AbortController();

                try {
                    const allActiveOperatorIds = operarios
                        .filter(op => op.Activo)
                        .map(op => op.IDOperario);

                    if (allActiveOperatorIds.length === 0) return;

                    const results: { id: number; cal: CalendarioDia[] }[] = [];
                    const batchSize = 6;

                    for (let i = 0; i < allActiveOperatorIds.length; i += batchSize) {
                        if (calendarAbortController.current?.signal.aborted) break;

                        const batch = allActiveOperatorIds.slice(i, i + batchSize);
                        const batchPromises = batch.map(id =>
                            getCalendarioOperario(id.toString(), startDate, endDate)
                                .then(cal => ({ id, cal }))
                                .catch(() => ({ id, cal: [] as CalendarioDia[] }))
                        );

                        const batchResults = await Promise.all(batchPromises);
                        results.push(...batchResults);

                        if (i + batchSize < allActiveOperatorIds.length) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }

                    if (calendarAbortController.current?.signal.aborted) return;

                    const empCalMap = new Map<number, Map<string, CalendarioDia>>();
                    results.forEach(({ id, cal }) => {
                        const dateMap = new Map<string, CalendarioDia>();
                        cal.forEach(day => {
                            if (!day.Fecha) return;
                            const cleanDate = day.Fecha.includes('T') ? day.Fecha.split('T')[0] : day.Fecha;
                            dateMap.set(cleanDate, day);
                        });
                        empCalMap.set(id, dateMap);
                    });

                    setEmployeeCalendarsByDate(empCalMap);
                    setCalendarsVersion(v => v + 1);
                } catch (e) {
                    logger.error("Error fetching calendars:", e);
                } finally {
                    setIsFetchingCalendars(false);
                }
            };

            updateCalendar();
        }, 100);

        return () => {
            clearTimeout(timer);
            if (calendarAbortController.current) {
                calendarAbortController.current.abort();
            }
        };
    }, [operarios, startDate, endDate]);

    // 8. Handlers para Acciones
    // Export handlers removed

    const selectedEmployeeData = useMemo(() => {
        if (selectedEmployeeIds.length !== 1) return undefined;
        const id = Number(selectedEmployeeIds[0]);
        return processedData.find(p => p.operario === id);
    }, [selectedEmployeeIds, processedData]);

    const isLongRange = useMemo(() => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays > 2;
    }, [startDate, endDate]);

    return {
        erpData,
        processedData,
        datasetResumen,
        datasetAusencias,
        employeeOptions: operarios.map(op => ({
            id: op.IDOperario,
            name: op.DescOperario,
            role: Role.Employee,
            department: op.DescDepartamento || 'General',
            flexible: op.Flexible,
            productivo: op.Productivo
        })),
        activeSickLeavesRaw: [],
        companyCalendarDays,
        selectedEmployeeData,
        isLoading: isLoadingFichajes || loadingOperarios || loadingMotivos || loadingCalendario || isProcessing,
        isRefetching: isFetchingFichajes && !isLoadingFichajes,
        fichajesError,
        refreshErpData,
        selectedDepartment,
        setSelectedDepartment,
        selectedEmployeeIds,
        setSelectedEmployeeIds,
        handleExport: async () => { },
        handleFreeHoursExport: async () => { },
        isLongRange,
        computedDepartments: Array.from(new Set(operarios.map(op => op.DescDepartamento).filter((v): v is string => Boolean(v)))).sort(),
        employeeCalendarsByDate,
        setEmployeeCalendarsByDate,
        isFetchingCalendars,
        lastUpdated: dataUpdatedAt || null,
        refetchActiveSickLeaves: async () => { }
    };
};
