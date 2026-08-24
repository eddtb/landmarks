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
 *
 * The second half of the fence watches what the app DECLARES, and it has
 * to read the generated plist rather than app.json. Asserting a key is
 * absent from the source config is worth nothing here: every key that
 * reached build 11's Info.plist wrongly (#284) was absent from app.json
 * and added downstream by a plugin default. So those tests call the
 * with-honest-capabilities mod itself and check its OUTPUT.
 */
import appJson from '../../app.json';

const config = appJson.expo;

type InfoPlist = Record<string, unknown>;
type InfoPlistMod = (config: {
  modResults: InfoPlist;
  modRequest: Record<string, unknown>;
}) => Promise<{ modResults: InfoPlist }>;

const withHonestCapabilities = jest.requireActual<
  (config: Record<string, unknown>) => { mods: { ios: { infoPlist: InfoPlistMod } } }
>('../../plugins/with-honest-capabilities');

/**
 * The Info.plist of build `e6335642` — 1.1.0 (11), the binary in front of
 * App Review — reduced to the keys that matter. Anything the plugin is
 * supposed to strip is here; so is everything it must leave alone.
 */
const shippedPlist = (): InfoPlist => ({
  CFBundleShortVersionString: '1.1.0',
  ITSAppUsesNonExemptEncryption: false,
  NSLocationWhenInUseUsageDescription:
    'Venture uses your location to find the stories within a walk of you.',
  NSLocationAlwaysUsageDescription: 'Allow $(PRODUCT_NAME) to access your location',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'Allow $(PRODUCT_NAME) to access your location',
  NSMotionUsageDescription: 'Allow $(PRODUCT_NAME) to detect your current motion activity',
  NSBonjourServices: ['_expo._tcp'],
  NSLocalNetworkUsageDescription:
    'Expo Dev Launcher uses the local network to discover and connect to development servers running on your computer.',
  UIBackgroundModes: ['fetch', 'location'],
  NSSupportsLiveActivities: true,
  NSSupportsLiveActivitiesFrequentUpdates: true,
});

/** Run the plugin's own registered mod over a plist, the way prebuild does. */
const runInfoPlistMod = async (plist: InfoPlist): Promise<InfoPlist> => {
  const applied = withHonestCapabilities({ name: 'Venture', slug: 'landmarks' });
  const result = await applied.mods.ios.infoPlist({ modResults: plist, modRequest: {} });
  return result.modResults;
};

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

  test('no background modes at all — arrivals left with 1.1.0', () => {
    // Only what the app actually does — 1.0(3) was rejected under 2.5.4
    // for a background mode it never used (see with-honest-capabilities),
    // and since the arrivals removal NOTHING here runs in the background.
    // A mode reappearing means a written-back config or a new feature
    // that must argue its case here first.
    expect('UIBackgroundModes' in config.ios.infoPlist).toBe(false);
    expect('NSLocationAlwaysUsageDescription' in config.ios.infoPlist).toBe(false);
  });

  test('no duplicate Android permissions', () => {
    expect(duplicates(config.android.permissions)).toEqual([]);
  });

  test('no permission creep past what the app asks for', () => {
    // A written-back config also added FOREGROUND_SERVICE,
    // FOREGROUND_SERVICE_LOCATION and MODIFY_AUDIO_SETTINGS from plugin
    // defaults. Plugins may add them at prebuild; the committed config
    // must not claim them.
    // Foreground location only since the arrivals removal: no
    // background grant, no notifications
    expect(config.android.permissions).toEqual([
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ]);
  });

  test('with-honest-capabilities stays at the front of the plugin list', () => {
    // Config mods run in REVERSE registration order, so the plugin whose
    // job is undoing another's default has to be registered ahead of it
    expect(config.plugins[0]).toBe('./plugins/with-honest-capabilities');
  });
});

describe('the generated plist declares only what the app does', () => {
  const variant = process.env.APP_VARIANT;

  afterEach(() => {
    if (variant === undefined) {
      delete process.env.APP_VARIANT;
    } else {
      process.env.APP_VARIANT = variant;
    }
  });

  test('a release build strips every capability the app never uses', async () => {
    // Each of these reached the SUBMITTED binary. None is written in
    // app.json; each arrives as a plugin default, and a default is not an
    // option you can decline — deleting it from app.json only renames it.
    delete process.env.APP_VARIANT;
    const plist = await runInfoPlistMod(shippedPlist());

    // expo-location: iOS would offer "Always" in Settings for an app that
    // only ever asks "While Using". That is the 4.2.2 / 2.5.4 shape that
    // already cost 1.0(3).
    expect('NSLocationAlwaysUsageDescription' in plist).toBe(false);
    expect('NSLocationAlwaysAndWhenInUseUsageDescription' in plist).toBe(false);

    // NSMotionUsageDescription is the one key that must STAY: build 13
    // was rejected with ITMS-90683 for its absence, because expo-location
    // links CoreMotion and Apple requires the string whenever the symbol
    // is referenced. The honesty lives in the wording — Expo's default
    // claims the app detects motion; ours says it never asks.
    expect(plist.NSMotionUsageDescription).toContain('never asks');
    expect(plist.NSMotionUsageDescription).not.toContain('$(PRODUCT_NAME)');

    // expo-dev-client: no dev frameworks are embedded in the IPA, so this
    // is a declared and unusable capability.
    expect('NSBonjourServices' in plist).toBe(false);
    expect('NSLocalNetworkUsageDescription' in plist).toBe(false);

    // expo-task-manager and expo-widgets. Confirmed already absent from
    // build 11 — this half of the plugin works, and must keep working.
    expect('UIBackgroundModes' in plist).toBe(false);
    expect('NSSupportsLiveActivities' in plist).toBe(false);
    expect('NSSupportsLiveActivitiesFrequentUpdates' in plist).toBe(false);
  });

  test('the one permission the app does ask for survives untouched', async () => {
    // A fence that strips everything would pass the test above and ship a
    // location app that cannot locate.
    delete process.env.APP_VARIANT;
    const plist = await runInfoPlistMod(shippedPlist());

    expect(plist.NSLocationWhenInUseUsageDescription).toBe(
      'Venture uses your location to find the stories within a walk of you.'
    );
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(plist.CFBundleShortVersionString).toBe('1.1.0');
  });

  test('a development client keeps the local network it genuinely uses', async () => {
    // The dev client reaches Metro over the LAN, and iOS denies that
    // without the usage description. Upstream strips these for Release
    // only; so do we, on the same APP_VARIANT signal app.config.js uses.
    process.env.APP_VARIANT = 'development';
    const plist = await runInfoPlistMod(shippedPlist());

    expect(plist.NSBonjourServices).toEqual(['_expo._tcp']);
    expect(typeof plist.NSLocalNetworkUsageDescription).toBe('string');

    // The Always-location claim is false in every variant; the motion key
    // must exist in every variant (ITMS-90683) but always with our
    // never-asks wording, not Expo's motion-detecting default.
    expect('NSLocationAlwaysUsageDescription' in plist).toBe(false);
    expect(plist.NSMotionUsageDescription).toContain('never asks');
    expect('UIBackgroundModes' in plist).toBe(false);
  });
});
