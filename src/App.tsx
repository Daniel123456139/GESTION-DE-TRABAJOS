import React, { useState, createContext, useMemo, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
const LoginComponent = React.lazy(() => import('./components/LoginComponent'));
const HrLayout = React.lazy(() => import('./components/hr/HrLayout'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const ProcessingComponent = React.lazy(() => import('./components/core/ProcessingComponent'));
const InitialConfigComponent = React.lazy(() => import('./components/core/InitialConfigComponent'));

const HrJobsPage = React.lazy(() => import('./components/hr/pages/HrPages').then(m => ({ default: m.HrJobsPage })));
const ImproductiveDashboards = React.lazy(() => import('./pages/ImproductiveDashboards'));

import { User, Role, RawDataRow, Shift } from './types';
import { NotificationProvider, useNotification } from './components/shared/NotificationContext';
import { useFichajes } from './hooks/useFichajes';
import { useCalendario } from './hooks/useErp';
import RealtimeNotificationsBridge from './components/shared/RealtimeNotificationsBridge';
import SyncNotificationBridge from './components/shared/SyncNotificationBridge';
import GlobalStatusPanel from './components/shared/GlobalStatusPanel';
import { AuditBridge } from './services/AuditBridge';
import { SyncService } from './services/syncService';
import { subscribeToAuthChanges, signOutApp } from './services/firebaseAuthService';
import { getFirebaseApp } from './firebaseConfig';

const LoadingFallback = () => (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent shadow-lg"></div>
            <p className="text-sm font-medium text-slate-500">Cargando aplicación...</p>
        </div>
    </div>
);

export interface AuthContextType {
    user: User | null;
    login: (user: User) => void;
    logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export interface DataContextType {
    erpData: RawDataRow[];
    shifts: Shift[];
}
export const DataContext = createContext<DataContextType>({ erpData: [], shifts: [] });

// Wrapper to use useNavigate hook
const MainRoutes: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    // Global Filter State
    const [globalFilterState, setGlobalFilterState] = useState<{
        startDate: string;
        endDate: string;
        startTime: string;
        endTime: string;
    } | null>(null);

    // 1. Suscribirse a cambios de autenticación
    useEffect(() => {
        const unsubscribe = subscribeToAuthChanges((authUser) => {
            if (authUser) {
                setCurrentUser({
                    id: authUser.uid,
                    name: authUser.displayName,
                    role: authUser.appRole === 'HR' ? Role.HR : (authUser.appRole === 'MANAGEMENT' ? Role.Management : Role.Employee),
                    uid: authUser.uid,
                    email: authUser.email,
                    appRole: authUser.appRole,
                    rolUnificado: authUser.rolUnificado
                });
            } else {
                setCurrentUser(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // React Query Hooks
    const { erpData, isLoading: loadingFichajes, error: errorFichajes } = useFichajes(
        globalFilterState?.startDate || '',
        globalFilterState?.endDate || ''
    );

    const { calendario, loading: loadingCalendario, error: errorCalendario } = useCalendario(
        globalFilterState?.startDate || '',
        globalFilterState?.endDate || ''
    );

    const { showNotification } = useNotification();

    const [shifts, setShifts] = useState<Shift[]>([]);

    // Error Handling
    useEffect(() => {
        if (errorFichajes) showNotification(`Error cargando fichajes: ${errorFichajes}`, 'error');
        if (errorCalendario) showNotification(`Error cargando calendario: ${errorCalendario}`, 'warning');
    }, [errorFichajes, errorCalendario, showNotification]);

    useEffect(() => {
        AuditBridge.init();
        const handleOnline = async () => {
            showNotification("Conexión restablecida. Sincronizando datos pendientes...", "success");
            await SyncService.processQueue();
            // Invalidate queries to refresh data after sync
            queryClient.invalidateQueries({ queryKey: ['fichajes'] });
        };
        const handleOffline = () => {
            showNotification("Se ha perdido la conexión. Trabajando en modo Offline.", "warning");
        };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [showNotification, queryClient]);

    const handleInitialConfigContinue = async (startDate: string, endDate: string, startTime: string, endTime: string) => {
        setGlobalFilterState({ startDate, endDate, startTime, endTime });
        navigate('/processing');
        // Data loading is triggered automatically by hooks when state changes
    };

    // Auto-navigate from processing to portal when data is ready
    useEffect(() => {
        if (location.pathname === '/processing' && !loadingFichajes && !loadingCalendario && erpData.length > 0) {
            navigate('/gestion-trabajos');
        }
        if (location.pathname === '/processing' && !loadingFichajes && !loadingCalendario && erpData.length === 0 && !errorFichajes) {
            navigate('/gestion-trabajos');
        }
    }, [loadingFichajes, loadingCalendario, erpData, errorFichajes, navigate]);

    const handleLogin = useCallback((user: User) => {
        setCurrentUser(user);
    }, []);

    const handleLogout = useCallback(async () => {
        await signOutApp();
        setCurrentUser(null);
        queryClient.removeQueries();
        setGlobalFilterState(null);
        navigate('/login');
    }, [navigate, queryClient]);

    const authContextValue = useMemo(() => ({
        user: currentUser,
        login: handleLogin,
        logout: handleLogout
    }), [currentUser, handleLogin, handleLogout]);

    const dataContextValue = useMemo(() => ({
        erpData,
        shifts,
    }), [erpData, shifts]);

    return (
        <AuthContext.Provider value={authContextValue}>
            <DataContext.Provider value={dataContextValue}>
                <RealtimeNotificationsBridge />
                <SyncNotificationBridge />
                {currentUser && <GlobalStatusPanel />}
                {loading ? (
                    <LoadingFallback />
                ) : (
                    <React.Suspense fallback={<LoadingFallback />}>
                        <Routes>
                            <Route
                                path="/login"
                                element={currentUser ? <Navigate to="/gestion-trabajos" /> : <LoginComponent onLogin={handleLogin} />}
                            />
                            <Route
                                path="/setup"
                                element={currentUser ? <InitialConfigComponent onContinue={handleInitialConfigContinue} onBack={() => { }} /> : <Navigate to="/login" />}
                            />
                            <Route
                                path="/processing"
                                element={currentUser ? <ProcessingComponent /> : <Navigate to="/login" />}
                            />
                            <Route
                                path="/gestion-trabajos"
                                element={
                                    currentUser ? (
                                        <HrLayout
                                            shifts={shifts}
                                            setShifts={setShifts}
                                            initialStartDate={globalFilterState?.startDate}
                                            initialEndDate={globalFilterState?.endDate}
                                            initialStartTime={globalFilterState?.startTime}
                                            initialEndTime={globalFilterState?.endTime}
                                        />
                                    ) : (
                                        <Navigate to="/login" />
                                    )
                                }
                            >
                                <Route index element={<Dashboard />} />
                                <Route path="jobs" element={<HrJobsPage />} />
                                <Route path="improductivos" element={<ImproductiveDashboards />} />
                            </Route>
                            <Route path="*" element={<Navigate to="/gestion-trabajos" />} />
                        </Routes>
                    </React.Suspense>
                )}
            </DataContext.Provider>
        </AuthContext.Provider>
    );
};

const App: React.FC = () => {
    return (
        <NotificationProvider>
            {/* ErpDataProvider REMOVED */}
            <BrowserRouter>
                <MainRoutes />
            </BrowserRouter>
        </NotificationProvider>
    );
};

export default App;
