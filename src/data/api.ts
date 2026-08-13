import Constants from 'expo-constants';

/**
 * Resolve API routes in every runtime:
 * - an explicit hosted origin for standalone native builds;
 * - Metro's LAN origin for development clients;
 * - same-origin paths for the hosted web application.
 */
export function apiUrl(path: string): string {
  const hostedOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.replace(/\/+$/, '');
  if (hostedOrigin) {
    return `${hostedOrigin}${path}`;
  }
  const debuggerHost = Constants.expoConfig?.hostUri;
  if (debuggerHost) {
    return `http://${debuggerHost}${path}`;
  }
  return path;
}
