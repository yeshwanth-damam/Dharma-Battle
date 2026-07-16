const DEFAULT_DEV_BACKEND = "http://localhost:8001";

/** Backend origin without trailing slash. */
export function getBackendUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (__DEV__) return DEFAULT_DEV_BACKEND;
  return "";
}
