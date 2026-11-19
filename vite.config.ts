import { defineConfig, loadEnv, type Plugin } from "vite";
import garageHandler from "./api/garage.js";
import react from "@vitejs/plugin-react";
import deploymentConfig from "./vercel.json";
import { securityHeaders } from "./server/security.js";

const backendEnvironmentKeys = [
  "DATABASE_URL",
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_JWKS_URL",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_LANGUAGE_CODE",
];

function garageApiPlugin(): Plugin {
  return {
    name: "garageos-api",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url || "/", "http://localhost").pathname !== "/api/garage") {
          next();
          return;
        }
        void garageHandler(request, response);
      });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url || "/", "http://localhost").pathname !== "/api/garage") {
          next();
          return;
        }
        void garageHandler(request, response);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), "");
  for (const key of backendEnvironmentKeys) {
    if (!process.env[key] && localEnvironment[key]) {
      process.env[key] = localEnvironment[key];
    }
  }

  return {
    plugins: [react(), garageApiPlugin()],
    server: { host: "127.0.0.1", headers: securityHeaders },
    preview: {
      host: "127.0.0.1",
      headers: Object.fromEntries(deploymentConfig.headers[0].headers.map(({ key, value }) => [key, value])),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("/node_modules/recharts/")) return "charts";
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/")
            ) {
              return "react-vendor";
            }
          }
        },
      },
    },
  };
});
