// Whether the server is reachable, as the app-wide connection banner sees it
// (src/routes/+layout.svelte): the service worker reports failed and succeeded
// requests, the window reports airplane mode, and a light probe notices
// recovery while the banner is up. Components that showed an error because the
// network dropped (the score pager) subscribe so they can retry by themselves
// the moment it comes back — the window's own `online` event often never fires
// in the installed iPad app.
import { writable } from 'svelte/store';

export const serverReachable = writable(true);
