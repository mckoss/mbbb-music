// Admin-only Drive sync control:
//   POST /admin/sync  → start a sync (no-op if already running), returns state
//   GET  /admin/sync  → Server-Sent Events stream of progress (replays current
//                       state on connect, then live events, closing at 'end')
// The hook already restricts /admin/* to admins; we re-check defensively.
import { error, json } from '@sveltejs/kit';

import { startSync, getState, subscribe } from '$lib/server/sync-runner';

function requireAdmin(locals: App.Locals) {
  if (locals.user?.role !== 'admin') throw error(403, 'Admins only');
}

export function POST({ locals }) {
  requireAdmin(locals);
  return json(startSync());
}

export function GET({ locals }) {
  requireAdmin(locals);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (ev: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Replay the current state so a late/!reconnecting client is in sync.
      send({ type: 'state', state: getState() });

      const unsub = subscribe((ev) => {
        send(ev);
        if (ev.type === 'end') {
          unsub();
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      // If the sync already finished before this client connected, there will be
      // no further 'end' event — close after the replayed snapshot.
      if (!getState().running) {
        unsub();
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}
