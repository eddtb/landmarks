import { ReactNode, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * Hand-rolled drag-reorder on the primitives we already own
 * (reanimated + gesture-handler) — no library. The trick that keeps
 * it simple: while a drag is active, every row renders a COMPACT
 * fixed-height form, so index math is `offset / rowHeight` and
 * auto-scroll is unnecessary at plan sizes (2–8 items). Rows
 * re-expand on release.
 */

export const CompactRowHeight = 52;

/** Pure and unit-tested: the reorder itself. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function clampIndex(value: number, length: number): number {
  'worklet';
  return Math.max(0, Math.min(length - 1, value));
}

export function ReorderList<T>({
  items,
  keyFor,
  renderRow,
  renderCompactRow,
  renderHandle,
  onReorder,
}: {
  items: T[];
  keyFor: (item: T) => string;
  /** The full row, including its leg/decorations. */
  renderRow: (item: T, index: number, handle: ReactNode) => ReactNode;
  /** The fixed-height row shown while any drag is active. */
  renderCompactRow: (item: T) => ReactNode;
  /** The ≡ affordance; the pan gesture rides it. */
  renderHandle: () => ReactNode;
  onReorder: (next: T[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const translationY = useSharedValue(0);
  const hoverShift = useSharedValue(0);

  const commit = (from: number, offsetRows: number) => {
    const to = Math.max(0, Math.min(items.length - 1, from + offsetRows));
    setDragIndex(null);
    if (to !== from) {
      onReorder(moveItem(items, from, to));
    }
  };

  const rows = items.map((item, index) => {
    const gesture = Gesture.Pan()
      .activateAfterLongPress(150)
      .onStart(() => {
        translationY.value = 0;
        hoverShift.value = 0;
        runOnJS(setDragIndex)(index);
      })
      .onUpdate((event) => {
        translationY.value = event.translationY;
        hoverShift.value = clampIndex(
          index + Math.round(event.translationY / CompactRowHeight),
          items.length
        );
      })
      .onEnd((event) => {
        runOnJS(commit)(index, Math.round(event.translationY / CompactRowHeight));
      })
      .onFinalize(() => {
        translationY.value = 0;
      });

    const handle = <GestureDetector gesture={gesture}>{renderHandle() as never}</GestureDetector>;
    return { item, index, handle };
  });

  return (
    <View>
      {rows.map(({ item, index, handle }) =>
        dragIndex === null ? (
          <View key={keyFor(item)}>{renderRow(item, index, handle)}</View>
        ) : (
          <CompactRow
            key={keyFor(item)}
            index={index}
            dragIndex={dragIndex}
            translationY={translationY}
            hoverShift={hoverShift}>
            {renderCompactRow(item)}
          </CompactRow>
        )
      )}
    </View>
  );
}

function CompactRow({
  index,
  dragIndex,
  translationY,
  hoverShift,
  children,
}: {
  index: number;
  dragIndex: number;
  translationY: { value: number };
  hoverShift: { value: number };
  children: ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (index === dragIndex) {
      return { transform: [{ translateY: translationY.value }], zIndex: 2, opacity: 0.92 };
    }
    // Rows between origin and hover slot make room for the traveller
    const hover = hoverShift.value;
    let shift = 0;
    if (index > dragIndex && index <= hover) {
      shift = -CompactRowHeight;
    } else if (index < dragIndex && index >= hover) {
      shift = CompactRowHeight;
    }
    return { transform: [{ translateY: withTiming(shift, { duration: 120 }) }], zIndex: 1 };
  });

  return (
    <Animated.View style={[styles.compact, animatedStyle]}>{children}</Animated.View>
  );
}

const styles = StyleSheet.create({
  compact: {
    height: CompactRowHeight,
    justifyContent: 'center',
  },
});
