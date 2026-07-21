import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ArticleImage } from '@/data/article-client';

/**
 * The proper look: tap any of the place's images and it opens
 * full-screen — swipe through the set, pinch to zoom, and DRAG THE
 * PHOTO DOWNWARDS TO CLOSE (Edd's redline: the scroll-bounce trick
 * never fired on a non-scrolling zoom view; this is a real pan
 * gesture, fading the backdrop as the photo travels). Gestures inside
 * a Modal need their own GestureHandlerRootView — a known RN gotcha.
 */
export function ImageViewer({
  images,
  initialIndex,
  onClose,
}: {
  images: ArticleImage[];
  initialIndex: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const indexRef = useRef(initialIndex ?? 0);
  const [zoomed, setZoomed] = useState(false);
  const dragY = useSharedValue(0);

  // A fresh open starts from rest — the last exit left dragY at height
  useEffect(() => {
    if (initialIndex !== null) {
      // eslint-disable-next-line react-hooks/immutability
      dragY.value = 0;
    }
  }, [initialIndex, dragY]);

  const backdropStyle = useAnimatedStyle(() => ({
    // Reaches ~0 as the photo exits — the modal unmounts into nothing
    opacity: interpolate(dragY.value, [0, height * 0.75], [1, 0], 'clamp'),
  }));
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  if (initialIndex === null) {
    return null;
  }

  // The dismissal finishes the story the drag started: photo continues
  // off-screen, backdrop to nothing, THEN unmount — no snap, no flash
  const animateOut = () => {
    // eslint-disable-next-line react-hooks/immutability
    dragY.value = withTiming(height, { duration: 180 }, (finished) => {
      if (finished) {
        runOnJS(onClose)();
      }
    });
  };

  const pan = Gesture.Pan()
    .enabled(!zoomed)
    // Vertical intent only — never fight the horizontal pager
    .activeOffsetY([-18, 18])
    .failOffsetX([-14, 14])
    .onUpdate((event) => {
      'worklet';
      // Reanimated shared values mutate inside worklets by design —
      // the compiler can't see across the worklet boundary
      // eslint-disable-next-line react-hooks/immutability
      dragY.value = event.translationY > 0 ? event.translationY : event.translationY * 0.25;
    })
    .onEnd((event) => {
      'worklet';
      if (dragY.value > 120 || event.velocityY > 900) {
        // Finish the story the drag started: photo continues off-screen,
        // backdrop reaches nothing, THEN unmount — no snap, no flash
        // eslint-disable-next-line react-hooks/immutability
        dragY.value = withTiming(height, { duration: 180 }, (finished) => {
          if (finished) {
            runOnJS(onClose)();
          }
        });
      } else {
        // eslint-disable-next-line react-hooks/immutability
        dragY.value = withSpring(0);
      }
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.page, pageStyle]}>
            <FlatList
              data={images}
              horizontal
              pagingEnabled
              initialScrollIndex={initialIndex}
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              keyExtractor={(image) => image.imageUrl}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => {
                indexRef.current = Math.round(event.nativeEvent.contentOffset.x / width);
              }}
              renderItem={({ item: image }) => (
                <View style={{ width, height }}>
                  <ScrollView
                    // iOS native pinch-zoom; Android keeps swipe + full view.
                    // CRUCIAL: the zoom scroll view claims vertical touches
                    // even with nothing to scroll — keep scrolling disabled
                    // until actually zoomed so the drag-to-close pan can win
                    // (pinch is its own recognizer and keeps working)
                    scrollEnabled={zoomed}
                    pinchGestureEnabled
                    bounces={false}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    onScroll={(event) => {
                      const scale = event.nativeEvent.zoomScale ?? 1;
                      setZoomed(scale > 1.01);
                    }}
                    scrollEventThrottle={100}
                    contentContainerStyle={styles.zoomPage}
                    centerContent
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}>
                    <Image
                      source={{ uri: image.imageUrl }}
                      style={{ width, height: height * 0.8 }}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  </ScrollView>
                  <ThemedText
                    type="small"
                    style={[styles.credit, { bottom: insets.bottom + Spacing.four }]}
                    numberOfLines={2}>
                    {image.credit}
                  </ThemedText>
                </View>
              )}
            />
          </Animated.View>
        </GestureDetector>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={animateOut}
          hitSlop={Spacing.three}
          style={[styles.close, { top: insets.top + Spacing.two }]}>
          <ThemedText type="headline" style={styles.closeText}>
            ✕
          </ThemedText>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  page: {
    flex: 1,
  },
  zoomPage: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  credit: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    color: '#FFFFFF',
    opacity: 0.75,
    textAlign: 'center',
    fontSize: 11,
  },
  close: {
    position: 'absolute',
    right: Spacing.four,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#FFFFFF',
  },
});
