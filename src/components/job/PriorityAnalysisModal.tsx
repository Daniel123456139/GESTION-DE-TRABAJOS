/**
 * MODAL DE ANÁLISIS DE PRIORIDADES (v2 - con flujo de Macros)
 *
 * Flujo:
 *   PASO 1: Selección → EJECUTAR MACROS | REALIZAR ANÁLISIS
 *   PASO 2: Selección de fechas + carga de archivo Excel
 *   PASO 3: Progreso (procesando macros / parseando)
 *
 * Si el usuario elige "EJECUTAR MACROS":
 *   → El archivo adjunto es el original (BASE DATOS visible en primera hoja).
 *   → Se aplican las macros JS para generar HOJA FINAL en memoria.
 *   → El análisis lo realiza con los artículos de HOJA FINAL.
 *
 * Si el usuario elige "REALIZAR ANÁLISIS":
 *   → El archivo adjunto debe tener ya la hoja "HOJA FINAL" (o hoja BASE DATOS).
 *   → Se parsea directamente.
 */

import React, { useState, useEffect } from 'react';
import { X, Upload, Calendar, AlertCircle, Zap, BarChart3, ChevronRight, Loader2 } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { isValidExcelFile } from '../../services/excelPriorityService';
import SmartDateInput from '../shared/SmartDateInput';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type FlowMode = 'select' | 'macros' | 'direct';

interface PriorityAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Análisis normal → Excel con hoja BASE DATOS */
    onExecute: (startDate: string, endDate: string, excelFile: File) => Promise<void>;
    /** Análisis con macros → Excel original, se aplican macros JS primero */
    onExecuteWithMacros: (startDate: string, endDate: string, excelFile: File) => Promise<void>;
    /** Análisis directo con Hoja Final → Excel ya procesado */
    onExecuteWithHojaFinal: (startDate: string, endDate: string, excelFile: File) => Promise<void>;
}

// ─── Componente ──────────────────────────────────────────────────────────────
const PriorityAnalysisModal: React.FC<PriorityAnalysisModalProps> = ({
    isOpen,
    onClose,
    onExecute,
    onExecuteWithMacros,
    onExecuteWithHojaFinal
}) => {
    const [step, setStep] = useState<FlowMode>('select');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [excelFile, setExcelFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progressMsg, setProgressMsg] = useState('');

    // Inicializar al abrir
    useEffect(() => {
        if (isOpen) {
            const yesterday = subDays(new Date(), 1);
            setStartDate(format(yesterday, 'yyyy-MM-dd'));
            setEndDate(format(yesterday, 'yyyy-MM-dd'));
            setExcelFile(null);
            setError(null);
            setStep('select');
            setIsLoading(false);
            setProgressMsg('');
        }
    }, [isOpen]);

    // ─── Handlers de archivo ──────────────────────────────────────────────────
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        setError(null);
        if (file) {
            if (!isValidExcelFile(file)) {
                setError('El archivo debe ser un Excel válido (.xlsx o .xls)');
                setExcelFile(null);
                return;
            }
            setExcelFile(file);
        }
    };

    // ─── Validación ───────────────────────────────────────────────────────────
    const validateInputs = (): boolean => {
        if (!startDate || !endDate) {
            setError('Debe seleccionar fechas DESDE y HASTA');
            return false;
        }
        if (new Date(startDate) > new Date(endDate)) {
            setError('La fecha DESDE no puede ser posterior a HASTA');
            return false;
        }
        if (!excelFile) {
            setError('Debe adjuntar el archivo Excel');
            return false;
        }
        return true;
    };

    // ─── Ejecución ────────────────────────────────────────────────────────────
    const handleExecute = async () => {
        if (!validateInputs()) return;

        setIsLoading(true);
        setError(null);

        try {
            if (step === 'macros') {
                setProgressMsg('⚙️ Aplicando macros al archivo Excel...');
                await onExecuteWithMacros(startDate, endDate, excelFile!);
            } else if (step === 'direct') {
                setProgressMsg('📊 Procesando Hoja Final...');
                await onExecuteWithHojaFinal(startDate, endDate, excelFile!);
            } else {
                setProgressMsg('📊 Procesando archivo Excel...');
                await onExecute(startDate, endDate, excelFile!);
            }
        } catch (err) {
            setError((err as Error).message || 'Error al procesar el análisis');
        } finally {
            setIsLoading(false);
            setProgressMsg('');
        }
    };

    if (!isOpen) return null;

    // ─── PASO 1: Selección de flujo ───────────────────────────────────────────
    if (step === 'select') {
        return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
                <div className="bg-white rounded-2xl shadow-2xl w-[640px] overflow-hidden">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                <BarChart3 className="w-7 h-7" />
                                ANÁLISIS DE PRIORIDADES
                            </h2>
                            <button
                                onClick={onClose}
                                className="text-white/80 hover:text-white transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <p className="text-violet-100 mt-2 text-sm">
                            Seleccione cómo desea iniciar el análisis
                        </p>
                    </div>

                    {/* Opciones */}
                    <div className="p-6 grid grid-cols-2 gap-4">
                        {/* Opción A: Ejecutar Macros */}
                        <button
                            onClick={() => setStep('macros')}
                            className="group relative flex flex-col items-center gap-4 p-6 border-2 border-violet-200 hover:border-violet-500 rounded-xl transition-all hover:shadow-lg hover:shadow-violet-100 hover:scale-[1.02] text-left"
                        >
                            <div className="w-14 h-14 bg-amber-100 group-hover:bg-amber-500 rounded-2xl flex items-center justify-center transition-colors">
                                <Zap className="w-8 h-8 text-amber-600 group-hover:text-white transition-colors" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800">
                                    EJECUTAR MACROS
                                </h3>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    Adjunta el Excel <strong>original</strong> (con la primera hoja de datos).
                                    La app aplicará las macros para generar la <em>HOJA FINAL</em>
                                    y realizará el análisis automáticamente.
                                </p>
                            </div>
                            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-hover:text-violet-500 transition-colors" />
                        </button>

                        {/* Opción B: Análisis Directo */}
                        <button
                            onClick={() => setStep('direct')}
                            className="group relative flex flex-col items-center gap-4 p-6 border-2 border-indigo-200 hover:border-indigo-500 rounded-xl transition-all hover:shadow-lg hover:shadow-indigo-100 hover:scale-[1.02] text-left"
                        >
                            <div className="w-14 h-14 bg-indigo-100 group-hover:bg-indigo-500 rounded-2xl flex items-center justify-center transition-colors">
                                <BarChart3 className="w-8 h-8 text-indigo-600 group-hover:text-white transition-colors" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800">
                                    REALIZAR ANÁLISIS
                                </h3>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                    Adjunta el Excel <strong>ya procesado</strong> que contiene
                                    la hoja <em>HOJA FINAL</em> (o hoja BASE DATOS).
                                    El análisis se ejecuta directamente sin pasar por macros.
                                </p>
                            </div>
                            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                        </button>
                    </div>

                    {/* Info adicional */}
                    <div className="px-6 pb-6">
                        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                            <span>
                                En ambos casos solo se adjunta un único archivo Excel. El análisis siempre
                                compara contra los datos reales del ERP (trabajos del periodo seleccionado).
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── PASO 2: Fechas + Archivo ─────────────────────────────────────────────
    const isMacrosFlow = step === 'macros';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[90vh] overflow-auto">
                {/* Header */}
                <div className={`bg-gradient-to-r ${isMacrosFlow ? 'from-amber-500 to-orange-600' : 'from-violet-600 to-indigo-600'} p-6 rounded-t-2xl`}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                            {isMacrosFlow ? <Zap className="w-7 h-7" /> : <Upload className="w-7 h-7" />}
                            {isMacrosFlow ? 'EJECUTAR MACROS + ANÁLISIS' : 'ANÁLISIS DE PRIORIDADES'}
                        </h2>
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="text-white/80 hover:text-white transition-colors disabled:opacity-50"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-white/80 mt-2 text-sm">
                        {isMacrosFlow
                            ? 'Adjunta el Excel original → las macros generarán HOJA FINAL automáticamente'
                            : 'Adjunta el Excel con hoja HOJA FINAL o BASE DATOS para el análisis directo'}
                    </p>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Paso / modo indicador */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setStep('select'); setError(null); }}
                            disabled={isLoading}
                            className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50"
                        >
                            ← Cambiar opción
                        </button>
                        <span className="text-xs text-slate-400">|</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${isMacrosFlow ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                            {isMacrosFlow ? '⚡ Modo: Macros + Análisis' : '📊 Modo: Análisis Directo'}
                        </span>
                    </div>

                    {/* Error Alert */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                            <p className="text-red-800 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Progress */}
                    {isLoading && progressMsg && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                            <p className="text-blue-800 text-sm font-medium">{progressMsg}</p>
                        </div>
                    )}

                    {/* Fechas */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-violet-600" />
                                DESDE
                            </label>
                            <SmartDateInput
                                value={startDate}
                                onChange={setStartDate}
                                disabled={isLoading}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-violet-600" />
                                HASTA
                            </label>
                            <SmartDateInput
                                value={endDate}
                                onChange={setEndDate}
                                disabled={isLoading}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                            />
                        </div>
                    </div>

                    {/* Excel Upload */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                            <Upload className="w-4 h-4 text-violet-600" />
                            {isMacrosFlow ? 'EXCEL ORIGINAL (primera hoja con datos)' : 'EXCEL PROCESADO (hoja HOJA FINAL o BASE DATOS)'}
                        </label>
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleFileChange}
                            disabled={isLoading}
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 disabled:bg-slate-100 disabled:cursor-not-allowed"
                        />
                        {excelFile && (
                            <p className="mt-2 text-sm text-green-600 flex items-center gap-2">
                                ✓ Archivo seleccionado: <span className="font-semibold">{excelFile.name}</span>
                            </p>
                        )}
                        <p className="mt-2 text-xs text-slate-500">
                            {isMacrosFlow
                                ? 'La app procesará el Excel con las macros antes del análisis. La primera hoja del archivo (sea cual sea su nombre) se usará como origen de datos.'
                                : 'El archivo debe contener la hoja "HOJA FINAL" (generada previamente por las macros) o la hoja "BASE DATOS".'}
                        </p>
                    </div>

                    {/* Info criterio urgencia */}
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                        <h3 className="font-semibold text-indigo-900 text-sm mb-2">📌 Criterio de Urgencia</h3>
                        <ul className="text-xs text-indigo-700 space-y-1">
                            <li>• <strong>URGENTE</strong>: Fecha requerida ≤ 7 días</li>
                            <li>• <strong>NO URGENTE</strong>: Fecha requerida {'>'} 7 días o sin fecha</li>
                        </ul>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-slate-50 px-6 py-4 rounded-b-2xl flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-5 py-2.5 text-slate-700 hover:bg-slate-200 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleExecute}
                        disabled={isLoading || !excelFile}
                        className={`px-6 py-2.5 bg-gradient-to-r ${isMacrosFlow ? 'from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700' : 'from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700'} text-white rounded-lg font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Procesando...
                            </>
                        ) : (
                            <>
                                {isMacrosFlow ? <Zap className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                                {isMacrosFlow ? 'Aplicar Macros y Analizar' : 'Ejecutar Análisis'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PriorityAnalysisModal;
