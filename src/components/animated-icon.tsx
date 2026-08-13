import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BrandPurple } from '@/constants/theme';

const DURATION = 600;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      transform: [{ scale: 1 }],
      opacity: 1,
    },
    20: {
      opacity: 1,
    },
    70: {
      opacity: 0,
      easing: Easing.elastic(0.7),
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1 }],
      easing: Easing.elastic(0.7),
    },
  });

  // The SAME image the native splash shows, at the same 200pt width
  // (app.json's imageWidth): the handoff from the system splash to
  // this overlay must be invisible — template residue here once put
  // the Expo logo between them, an off-brand flash on every launch
  // (Edd's phone, and every reviewer's).
  const image = (
    <Image style={styles.wander} source={require('@/assets/images/splash-wander.png')} />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}>
      {image}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}>
      {image}
    </View>
  );
}

const styles = StyleSheet.create({
  // splash-wander.png is square (1024×1024); 200pt matches the native
  // splash's rendered width exactly
  wander: {
    width: 200,
    height: 200,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BrandPurple,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
