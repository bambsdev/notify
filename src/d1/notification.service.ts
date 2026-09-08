// src/d1/notification.service.ts
import { NotificationService as BaseNotificationService } from "../services/notification.service";
import * as d1Schema from "../db/d1/schema";
import type { FCMService } from "../services/fcm.service";
import type { WebPushService } from "../services/webpush.service";
import type { D1DB } from "../types";

export class NotificationService extends BaseNotificationService<D1DB> {
  constructor(
    db: D1DB,
    fcm?: FCMService,
    analytics?: AnalyticsEngineDataset,
    webPush?: WebPushService,
  ) {
    super(db, fcm, analytics, webPush, d1Schema, "d1");
  }
}
