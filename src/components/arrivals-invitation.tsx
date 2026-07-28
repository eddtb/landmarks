import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dismissArrivalInvitation, useShouldOfferArrivals } from '@/data/arrivals';
import { useArrivalsToggle } from '@/hooks/use-arrivals';
import { useTheme } from '@/hooks/use-theme';

/**
 * The offer. Arrivals ship off — background location is not something
 * to switch on for someone — so the feature needs somewhere to be
 * asked for, and the ⋯ menu alone is somewhere nobody looks.
 *
 * Shown once: taking the offer or turning it down both retire it. It
 * sits under the count line, above the first card, and only where the
 * user actually IS — an invitation to be told about arriving somewhere
 * means nothing while browsing another city from the sofa.
 */
export function ArrivalsInvitation() {
  const theme = useTheme();
  const offer = useShouldOfferArrivals();
  const { toggle } = useArrivalsToggle();
  const [asking, setAsking] = useState(false);

  if (!offer) {
    return null;
  }

  const turnOn = async () => {
    setAsking(true);
    try {
      await toggle();
    } finally {
      setAsking(false);
    }
  };

  return (
    <View
      testID="arrivals-invitation"
      style={[
        styles.card,
        { backgroundColor: theme.accentSoft, borderColor: theme.accent },
      ]}>
      <ThemedText type="eyebrow" style={{ color: theme.accent }}>
        Arrivals
      </ThemedText>
      <ThemedText type="headline">Be told when you walk up to it</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Venture can tap you on the shoulder when you reach somewhere with a story — with the app
        closed, and your phone in your pocket.
      </ThemedText>
      <View style={styles.actions}>
        <Pressable
          testID="arrivals-turn-on"
          accessibilityRole="button"
          accessibilityLabel="Turn on arrivals"
          disabled={asking}
          onPress={turnOn}
          hitSlop={Spacing.two}>
          <ThemedText type="linkPrimary">{asking ? 'Asking…' : 'Turn on'}</ThemedText>
        </Pressable>
        <Pressable
          testID="arrivals-not-now"
          accessibilityRole="button"
          accessibilityLabel="Not now"
          onPress={dismissArrivalInvitation}
          hitSlop={Spacing.two}>
          <ThemedText type="small" themeColor="textSecondary">
            Not now
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same geometry as the standing-on banner — the two are siblings in
  // the feed and must not read as different kinds of object
  card: {
    borderWidth: 1.5,
    borderRadius: Spacing.three - 2,
    gap: 2,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    padding: Spacing.three,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
});
