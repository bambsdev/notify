// src/routes/pg/device-token.routes.ts
import { createDeviceTokenRoutes } from "../factory/device-token.factory";
import { deviceTokens } from "../../db/pg/schema";
import type { PgBindings, PgVariables } from "../../types";

export const deviceTokenRoutes = createDeviceTokenRoutes<PgBindings, PgVariables>(deviceTokens);
