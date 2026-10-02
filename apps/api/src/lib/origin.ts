import type { FastifyRequest } from 'fastify';

function parseOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The browser-supplied Origin (or Referer) of the request, if it matches the host serving it. */
export function sameOriginSource(req: FastifyRequest): URL | null {
  const source = parseOrigin(req.headers.origin) ?? parseOrigin(req.headers.referer);
  if (!source) return null;
  return source.host === req.host ? source : null;
}

/** Origin used for WebAuthn: the page's origin, which by now is known to be same-origin. */
export function requestOrigin(req: FastifyRequest): string {
  return sameOriginSource(req)?.origin ?? `${req.protocol}://${req.host}`;
}
