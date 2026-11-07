import { handleDeviceAuth } from "../field-tools-device-login/handler.ts";

Deno.serve((req) => handleDeviceAuth(req, "verify"));
