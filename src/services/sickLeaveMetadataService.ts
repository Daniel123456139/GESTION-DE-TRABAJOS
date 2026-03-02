import { z } from 'zod';
import { SickLeave } from '../types';
import { logError, logWarning } from '../utils/logger';

const METADATA_KEY = 'hr_app_sick_leave_metadata';

// Esquema de validación para los metadatos de una baja
const SickLeaveMetadataSchema = z.object({
    lastRevisionDate: z.string().optional(),
    expectedReturnDate: z.string().optional(),
    doctorName: z.string().optional(),
    notes: z.string().optional(),
});

// Esquema para el diccionario completo de metadatos
const AllMetadataSchema = z.record(z.string(), SickLeaveMetadataSchema);

export const sickLeaveMetadataService = {
    /**
     * Obtiene todos los metadatos de las bajas del almacenamiento local.
     */
    getAllMetadata: (): Record<string, SickLeave['metadata']> => {
        try {
            const saved = localStorage.getItem(METADATA_KEY);
            if (!saved) return {};

            const parsed = JSON.parse(saved);
            const result = AllMetadataSchema.safeParse(parsed);

            if (result.success) {
                return result.data as Record<string, SickLeave['metadata']>;
            } else {
                logWarning('Invalid sick leave metadata detected, using empty object. Errors:', result.error.format());
                return {};
            }
        } catch (error) {
            logError('Error loading sick leave metadata:', error);
            return {};
        }
    },

    /**
     * Obtiene los metadatos de una baja específica.
     */
    getMetadata: (leaveId: string): SickLeave['metadata'] | undefined => {
        const allMetadata = sickLeaveMetadataService.getAllMetadata();
        return allMetadata[leaveId];
    },

    /**
     * Guarda los metadatos de una baja específica.
     */
    saveMetadata: (leaveId: string, metadata: SickLeave['metadata']): void => {
        try {
            // Validar los metadatos antes de guardar
            const validation = SickLeaveMetadataSchema.safeParse(metadata);
            if (!validation.success) {
                logError('Validation failed for sick leave metadata:', validation.error.format());
                return;
            }

            const allMetadata = sickLeaveMetadataService.getAllMetadata();
            allMetadata[leaveId] = validation.data;
            localStorage.setItem(METADATA_KEY, JSON.stringify(allMetadata));
        } catch (error) {
            logError('Error saving sick leave metadata:', error);
        }
    },

    /**
     * Elimina los metadatos de una baja específica.
     */
    deleteMetadata: (leaveId: string): void => {
        try {
            const allMetadata = sickLeaveMetadataService.getAllMetadata();
            delete allMetadata[leaveId];
            localStorage.setItem(METADATA_KEY, JSON.stringify(allMetadata));
        } catch (error) {
            logError('Error deleting sick leave metadata:', error);
        }
    }
};

const toLegacyKey = (employeeId: number, startDate: string) => `${employeeId}-${startDate}`;

export const SickLeaveMetadataService = {
    get: (employeeId: number, startDate: string) => {
        return sickLeaveMetadataService.getMetadata(toLegacyKey(employeeId, startDate));
    },
    update: (
        employeeId: number,
        startDate: string,
        patch: Partial<NonNullable<SickLeave['metadata']>>,
        _user: string
    ) => {
        const key = toLegacyKey(employeeId, startDate);
        const current = sickLeaveMetadataService.getMetadata(key) || {};
        sickLeaveMetadataService.saveMetadata(key, { ...current, ...patch });
    },
    remove: (employeeId: number, startDate: string) => {
        sickLeaveMetadataService.deleteMetadata(toLegacyKey(employeeId, startDate));
    }
};
