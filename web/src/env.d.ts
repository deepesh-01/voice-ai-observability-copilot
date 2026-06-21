/// <reference types="vite/client" />

// Injected into the served SPA by the backend (server/src/index.ts) — the read-API
// bearer token, echoed by api.ts on every /api request. Absent in local dev.
interface Window {
  __API_TOKEN__?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
