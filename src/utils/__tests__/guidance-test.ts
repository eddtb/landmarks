import { guidanceFor } from '@/utils/guidance';

// A two-step route heading north then east
const route = {
  seconds: 300,
  meters: 400,
  steps: [
    {
      instruction: 'Head north on Stoney St',
      meters: 200,
      start: { latitude: 51.5, longitude: -0.09 },
      end: { latitude: 51.5018, longitude: -0.09 },
    },
    {
      instruction: 'Turn right onto Park St',
      meters: 200,
      start: { latitude: 51.5018, longitude: -0.09 },
      end: { latitude: 51.5018, longitude: -0.0871 },
    },
  ],
};

describe('guidanceFor', () => {
  test('at the start, points at the first maneuver', () => {
    const guidance = guidanceFor(route, { latitude: 51.5, longitude: -0.09 });

    expect(guidance?.stepIndex).toBe(0);
    expect(guidance?.step.instruction).toBe('Head north on Stoney St');
    expect(guidance?.target).toEqual(route.steps[0].end);
    expect(guidance?.arrived).toBe(false);
  });

  test('reaching the first corner advances to the next step', () => {
    // 10m short of the first maneuver point — inside the arrival threshold
    const guidance = guidanceFor(route, { latitude: 51.50171, longitude: -0.09 });

    expect(guidance?.stepIndex).toBe(1);
    expect(guidance?.step.instruction).toBe('Turn right onto Park St');
  });

  test('near the destination reports arrived', () => {
    const guidance = guidanceFor(route, { latitude: 51.5018, longitude: -0.08715 });

    expect(guidance?.arrived).toBe(true);
    expect(guidance?.stepIndex).toBe(1);
  });

  test('routes without geometry produce no guidance', () => {
    expect(
      guidanceFor({ seconds: 60, meters: 80, steps: [{ instruction: 'Walk', meters: 80 }] }, {
        latitude: 51.5,
        longitude: -0.09,
      })
    ).toBeNull();
  });
});
