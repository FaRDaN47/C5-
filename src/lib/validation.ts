import { config } from "zod";

// Initialize before auth schemas so CSP never needs unsafe-eval.
config({ jitless: true });
