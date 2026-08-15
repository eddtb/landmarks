const { withInfoPlist } = require('expo/config-plugins');

/**
 * Declare only what the app actually does.
 *
 * Venture 1.0 (3) was rejected under guideline 2.5.4 for an `audio`
 * background mode it never used — injected by expo-audio's plugin
 * default, not written by anyone here. Several of the installed plugins
 * do the same thing:
 *
 * expo-task-manager unconditionally adds the `fetch` background mode.
 * It is installed here only as expo-location's geofencing peer; this
 * app never performs a background fetch. Since the arrivals removal it
 * needs no background mode at all.
 *
 * expo-widgets likewise sets NSSupportsLiveActivities unconditionally.
 * There is one Home Screen widget here and no Live Activity.
 *
 * expo-location registers DEFAULTS for four permission strings, and a
 * default is not an option you can decline. `@expo/config-plugins`'
 * ios/Permissions.js does
 *
 *   infoPlist[key] = permissions[key] || infoPlist[key] || description
 *
 * so deleting the option from app.json swaps your string for Expo's
 * generic one — it does not remove the key. 7ea2937 removed the Always
 * strings from app.json and they came straight back as
 * "Allow $(PRODUCT_NAME) to access your location". Build 11 — the
 * binary now in front of App Review — ships NSLocationAlwaysUsage-
 * Description, NSLocationAlwaysAndWhenInUseUsageDescription and
 * NSMotionUsageDescription for an app that asks for none of them (#284).
 *
 * expo-dev-client adds NSBonjourServices `_expo._tcp` and a
 * NSLocalNetworkUsageDescription naming "development servers running on
 * your computer". Upstream means to strip those from release builds and
 * tries to, with an Xcode build phase gated on `$CONFIGURATION`; it did
 * not fire in build 11, so a shipping binary asks for the local network
 * to find a Metro server that is not there. A development build DOES
 * use the local network, so those two follow the same APP_VARIANT split
 * app.config.js already uses for the bundle identifier — and the
 * default, with no variant set, is to strip.
 *
 * ORDERING — this plugin must stay near the FRONT of app.json's
 * plugins array, and that is not a typo. Config mods execute in
 * REVERSE registration order, so the plugin listed first runs last.
 * Measured at prebuild: registered at the end of the array, this mod
 * ran before expo-widgets' and before expo-task-manager's, and every
 * edit it made was simply overwritten afterwards. A plugin whose job
 * is to undo another's default has to be registered ahead of it.
 */

/** Modes the app genuinely uses. Anything else gets stripped. */
const UsedBackgroundModes = new Set([]);

/** Bonjour services the shipped app genuinely browses. Anything else gets stripped. */
const UsedBonjourServices = new Set([]);

/**
 * Permissions no build of this app ever requests. They arrive as
 * expo-location plugin defaults; there is no app.json option that takes
 * them away, only one that renames them.
 */
const NeverRequestedPermissions = [
  'NSLocationAlwaysUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
];

/**
 * NSMotionUsageDescription cannot be stripped, and build 13 proved it:
 * ITMS-90683 rejected the delivery because expo-location's binary links
 * CoreMotion (activity-based location this app never enables), and
 * Apple's scan requires the key whenever the SYMBOL is referenced —
 * usage is not the test. Build 11 passed only because it still carried
 * Expo's generic default, which claims the app detects motion. It does
 * not. So the key stays, and the honesty moves into the string: the app
 * never requests this permission, and the text says so.
 */
const HonestMotionDescription =
  'Venture does not read motion or fitness data and never asks for it. ' +
  'This notice is required because a location library links the Motion framework.';

/**
 * Local-network discovery is a capability a development client earns and a
 * shipped app does not. Same signal app.config.js splits the bundle
 * identifier on, so an unset variant strips — a forgotten flag can only make
 * the binary more honest, never less.
 */
const isDevelopmentVariant = () => process.env.APP_VARIANT === 'development';

/** Keep the entries the app uses; drop the key entirely when none are left. */
function keepOnlyUsed(plist, key, used) {
  if (!Array.isArray(plist[key])) {
    return;
  }
  const kept = plist[key].filter((entry) => used.has(entry));
  if (kept.length > 0) {
    plist[key] = kept;
  } else {
    delete plist[key];
  }
}

module.exports = function withHonestCapabilities(config) {
  return withInfoPlist(config, (modConfig) => {
    const plist = modConfig.modResults;

    keepOnlyUsed(plist, 'UIBackgroundModes', UsedBackgroundModes);

    // No Live Activity in this app — a declared-but-absent capability
    // is the same shape of claim as the background mode above.
    delete plist.NSSupportsLiveActivities;
    delete plist.NSSupportsLiveActivitiesFrequentUpdates;

    // iOS offers the user whatever the plist declares. Leaving these in
    // puts an "Always" option in Settings for an app that only ever asks
    // "While Using", in a binary whose listing says it does neither.
    for (const permission of NeverRequestedPermissions) {
      delete plist[permission];
    }

    plist.NSMotionUsageDescription = HonestMotionDescription;

    if (!isDevelopmentVariant()) {
      keepOnlyUsed(plist, 'NSBonjourServices', UsedBonjourServices);
      delete plist.NSLocalNetworkUsageDescription;
    }

    return modConfig;
  });
};
