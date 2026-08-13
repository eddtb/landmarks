import { Image } from 'expo-image';
import { ReactNode, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { router } from 'expo-router';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { GlassIslandHeader, useIslandInset } from '@/components/glass-header';
import { HistoryCard } from '@/components/history-card';
import { failureCause, LoadFailure } from '@/components/load-failure';
import { LocationInvitation, OpenSettings } from '@/components/location-ask';
import { PlaceSearch } from '@/components/place-search';
import { StoriesMap } from '@/components/stories-map';
import { useOneDoorDismissed } from '@/components/one-door';
import { OverflowMenu } from '@/components/overflow-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DrawingWanderLine, WanderLine } from '@/components/wander-line';
import { BrandWarmInk, Spacing } from '@/constants/theme';
import { useAreaName } from '@/hooks/use-area-name';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHistory } from '@/hooks/use-history';
import { useLocation } from '@/hooks/use-location';
import { useAreaWidget } from '@/hooks/use-area-widget';
import { setPin, usePin } from '@/hooks/use-pin';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { featuredStories } from '@/utils/featured';
import { formatWalkTimeForMeters } from '@/utils/format';
import { Coordinates, distanceMeters } from '@/utils/geo';

const PrivacyUrl = 'https://eddtb-landmarks.expo.app/privacy';
const SupportUrl = 'https://eddtb-landmarks.expo.app/support';

/**
 * Two different facts about the world, and they have different
 * remedies — the split #290 turns on. `denied = status === 'denied' ||
 * status === 'priming'` collapsed them into one boolean, and every
 * false sentence in this flow came out of that line: never-asked was
 * told location was "off" and sent to a Settings page that has no
 * Location row until an app has asked once.
 */
export type LocationStanding =
  /** A real fix, or a place the reader deliberately pinned. */
  | 'located'
  /** Venture has never asked — iOS will still show its own prompt. */
  | 'unasked'
  /** Asked and refused — only Settings can undo it. */
  | 'refused';

/** The banner over Nearby's no-location state, and only for 'refused':
 *  never-asked has nothing to turn back on.
 *
 *  History had one of these too, in the standing header direction B
 *  removed. It is not lost copy: refused with no pin sends the tab to
 *  `HistoryInvitation.refused`, which says the same thing at more
 *  length and offers the way out — and refused WITH a pin is exploring,
 *  which was never told about Settings anyway. */
const NearbyRefusedCopy =
  'Location is off for Venture. Turn it back on in Settings and this fills with the ground you’re standing on.';

/** What each tab shows instead of a feed it cannot honestly compose. */
const NearbyInvitation = {
  unasked: {
    heading: 'Venture hasn’t asked where you are yet',
    lede: 'The stories on this screen are picked by the ground under your feet. Tap below and iOS will ask you — you can still say no.',
  },
  refused: {
    heading: 'Or read a place you name',
    lede: 'Venture tells you what happened anywhere it can find on a map.',
  },
} as const;

const HistoryInvitation = {
  unasked: {
    heading: 'Venture hasn’t asked where you are yet',
    lede: 'The Gazetteer is written about the ground under your feet. Tap below and iOS will ask you — you can still say no.',
  },
  refused: {
    heading: 'The Gazetteer is written about a place',
    lede: 'Name one and Venture writes it — the area’s own story, with the relics of its ground beneath.',
  },
} as const;

/** 'located' can only reach an invitation through a bug; it reads as
 *  refused there, which promises nothing that isn't on the screen. */
function invitationCopy(
  copy: typeof NearbyInvitation | typeof HistoryInvitation,
  standing: LocationStanding
) {
  return standing === 'unasked' ? copy.unasked : copy.refused;
}

/** One identity for "no feed yet", so a loading render can't re-fire
 * the widget effect with a fresh [] on every tick. */
const NoItems: HistoryItem[] = [];

/**
 * Nearby = things you can visit AND recognise: a subject photo and no
 * structured evidence of pastness. The past and the unphotographed
 * live in the Gazetteer next door.
 *
 * Exported and shared rather than inlined twice: the count line and
 * the Home Screen widget both print this number, and a widget that
 * disagreed with the screen behind it would be worse than no widget.
 */
export function walkableStories(items: HistoryItem[]): HistoryItem[] {
  return items.filter(
    (item) => item.thumbnailUrl && !item.pastTag && !item.event && !item.area
  );
}

/** Pure and unit-tested: the story you are physically standing on. */
export function standingOn(
  items: HistoryItem[],
  center: Coordinates,
  maxMeters = 45
): HistoryItem | null {
  let best: HistoryItem | null = null;
  let bestDistance = maxMeters;
  for (const item of items) {
    // Live position vs compose-time distances: recompute, always
    const meters = distanceMeters(center, item.coordinates);
    if (meters <= bestDistance) {
      bestDistance = meters;
      best = item;
    }
  }
  return best;
}

/**
 * The Storyteller's home: location gating, the NEARBY header with the
 * locator dot, and the stories of where you stand.
 */

/** The two long cold loads (approved mock 2): the wander line draws
 * itself — the walked part solid, the path ahead faint — instead of an
 * anonymous spinner. Every short wait elsewhere keeps the spinner. */
function ColdLoad({ areaLabel }: { areaLabel: string | null }) {
  const theme = useTheme();
  return (
    <View style={styles.centered} testID="cold-load">
      <DrawingWanderLine arcSpan={64} stroke={7} count={4} color={theme.accent} />
      <ThemedText type="small" themeColor="textSecondary">
        {areaLabel ? `Finding the stories of ${areaLabel}…` : 'Finding the stories near you…'}
      </ThemedText>
    </View>
  );
}

export function LocationGate({ children }: { children: (props: GateProps) => ReactNode }) {
  const { status, coordinates } = useLocation();
  const dismissed = useOneDoorDismissed();
  // ONE pin app-wide (see use-pin): both tabs' gates read the same
  // store, so pinning on Nearby pins History too, and either tab's
  // "Back to near me" releases both. The pin remembers how it was
  // dropped: blind (no fix at the time — an emergency hatch) or
  // sighted (deliberate exploring with GPS live).
  const pin = usePin();

  const onManualCenter = useCallback(
    (center: Coordinates, label?: string) => setPin({ center, blind: !coordinates, label }),
    [coordinates]
  );
  const onBackToNearMe = useCallback(() => setPin(null), []);

  // Location-first: a blind pin only holds while GPS is silent — the
  // moment a real fix exists it lets go, derived, no effect needed
  // (coordinates never return to null once set). A sighted pin
  // outlasts movement — only "Back to near me" clears it.
  const activePin = pin && pin.blind && coordinates ? null : pin;

  // Permission undetermined and "Not now" not on record: the ROOT
  // OneDoorGate owns this state and covers everything, tab pill
  // included — beneath it this gate just holds a quiet loading. Once
  // the flag says dismissed, undetermined falls through to the
  // never-asked invitation below instead.
  //
  // 'loading' holds here too: until the permission read lands the app
  // does not know WHICH state this is, and it used to answer that by
  // handing the feed central London. A brief hold is the honest
  // answer to "we don't know yet" — and it ends, because the read does.
  if (status === 'loading' || (status === 'priming' && dismissed !== true)) {
    return (
      // Named so a test can ask for it. It was asserted only by the
      // absence of everything else, which a blank screen satisfies too.
      <ThemedView style={styles.centered} testID="gate-waiting">
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (status === 'locating') {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Finding places near you…
        </ThemedText>
      </ThemedView>
    );
  }

  // Past the door, 'priming' means the user chose "Not now" — never
  // asked, and iOS will still prompt. 'denied' is the other fact
  // entirely. A pin is a place the reader chose, so it stands as a
  // centre whichever of the two holds behind it.
  const standing: LocationStanding =
    status === 'denied' ? 'refused' : status === 'priming' ? 'unasked' : 'located';
  // Null, never the fallback: a centre nobody downstream can mistake
  // for a position. Charing Cross used to flow from here into walk
  // times, the map, the area name and the locator dot (#289) — the
  // type now forbids it.
  const center = activePin?.center ?? coordinates ?? null;

  return children({
    center,
    standing,
    exploring: activePin !== null,
    onManualCenter,
    onBackToNearMe,
  });
}

export type GateProps = {
  /** Null when Venture has no honest centre — no fix and no pin. */
  center: Coordinates | null;
  /** Never-asked and refused are different facts with different
   *  remedies; nothing below may collapse them again. */
  standing: LocationStanding;
  /** A manual pin holds the center — the header must admit it. */
  exploring: boolean;
  /** `label`: the searched place name, riding the pin so the area-name
   * cascade can try the user's own word for the place first. */
  onManualCenter: (center: Coordinates, label?: string) => void;
  onBackToNearMe: () => void;
};

/** The eyebrow over the area name with the locator dot. When a manual
 * pin holds the center, the header owns the mode (the approved
 * "Exploring header"): accent eyebrow, hollow dot — you are not
 * there — and one worded way home. */
function SectionHeader({
  center,
  standing,
  exploring,
  onManualCenter,
  onBackToNearMe,
  eyebrow,
  refusedCopy,
  overflow,
}: GateProps & {
  eyebrow: string;
  /** This tab's one sentence for the refused state. */
  refusedCopy: string;
  overflow?: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  // The cascade winner, as the user would say it — "Crystal Palace",
  // never the borough "Bromley" nor the ward "Dorking North". With no
  // centre it resolves nothing and spends nothing.
  const { label: areaLabel } = useAreaName(center);
  const theme = useTheme();

  const title = areaLabel ?? 'Near you';
  // The dot means "you are here". It only fills where the app knows:
  // hollow while exploring (you are not there) and hollow with no
  // centre at all — a solid dot over a resolved London name told a
  // reader in Cupertino they were standing in Charing Cross (#289).
  const hollowDot = exploring || center === null;
  // With no centre the invitation below owns the search, so the title
  // is a name and nothing more — two fields on one screen is worse
  // than none.
  const titleGroup = (
    <>
      <View
        testID="locator-dot"
        style={[
          styles.locatorDot,
          hollowDot
            ? {
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderColor: theme.textSecondary,
              }
            : { backgroundColor: theme.accent },
        ]}
      />
      <ThemedText type="largeTitle">{title}</ThemedText>
    </>
  );

  return (
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor={exploring ? 'accent' : 'textSecondary'}>
        {exploring ? 'Exploring' : eyebrow}
      </ThemedText>
      <View style={styles.titleRow}>
        {/* The title is the search affordance: tap to pin anywhere, deliberately */}
        {center === null ? (
          <View style={styles.titleGroup}>{titleGroup}</View>
        ) : (
          <Pressable
            testID="area-title"
            accessibilityRole="button"
            accessibilityLabel={`Area: ${title}`}
            accessibilityHint="Search near another place"
            onPress={() => setSearchOpen((open) => !open)}
            style={styles.titleGroup}>
            {titleGroup}
          </Pressable>
        )}
        {/* Housekeeping lives behind the ⋯, not in the feed: Privacy
            must stay reachable in-app (Apple 5.1.1(i)), but it was
            never a story and had no business between the count line
            and the first card. Support rides along for one row. */}
        {overflow && (
          <OverflowMenu
            actions={[
              { id: 'privacy', title: 'Privacy Policy' },
              { id: 'support', title: 'Support' },
            ]}
            onAction={(id) => {
              Linking.openURL(id === 'privacy' ? PrivacyUrl : SupportUrl);
            }}
          />
        )}
      </View>
      {exploring && (
        <Pressable accessibilityRole="button" onPress={onBackToNearMe} hitSlop={Spacing.two}>
          <ThemedText type="linkPrimary">Back to near me</ThemedText>
        </Pressable>
      )}
      {/* Only the refused state is sent to Settings, and only it is
          told anything is off. Never-asked is answered in the body,
          where iOS can still be asked. */}
      {!exploring && standing === 'refused' && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {refusedCopy}
          </ThemedText>
          <View style={styles.settingsRow}>
            <OpenSettings />
          </View>
        </>
      )}
      {center !== null && searchOpen && (
        <PlaceSearch
          onManualCenter={onManualCenter}
          autoFocus
          onFound={() => setSearchOpen(false)}
        />
      )}
    </View>
  );
}

export function StoriesScreen() {
  // The glass island (Edd, 2026-08-06): the header AND the count line
  // float together in glass — the pinned-count redline survives,
  // modernised — and the whole feed scrolls beneath them.
  const [islandHeight, setIslandHeight] = useState(120);
  // ONE origin (#300). The island used to sit inside a SafeAreaView and
  // be handed only its own height, while Saved added `insets.top`
  // itself and the Gazetteer passed `topOffset={0}` — three spellings
  // of one measurement, and moving the geometry drifted two of them.
  const topInset = useIslandInset(islandHeight);
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          {/* The body keeps the horizontal edges — the TOP one is the
              island's business now, and paid once by useIslandInset. */}
          <SafeAreaView style={styles.container} edges={['left', 'right']}>
            <HistoryBody
              center={gate.center}
              exploring={gate.exploring}
              standing={gate.standing}
              onManualCenter={gate.onManualCenter}
              topInset={topInset}
            />
          </SafeAreaView>
          {/* After the body so it paints above; the feed slides under.
              A DIRECT child of the screen surface — never inside a
              SafeAreaView, which is the arrangement useIslandInset
              assumes and the island's own default `top` matches. */}
          <GlassIslandHeader onHeight={setIslandHeight}>
            <SectionHeader {...gate} eyebrow="Nearby" refusedCopy={NearbyRefusedCopy} overflow />
            <FeedCountLine center={gate.center} />
          </GlassIslandHeader>
        </ThemedView>
      )}
    </LocationGate>
  );
}

/**
 * The count line, now living in the island's lower deck. Its own
 * useHistory subscription — the hook shares state per center, so this
 * costs a lookup, not a second fetch. Exported for its tests: the
 * copy's honesty rules (sparse mode, the derived horizon) are fenced
 * there.
 */
export function FeedCountLine({ center }: { center: Coordinates | null }) {
  const { state } = useHistory(center);
  // No centre, no count: there is nothing to have counted
  if (center === null || state.status !== 'ready') {
    return null;
  }
  const items = walkableStories(state.items);
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={styles.countLine}>
      <ThemedText type="small" themeColor="textSecondary">
        {/* Honest in quiet corners: the server widened its search
            (sparse-area mode) and the count line says so — with a
            walk time derived from the horizon the server actually
            searched, so a radius change can't make this copy lie */}
        {state.sparse
          ? `${items.length} ${items.length === 1 ? 'story' : 'stories'} — a quieter corner, so we looked further (up to ~${formatWalkTimeForMeters(state.horizon ?? LegacySparseHorizonMeters)})`
          : `${items.length} ${items.length === 1 ? 'story' : 'stories'} within a walk`}
      </ThemedText>
    </View>
  );
}

/**
 * The Gazetteer (Edd's pick): the place's own illustrated story with
 * the relics of its ground beneath.
 *
 * Direction B (#300): the hero IS the header, so the tab wears no
 * chrome at all until the hero's title has cleared the top edge — and
 * then the story screen's own one-row island arrives, minus the
 * chevron the tab pill makes unnecessary. The standing `SectionHeader`
 * that used to sit above the hero is gone with it: one title, once.
 *
 * #292's rule survives the removal rather than being reverted — a
 * LOCATED reader must never get a screen that fails to say where they
 * are. With an article the hero says it; with none, the gazetteer now
 * renders the same title block on the page (see `RecordTitle`), which
 * is the thing the island later arrives to carry.
 */
export function HistoryArchiveScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          {/* No top edge: the gazetteer runs full-bleed to the true
              screen top and pays the notch itself, hero and island
              alike. The states that are NOT the gazetteer take the
              inset back, below. */}
          <SafeAreaView style={styles.container} edges={['left', 'right']}>
            <GazetteerBody
              center={gate.center}
              standing={gate.standing}
              onManualCenter={gate.onManualCenter}
              exploring={gate.exploring}
              onBackToNearMe={gate.onBackToNearMe}
            />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

/** A tab state that is not the full-bleed gazetteer is an ordinary
 *  screen, and sits below the notch like one. */
function BelowTheNotch({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}

function GazetteerBody({
  center,
  standing,
  onManualCenter,
  exploring,
  onBackToNearMe,
}: {
  center: Coordinates | null;
  standing: LocationStanding;
  onManualCenter: (center: Coordinates, label?: string) => void;
  /** A held pin is a mode the screen must admit — and with the standing
   *  header gone the admission rides in the flow, under the hero, where
   *  Nearby's offline line already lives. */
  exploring?: boolean;
  onBackToNearMe?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { state, refresh } = useHistory(center);
  const { name: areaName, label: areaLabel, settled: areaSettled } = useAreaName(center);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // A gazetteer is written ABOUT a place. With no centre there is no
  // place, so the tab says what it needs instead of retelling the
  // history of somewhere the reader has never been — and nothing was
  // fetched to find that out.
  if (center === null) {
    const copy = invitationCopy(HistoryInvitation, standing);
    return (
      <BelowTheNotch>
        <View style={styles.invitation}>
          <LocationInvitation
            askable={standing === 'unasked'}
            heading={copy.heading}
            lede={copy.lede}
            onManualCenter={onManualCenter}
          />
        </View>
      </BelowTheNotch>
    );
  }

  if (state.status === 'loading') {
    return (
      <BelowTheNotch>
        <ColdLoad areaLabel={areaLabel} />
      </BelowTheNotch>
    );
  }
  if (state.status === 'error') {
    return (
      <BelowTheNotch>
        <View style={styles.failure}>
          <LoadFailure surface="feed" cause={failureCause(state.verdict)} onRetry={refresh} />
        </View>
      </BelowTheNotch>
    );
  }

  const relics = state.items.filter(
    (item) => !item.thumbnailUrl || item.pastTag || item.event || item.area
  );
  return (
    <AreaGazetteer
      areaName={areaName}
      areaLabel={areaLabel}
      areaSettled={areaSettled}
      relics={relics}
      allStories={state.items}
      refreshing={refreshing}
      onRefresh={onRefresh}
      lead={
        // The mode admission, in the flow rather than in chrome that no
        // longer stands at rest — the slot Nearby's offline line uses.
        exploring ? (
          <View style={styles.gazetteerLead} testID="gazetteer-exploring">
            <ThemedText type="eyebrow" themeColor="accent">
              Exploring
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={onBackToNearMe} hitSlop={Spacing.two}>
              <ThemedText type="linkPrimary">Back to near me</ThemedText>
            </Pressable>
          </View>
        ) : undefined
      }
      // The flag was on the hook all along and only Nearby read it: the
      // History tab served cached stories offline with no admission at
      // all (#248). It travels as a FACT rather than as an element,
      // because the same flag also decides the article's verdict —
      // offline outranks absence and failure both, and a line rendered
      // here while the verdict was decided there is exactly the split
      // that let #291 happen.
      stale={state.stale}
      savedAt={state.savedAt}
    />
  );
}

/** The magic moment: a story within arm's reach leads the screen —
 * and the single surface that earns the warm accent (approved mock 3).
 * Purple is the app's voice; yellow is its rarity marker. Same shape,
 * same copy — only the border, eyebrow and ground go warm. */
export function StandingOnIt({ item, center }: { item: HistoryItem; center: Coordinates }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const meters = Math.round(distanceMeters(center, item.coordinates));
  // The mock's --warm-ink: in dark the eyebrow IS the warm accent; in
  // light it wears the warm's dark ink — accentWarm on warmSoft is
  // yellow-on-yellow there and can't be read
  const eyebrowColor = scheme === 'dark' ? theme.accentWarm : BrandWarmInk;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/history/[pageId]', params: { pageId: String(item.pageId) } })
      }
      style={({ pressed }) => [
        styles.standing,
        { backgroundColor: theme.warmSoft, borderColor: theme.accentWarm },
        pressed && { opacity: 0.9 },
      ]}>
      <ThemedText type="eyebrow" style={{ color: eyebrowColor }}>
        You&apos;re standing on it
      </ThemedText>
      <ThemedText type="headline">{item.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {meters <= 15 ? 'right here' : `${meters} m from you`} · {item.source}
      </ThemedText>
    </Pressable>
  );
}

/** Mini featured listings up top (Edd's call): the fun-facts FORMAT,
 * but the content is places — the area's heavy hitters, tappable. */
export function FeaturedRail({
  items,
  excludePageId,
}: {
  items: HistoryItem[];
  excludePageId?: number;
}) {
  const theme = useTheme();
  const featured = featuredStories(items, excludePageId);

  if (featured.length < 2) {
    return null;
  }
  return (
    <View style={styles.featured}>
      <ThemedText type="eyebrow" themeColor="accent" style={styles.featuredEyebrow}>
        Featured
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.featuredContent}>
        {featured.map((item) => (
          <Pressable
            key={item.pageId}
            accessibilityRole="button"
            accessibilityLabel={`Featured: ${item.title}`}
            onPress={() =>
              router.push({
                pathname: '/history/[pageId]',
                params: { pageId: String(item.pageId) },
              })
            }
            style={({ pressed }) => [
              styles.featuredCard,
              { backgroundColor: theme.accentSoft },
              pressed && { opacity: 0.85 },
            ]}>
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.featuredImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            {/* Fixed 148pt cards: both lines capped so accessibility
                sizes can't burst the rail (smallBold caps by default;
                the meta line is `small`, unlimited elsewhere) */}
            <ThemedText type="smallBold" style={styles.featuredTitle} numberOfLines={2}>
              {item.title}
            </ThemedText>
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              style={styles.featuredMeta}
              maxFontSizeMultiplier={1.4}>
              {formatWalkTimeForMeters(item.distanceMeters)}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// A sparse feed persisted before the horizon rode along (an additive,
// optional field — no storage-key bump) lacks the number. Every such
// entry in the wild was composed at the server's 3000m sparse radius,
// so this fallback phrases exactly the truth those feeds were built
// on; entries minted from now on carry their own horizon.
const LegacySparseHorizonMeters = 3000;

export function HistoryBody({
  center,
  exploring,
  standing = 'located',
  onManualCenter,
  topInset = 0,
}: {
  /** Null when there is no honest centre — the feed stands down. */
  center: Coordinates | null;
  exploring?: boolean;
  /** Which no-location fact holds, and so which remedy is offered. */
  standing?: LocationStanding;
  onManualCenter: (center: Coordinates, label?: string) => void;
  /** Height of the floating glass island above — the scroll content
   *  starts below it and slides beneath it. */
  topInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const { state, refresh } = useHistory(center);
  // The widget and the cold-load copy both SHOW this name, so both take
  // the spoken form: "Crystal Palace", not "Crystal Palace, London"
  const { label: areaLabel } = useAreaName(center);

  // The Home Screen widget rides the feed:
  // nothing leaves the device and nothing runs in the background.
  // Only once the feed is READY — an empty list mid-load would tell
  // the widget there is no history here, which is its own untruth.
  const widgetStories = useMemo(
    () => (state.status === 'ready' ? walkableStories(state.items) : NoItems),
    [state]
  );
  useAreaWidget(
    widgetStories,
    areaLabel,
    state.status === 'ready' && !exploring && center !== null
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // The feed's whole job is the ground under the reader's feet. With
  // no centre it has no ground, so it stands down and becomes the
  // invitation (#289) — rather than sorting central London's stories
  // and printing "2 min walk" on each of them from Cupertino. Nothing
  // was fetched for it either: useHistory never asked.
  if (center === null) {
    const copy = invitationCopy(NearbyInvitation, standing);
    return (
      <View style={[styles.invitation, { paddingTop: topInset }]}>
        <LocationInvitation
          askable={standing === 'unasked'}
          heading={copy.heading}
          lede={copy.lede}
          onManualCenter={onManualCenter}
        />
      </View>
    );
  }

  if (state.status === 'loading') {
    return (
      <View style={[styles.container, { paddingTop: topInset }]}>
        <ColdLoad areaLabel={areaLabel} />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.failure, { paddingTop: topInset }]}>
        <LoadFailure surface="feed" cause={failureCause(state.verdict)} onRetry={refresh} />
      </View>
    );
  }

  const items = walkableStories(state.items);

  // No standing-on unless the center is a real GPS fix: while
  // exploring the pinned center is somewhere the user is NOT — "right
  // here" about a place you are not standing lies (#208). With no
  // centre at all the feed never gets this far.
  const underfoot =
    state.status === 'ready' && !exploring
      ? standingOn(state.items.filter((item) => !item.area), center)
      : null;

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.pageId)}
        renderItem={({ item }) => <HistoryCard item={item} />}
        // Featured scrolls away with the listings (Edd's call) — it's
        // the list's header, not the screen's. The negative margin
        // cancels the list padding so the rail bleeds edge to edge.
        // The map leads it, on the same terms: visible without a scroll
        // or a tap (App Review saw none of the native surfaces), and it
        // scrolls away when you have chosen where to walk.
        // The standing banner and the offline line lead the list now —
        // the count moved up into the glass island (FeedCountLine), and
        // everything else scrolls beneath it.
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {underfoot && <StandingOnIt item={underfoot} center={center} />}
            {state.stale && (
              <View style={styles.controlLine}>
                <ThemedText type="small" themeColor="textSecondary">
                  Showing saved stories — you&apos;re offline
                </ThemedText>
              </View>
            )}
            {/* The map draws a centre the screen believes in — a real
                fix or a place the reader pinned. It used to be fenced
                off the fallback by hand (simulator-caught); the
                fallback is gone, so the fence went with it. */}
            <View style={styles.mapCard}>
              <StoriesMap items={items} center={center} />
            </View>
            <FeaturedRail items={state.items} excludePageId={underfoot?.pageId} />
          </View>
        }
        // The deep feed can run to ~150 stories — render the first
        // screenful fast and let virtualisation handle the rest
        initialNumToRender={8}
        contentContainerStyle={[
          styles.list,
          // Below the island, clear of the tab bar
          { paddingTop: topInset, paddingBottom: Spacing.four + insets.bottom },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          // Mock 1: the drawing agrees with the words — a quiet accent
          // wander line above the invitation. Static; an empty state
          // shouldn't fidget.
          <View style={styles.empty}>
            <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
              No recorded history right here — wander a little.
            </ThemedText>
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  // The panel carries its own surface and margins; the screen only
  // decides where down the page it starts
  failure: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  locatorDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  listHeader: {
    // Cancel the list's horizontal padding: the rail manages its own
    // insets and must scroll edge to edge
    marginHorizontal: -Spacing.four,
    marginBottom: Spacing.one,
  },
  mapCard: {
    // The header cancels the list padding so the rail can bleed; the
    // map is a card rather than a rail, so it takes that padding back
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  standing: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three - 2,
    borderWidth: 1.5,
    gap: 2,
  },
  featured: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  featuredEyebrow: {
    paddingHorizontal: Spacing.four,
  },
  featuredContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  featuredCard: {
    width: 148,
    borderRadius: Spacing.three - 2,
    padding: Spacing.one,
    gap: 2,
  },
  featuredImage: {
    width: '100%',
    height: 82,
    borderRadius: Spacing.three - 4,
  },
  // smallBold's 14 replaces a bespoke 13 — the ramp has no 13
  featuredTitle: {
    paddingHorizontal: 2,
  },
  featuredMeta: {
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  // The seam the list scrolls under. The count is pinned while cards
  // pass beneath it, so with no edge a card's text is sliced
  // mid-sentence and reads as a collision. The rule belongs HERE, not
  // on the header block above: the count line is a pinned sibling of
  // the list, and a border on the header lands one element too early
  // (caught in a screenshot, after the first attempt shipped).
  // No bottom border since the move into the island (Edd's screenshot,
  // 21:02): the card's own edge separates; the orphaned hairline read
  // as a stray rule under the count
  countLine: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  controlLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  empty: {
    alignItems: 'center',
    paddingTop: Spacing.six,
    gap: Spacing.three,
  },
  emptyCopy: {
    textAlign: 'center',
  },
  // The Settings chip is a 44pt object in a stack of text lines: its
  // own row, so nothing sits inside its target
  settingsRow: {
    flexDirection: 'row',
    paddingTop: Spacing.one,
  },
  gazetteerLead: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.half,
  },
  invitation: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: Spacing.six,
  },
});
