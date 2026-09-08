// src/utils/logger.ts
import type { MiddlewareHandler } from "hono";
import type { NotifyBindings, NotifyVariables, NotifyLogger } from "../types";

/**
 * Middleware untuk meng-inject Dependency Logger dari consumer app ke dalam Hono Context
 * dan memproses HTTP request log secara terstruktur sesuai standar industri.
 */
export const customLogger = (
  injectedLogger?: NotifyLogger,
): MiddlewareHandler<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
}> => {
  return async (c, next) => {
    if (injectedLogger) {
      c.set("logger", injectedLogger);
    }

    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    const logger = injectedLogger ?? c.get("logger");
    if (!logger) return;

    const ip =
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For") ||
      "unknown";
    const method = c.req.method;
    const url = c.req.path;
    const status = c.res.status;
    const userId = c.get("userId") || undefined;

    const meta = {
      event: "notify_http_request",
      latency_ms: ms,
      http: {
        method,
        path: url,
        status,
        ip,
      },
      userId,
    };

    const msg = `Notify HTTP ${method} ${url} - ${status} (${ms}ms)`;

    if (status >= 500) {
      logger.error?.(msg, meta);
    } else if (status >= 400) {
      logger.warn?.(msg, meta);
    } else {
      logger.info?.(msg, meta);
    }
  };
};

/**
 * Helper untuk mengambil logger dari Hono context dengan aman (safe fallback jika tidak ada logger).
 */
export function getLogger(c?: { get: (key: "logger") => NotifyLogger | undefined }): NotifyLogger {
  return c?.get("logger") ?? {};
}

