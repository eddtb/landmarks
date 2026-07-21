import { Image } from 'expo-image';
import { useRef } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ArticleImage } from '@/data/article-client';

/**
 * The proper look (Edd's ask): tap any of the place's images and it
 * opens full-screen — swipe through the set, pinch to zoom, the
 * photographer's credit riding along. Core primitives only: a Modal,
 * a paging list, and iOS's native ScrollView zoom.
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

  if (initialIndex === null) {
    return null;
  }

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
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
                // iOS native pinch-zoom; Android keeps swipe + full view
                maximumZoomScale={4}
                minimumZoomScale={1}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={Spacing.three}
          style={[styles.close, { top: insets.top + Spacing.two }]}>
          <ThemedText type="headline" style={styles.closeText}>
            ✕
          </ThemedText>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
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
