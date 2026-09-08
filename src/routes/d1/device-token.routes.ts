// src/routes/d1/device-token.routes.ts
import { createDeviceTokenRoutes } from "../factory/device-token.factory";
import { deviceTokens } from "../../db/d1/schema";
import type { D1Bindings, D1Variables } from "../../types";

export const deviceTokenRoutes = createDeviceTokenRoutes<D1Bindings, D1Variables>(deviceTokens);
