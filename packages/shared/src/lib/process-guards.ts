/**
 * Process-level error guards for production services.
 *
 * Catches unhandledRejection and uncaughtException,
 * logs them to Axiom and console so they don't crash silently.
 *
 * Usage: call installProcessGuards("service-name") early in your entry point.
 */

import { logError, flushAxiom } from "./axiom";

interface CapturedError {
  message: string;
  type: "unhandled_rejection" | "uncaught_exception";
  timestamp: string;
  stack?: string;
}

let lastCapturedError: CapturedError | null = null;
let guardsInstalled = false;

/** @internal For testing — returns the last error captured by guards */
export function _getLastCapturedError(): CapturedError | null {
  return lastCapturedError;
}

/** @internal For testing — reset installed state */
export function _resetGuards(): void {
  guardsInstalled = false;
  lastCapturedError = null;
}

/**
 * Install process-level error handlers that log to Axiom.
 * Call once at service startup. Safe to call multiple times — guards install only once.
 */
export function installProcessGuards(serviceName: string): void {
  if (guardsInstalled) {
    return;
  }
  guardsInstalled = true;
  process.on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;

    console.error(`[${serviceName}] Unhandled rejection:`, message);
    if (stack) console.error(stack);

    lastCapturedError = {
      message,
      type: "unhandled_rejection",
      timestamp: new Date().toISOString(),
      stack,
    };

    logError({
      service: serviceName,
      error_message: message,
      error_type: "unhandled_rejection",
      stack,
    });
  });

  process.on("uncaughtException", (error: Error) => {
    console.error(`[${serviceName}] Uncaught exception:`, error.message);
    if (error.stack) console.error(error.stack);

    lastCapturedError = {
      message: error.message,
      type: "uncaught_exception",
      timestamp: new Date().toISOString(),
      stack: error.stack,
    };

    logError({
      service: serviceName,
      error_message: error.message,
      error_type: "uncaught_exception",
      stack: error.stack,
    });

    // Flush Axiom before potentially crashing
    flushAxiom().finally(() => {
      // Don't exit for unhandled rejections but do for uncaught exceptions
      // The process is in an undefined state after uncaughtException
      process.exit(1);
    });
  });
}
