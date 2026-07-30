/**
 * app.json is load-bearing for OTA delivery, and tooling writes to it.
 *
 * `eas update` auto-configures any platform missing a runtimeVersion
 * policy — and when it writes the file back it serialises the config
 * AFTER the config plugins have run, so expo-location's permissions and
 * the location background mode come back duplicated. That silently
 * changes the native fingerprint, which silently changes the runtime
 * version an update is published against, which means the update is
 * offered to no build that exists. Nothing fails; the phone simply never
 * receives it.
 *
 * That happened. This file is the fence: both policies stay explicit so
 * `eas update` has nothing to configure, and the duplication that marks
 * a written-back config fails CI instead of shipping.
 */
import appJson from '../../app.json';

const config = appJson.expo;

const duplicates = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => (seen.has(value) ? true : (seen.add(value), false)));
};

describe('app.json survives the tooling', () => {
  test('BOTH platforms declare a runtimeVersion policy explicitly', () => {
    // A missing policy is the trigger: eas update writes one in, and
    // takes the rest of the file with it
    expect(config.ios.runtimeVersion?.policy).toBe('fingerprint');
    expect(config.android.runtimeVersion?.policy).toBe('fingerprint');
  });

  test('the fingerprint policy is what makes an OTA safe — never loosen it', () => {
    // A native change must stop being OFFERED to old binaries rather
    // than crash on them. appVersion or a literal string would hand a
    // native-incompatible update to a phone that cannot run it.
    for (const platform of [config.ios, config.android]) {
      expect(platform.runtimeVersion?.policy).toBe('fingerprint');
    }
  });

  test('no duplicate iOS background modes', () => {
    const modes = config.ios.infoPlist.UIBackgroundModes;
    expect(duplicates(modes)).toEqual([]);
    // Only what the app actually does — 1.0(3) was rejected under 2.5.4
    // for a background mode it never used (see with-honest-capabilities)
    expect(modes).toEqual(['location']);
  });

  test('no duplicate Android permissions', () => {
    expect(duplicates(config.android.permissions)).toEqual([]);
  });

  test('no permission creep past what the app asks for', () => {
    // A written-back config also added FOREGROUND_SERVICE,
    // FOREGROUND_SERVICE_LOCATION and MODIFY_AUDIO_SETTINGS from plugin
    // defaults. Plugins may add them at prebuild; the committed config
    // must not claim them.
    expect(config.android.permissions).toEqual([
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
    ]);
  });

  test('with-honest-capabilities stays at the front of the plugin list', () => {
    // Config mods run in REVERSE registration order, so the plugin whose
    // job is undoing another's default has to be registered ahead of it
    expect(config.plugins[0]).toBe('./plugins/with-honest-capabilities');
  });
});
