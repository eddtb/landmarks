/**
 * Reduce Motion is honoured everywhere the app moves things (#298).
 *
 * It was honoured in ONE component — the wander line — while the
 * compass dial tweened a full-screen needle AND a counter-rotating
 * cardinal card on every 2°-plus heading tick (the vestibular trigger
 * the setting exists for, on a modal that IS the screen), and the
 * image viewer translated a full-screen photo on dismiss. Under Reduce
 * Motion the dial now JUMPS to each angle and the viewer closes in the
 * same beat as the gesture.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ImageViewer } from '@/components/image-viewer';
import { PointerDial } from '@/components/pointer-dial';

const mockUseReducedMotion = jest.fn();
// A Proxy, not a spread: reanimated's exports are getters (the default
// export included) and a spread would drop them
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return new Proxy(actual, {
    get: (target, prop) =>
      prop === 'useReducedMotion' ? () => mockUseReducedMotion() : target[prop],
  });
});

const mockUseHeading = jest.fn();
jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => {
    const degrees = mockUseHeading() as number | null;
    return { heading: { value: degrees ?? 0 }, available: degrees !== null };
  },
}));

// ~96m north of the user — compass-test's own geometry
const Target = { latitude: 51.50636, longitude: -0.0906 };
const User = { latitude: 51.5055, longitude: -0.0906 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the dial', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('under Reduce Motion the needle JUMPS — no 300ms swing to sit through', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    // Facing east with the target due north: the needle belongs at -90
    mockUseHeading.mockReturnValue(90);
    await render(<PointerDial user={User} target={Target} primary="96 m" />);

    // ONE frame — enough for the jumped value to reach the style, and
    // nothing like the 300ms swing: mid-tween this reads ~-5°, which is
    // exactly the revert's failure
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    expect(screen.getByTestId('compass-needle')).toHaveAnimatedStyle({
      transform: [{ rotate: '-90deg' }],
    });
    // The counter-rotating cardinal card jumps with it
    expect(screen.getByTestId('cardinal-card')).toHaveAnimatedStyle({
      transform: [{ rotate: '-90deg' }],
    });
  });

  test('with motion allowed the swing stays — the jump is the setting’s, not everyone’s', async () => {
    mockUseReducedMotion.mockReturnValue(false);
    mockUseHeading.mockReturnValue(90);
    await render(<PointerDial user={User} target={Target} primary="96 m" />);

    await act(async () => {
      jest.advanceTimersByTime(301);
    });
    expect(screen.getByTestId('compass-needle')).toHaveAnimatedStyle({
      transform: [{ rotate: '-90deg' }],
    });
  });
});

describe('the image viewer', () => {
  const images = [{ imageUrl: 'https://img/1.jpg', credit: 'Photo: Test' }];

  test('under Reduce Motion, Close closes NOW — no 180ms exit slide', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onClose = jest.fn();
    await render(<ImageViewer images={images} initialIndex={0} onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Close'));

    // Synchronously — the tween's completion callback could not have
    // run yet, so a revert to the slide leaves this uncalled
    expect(onClose).toHaveBeenCalled();
  });

  test('with motion allowed the exit finishes its story first', async () => {
    mockUseReducedMotion.mockReturnValue(false);
    const onClose = jest.fn();
    await render(<ImageViewer images={images} initialIndex={0} onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).not.toHaveBeenCalled();

    // The 180ms slide lands, THEN the unmount
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
