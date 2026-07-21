import AsyncStorage from '@react-native-async-storage/async-storage';
import { PropsWithChildren, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const ONBOARDING_SEEN_KEY = 'onboarding-seen-v1';

const PAGES = [
  {
    title: 'Stories where you stand',
    body:
      'Venture finds the history within a walk of you — palaces, ships, plaques, vanished ' +
      'things. Every place shows a photo of the thing itself, so you know what ' +
      "you're looking for.",
  },
  {
    title: 'The story of the area',
    body:
      'The History tab retells your whole area as one illustrated long read. Retold by AI ' +
      'from Wikipedia, labelled honestly, with the original one tap away.',
  },
  {
    title: 'Walk to it',
    body:
      'Every story has a violet Go with walking directions. Purple text is always ' +
      'tappable — names in a story are doors to their own stories.',
  },
] as const;

/**
 * The app explains nothing on first launch — these three cards do it
 * once, then get out of the way. Shown only while the seen-flag is
 * confirmed absent; skippable from any page.
 */
function Onboarding({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  return (
    <View testID="onboarding" style={[styles.overlay, { backgroundColor: theme.background }]}>
      <Pressable
        testID="onboarding-skip"
        accessibilityRole="button"
        onPress={onDone}
        hitSlop={Spacing.three}
        style={({ pressed }) => [
          styles.skip,
          { top: insets.top + Spacing.three },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold" themeColor="accent">
          Skip
        </ThemedText>
      </Pressable>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)))
        }>
        {PAGES.map((card, index) => (
          <View key={card.title} style={[styles.page, { width }]}>
            <ThemedText type="subtitle" style={styles.title}>
              {card.title}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.body}>
              {card.body}
            </ThemedText>
            {index === PAGES.length - 1 && (
              <Pressable
                testID="onboarding-done"
                accessibilityRole="button"
                onPress={onDone}
                style={({ pressed }) => [
                  styles.done,
                  { backgroundColor: theme.accent },
                  pressed && { opacity: 0.85 },
                ]}>
                <ThemedText type="smallBold" style={styles.doneText}>
                  Start exploring
                </ThemedText>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.dots, { paddingBottom: insets.bottom + Spacing.five }]}>
        {PAGES.map((card, index) => (
          <View
            key={card.title}
            style={[
              styles.dot,
              // Dimming, never colour: the current dot is simply darker
              { backgroundColor: index === page ? theme.textSecondary : theme.backgroundSelected },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Renders the app always, and the onboarding over it exactly once.
 * The flag is read async at boot; until it resolves the gate adds
 * nothing, so a returning user never sees a flash of onboarding.
 */
export function OnboardingGate({ children }: PropsWithChildren) {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((value) => {
        if (!cancelled) setSeen(value === 'true');
      })
      // Storage broke: never hold the app hostage over a welcome mat
      .catch(() => {
        if (!cancelled) setSeen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setSeen(true);
    // Fire-and-forget: worst case the cards show once more next launch
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true').catch(() => {});
  };

  return (
    <>
      {children}
      {seen === false && <Onboarding onDone={dismiss} />}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above the tabs, below the animated splash (zIndex 1000)
    zIndex: 500,
  },
  skip: {
    position: 'absolute',
    right: Spacing.four,
    zIndex: 1,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: 480,
  },
  done: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  doneText: {
    color: '#FFFFFF',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: Spacing.two,
    height: Spacing.two,
    borderRadius: Spacing.one,
  },
});
