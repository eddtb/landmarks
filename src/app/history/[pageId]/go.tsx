import { useLocalSearchParams } from 'expo-router';

import { GoMode } from '@/components/go-mode';
import { getCachedHistoryItem } from '@/data/history-client';

export default function HistoryGoScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));
  return <GoMode name={item?.title ?? ''} target={item?.coordinates} />;
}
