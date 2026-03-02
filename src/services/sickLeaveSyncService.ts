import { RawDataRow } from '../types';
import { SyncService } from './syncService';
import { logWarning } from '../utils/logger';

const groupByEmployeeAndDate = (rows: RawDataRow[]) => {
    const map = new Map<string, RawDataRow[]>();
    rows.forEach((row) => {
        const key = `${row.IDOperario}-${row.Fecha}`;
        const current = map.get(key) || [];
        current.push(row);
        map.set(key, current);
    });
    return Array.from(map.values());
};

const syncSickLeaveRows = async (leaveRows: RawDataRow[]): Promise<void> => {
    for (const row of leaveRows) {
        await SyncService.addToQueue({
            type: 'INSERT_FICHAJE',
            payload: row,
            user: 'System'
        });
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
        await SyncService.processQueue();
    }
};

export const sickLeaveSyncService = {
    syncSickLeave: syncSickLeaveRows,
    unsyncSickLeave: async (_leaveRows: RawDataRow[]) => {
        // Placeholder compatible API: mantener sin eliminar en ERP automáticamente.
    },
    syncAllActiveSickLeaves: async (
        activeRows: RawDataRow[],
        onProgress?: (current: number, total: number) => void
    ): Promise<{ processed: number; errors: number }> => {
        const groups = groupByEmployeeAndDate(activeRows.filter(r => r.MotivoAusencia === 10 || r.MotivoAusencia === 11));
        let processed = 0;
        let errors = 0;

        for (const group of groups) {
            try {
                await syncSickLeaveRows(group);
                processed += 1;
            } catch (error) {
                logWarning('Fallo sincronizando grupo de bajas medicas', {
                    source: 'sickLeaveSyncService.syncAllActiveSickLeaves',
                    groupSize: group.length,
                    reason: error
                });
                errors += 1;
            } finally {
                if (onProgress) onProgress(processed + errors, groups.length);
            }
        }

        return { processed, errors };
    }
};

export const SickLeaveSyncService = sickLeaveSyncService;
