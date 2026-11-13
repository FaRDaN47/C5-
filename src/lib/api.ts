import { authClient } from "./auth";

export async function garageApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!authClient) {
    throw new Error("Neon Auth is not configured. Set VITE_NEON_AUTH_URL.");
  }

  const { data: sessionData, error: sessionError } =
    await authClient.getSession();
  if (sessionError) throw new Error(sessionError.message);
  const token = sessionData?.session?.token;
  if (!token) throw new Error("Your session expired. Sign in again.");

  const response = await fetch("/api/garage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid response."
        : `The request failed with status ${response.status}.`,
    );
  }

  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `The request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return result as T;
}
