import { HStack, Image, Rectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  clipped,
  containerRelativeFrame,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  resizable,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/**
 * How much history is within a walk of you, on the Home Screen.
 *
 * It says an AREA-level fact on purpose. The first version named the
 * single nearest place and how far it was, which is the fastest-
 * decaying thing this app knows: "31 m away" is wrong after fifty
 * metres, and a widget only refreshes when the app runs. "78 stories
 * in Greenwich" stays true for as long as you are in Greenwich — the
 * same staleness, an order of magnitude less lying — and it answers
 * the question actually worth asking from a Home Screen, which is
 * whether this place is worth opening the app for.
 *
 * The count is the SAME one the feed's own header prints, so the
 * widget and the app can never disagree about what is around you.
 *
 * Everything inside the `'widget'` directive runs in an isolated
 * runtime with no hooks, no state, no async work and no access to
 * module-scope constants. Whatever it needs must arrive in `props` or
 * `environment`, which is why the app pushes a flattened snapshot
 * (src/data/area-widget.ts) rather than the app's own HistoryItem —
 * the photograph included, as a file in the shared App Group
 * container, because this runtime cannot fetch anything either.
 */
export type AreaStoriesProps = {
  /** Where the user is — "Greenwich". May be empty if unresolved. */
  area: string;
  /** Walkable stories within reach. Zero means the empty state. */
  count: number;
  /** The nearest of them, named on the wider size only. */
  nearest: string;
  /** Pre-formatted: "31 m away", "9 min walk". The widget cannot format. */
  nearestWalk: string;
  /** file:// path inside the App Group, or empty until one is cached. */
  photo: string;
  /** Deep link into the feed, or empty when there is nothing to open. */
  url: string;
  /**
   * What to say when there is nothing to count. Set by the app only
   * once it HAS a feed and found nothing walkable in it; left empty
   * before the app has ever run, so the two situations can say
   * different things. The widget never guesses which it is in.
   */
  emptyNote: string;
};

const AreaStories = (props: AreaStoriesProps, environment: WidgetEnvironment) => {
  'widget';

  // Declared INSIDE the directive, and it has to be. The widget body
  // runs in an isolated runtime that cannot see this module's scope,
  // so a `const BrandPurple` hoisted to the top of the file compiles
  // fine, passes every test, and then renders a red error box on the
  // user's Home Screen: "ReferenceError: Can't find variable:
  // BrandPurple". Caught only by opening the widget gallery.
  const brandPurple = '#6A4BDB';
  const fill = frame({ maxWidth: Infinity, maxHeight: Infinity });
  const wide = environment.widgetFamily !== 'systemSmall';

  // Nothing to count. Before the app has ever run this is the widget's
  // own wording; once the app holds a real but empty feed it supplies
  // its own, so the square never tells someone to open an app they
  // have just opened.
  if (props.count <= 0) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[fill, padding({ all: 16 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(brandPurple)]}>
          VENTURE
        </Text>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(3)]}>
          {props.emptyNote || 'Open Venture to see the history around you.'}
        </Text>
        <Spacer />
      </VStack>
    );
  }

  // "stories in Greenwich", or "stories within a walk" when the area
  // could not be named — never a blank where a place should be.
  const noun = props.count === 1 ? 'story' : 'stories';
  const named = props.area ? `${noun} in ${props.area}` : `${noun} within a walk`;
  const footnote =
    wide && props.nearest
      ? `within a walk · nearest is ${props.nearest}, ${props.nearestWalk}`
      : 'within a walk';

  const count = (
    <Text
      modifiers={[
        font({ size: wide ? 34 : 30, weight: 'bold' }),
        foregroundStyle('#FFFFFF'),
        lineLimit(1),
      ]}>
      {String(props.count)}
    </Text>
  );

  const heading = (
    <Text
      modifiers={[
        font({ size: wide ? 17 : 15, weight: 'bold' }),
        foregroundStyle('#FFFFFF'),
        lineLimit(2),
        // A long area name shrinks rather than vanishing behind an ellipsis
        minimumScaleFactor(0.75),
      ]}>
      {named}
    </Text>
  );

  const sub = (
    <Text
      modifiers={[
        font({ size: 11, weight: 'medium' }),
        foregroundStyle('rgba(255,255,255,0.85)'),
        lineLimit(2),
      ]}>
      {footnote}
    </Text>
  );

  return (
    // bottomLeading on the STACK as well as the text block: if the
    // inner VStack ever ends up content-sized rather than filling, the
    // stack's default centre alignment is what put the wider size's
    // words in the middle of the widget instead of down in the corner.
    <ZStack
      alignment="bottomLeading"
      modifiers={[fill, ...(props.url ? [widgetURL(props.url)] : [])]}>
      <Image
        uiImage={props.photo}
        // containerRelativeFrame, not frame(maxWidth/maxHeight). An
        // aspect-FILLED image is larger than the widget by definition,
        // and a max-frame does not stop it driving the ZStack's
        // bounds — so "bottomLeading" meant the IMAGE's corner, which
        // is off-screen, and every text layout was being pushed out
        // with it. Proved by deleting the image: the same text laid
        // out perfectly. This pins the picture to the container.
        modifiers={[
          resizable(),
          aspectRatio({ contentMode: 'fill' }),
          containerRelativeFrame({ axes: 'both' }),
          clipped(),
        ]}
      />

      {/* The scrim. Photographs are unpredictable — a bright sky behind
          white text is unreadable — so the words always sit on a
          darkened foot rather than trusting the picture to behave. */}
      <Rectangle
        modifiers={[
          foregroundStyle({
            type: 'linearGradient',
            colors: [
              'rgba(0,0,0,0)',
              'rgba(0,0,0,0.35)',
              'rgba(0,0,0,0.78)',
              'rgba(0,0,0,0.95)',
            ],
            startPoint: { x: 0.5, y: wide ? 0.1 : 0.2 },
            endPoint: { x: 0.5, y: 1 },
          }),
          fill,
        ]}
      />

      {/* Spacers on BOTH axes, never a frame alignment. Measured on the
          Home Screen: frame(maxWidth: Infinity) with no alignment
          silently centres the block, and adding alignment: 'leading'
          places the inner CONTENT at the edge and throws the leading
          padding away, clipping the text. */}
      <VStack modifiers={[fill]}>
        <Spacer />
        <HStack modifiers={[frame({ maxWidth: Infinity })]}>
          <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 16 })]}>
            {wide ? (
              <HStack spacing={9}>
                {count}
                {heading}
              </HStack>
            ) : (
              count
            )}
            {wide ? null : heading}
            {sub}
          </VStack>
          <Spacer />
        </HStack>
      </VStack>
    </ZStack>
  );
};

export default createWidget('AreaStories', AreaStories);
