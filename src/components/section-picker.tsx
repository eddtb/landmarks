import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PlaceCategory } from '@/types/place';

/** The browse sections: the four place categories plus history. */
export type Section = PlaceCategory | 'history';

const Sections: { value: Section; label: string }[] = [
  { value: 'landmark', label: 'Landmarks' },
  { value: 'food', label: 'Food' },
  { value: 'drink', label: 'Drinks' },
  { value: 'activity', label: 'Activities' },
  { value: 'history', label: 'History' },
];

type Props = {
  selected: Section;
  onSelect: (section: Section) => void;
};

export function SectionPicker({ selected, onSelect }: Props) {
  const theme = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.container, { backgroundColor: theme.backgroundElement }]}
      contentContainerStyle={styles.content}>
      {Sections.map((section) => {
        const isSelected = section.value === selected;
        return (
          <Pressable
            key={section.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(section.value)}
            style={[styles.segment, isSelected && { backgroundColor: theme.text }]}>
            <ThemedText
              type={isSelected ? 'smallBold' : 'small'}
              themeColor={isSelected ? 'background' : 'textSecondary'}>
              {section.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    flexGrow: 0,
  },
  content: {
    padding: Spacing.one,
    gap: Spacing.one,
  },
  segment: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
});
