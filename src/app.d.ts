// See https://svelte.dev/docs/kit/types#app.d.ts
/// <reference types="@sveltejs/enhanced-img" />
import type { SessionUser } from '$lib/types';

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      // The signed-in user (null when unauthenticated). role is null when
      // authenticated but not yet approved.
      user: SessionUser | null;
      // True when OAuth isn't configured and the app is running open.
      authOpen: boolean;
      // Version of the browser bundle that initiated this write, when supplied.
      // Legacy clients that predate write stamping are null/unknown.
      clientVersion: string | null;
    }
    interface PageData {
      user?: SessionUser | null;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
