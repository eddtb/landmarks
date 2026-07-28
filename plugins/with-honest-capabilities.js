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
 * Scope note — this deliberately does NOT touch
 * NSSupportsLiveActivities, which expo-widgets sets unconditionally
 * and which is likewise unused. Mod ordering here is not the array
 * order: measured at prebuild, this mod runs BEFORE expo-widgets'
 * (which sees an Info.plist without the key at all), so deleting it
 * from here is a line that silently does nothing. It is also a
 * capability declaration rather than a background mode, so it is not
 * the 2.5.4 shape. Left alone knowingly, not overlooked.
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

    return modConfig;
  });
};
