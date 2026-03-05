
import { getApiBaseUrl } from '../config/apiConfig';
import { getCurrentFirebaseToken } from './firebaseAuthService';
import { logInfo, logWarning } from '../utils/logger';

export type ServerStatus = 'online' | 'offline' | 'connecting';

type StatusListener = (status: ServerStatus, latency: number | null) => void;

const BASE_INTERVAL_MS = 15000; // 15 segundos en estado normal
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const FETCH_TIMEOUT_MS = 5000; // Timeout estricto para el ping
const PING_TIMEOUT_WARN_COOLDOWN_MS = 60000;

const shouldAttachProxyToken = (url: string): boolean => {
    if (!url) return false;
    if (url.startsWith('/api/erp')) return true;
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const parsed = new URL(url, origin);
        if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
            return false;
        }
        return parsed.pathname.startsWith('/api/erp');
    } catch {
        return false;
    }
};

class ServerConnectionMonitorService {
    private status: ServerStatus = 'connecting';
    private latency: number | null = null;
    private listeners: StatusListener[] = [];
    private timerId: any = null;
    private abortController: AbortController | null = null;
    private lastPingTimeoutWarningAt = 0;
    
    // Control de Backoff
    private retryCount = 0;
    private isRunning = false;

    constructor() {
        // Escuchar cambios en la configuración de la API para reiniciar chequeo inmediatamente
        if (typeof window !== 'undefined') {
            window.addEventListener('apiBaseUrlChanged', () => {
                logInfo('API URL changed detected by monitor. Restarting check.', {
                    source: 'ServerConnectionMonitor.constructor'
                });
                this.forceCheck();
            });
        }
    }

    /**
     * Inicia el ciclo de monitorización.
     */
    public start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.checkConnection();
    }

    /**
     * Detiene la monitorización.
     */
    public stop() {
        this.isRunning = false;
        if (this.timerId) clearTimeout(this.timerId);
        if (this.abortController) this.abortController.abort();
    }

    /**
     * Fuerza una comprobación inmediata (útil tras reconexión de red detectada por navegador).
     */
    public forceCheck() {
        this.stop();
        this.retryCount = 0;
        this.status = 'connecting';
        this.notify();
        this.start();
    }

    /**
     * Suscribirse a cambios de estado.
     */
    public subscribe(callback: StatusListener): () => void {
        this.listeners.push(callback);
        // Emitir estado actual inmediatamente
        callback(this.status, this.latency);
        
        // Si es el primer suscriptor, arrancamos el monitor
        if (this.listeners.length === 1) {
            this.start();
        }

        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
            // Si no quedan suscriptores, pausamos para ahorrar recursos
            if (this.listeners.length === 0) {
                this.stop();
            }
        };
    }

    public getStatus() {
        return this.status;
    }

    public getLatency() {
        return this.latency;
    }

    private notify() {
        this.listeners.forEach(listener => listener(this.status, this.latency));
    }

    private async checkConnection() {
        if (!this.isRunning) return;

        if (this.abortController) this.abortController.abort();
        const currentController = new AbortController();
        this.abortController = currentController;
        let abortedByTimeout = false;

        // Timeout de seguridad para el ping
        const timeoutId = setTimeout(() => {
            abortedByTimeout = true;
            currentController.abort();
        }, FETCH_TIMEOUT_MS);

        const startTime = Date.now();
        const baseUrl = getApiBaseUrl();
        const checkEndpoint = `${baseUrl}/docs`; // Asumiendo endpoint docs o root
        const shouldAttachToken = shouldAttachProxyToken(checkEndpoint);
        const token = shouldAttachToken
            ? await getCurrentFirebaseToken()
            : null;
        const headers: HeadersInit | undefined = token
            ? { Authorization: `Bearer ${token}` }
            : undefined;
        const mode: RequestMode = shouldAttachToken ? 'same-origin' : 'no-cors';

        try {
            // Intentamos un fetch simple GET
            await fetch(checkEndpoint, {
                method: 'GET',
                mode,
                signal: currentController.signal,
                headers,
                cache: 'no-store'
            });

            clearTimeout(timeoutId);

            // Si llegamos aquí, hay conexión TCP/IP
            const endTime = Date.now();
            this.latency = endTime - startTime;
            
            if (this.status !== 'online') {
                this.status = 'online';
                this.retryCount = 0; // Reset backoff
                this.notify();
            } else {
                // Solo notificamos latencia si ya estábamos online
                this.notify();
            }

            // Programar siguiente check normal
            this.scheduleNext(BASE_INTERVAL_MS);

        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error?.name === 'AbortError' && !abortedByTimeout) {
                // Abort intencional (stop/forceCheck/solape de chequeos): no contaminar estado ni logs.
                return;
            }

            if (error?.name === 'AbortError' && abortedByTimeout) {
                const now = Date.now();
                if ((now - this.lastPingTimeoutWarningAt) >= PING_TIMEOUT_WARN_COOLDOWN_MS) {
                    this.lastPingTimeoutWarningAt = now;
                    logWarning("Connection Monitor: Ping timeout", {
                        source: 'ServerConnectionMonitor.checkConnection',
                        endpoint: checkEndpoint,
                        timeoutMs: FETCH_TIMEOUT_MS
                    });
                }
            }

            const wasOnline = this.status === 'online';
            this.status = 'offline';
            this.latency = null;
            
            if (wasOnline) {
                this.notify();
            }

            // Calcular backoff exponencial
            const delay = Math.min(
                MIN_BACKOFF_MS * Math.pow(2, this.retryCount),
                MAX_BACKOFF_MS
            );
            
            this.retryCount++;
            this.scheduleNext(delay);
        }
    }

    private scheduleNext(delayMs: number) {
        if (this.timerId) clearTimeout(this.timerId);
        this.timerId = setTimeout(() => {
            this.checkConnection();
        }, delayMs);
    }
}

export const ServerConnectionMonitor = new ServerConnectionMonitorService();
