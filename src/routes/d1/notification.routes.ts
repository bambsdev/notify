// src/routes/d1/notification.routes.ts
import { createNotificationRoutes } from "../factory/notification.factory";
import * as d1Schema from "../../db/d1/schema";
import type { D1Bindings, D1Variables } from "../../types";

export const notifyRoutes = createNotificationRoutes<D1Bindings, D1Variables>(d1Schema, "d1");
