import { useLocalSearchParams } from 'expo-router';

import { GoMode } from '@/components/go-mode';
import { usePlaceDetails } from '@/hooks/use-place-details';

export default function GoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  const place = state.status === 'ready' ? state.details : summary;
  return <GoMode name={place?.name ?? ''} target={place?.coordinates} />;
}
