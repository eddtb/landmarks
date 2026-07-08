import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PlaceCategory } from '@/types/place';

const Sections: { value: PlaceCategory; label: string }[] = [
  { value: 'landmark', label: 'Landmarks' },
  { value: 'restaurant', label: 'Restaurants' },
  { value: 'pub', label: 'Pubs' },
];

type Props = {
  selected: PlaceCategory;
  onSelect: (category: PlaceCategory) => void;
};

export function SectionPicker({ selected, onSelect }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      {Sections.map((section) => {
        const isSelected = section.value === selected;
        return (
          <Pressable
            key={section.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(section.value)}
            style={[styles.segment, isSelected && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText
              type={isSelected ? 'smallBold' : 'small'}
              themeColor={isSelected ? 'text' : 'textSecondary'}>
              {section.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three - Spacing.one,
  },
});
