/**
 * A minimal incremental SSE frame reader for the streaming clients:
 * feed network chunks as they arrive; complete `event`/`data` frames
 * come back the moment their blank-line terminator lands, and a
 * half-received frame is never surfaced. No id/retry/comment support —
 * the retold stream uses none of it, and a parser this small beats a
 * package (the dependency diet).
 */

export type SseFrame = { event: string; data: string };

export function makeSseFrameReader(): { feed(chunk: string): SseFrame[] } {
  let buffer = '';
  return {
    feed(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''));
          }
        }
        if (data.length > 0) {
          frames.push({ event, data: data.join('\n') });
        }
      }
      return frames;
    },
  };
}
