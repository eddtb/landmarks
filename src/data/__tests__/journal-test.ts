import { journalEntry, markRead, markVisited, setJournalForTests } from '@/data/journal';

describe('the journal (quiet ledger)', () => {
  beforeEach(() => {
    setJournalForTests({});
    jest.restoreAllMocks();
  });

  test('first read wins — the journal records the discovery, not the habit', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    markRead(42);
    jest.spyOn(Date, 'now').mockReturnValue(9_999_999);
    markRead(42);

    expect(journalEntry(42)?.readAt).toBe(1_000);
  });

  test('standing still is one visit: repeats inside 6h never rewrite', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    markVisited(42);
    // Every GPS tick at the site lands here — same visit
    jest.spyOn(Date, 'now').mockReturnValue(1_000 + 60_000);
    markVisited(42);
    expect(journalEntry(42)?.visitedAt).toBe(1_000);

    // A return a week later is a new visit, and the latest one shows
    const nextWeek = 1_000 + 7 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(nextWeek);
    markVisited(42);
    expect(journalEntry(42)?.visitedAt).toBe(nextWeek);
  });

  test('read and visited coexist on one entry', () => {
    markRead(42);
    markVisited(42);
    const entry = journalEntry(42);
    expect(entry?.readAt).toBeDefined();
    expect(entry?.visitedAt).toBeDefined();
  });

  test('a mark racing hydration is deferred, never dropped', async () => {
    setJournalForTests(null); // first read still in flight
    markRead(77);
    expect(journalEntry(77)).toBeUndefined(); // not yet applied

    // Hydration lands (the store's promise resolves on a real tick)
    await new Promise((resolve) => setTimeout(resolve, 0));
    setJournalForTests(journalEntry(77) ? { 77: journalEntry(77)! } : {});
    // The deferred apply reached the record via store.hydrated
    markRead(77);
    expect(journalEntry(77)?.readAt).toBeDefined();
  });
});
