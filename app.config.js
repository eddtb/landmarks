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
module.exports = ({ config }) => ({
  ...config,
  name: isDevelopment ? 'Venture Dev' : config.name,
  scheme: isDevelopment ? 'landmarks-dev' : config.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: isDevelopment ? 'com.eddtb.landmarks.dev' : config.ios.bundleIdentifier,
  },
  plugins: withVariantWidgets(config.plugins ?? []),
});
