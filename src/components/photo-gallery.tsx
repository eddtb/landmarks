import { Image } from 'expo-image';
import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  photoUrls: string[];
};

/** Paged photo strip with a dot indicator; a single photo renders plain. */
export function PhotoGallery({ photoUrls }: Props) {
  const [page, setPage] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, MaxContentWidth);
  const theme = useTheme();

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  if (photoUrls.length <= 1) {
    return (
      <Image
        source={{ uri: photoUrls[0] }}
        style={[styles.photo, { width }]}
        contentFit="cover"
      />
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ width }}>
        {photoUrls.map((url) => (
          <Image
            key={url}
            source={{ uri: url }}
            style={[styles.photo, { width }]}
            contentFit="cover"
          />
        ))}
      </ScrollView>
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
