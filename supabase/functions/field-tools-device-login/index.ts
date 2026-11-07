import { handleDeviceAuth } from "./handler.ts";

Deno.serve((req) => handleDeviceAuth(req, "login"));
