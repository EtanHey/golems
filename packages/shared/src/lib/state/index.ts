/**
 * State management layer — barrel re-export.
 *
 * Canonical import path for new code:
 *   import { getState, setState, logEvent } from "@golems/shared/lib/state";
 *
 * Old imports still work:
 *   import { getState } from "@golems/shared/lib/state-store";
 *   import { logEvent } from "@golems/shared/lib/event-log";
 */

// State store (local file storage)
export {
  getState,
  setState,
  isJobSeen,
  markJobSeen,
  markJobsSeen,
  getSeenJobIds,
} from "../state-store";

// Event logging
export {
  logEvent,
  getRecentEvents,
  formatEventsForClaude,
  type GolemActor,
  type EventType,
  type GolemEvent,
} from "../event-log";
