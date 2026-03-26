// src/utils/logger.ts
import type { MiddlewareHandler } from "hono";
import type { NotifyBindings, NotifyVariables } from "../types";

export const customLogger = (): MiddlewareHandler<{
  Bindings: NotifyBindings;
  Variables: NotifyVariables;
}> => {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    const ip =
      c.req.header("CF-Connecting-IP") ||
      c.req.header("X-Forwarded-For") ||
      "unknown";
    const method = c.req.method;
    const url = new URL(c.req.url).pathname;
    const status = c.res.status;
    const userId = c.get("userId") ? ` User:${c.get("userId")}` : "";
    const timestamp = new Date().toISOString();

    if (status >= 500) {
      console.error(
        `🔴 [${timestamp}] ERROR: ${method} ${url} - ${status} (${ms}ms) IP:${ip}${userId}`,
      );
    } else if (status >= 400) {
      console.warn(
        `🟠 [${timestamp}] WARN: ${method} ${url} - ${status} (${ms}ms) IP:${ip}${userId}`,
      );
    } else {
      console.log(
        `🟢 [${timestamp}] INFO: ${method} ${url} - ${status} (${ms}ms) IP:${ip}${userId}`,
      );
    }
  };
};
