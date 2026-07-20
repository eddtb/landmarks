import Constants from 'expo-constants';

/** Same-origin in production; Metro's LAN origin in development. */
export function apiUrl(path: string): string {
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    return `http://${debuggerHost}${path}`;
  }
  return path;
}
