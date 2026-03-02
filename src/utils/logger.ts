type LogLevel = 'ERROR' | 'WARN' | 'INFO';
type ContextValue = Record<string, unknown> | Error | string | undefined;

const isDev = import.meta.env.DEV;
const isBrowser = typeof window !== 'undefined';
const DEV_TERMINAL_ENDPOINT = '/__client-log';

const COLOR_STYLE: Record<LogLevel, string> = {
    ERROR: 'color:#dc2626;font-weight:700',
    WARN: 'color:#d97706;font-weight:700',
    INFO: 'color:#059669;font-weight:700'
};

const ICON_BY_LEVEL: Record<LogLevel, string> = {
    ERROR: '🔴',
    WARN: '🟡',
    INFO: '🟢'
};

const pad = (value: number) => String(value).padStart(2, '0');

const getTimestamp = () => {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
};

const safeStringify = (value: unknown) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const stringifyArgs = (args: unknown[]) => args.map(safeStringify).join(' ');

const extractSourceFromStack = (stack?: string) => {
    if (!stack) return undefined;
    const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return undefined;

    const firstStackLine = lines[1];
    const match = firstStackLine.match(/(?:at\s+)?(.+?)(?:\s+\(|@|\s+https?:\/\/)/);
    return match?.[1]?.trim();
};

const buildContextLabel = (contexto?: ContextValue, fallbackSource?: string) => {
    if (typeof contexto === 'string') {
        return contexto;
    }

    if (contexto instanceof Error) {
        const header = fallbackSource || 'app';
        return `${header} error=${contexto.message}`;
    }

    if (contexto && typeof contexto === 'object') {
        const { source, ...rest } = contexto;
        const detailPairs = Object.entries(rest)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${safeStringify(value)}`);
        const header = (typeof source === 'string' ? source : undefined) || fallbackSource || 'app';
        return detailPairs.length > 0
            ? `${header} ${detailPairs.join(' ')}`
            : header;
    }

    return fallbackSource || 'app';
};

const isLikelyContextObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || value instanceof Error) return false;
    const contextKeys = new Set(['source', 'filename', 'file', 'line', 'column', 'component', 'componentStack']);
    return Object.keys(value).some((key) => contextKeys.has(key));
};

const toError = (value: unknown): Error => {
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    return new Error(safeStringify(value));
};

const postToDevTerminal = (level: LogLevel, payload: { timestamp: string; context: string; message: string; stack?: string }) => {
    if (!isDev || !isBrowser || typeof fetch === 'undefined') return;

    void fetch(DEV_TERMINAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
            level,
            ...payload
            // Future extension:
            // remote: {
            //   service: 'error-api',
            //   enabled: false
            // }
        })
    }).catch(() => {
        // Silent by design to avoid logging loops.
    });
};

const emit = (level: LogLevel, message: string, contexto?: ContextValue, stack?: string) => {
    if (!isDev && level !== 'ERROR') return;

    const timestamp = getTimestamp();
    const fallbackSource = extractSourceFromStack(stack);
    const contextLabel = buildContextLabel(contexto, fallbackSource);
    const headline = `${ICON_BY_LEVEL[level]} [${level}] [${timestamp}] [${contextLabel}] -> ${message}`;

    if (isBrowser) {
        if (level === 'ERROR') {
            console.error(`%c${headline}`, COLOR_STYLE[level]);
            if (stack) {
                console.error(stack);
            }
        } else if (level === 'WARN') {
            console.warn(`%c${headline}`, COLOR_STYLE[level]);
        } else {
            console.info(`%c${headline}`, COLOR_STYLE[level]);
        }
    } else {
        const ansiColor = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';

        if (level === 'ERROR') {
            console.error(`${ansiColor}${headline}${reset}`);
            if (stack) {
                console.error(`${ansiColor}${stack}${reset}`);
            }
        } else if (level === 'WARN') {
            console.warn(`${ansiColor}${headline}${reset}`);
        } else {
            console.info(`${ansiColor}${headline}${reset}`);
        }
    }

    postToDevTerminal(level, {
        timestamp,
        context: contextLabel,
        message,
        stack
    });
};

export function logError(error: unknown, contexto?: ContextValue): void {
    if (typeof error === 'string' && contexto !== undefined && !isLikelyContextObject(contexto)) {
        const normalizedSecondArg = toError(contexto);
        emit('ERROR', normalizedSecondArg.message, error, normalizedSecondArg.stack);
        return;
    }

    const normalizedError = toError(error);
    emit('ERROR', normalizedError.message, contexto, normalizedError.stack);
}

export function logWarning(message: string, contexto?: ContextValue): void {
    emit('WARN', message, contexto);
}

export function logInfo(message: string, contexto?: ContextValue): void {
    emit('INFO', message, contexto);
}

export const logger = {
    log: (...args: unknown[]) => {
        logInfo(stringifyArgs(args), 'logger.log');
    },
    warn: (...args: unknown[]) => {
        logWarning(stringifyArgs(args), 'logger.warn');
    },
    error: (...args: unknown[]) => {
        if (args.length === 0) {
            logError(new Error('Unknown error'), 'logger.error');
            return;
        }

        if (args.length === 1) {
            logError(args[0], 'logger.error');
            return;
        }

        const [context, ...rest] = args;
        if (typeof context === 'string' && rest.length > 0) {
            const [first, ...others] = rest;
            if (first instanceof Error || typeof first === 'object') {
                logError(first, { source: context, extra: stringifyArgs(others) || undefined });
                return;
            }

            logError(new Error(stringifyArgs(rest)), context);
            return;
        }

        logError(new Error(stringifyArgs(args)), 'logger.error');
    },
    critical: (...args: unknown[]) => {
        logError(new Error(stringifyArgs(args)), 'logger.critical');
    },
    debug: (...args: unknown[]) => {
        if (!isDev) return;
        logInfo(stringifyArgs(args), 'logger.debug');
    },
    info: (...args: unknown[]) => {
        logInfo(stringifyArgs(args), 'logger.info');
    },
    success: (...args: unknown[]) => {
        logInfo(`✅ ${stringifyArgs(args)}`, 'logger.success');
    }
};

export default logger;
