import React, { ErrorInfo, ReactNode } from 'react';
import { logError } from '../../utils/logger';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    public state: ErrorBoundaryState = {
        hasError: false
    };

    public static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        logError(error, {
            source: 'ErrorBoundary',
            componentStack: errorInfo.componentStack
        });
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
                    <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-8 shadow-xl">
                        <p className="text-sm font-black uppercase tracking-wider text-rose-600 mb-2">Error inesperado</p>
                        <h1 className="text-2xl font-black text-slate-900 mb-3">Algo ha fallado en la aplicación</h1>
                        <p className="text-sm text-slate-600 mb-6">
                            Hemos registrado el error en tiempo real para revisarlo. Puedes recargar la aplicación para continuar.
                        </p>
                        <button
                            type="button"
                            onClick={this.handleReload}
                            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-700 transition-colors"
                        >
                            Recargar
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
