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
 * The nearest story, on the Home Screen.
 *
 * This is the app's whole premise with the app removed: you are always
 * standing near something, and here is what. A web page cannot occupy
 * this space — which is rather the point of it existing.
 *
 * The photograph is the widget, not an illustration inside it. Venture
 * sells itself on "everything historic within a walk, each with a
 * photograph", and a white card with a small picture pasted at the top
 * reads like a default template. Full-bleed image, a gradient scrim
 * for legibility, and the words sitting on it — the same idiom Photos,
 * News and Music use, and the reason those widgets look designed.
 *
 * Everything inside the `'widget'` directive runs in an isolated
 * runtime with no hooks, no state, no async work and no access to
 * module-scope constants. Whatever it needs must arrive in `props` or
 * `environment`, which is why the app pushes a flattened snapshot
 * (src/data/widget-feed.ts) rather than the app's own HistoryItem —
 * the photograph included, as a file in the shared App Group
 * container, because this runtime cannot fetch anything either.
 */
export type NearestStoryProps = {
  /** The place's name, or empty before the app has ever had a feed. */
  title: string;
  /** The one line that gives a reason to walk over. May be empty. */
  hook: string;
  /** Pre-formatted on the app side: the widget cannot call a helper. */
  distance: string;
  /** A structured existence fact — "Demolished 1936". Often empty. */
  era: string;
  /** Deep link into the story, or empty when there is nothing to open. */
  url: string;
  /** file:// path inside the App Group, or empty until one is cached. */
  photo: string;
};

const NearestStory = (props: NearestStoryProps, environment: WidgetEnvironment) => {
  'widget';

  // Declared INSIDE the directive, and it has to be. The widget body
  // runs in an isolated runtime that cannot see this module's scope,
  // so a `const BrandPurple` hoisted to the top of the file compiles
  // fine, passes every test, and then renders a red error box on the
  // user's Home Screen: "ReferenceError: Can't find variable:
  // BrandPurple". Caught only by opening the widget gallery.
  const brandPurple = '#6A4BDB';
  const fill = frame({ maxWidth: Infinity, maxHeight: Infinity });
  // Only systemSmall ships (see app.json). The medium family is the
  // same HEIGHT as small and merely wider, so it gains nothing but a
  // layout that would not behave: in this bridge its text block landed
  // entirely below the viewport whatever combination of frame,
  // padding, Spacer and stack alignment was tried. `wide` stays so the
  // no-photo fallback can still adapt if medium is ever revisited.
  const wide = environment.widgetFamily !== 'systemSmall';

  // The honest empty state. A widget added before the app has ever
  // loaded a feed has nothing to show, and inventing a placeholder
  // place would be a lie on someone's Home Screen.
  if (!props.title) {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[fill, padding({ all: 16 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(brandPurple)]}>
          VENTURE
        </Text>
        <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(3)]}>
          Open Venture to see the history around you.
        </Text>
        <Spacer />
      </VStack>
    );
  }

  const meta = props.era ? `${props.distance} · ${props.era}` : props.distance;

  // No picture yet — a typographic card rather than a grey rectangle
  // with nothing in it. The photo leg lands a moment later.
  if (!props.photo) {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[fill, padding({ all: 16 }), ...(props.url ? [widgetURL(props.url)] : [])]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(brandPurple)]}>
          NEAREST
        </Text>
        <Text
          modifiers={[
            font({ textStyle: wide ? 'title2' : 'title3', weight: 'bold' }),
            lineLimit(3),
            minimumScaleFactor(0.7),
          ]}>
          {props.title}
        </Text>
        {props.hook ? (
          <Text
            modifiers={[
              font({ textStyle: 'footnote' }),
              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
              lineLimit(2),
            ]}>
            {props.hook}
          </Text>
        ) : null}
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'medium' }),
            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
          ]}>
          {meta}
        </Text>
      </VStack>
    );
  }

  // The text layer FILLS the widget and pushes itself down with a
  // Spacer, rather than being a content-sized block pinned to the
  // bottom. That is not a style choice: a ZStack lays each child out
  // at its IDEAL size, so a content-sized Text grows wider than the
  // widget and is clipped at both edges instead of wrapping —
  // measured repeatedly, "Drummonds Bank" rendering as "rummonds
  // Bank" and "NEAREST" as "AREST". Filling the container is what
  // gives the words a real width to wrap inside.
  //
  // (SwiftUI's .overlay would express this more directly, but
  // OverlayView is not linked into the widget extension's runtime —
  // "Unable to get the view for: OverlayView" on the Home Screen.)
  return (
    // bottomLeading on the STACK as well as the text block: if the
    // inner VStack ever ends up content-sized rather than filling, the
    // stack's default centre alignment is what put the medium size's
    // title in the middle of the widget instead of down in the corner.
    <ZStack alignment="bottomLeading" modifiers={[fill, ...(props.url ? [widgetURL(props.url)] : [])]}>
      <Image
        uiImage={props.photo}
        // containerRelativeFrame, not frame(maxWidth/maxHeight). An
        // aspect-FILLED image is larger than the widget by definition,
        // and a max-frame does not stop it driving the ZStack's
        // bounds — so "bottomLeading" meant the IMAGE's corner, which
        // is off-screen, and every text layout above was being pushed
        // out with it. Proved by deleting the image: the same text
        // laid out perfectly. This pins the picture to the container.
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

      {/* Spacers on BOTH axes, never a frame alignment. Measured on
          the Home Screen: frame(maxWidth: Infinity) with no alignment
          silently centres the block, and adding alignment: 'leading'
          places the inner CONTENT at the edge and throws the leading
          padding away, clipping the text to "utty Sark". A Spacer
          above and a Spacer trailing push the padded block into the
          bottom-left corner with its padding intact. */}
      <VStack modifiers={[fill]}>
        <Spacer />
        <HStack modifiers={[frame({ maxWidth: Infinity })]}>
          <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 16 })]}>
            <Text
              modifiers={[
                font({ size: 15, weight: 'bold' }),
                foregroundStyle('#FFFFFF'),
                lineLimit(2),
                // A long name shrinks rather than vanishing behind an ellipsis
                minimumScaleFactor(0.8),
              ]}>
              {props.title}
            </Text>

            <HStack spacing={5}>
              <Text
                modifiers={[
                  font({ size: 9, weight: 'bold' }),
                  foregroundStyle('rgba(255,255,255,0.6)'),
                ]}>
                NEAREST
              </Text>
              <Text
                modifiers={[
                  font({ size: 11, weight: 'medium' }),
                  foregroundStyle('rgba(255,255,255,0.92)'),
                  lineLimit(1),
                ]}>
                {meta}
              </Text>
            </HStack>
          </VStack>
          <Spacer />
        </HStack>
      </VStack>
    </ZStack>
  );
};

export default createWidget('NearestStory', NearestStory);
