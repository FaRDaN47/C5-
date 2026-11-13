import { createAuthClient } from "@neon/auth";
import { BetterAuthReactAdapter } from "@neon/auth/react/adapters";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

export const isNeonAuthConfigured = Boolean(authUrl);
export const authClient = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthReactAdapter({
        fetchOptions: { credentials: "include" },
      }),
    })
  : null;

export type AuthSessionData = NonNullable<
  Awaited<ReturnType<NonNullable<typeof authClient>["getSession"]>>["data"]
>;
