import { TodayEvent } from '@/types/today';

/** Demo-mode events so the Today section works without API keys. */
export const MockTodayEvents: TodayEvent[] = [
  {
    title: 'Quiz night',
    venue: 'The George Inn',
    time: '8pm',
    detail: '£2 entry, teams of up to six',
    sourceUrl: 'https://example.com/george-inn-quiz',
  },
  {
    title: 'Borough Market open',
    venue: 'Borough Market',
    time: 'Until 5pm',
    sourceUrl: 'https://example.com/borough-market',
  },
];
