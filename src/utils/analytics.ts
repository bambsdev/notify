// src/utils/analytics.ts
//
// Helper untuk logging event ke Cloudflare Analytics Engine.

export type NotifyAnalyticsEvent =
  | "device_token_registered"
  | "device_token_deleted"
  | "push_sent"
  | "push_failed"
  | "notification_created"
  | "notification_read"
  | "notifications_read_all"
  | "cleanup_expired";

interface AnalyticsLogOptions {
  event: NotifyAnalyticsEvent;
  userId?: string;
  metadata?: Record<string, string>;
  doubles?: number[];
}

/**
 * Log event ke Cloudflare Analytics Engine.
 * Blobs format: [event, userId, ...metadata values]
 * Doubles: custom numeric values
 */
export function logAnalytics(
  analytics: AnalyticsEngineDataset,
  options: AnalyticsLogOptions,
): void {
  const blobs: string[] = [options.event];

  if (options.userId) {
    blobs.push(options.userId);
  }

  if (options.metadata) {
    blobs.push(...Object.values(options.metadata));
  }

  analytics.writeDataPoint({
    blobs,
    doubles: options.doubles ?? [],
  });
}
