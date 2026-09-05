/**
 * Notification layer — barrel re-export.
 *
 * Canonical import path for new code:
 *   import { sendNotification } from "@golems/shared/lib/notify";
 *
 * Old imports still work:
 *   import { sendNotification } from "@golems/shared/lib/telegram-direct";
 */
export { sendNotification, type NotificationPayload } from "../telegram-direct";
