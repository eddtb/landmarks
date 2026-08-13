import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Coordinates } from '@/utils/geo';

/** The one wording, wherever the field appears — the header's own
 *  search and the no-location invitation are the same control. */
export const PlaceSearchPlaceholder = 'Search a town, street or postcode…';

/**
 * What the last submitted search did. A search that finds nothing, or
 * that fails outright, has to SAY so: for a reader with no location
 * this field is the only tool on the screen, and a field that swallows
 * a submission reads as a broken app (#289). Both used to be silent —
 * no result did nothing at all, and a throw wrote a console warning
 * nobody on a phone can see.
 */
type Outcome =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'missing'; query: string }
  | { kind: 'failed' };

/** The geocoder's three answers, as a verdict. Module-level on
 *  purpose: a conditional inside a try/catch opts the whole enclosing
 *  function out of the React Compiler (AGENTS.md), and inside the
 *  component that would be the component. */
async function geocodePlace(
  query: string
): Promise<{ kind: 'found'; center: Coordinates } | { kind: 'missing' } | { kind: 'failed' }> {
  try {
    // On-device geocoding — free
    const [first] = await Location.geocodeAsync(query);
    if (!first) {
      return { kind: 'missing' };
    }
    return { kind: 'found', center: { latitude: first.latitude, longitude: first.longitude } };
  } catch (error) {
    console.warn('Geocoding failed:', error);
    return { kind: 'failed' };
  }
}

export function PlaceSearch({
  onManualCenter,
  autoFocus,
  onFound,
}: {
  /** Pins the found place — the searched words ride along as its name. */
  onManualCenter: (center: Coordinates, label?: string) => void;
  autoFocus?: boolean;
  /** A place landed: the header folds its field away again. */
  onFound?: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const onSubmit = useCallback(async () => {
    const wanted = query.trim();
    if (!wanted) {
      return;
    }
    setOutcome({ kind: 'searching' });
    const verdict = await geocodePlace(wanted);
    if (verdict.kind === 'missing') {
      setOutcome({ kind: 'missing', query: wanted });
      return;
    }
    if (verdict.kind === 'failed') {
      setOutcome({ kind: 'failed' });
      return;
    }
    setOutcome({ kind: 'idle' });
    setQuery('');
    onFound?.();
    // The RAW typed string rides the pin (trimmed): the geocode result
    // carries coordinates, not a better name — and the typed name is
    // the one the user expects to lead the screen. Last, because
    // pinning unmounts the field on the invitation.
    onManualCenter(verdict.center, wanted);
  }, [query, onManualCenter, onFound]);

  return (
    <View style={styles.field}>
      <TextInput
        testID="place-search"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={onSubmit}
        placeholder={PlaceSearchPlaceholder}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        autoFocus={autoFocus}
        accessibilityLabel="Search a place"
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
      {/* Grey, per the rule of use: an outcome is neither a name nor a
          control, and state is words, never colour */}
      {outcome.kind === 'missing' && (
        <ThemedText type="small" themeColor="textSecondary">
          No map match for “{outcome.query}”. Try a postcode, or the nearest town.
        </ThemedText>
      )}
      {outcome.kind === 'failed' && (
        <ThemedText type="small" themeColor="textSecondary">
          Couldn’t search just now. Check your connection and try again.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: Spacing.three - Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
    // Every tap target clears 44pt, the field included
    minHeight: 44,
    // TextInput lives outside ThemedText's ramp — the one sanctioned
    // inline size, between `small` and `default` for a comfy field
    fontSize: 15,
  },
});
