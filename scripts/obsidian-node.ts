/**
 * Node.js shim for Obsidian's browser APIs, used by eval scripts.
 * Provides requestUrl via native fetch. Other Obsidian types are stubbed for
 * TypeScript compilation only — they are never called at runtime from scripts.
 */

// ─── Type stubs (compile-time only) ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type App = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TFile = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TAbstractFile = any;
export const Platform = { isDesktopApp: false, isMobileApp: false };

// ─── requestUrl ───────────────────────────────────────────────────────────────

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
}

export async function requestUrl(
  request: RequestUrlParam | string
): Promise<RequestUrlResponse> {
  const params: RequestUrlParam =
    typeof request === "string" ? { url: request } : request;

  const shouldThrow = params.throw !== false;

  const headers: Record<string, string> = { ...params.headers };
  if (params.contentType) {
    headers["Content-Type"] = params.contentType;
  }

  const res = await fetch(params.url, {
    method: params.method ?? "GET",
    headers,
    body: params.body as BodyInit | undefined,
  });

  const arrayBuffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  if (shouldThrow && !res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}\n${text}`);
  }

  return { status: res.status, headers: responseHeaders, arrayBuffer, json, text };
}
