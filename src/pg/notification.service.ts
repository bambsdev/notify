// src/pg/notification.service.ts
import { NotificationService as BaseNotificationService } from "../services/notification.service";
import * as pgSchema from "../db/pg/schema";
import type { FCMService } from "../services/fcm.service";
import type { WebPushService } from "../services/webpush.service";
import type { PgDB } from "../types";

export class NotificationService extends BaseNotificationService<PgDB> {
  constructor(
    db: PgDB,
    fcm?: FCMService,
    analytics?: AnalyticsEngineDataset,
    webPush?: WebPushService,
  ) {
    super(db, fcm, analytics, webPush, pgSchema, "pg");
  }
}
