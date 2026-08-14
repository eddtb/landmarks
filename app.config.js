const isDevelopment = process.env.APP_VARIANT === 'development';

/**
 * The widget extension and its App Group must follow the app's own
 * dev/release split. The group is a shared container keyed by
 * identifier: left on the production names, a development build would
 * read and write the release app's widget storage, and whichever
 * loaded a feed last would own the Home Screen.
 */
function withVariantWidgets(plugins) {
  if (!isDevelopment) {
    return plugins;
  }
  return plugins.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-widgets') {
      return plugin;
    }
    const [name, options] = plugin;
    return [
      name,
      {
        ...options,
        bundleIdentifier: 'com.eddtb.landmarks.dev.widgets',
        groupIdentifier: 'group.com.eddtb.landmarks.dev',
      },
    ];
  });
}

/** Keep the development client installable beside the preview/release app. */
module.exports = ({ config }) => {
  /**
   * The E2E manifest escape hatch — and only that.
   *
   * The dev client loads an app by first fetching Metro's manifest, and
   * gives that request ~10 s before it shows "There was a problem
   * loading the project". With expo-updates installed, EVERY manifest
   * request spawns `expo-updates runtimeversion:resolve`, which under
   * the fingerprint policy hashes the native project — measured at 47 s
   * cold on a warm laptop, and past the client's timeout on every one
   * of 9 launches across two nightly runs (31732640735, 31774746096:
   * NSURLError -1001 on GET /, ERR_STREAM_PREMATURE_CLOSE in
   * metro.log). The suite went red the first night main carried
   * expo-updates, and every flow died before the app's first frame.
   *
   * Under E2E_FIXTURES=1 — the hermetic-suite flag the E2E workflow
   * already sets on Metro, never set by builds, updates or the
   * preflight — the runtime version becomes a static string, so the
   * resolve answers from config instead of hashing the world. The
   * fingerprint policy in app.json is untouched for every real road;
   * src/__tests__/app-config-test.ts fences both directions.
   */
  const e2eStaticRuntime = process.env.E2E_FIXTURES === '1';

  return {
    ...config,
    name: isDevelopment ? 'Venture Dev' : config.name,
    scheme: isDevelopment ? 'landmarks-dev' : config.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopment ? 'com.eddtb.landmarks.dev' : config.ios.bundleIdentifier,
      ...(e2eStaticRuntime ? { runtimeVersion: 'e2e-fixtures-only' } : {}),
    },
    ...(e2eStaticRuntime
      ? { android: { ...config.android, runtimeVersion: 'e2e-fixtures-only' } }
      : {}),
    plugins: withVariantWidgets(config.plugins ?? []),
  };
};
