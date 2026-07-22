const isDevelopment = process.env.APP_VARIANT === 'development';

/** Keep the development client installable beside the preview/release app. */
module.exports = ({ config }) => ({
  ...config,
  name: isDevelopment ? 'Venture Dev' : config.name,
  scheme: isDevelopment ? 'landmarks-dev' : config.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: isDevelopment ? 'com.eddtb.landmarks.dev' : config.ios.bundleIdentifier,
  },
});
