import React, { useEffect } from 'react';
import { SyncService } from '../../services/syncService';
import { useNotification } from './NotificationContext';

/**
 * Bridge component that listens to SyncService events and triggers UI notifications.
 * This component remains invisible (returns null) but ensures synchronization events
 * are communicated to the user via Toasts.
 */
const SyncNotificationBridge: React.FC = () => {
    const { showNotification } = useNotification();

    useEffect(() => {
        // Subscribe to synchronization events
        const unsubscribe = SyncService.subscribe((event) => {
            switch (event.type) {
                case 'SYNC_SUCCESS':
                    showNotification(event.message, 'success');
                    break;
                case 'SYNC_ERROR':
                    showNotification(event.message, 'error');
                    break;
                case 'SYNC_QUEUED':
                    showNotification(event.message, 'warning');
                    break;
                case 'QUEUE_PROCESSED':
                    showNotification(event.message, 'success');
                    break;
                default:
                    // Fallback for any other event types
                    if (event.message) {
                        showNotification(event.message, 'info');
                    }
            }
        });

        // Cleanup subscription on unmount
        return () => {
            unsubscribe();
        };
    }, [showNotification]);

    return null;
};

export default SyncNotificationBridge;
