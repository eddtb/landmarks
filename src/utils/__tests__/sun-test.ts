import { sunsetAt } from '@/utils/sun';

describe('sunsetAt', () => {
  test('London in July sets around 20:00–21:30 UTC', () => {
    const sunset = sunsetAt({ latitude: 51.48, longitude: -0.01 }, new Date('2026-07-21T12:00:00Z'));
    expect(sunset).not.toBeNull();
    const utcHour = sunset!.getUTCHours() + sunset!.getUTCMinutes() / 60;
    expect(utcHour).toBeGreaterThan(19.8);
    expect(utcHour).toBeLessThan(21.5);
  });

  test('London in December sets around 15:30–16:30 UTC', () => {
    const sunset = sunsetAt({ latitude: 51.48, longitude: -0.01 }, new Date('2026-12-21T12:00:00Z'));
    const utcHour = sunset!.getUTCHours() + sunset!.getUTCMinutes() / 60;
    expect(utcHour).toBeGreaterThan(15.4);
    expect(utcHour).toBeLessThan(16.6);
  });

  test('polar night has no sunset', () => {
    expect(sunsetAt({ latitude: 78.2, longitude: 15.6 }, new Date('2026-12-21T12:00:00Z'))).toBeNull();
  });
});
