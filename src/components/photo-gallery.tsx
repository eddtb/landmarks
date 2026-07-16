import { Image } from 'expo-image';
import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  photoUrls: string[];
};

/**
 * Paged photo strip with a dot indicator. The structure never changes
 * with the photo count: the screen mounts this with the summary's one
 * cached photo, and when details land the extra pages append beside
 * it — the first image element is keyed by URL and survives the
 * update, so the hero never remounts (remounting is a visible flash).
 */
export function PhotoGallery({ photoUrls }: Props) {
  const [page, setPage] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, MaxContentWidth);
  const theme = useTheme();

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        scrollEnabled={photoUrls.length > 1}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ width }}>
        {photoUrls.map((url) => (
          <Image
            key={url}
            source={{ uri: url }}
            style={[styles.photo, { width }]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ))}
      </ScrollView>
      {photoUrls.length > 1 && (
        <View style={styles.dots}>
          {photoUrls.map((url, index) => (
            <View
              key={url}
              style={[
                styles.dot,
                { backgroundColor: index === page ? theme.text : theme.backgroundSelected },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    aspectRatio: 16 / 9,
  },
  dots: {
    position: 'absolute',
    bottom: Spacing.two,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: Spacing.one,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
