/**
 * Parse BetBra deep links and ArbiShield market labels.
 */

export type BetBraLinkRef = {
  eventId: string;
  marketId: string | null;
  sportSlug: string;
};

/** https://.../event/123/market/456 or /event/123 */
export function parseBetBraLink(link: string | null | undefined): BetBraLinkRef | null {
  if (!link) return null;
  const eventMatch = link.match(/\/event\/(\d+)/i);
  if (!eventMatch) return null;
  const marketMatch = link.match(/\/market\/(\d+)/i);
  const sportMatch = link.match(/\/sport\/([a-z0-9_-]+)\//i);
  return {
    eventId: eventMatch[1],
    marketId: marketMatch?.[1] ?? null,
    sportSlug: sportMatch?.[1] ?? "soccer",
  };
}

/**
 * "Lay 0x1" → "0-1"; "Lay 2x2" → "2-2"
 * Returns null for non scoreline labels (e.g. Goleada).
 */
export function layLabelToScoreline(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = name.trim().match(/^lay\s+(\d+)\s*[x×:-]\s*(\d+)$/i);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

export function sportSlugToId(slug: string): number {
  const s = slug.toLowerCase();
  if (s === "tennis" || s === "tenis") return 9;
  return 15; // soccer default
}
