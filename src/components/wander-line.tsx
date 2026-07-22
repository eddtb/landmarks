import { useEffect } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/**
 * The wander line — Venture's mark, extracted from the one-door gate
 * (where it was pixel-verified) for the approved "elsewhere" surfaces:
 * the gate, the empty states, and the cold-load wait.
 *
 * Drawn with primitives (react-native-svg is a native module — rebuild
 * cost — and the dependency diet forbids it when Views suffice). A
 * serpentine of alternating semicircle half-arcs: each is a View half
 * the arc span tall with only its outer corners rounded and the flat
 * side's border removed. A semicircle's ends run vertical, so an
 * over-arc joined to an under-arc at the shared edge is C1-continuous
 * — a smooth wave, no crossings, no chain-link lenses.
 */

export type WanderLineProps = {
  /** Horizontal span of one half-arc; the row is `arcSpan` tall. */
  arcSpan: number;
  /** Stroke width of the line. */
  stroke: number;
  /** How many half-arcs — sizes the line to its surface. */
  count: number;
  /** The line's colour — white on the gate, accent elsewhere. */
  color: string;
  /** Position/opacity live at the call site, not in the primitive. */
  style?: StyleProp<ViewStyle>;
};

/** One half-arc. Over-arcs rise, crest, fall; under-arcs mirror them,
 * dropped half an arc so the vertical ends meet. Each arc past the
 * first overlaps by the stroke so the arc-ends share their pixels —
 * one continuous line, not butted segments. */
function arcStyle(index: number, { arcSpan, stroke, color }: WanderLineProps): ViewStyle {
  const half = arcSpan / 2;
  return {
    width: arcSpan,
    height: half,
    borderColor: color,
    borderWidth: stroke,
    ...(index > 0 && { marginLeft: -stroke }),
    ...(index % 2 === 0
      ? { borderTopLeftRadius: half, borderTopRightRadius: half, borderBottomWidth: 0 }
      : {
          marginTop: half,
          borderBottomLeftRadius: half,
          borderBottomRightRadius: half,
          borderTopWidth: 0,
        }),
  };
}

function rowStyle(arcSpan: number): ViewStyle {
  return { flexDirection: 'row', alignItems: 'flex-start', height: arcSpan };
}

/** The static line. Decorative always: hidden from the accessibility
 * tree and untouchable — the words next to it carry the meaning. */
export function WanderLine(props: WanderLineProps) {
  return (
    <View
      testID="wander-line"
      style={[rowStyle(props.arcSpan), props.style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {Array.from({ length: props.count }, (_, index) => (
        <View key={index} testID="wander-arc" style={arcStyle(index, props)} />
      ))}
    </View>
  );
}

/**
 * The self-drawing line for the long cold loads (approved mock 2): the
 * walked part solid, the path ahead faint, looping until the stories
 * land. Under reduced motion it holds still — the static line says
 * "Venture is working" without fidgeting.
 */
export function DrawingWanderLine(props: WanderLineProps) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    return <WanderLine {...props} />;
  }
  return <DrawingLoop {...props} />;
}

/** The path ahead. */
const FaintOpacity = 0.25;
/** A beat per half-arc — a walking pace, not a spinner's whirr. */
const MsPerArc = 420;

function DrawingLoop(props: WanderLineProps) {
  const { count } = props;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(count, { duration: count * MsPerArc, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
    return () => cancelAnimation(progress);
  }, [count, progress]);

  return (
    <View
      testID="wander-line-drawing"
      style={[rowStyle(props.arcSpan), props.style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {Array.from({ length: props.count }, (_, index) => (
        <FadingArc key={index} index={index} progress={progress} line={props} />
      ))}
    </View>
  );
}

function FadingArc({
  index,
  progress,
  line,
}: {
  index: number;
  progress: SharedValue<number>;
  line: WanderLineProps;
}) {
  const animated = useAnimatedStyle(() => ({
    // This arc solidifies as the walk crosses it: faint until the
    // progress reaches its stretch, solid once past
    opacity: interpolate(progress.value, [index, index + 1], [FaintOpacity, 1], Extrapolation.CLAMP),
  }));
  return <Animated.View testID="wander-arc" style={[arcStyle(index, line), animated]} />;
}
