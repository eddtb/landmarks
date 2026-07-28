const { withXcodeProject } = require('expo/config-plugins');

/**
 * Keep the widget extension's version identical to the app's.
 *
 * Caught by the first simulator build, which warned:
 *
 *   The CFBundleShortVersionString of an app extension ('1.0') must
 *   match that of its containing parent app ('1.0.0').
 *
 * It is not cosmetic. App Store Connect rejects an upload whose
 * extension version disagrees with its parent, so this would have
 * failed validation before a reviewer ever opened the build — a
 * particularly expensive way to learn it, mid-appeal.
 *
 * The cause is that expo-widgets' generated target sets
 * GENERATE_INFOPLIST_FILE = YES with MARKETING_VERSION = 1.0, and
 * Xcode's synthesized value wins over the correct 1.0.0 sitting in
 * the target's own Info.plist. So the fix belongs in the build
 * settings, not the plist.
 *
 * Targets are matched on INFOPLIST_FILE rather than bundle identifier
 * because the identifier changes with the dev/release variant.
 */
const WidgetTargetMarker = 'ExpoWidgetsTarget';

module.exports = function withWidgetVersionMatch(config) {
  return withXcodeProject(config, (modConfig) => {
    const version = modConfig.version ?? '1.0.0';
    const buildNumber = modConfig.ios?.buildNumber ?? '1';
    const configurations = modConfig.modResults.pbxXCBuildConfigurationSection();

    let matched = 0;
    for (const key of Object.keys(configurations)) {
      const settings = configurations[key]?.buildSettings;
      const infoPlist = settings?.INFOPLIST_FILE;
      if (typeof infoPlist !== 'string' || !infoPlist.includes(WidgetTargetMarker)) {
        continue;
      }
      settings.MARKETING_VERSION = version;
      settings.CURRENT_PROJECT_VERSION = buildNumber;
      matched += 1;
    }

    // Silence here would mean the extension quietly kept its own
    // version again, and the next upload would fail the same way.
    if (matched === 0) {
      throw new Error(
        `[with-widget-version-match] no ${WidgetTargetMarker} build configurations found — ` +
          'the widget plugin may have changed its target name, and the extension version is ' +
          'no longer being matched to the app.'
      );
    }

    return modConfig;
  });
};
