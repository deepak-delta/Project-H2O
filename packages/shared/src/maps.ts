/**
 * Client locations are saved as a map link the owner pastes (Google Maps → Share → Copy link).
 * Only links to real map services are accepted, so staff never get sent to some other site.
 */

const MAP_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|maps\.apple\.com|(www\.)?openstreetmap\.org|osm\.org)$/;

/** The first web link in pasted text ("Sri Ganesh Stores https://maps.app.goo.gl/…" → the link). */
export function extractUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  return match ? match[0].replace(/[.,;)\]]+$/, '') : null;
}

export function isMapLink(value: string): boolean {
  // https://host[/path] with no user/password or port tricks.
  const match = /^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i.exec(value);
  if (!match) return false;
  const host = match[1]!.toLowerCase();
  const path = match[2] ?? '/';
  if (!MAP_HOSTS.test(host)) return false;
  // Plain google.com / goo.gl links must point into Maps.
  if (/^(www\.)?google\./.test(host) || host === 'goo.gl') return path.startsWith('/maps');
  return true;
}

/** Where "Open in Maps" goes: the saved link, else a Maps search for the written address. */
export function mapsUrl(place: { mapLink?: string | null; address?: string | null }): string | null {
  if (place.mapLink) return place.mapLink;
  const address = place.address?.trim();
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
}
