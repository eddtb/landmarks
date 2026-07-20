import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Hand-rolled drag-reorder on the primitives we already own
 * (reanimated + gesture-handler) — no library. While a drag is
 * active, every row renders a COMPACT fixed-height form, so index
 * math is offset/rowHeight and auto-scroll is unnecessary at plan
 * sizes. Rows re-expand on release.
 *
 * Hard-learned structure (field bug: "items minimise and are
 * unmovable"): the GestureDetector must wrap a node that NEVER
 * unmounts. The compact/full swap happens INSIDE the detector, and
 * gesture objects are memoized so the drag-start re-render doesn't
 * reconfigure an active gesture. Long-press anywhere on a row (the
 * ≡ is the visual affordance) starts the drag.
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

export function ReorderList<T>({
  items,
  keyFor,
  renderRow,
  renderCompactRow,
  onReorder,
}: {
  items: T[];
  keyFor: (item: T) => string;
  /** The full row; `handle` is the ≡ affordance to place in it. */
  renderRow: (item: T, index: number, handle: ReactNode) => ReactNode;
  /** The fixed-height row shown while any drag is active. */
  renderCompactRow: (item: T) => ReactNode;
  onReorder: (next: T[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const translationY = useSharedValue(0);
  const hoverIndex = useSharedValue(0);

  // Callbacks read through refs so the memoized gestures never go
  // stale — and never get recreated mid-drag (recreation cancels an
  // active gesture)
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    itemsRef.current = items;
    onReorderRef.current = onReorder;
  });

  const commit = (from: number, offsetRows: number) => {
    const current = itemsRef.current;
    const to = Math.max(0, Math.min(current.length - 1, from + offsetRows));
    setDragIndex(null);
    if (to !== from) {
      onReorderRef.current(moveItem(current, from, to));
    }
  };
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  /* eslint-disable react-hooks/refs -- ref reads inside these
     callbacks run at gesture-event time, never during render */
  const gestures = useMemo(
    () =>
      Array.from({ length: items.length }, (_, index) =>
        Gesture.Pan()
          .activateAfterLongPress(200)
          // JS thread, not worklets: our math is trivial, and worklet
          // serialization of React refs corrupts them (field crash)
          .runOnJS(true)
          .onStart(() => {
            translationY.value = 0;
            hoverIndex.value = index;
            setDragIndex(index);
          })
          .onUpdate((event) => {
            translationY.value = event.translationY;
            const target = index + Math.round(event.translationY / CompactRowHeight);
            hoverIndex.value = Math.max(0, Math.min(itemsRef.current.length - 1, target));
          })
          .onEnd((event) => {
            commitRef.current(index, Math.round(event.translationY / CompactRowHeight));
          })
          .onFinalize(() => {
            translationY.value = 0;
          })
      ),
    // Recreate only when the row count changes — never on drag state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length]
  );
  /* eslint-enable react-hooks/refs */

  const handle = (
    <View accessibilityLabel="Reorder" style={styles.handle}>
      <ThemedText type="small" themeColor="textSecondary">
        ≡
      </ThemedText>
    </View>
  );

  return (
    <View>
      {items.map((item, index) => (
        <ReorderRow
          key={keyFor(item)}
          index={index}
          dragIndex={dragIndex}
          translationY={translationY}
          hoverIndex={hoverIndex}
          gesture={gestures[index]}>
          {dragIndex === null ? (
            renderRow(item, index, handle)
          ) : (
            <View style={styles.compact}>{renderCompactRow(item)}</View>
          )}
        </ReorderRow>
      ))}
    </View>
  );
}

function ReorderRow({
  index,
  dragIndex,
  translationY,
  hoverIndex,
  gesture,
  children,
}: {
  index: number;
  dragIndex: number | null;
  translationY: { value: number };
  hoverIndex: { value: number };
  gesture: ReturnType<typeof Gesture.Pan>;
  children: ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (dragIndex === null) {
      return { transform: [{ translateY: 0 }], zIndex: 1, opacity: 1 };
    }
    if (index === dragIndex) {
      return { transform: [{ translateY: translationY.value }], zIndex: 2, opacity: 0.92 };
    }
    // Rows between origin and hover slot make room for the traveller
    const hover = hoverIndex.value;
    let shift = 0;
    if (index > dragIndex && index <= hover) {
      shift = -CompactRowHeight;
    } else if (index < dragIndex && index >= hover) {
      shift = CompactRowHeight;
    }
    return {
      transform: [{ translateY: withTiming(shift, { duration: 120 }) }],
      zIndex: 1,
      opacity: 1,
    };
  }, [dragIndex, index]);

  // The detector wraps a node that exists in BOTH modes — the swap
  // happens inside it, so an active gesture is never unmounted
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  compact: {
    height: CompactRowHeight,
    justifyContent: 'center',
  },
  handle: {
    paddingHorizontal: Spacing.one,
  },
});
