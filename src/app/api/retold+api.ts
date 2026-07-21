import { getRetold } from '@/server/retold';

/**
 * GET /api/retold?area=Greenwich
 *
 * The area's story retold in parts — one free-tier call per area per
 * month, cached. 404 means "show the original article instead": the
 * retelling improves the read, it never gates it.
 */
export async function GET(request: Request) {
  const area = new URL(request.url).searchParams.get('area');
  if (!area) {
    return Response.json({ error: 'Expected area' }, { status: 400 });
  }

  try {
    const retold = await getRetold(area);
    if (!retold) {
      return Response.json({ error: 'No retelling available' }, { status: 404 });
    }
    return Response.json({ retold });
  } catch (error) {
    console.error('Retold failed:', error);
    return Response.json({ error: 'Retold failed' }, { status: 502 });
  }
}
