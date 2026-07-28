import { Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
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
 * Everything inside the `'widget'` directive runs in an isolated
 * runtime with no hooks, no state, no async work and no access to
 * module-scope constants. Whatever it needs must arrive in `props` or
 * `environment`, which is why the app pushes a flattened snapshot
 * (src/data/widget-feed.ts) rather than the app's own HistoryItem.
 */
export type NearestStoryProps = {
  /** The place's name, or empty before the app has ever had a feed. */
  title: string;
  /** The one line that gives a reason to walk over. May be empty. */
  hook: string;
  /** Pre-formatted on the app side: the widget cannot call a helper. */
  distance: string;
  /** Deep link into the story, or empty when there is nothing to open. */
  url: string;
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

  // The honest empty state. A widget added before the app has ever
  // loaded a feed has nothing to show, and inventing a placeholder
  // place would be a lie on someone's Home Screen.
  if (!props.title) {
    return (
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ size: 11, weight: 'semibold' }),
            foregroundStyle(brandPurple),
          ]}>
          VENTURE
        </Text>
        <Text modifiers={[font({ textStyle: 'subheadline' }), lineLimit(3)]}>
          Open Venture to see the history around you.
        </Text>
      </VStack>
    );
  }

  // The medium widget has room for the hook; the small one does not,
  // and a truncated half-sentence is worse than the name alone.
  const roomForHook = environment.widgetFamily !== 'systemSmall';

  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[
        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
        ...(props.url ? [widgetURL(props.url)] : []),
      ]}>
      <Text
        modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(brandPurple)]}>
        NEAREST
      </Text>
      <Text
        modifiers={[
          font({ textStyle: 'headline' }),
          lineLimit(roomForHook ? 2 : 3),
          // A long name shrinks rather than vanishing behind an ellipsis
          minimumScaleFactor(0.8),
        ]}>
        {props.title}
      </Text>
      {roomForHook && props.hook ? (
        <Text
          modifiers={[
            font({ textStyle: 'footnote' }),
            foregroundStyle('secondary'),
            lineLimit(2),
          ]}>
          {props.hook}
        </Text>
      ) : null}
      <Spacer />
      <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('secondary')]}>
        {props.distance}
      </Text>
    </VStack>
  );
};

export default createWidget('NearestStory', NearestStory);
