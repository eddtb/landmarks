import { Place } from '@/types/place';

/**
 * Grouping for the type-filter menu. Google's primary labels are too
 * granular to list flat — Food alone spreads ~34 places across ~20
 * labels ("Chinese Restaurant", "Steak House"…) — so labels sharing a
 * head noun fold into one group with the specifics a submenu deeper.
 * The heuristic is suffix-based with a small override list where the
 * last word lies about the kind ("Steak House" is a restaurant, not
 * a house).
 */
const GroupOverrides: Record<string, string> = {
  'Steak House': 'Restaurant',
  'Bar & Grill': 'Bar',
};

export function typeGroup(label: string): string {
  const override = GroupOverrides[label];
  if (override) {
    return override;
  }
  if (/ Restaurant$/.test(label)) {
    return 'Restaurant';
  }
  if (/ Bar$/.test(label)) {
    return 'Bar';
  }
  if (/museum$/i.test(label)) {
    return 'Museum';
  }
  return label;
}

/** 'all' shows everything; group:X matches every label in the group. */
export type TypeFilter = 'all' | `group:${string}` | `label:${string}`;

export function matchesTypeFilter(place: Place, filter: TypeFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (!place.primaryLabel) {
    return false;
  }
  if (filter.startsWith('label:')) {
    return place.primaryLabel === filter.slice('label:'.length);
  }
  return typeGroup(place.primaryLabel) === filter.slice('group:'.length);
}

export type TypeGroup = {
  group: string;
  count: number;
  /** Distinct labels folded into this group, largest first. */
  labels: { label: string; count: number }[];
};

/** Groups present in the loaded results, largest first — never a stale option. */
export function buildTypeGroups(places: Place[]): TypeGroup[] {
  const groups = new Map<string, Map<string, number>>();
  for (const place of places) {
    if (!place.primaryLabel) {
      continue;
    }
    const group = typeGroup(place.primaryLabel);
    const labels = groups.get(group) ?? new Map<string, number>();
    labels.set(place.primaryLabel, (labels.get(place.primaryLabel) ?? 0) + 1);
    groups.set(group, labels);
  }
  return [...groups.entries()]
    .map(([group, labels]) => ({
      group,
      count: [...labels.values()].reduce((sum, count) => sum + count, 0),
      labels: [...labels.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The count line's noun: "places", "pubs", "coffee shops". Lowercase
 * by design — the sentence stays quiet ("7 coffee shops · Nearest").
 * Pass the live count so one result reads "1 coffee shop", not
 * "1 coffee shops".
 */
export function typeNoun(filter: TypeFilter, count = Infinity): string {
  const name = filter === 'all' ? 'place' : filter.slice(filter.indexOf(':') + 1).toLowerCase();
  return count === 1 ? name : pluralize(name);
}

function pluralize(noun: string): string {
  if (/[^aeiou]y$/.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }
  if (/(s|sh|ch|x)$/.test(noun)) {
    return `${noun}es`;
  }
  return `${noun}s`;
}
