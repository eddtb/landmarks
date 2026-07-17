import { ComponentType, ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * The header ⋯ as an anchored system menu (@expo/ui MenuView) — the
 * same chrome as the count line's menus, replacing the old centred
 * Alert dialog. Falls back to the system sheet on clients built
 * before @expo/ui existed.
 */

export type OverflowAction = { id: string; title: string };

type MenuViewProps = {
  actions: { id: string; title: string }[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
  testID?: string;
  children?: ReactNode;
};

const MenuView: ComponentType<MenuViewProps> | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@expo/ui/community/menu').MenuView;
  } catch {
    return null;
  }
})();

export function OverflowMenu({
  actions,
  onAction,
}: {
  actions: OverflowAction[];
  onAction: (id: string) => void;
}) {
  const trigger = (
    <ThemedText type="headline" accessibilityLabel="More actions">
      ⋯
    </ThemedText>
  );
  if (!MenuView) {
    const show = () => {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options: [...actions.map((a) => a.title), 'Cancel'], cancelButtonIndex: actions.length },
          (index) => {
            if (index < actions.length) onAction(actions[index].id);
          }
        );
        return;
      }
      Alert.alert('Actions', undefined, [
        ...actions.map((a) => ({ text: a.title, onPress: () => onAction(a.id) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    };
    return (
      <Pressable accessibilityRole="button" hitSlop={Spacing.two} onPress={show}>
        {trigger}
      </Pressable>
    );
  }
  return (
    <MenuView
      testID="overflow-menu"
      actions={actions}
      onPressAction={({ nativeEvent }) => onAction(nativeEvent.event)}>
      <Pressable accessibilityRole="button" hitSlop={Spacing.two}>
        {trigger}
      </Pressable>
    </MenuView>
  );
}
