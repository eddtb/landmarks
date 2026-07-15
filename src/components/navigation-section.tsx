import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Compass } from '@/components/compass';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchWalkingRoute } from '@/data/route-client';
import { useLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';
import { formatDistance, formatWalkTime } from '@/utils/format';

type Mode = 'compass' | 'route';

type Props = {
  target: Coordinates;
};

/**
 * How-do-I-get-there, two ways: the compass (point and wander) or the
 * walking route (numbered street-by-street steps). Routes are fetched
 * lazily — only when the user opens the Route view.
 */
export function NavigationSection({ target }: Props) {
  const [mode, setMode] = useState<Mode>('compass');
  const { coordinates } = useLocation();
  const theme = useTheme();

  if (!coordinates) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.toggle, { backgroundColor: theme.backgroundElement }]}>
        {(['compass', 'route'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === value }}
            onPress={() => setMode(value)}
            style={[
              styles.toggleOption,
              mode === value && { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText
              type={mode === value ? 'smallBold' : 'small'}
              themeColor={mode === value ? 'text' : 'textSecondary'}>
              {value === 'compass' ? 'Compass' : 'Route'}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {mode === 'compass' ? (
        <Compass target={target} />
      ) : (
        <RouteSteps from={coordinates} to={target} />
      )}
    </View>
  );
}

function RouteSteps({ from, to }: { from: Coordinates; to: Coordinates }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; route: WalkingRoute | null }
  >({ status: 'loading' });
  const theme = useTheme();
  const { latitude, longitude } = from;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const route = await fetchWalkingRoute({ latitude, longitude }, to);
        if (!cancelled) {
          setState({ status: 'ready', route });
        }
      } catch (error) {
        console.warn('Failed to load route:', error);
        if (!cancelled) {
          setState({ status: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, to]);

  if (state.status === 'loading') {
    return <ActivityIndicator style={styles.routeStatus} />;
  }
  if (state.status === 'error' || !state.route) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.routeStatus}>
        No walking route available.
      </ThemedText>
    );
  }

  const { route } = state;
  return (
    <View style={styles.steps}>
      <ThemedText type="smallBold">
        {formatWalkTime(route.seconds)} · {formatDistance(route.meters)}
      </ThemedText>
      {route.steps.map((step, index) => (
        <View
          key={`${index}-${step.instruction}`}
          style={[styles.step, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.stepNumber}>
            {index + 1}
          </ThemedText>
          <View style={styles.stepBody}>
            <ThemedText type="small">{step.instruction}</ThemedText>
            {step.meters > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatDistance(step.meters)}
              </ThemedText>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.one,
    gap: Spacing.one,
    alignSelf: 'center',
  },
  toggleOption: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three - Spacing.one,
  },
  routeStatus: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  steps: {
    gap: Spacing.two,
  },
  step: {
    flexDirection: 'row',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  stepNumber: {
    minWidth: 18,
    textAlign: 'center',
  },
  stepBody: {
    flex: 1,
    gap: Spacing.half,
  },
});
