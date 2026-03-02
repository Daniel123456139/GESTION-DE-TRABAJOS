import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Outlet, NavLink, useLocation, useOutletContext } from 'react-router-dom';
import { Shift, ProcessedDataRow, RawDataRow, Role } from '../../types';
import { CalendarioDia } from '../../services/erpApi';
import { useHrPortalData } from '../../hooks/useHrPortalData';
import { getSmartDefaultDateRange } from '../../utils/localDate';
import { exportUnproductivityToXlsx } from '../../services/exports/unproductivityExportService';
import { logWarning } from '../../utils/logger';
import {
    Briefcase,
    LayoutDashboard,
    Menu,
    X
} from 'lucide-react';

interface HrLayoutProps {
    shifts: Shift[];
    setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
    initialStartDate?: string;
    initialEndDate?: string;
    initialStartTime?: string;
    initialEndTime?: string;
}

export interface HrLayoutContextType {
    // State from HrPortal/Layout
    startDate: string; setStartDate: React.Dispatch<React.SetStateAction<string>>;
    endDate: string; setEndDate: React.Dispatch<React.SetStateAction<string>>;

    // Data from useHrPortalData
    erpData: RawDataRow[];
    processedData: ProcessedDataRow[];
    datasetResumen: ProcessedDataRow[];
    datasetAusencias: ProcessedDataRow[];
    employeeOptions: { id: number; name: string; role: Role; department: string; flexible: boolean }[];
    activeSickLeavesRaw: RawDataRow[];
    companyHolidays: import('../../types').CompanyHoliday[];
    companyHolidaySet: Set<string>;

    selectedEmployeeData: ProcessedDataRow | undefined;
    employeeCalendarsByDate: Map<number, Map<string, CalendarioDia>>;
    setEmployeeCalendarsByDate: React.Dispatch<React.SetStateAction<Map<number, Map<string, CalendarioDia>>>>;

    // UI/Filter State
    selectedDepartment: string; setSelectedDepartment: (val: string) => void;
    selectedEmployeeIds: string[]; setSelectedEmployeeIds: (ids: string[]) => void;
    startTime: string; setStartTime: (val: string) => void;
    endTime: string; setEndTime: (val: string) => void;
    turno: string; setTurno: (val: string) => void;
    departmentFilteredEmployees: any[];

    // Computed
    isLongRange: boolean;
    computedDepartments: string[];
    isFetchingCalendars: boolean;
    effectiveCalendarDays: CalendarioDia[];
    shouldUseVirtualization: boolean;

    // Actions
    handleExport: (range?: { startDate: string; endDate: string }) => void;
    handleFreeHoursExport: (section: string, filterEmployeeIds: string[]) => void;
    handleExportResumen: () => void;
    handleUnproductivityExport: () => void;

    // Status
    isLoading: boolean;
    isReloading: boolean;
    isRefetching: boolean;
    fichajesError: any;
    refreshErpData: () => unknown | Promise<unknown>;
    reloadFromServer: () => unknown | Promise<unknown>;
    lastUpdated: number | null;

    // Handlers passed down
    // Handlers passed down
    handleOpenAdjustmentModal: (date?: string, employeeId?: number) => void;

    // Props passed through
    shifts: Shift[]; setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
}

export const useHrLayout = () => useOutletContext<HrLayoutContextType>();

const NavItem: React.FC<{
    to: string;
    label: string;
    icon: React.ReactNode;
    end?: boolean;
}> = ({ to, label, icon, end = false }) => {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `
                w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors
                ${isActive
                    ? 'bg-blue-50 text-blue-700 font-bold'
                    : 'text-slate-600 hover:bg-slate-50'
                }
            `}
        >
            {icon}
            <span className="capitalize">{label}</span>
        </NavLink>
    );
};

const HrLayout: React.FC<HrLayoutProps> = (props) => {
    // --- UI State ---
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const location = useLocation();

    // Close sidebar on route change on mobile
    useEffect(() => {
        setIsSidebarOpen(false);
    }, [location.pathname]);

    // Form State (Driven by UI)
    // Form State (Driven by UI)
    const defaultDates = getSmartDefaultDateRange();

    const [startDate, setStartDate] = useState(props.initialStartDate || defaultDates.startDate);
    const [endDate, setEndDate] = useState(props.initialEndDate || defaultDates.endDate);
    const [startTime, setStartTime] = useState(props.initialStartTime || '00:00');
    const [endTime, setEndTime] = useState(props.initialEndTime || '23:59');

    // Business Logic Hook
    const {
        erpData,
        processedData,
        datasetResumen,
        datasetAusencias,
        employeeOptions,
        activeSickLeavesRaw,
        companyCalendarDays,
        selectedEmployeeData,
        isLoading,
        isRefetching,
        fichajesError,
        refreshErpData,
        selectedDepartment,
        setSelectedDepartment,
        selectedEmployeeIds,
        setSelectedEmployeeIds,
        handleExport,
        handleFreeHoursExport,
        isLongRange,
        computedDepartments,
        employeeCalendarsByDate,
        setEmployeeCalendarsByDate,
        isFetchingCalendars,
        lastUpdated,
        refetchActiveSickLeaves
    } = useHrPortalData({ startDate, endDate });

    // --- Handlers ---

    const handleExportResumen = () => {
        if (datasetResumen.length === 0) return;
        const headers = ['ID', 'Nombre', 'Departamento', 'Turno', 'Tiempo Real', 'Presencia', 'Justificadas', 'Total', 'Excesos', 'TAJ', 'Estado'];
        const csvContent = [
            headers.join(';'),
            ...datasetResumen.map(row => [
                row.operario, row.nombre, row.colectivo || '', row.turnoAsignado, row.horarioReal || '-',
                row.totalHoras.toFixed(2).replace('.', ','),
                row.horasJustificadas.toFixed(2).replace('.', ','),
                row.horasTotalesConJustificacion.toFixed(2).replace('.', ','),
                row.horasExceso.toFixed(2).replace('.', ','),
                `${row.numTAJ} / ${row.hTAJ.toFixed(2).replace('.', ',')}`,
                row.incidentCount > 0 ? 'Pendiente' : 'Correcto'
            ].join(';'))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `resumen_empleados_${startDate}_${endDate}.csv`;
        link.click();
    };

    const handleUnproductivityExport = () => {
        if (datasetResumen.length === 0) return;
        exportUnproductivityToXlsx(datasetResumen, erpData, startDate, endDate);
    };

    const [turno, setTurno] = useState('all');

    const companyHolidaySet = useMemo(() => {
        return new Set((companyCalendarDays || []).filter(d => d.TipoDiaEmpresa === 1 || d.Festivo === 1).map(d => d.Fecha));
    }, [companyCalendarDays]);

    const companyHolidays = useMemo(() => {
        return (companyCalendarDays || []).filter(d => d.TipoDiaEmpresa === 1 || d.Festivo === 1).map(d => ({
            date: d.Fecha,
            description: d.DescCalendario || 'Festivo',
            isNational: d.TipoDiaEmpresa === 1
        }));
    }, [companyCalendarDays]);

    const handleOpenAdjustmentModal = (date?: string, employeeId?: number) => {
        console.log("Opening adjustment modal for", date, employeeId);
        // This will be connected to the actual modal state later if needed
    };

    const departmentFilteredEmployees = useMemo(() => {
        if (selectedDepartment === 'all' || selectedDepartment === 'TODOS') return employeeOptions;
        return employeeOptions.filter(emp => emp.department === selectedDepartment);
    }, [selectedDepartment, employeeOptions]);



    const [shouldUseVirtualization, setShouldUseVirtualization] = useState(false);

    useEffect(() => {
        const readSettings = () => {
            try {
                const saved = localStorage.getItem('appSettings');
                if (!saved) {
                    setShouldUseVirtualization(false);
                    return;
                }
                const parsed = JSON.parse(saved);
                setShouldUseVirtualization(Boolean(parsed?.sistema?.modoRendimiento));
            } catch (error) {
                logWarning('No se pudo leer appSettings de localStorage', {
                    source: 'HrLayout.readSettings',
                    reason: error
                });
                setShouldUseVirtualization(false);
            }
        };

        readSettings();
        window.addEventListener('settingsChanged', readSettings);
        return () => window.removeEventListener('settingsChanged', readSettings);
    }, []);

    const contextValue: HrLayoutContextType = {
        startDate, setStartDate,
        endDate, setEndDate,
        startTime, setStartTime,
        endTime, setEndTime,
        turno, setTurno,
        departmentFilteredEmployees,

        erpData, processedData, datasetResumen, datasetAusencias, employeeOptions,
        activeSickLeavesRaw, selectedEmployeeData,
        employeeCalendarsByDate, setEmployeeCalendarsByDate,

        selectedDepartment, setSelectedDepartment,
        selectedEmployeeIds, setSelectedEmployeeIds,

        isLongRange, computedDepartments: computedDepartments as string[], isFetchingCalendars,
        effectiveCalendarDays: companyCalendarDays || [],
        shouldUseVirtualization,

        handleExport, handleFreeHoursExport,
        handleExportResumen, handleUnproductivityExport,

        isLoading,
        isReloading: isLoading || isRefetching,
        isRefetching,
        fichajesError,
        refreshErpData,
        reloadFromServer: refreshErpData,
        lastUpdated,

        companyHolidays,
        companyHolidaySet,
        handleOpenAdjustmentModal,

        shifts: props.shifts, setShifts: props.setShifts,
    };

    return (
        <div className="flex min-h-screen bg-slate-50">
            <aside className={`fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 transition-transform duration-300 z-30 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        GESTION DE TRABAJOS
                    </span>
                </div>
                <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-100px)]">
                    <NavItem to="/gestion-trabajos" label="Dashboard" icon={<LayoutDashboard size={20} />} end />
                    <NavItem to="/gestion-trabajos/jobs" label="Partes de Trabajo" icon={<Briefcase size={20} />} />

                    <div className="mt-8 px-4">
                        {/* Status indicators */}
                    </div>
                </nav>
            </aside>

            <main className="flex-1 lg:ml-64 p-4 sm:p-6 lg:p-8 overflow-y-auto">
                <div className="lg:hidden flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-bold text-slate-800">Gestión Trabajos</h1>
                        <p className="text-xs text-slate-500">Portal de Operarios</p>
                    </div>
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-white rounded-md shadow-sm border border-slate-200">
                        {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>

                <Outlet context={contextValue} />
            </main>
        </div>
    );
};

export default HrLayout;
