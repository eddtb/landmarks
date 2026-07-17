import { apiUrl } from '@/data/places-client';
import { Plan, PlanCompany, PlanDuration } from '@/types/plan';
import { Coordinates } from '@/utils/geo';

/** Client for the Plan engine. */
export async function fetchPlan(options: {
  center: Coordinates;
  duration: PlanDuration;
  company: PlanCompany;
  /** The ↻: recompose instead of reading the server cache. */
  fresh?: boolean;
}): Promise<Plan> {
  const { center, duration, company, fresh } = options;
  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
    duration,
    company,
    ...(fresh ? { fresh: '1' } : {}),
  });
  const response = await fetch(apiUrl(`/api/plan?${params}`));
  const body = (await response.json()) as { plan?: Plan; error?: string };
  if (!response.ok || !body.plan) {
    throw new Error(body.error ?? `Plan request failed (${response.status})`);
  }
  return body.plan;
}
