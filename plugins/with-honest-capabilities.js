const { withInfoPlist } = require('expo/config-plugins');

/**
 * Declare only what the app actually does.
 *
 * Venture 1.0 (3) was rejected under guideline 2.5.4 for an `audio`
 * background mode it never used — injected by expo-audio's plugin
 * default, not written by anyone here. Two of the plugins added for
 * arrivals and the widget do the same thing:
 *
 * expo-task-manager unconditionally adds the `fetch` background mode.
 * It is installed here only as expo-location's geofencing peer; this
 * app never performs a background fetch. The one mode it genuinely
 * needs, `location`, is declared in app.json.
 *
 * expo-widgets likewise sets NSSupportsLiveActivities unconditionally.
 * There is one Home Screen widget here and no Live Activity.
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
const UsedBackgroundModes = new Set(['location']);

module.exports = function withHonestCapabilities(config) {
  return withInfoPlist(config, (modConfig) => {
    const plist = modConfig.modResults;

    if (Array.isArray(plist.UIBackgroundModes)) {
      const kept = plist.UIBackgroundModes.filter((mode) => UsedBackgroundModes.has(mode));
      if (kept.length > 0) {
        plist.UIBackgroundModes = kept;
      } else {
        delete plist.UIBackgroundModes;
      }
    }

    // No Live Activity in this app — a declared-but-absent capability
    // is the same shape of claim as the background mode above.
    delete plist.NSSupportsLiveActivities;
    delete plist.NSSupportsLiveActivitiesFrequentUpdates;

    return modConfig;
  });
};
