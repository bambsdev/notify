// src/routes/pg/notification.routes.ts
import { createNotificationRoutes } from "../factory/notification.factory";
import * as pgSchema from "../../db/pg/schema";
import type { PgBindings, PgVariables } from "../../types";

export const notifyRoutes = createNotificationRoutes<PgBindings, PgVariables>(pgSchema, "pg");
