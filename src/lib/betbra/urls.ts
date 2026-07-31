import { getBetBraConfig } from "./config";

const SPORT_SLUG: Record<number, string> = {
  15: "soccer",
  9: "tennis",
};

export function getEventDeepLink(sportId: number, eventId: string): string {
  const { siteOrigin } = getBetBraConfig();
  const slug = SPORT_SLUG[sportId] ?? "soccer";
  return `${siteOrigin}/b/exchange/sport/${slug}/event/${eventId}`;
}

export function getEventDetailReferer(sportId: number, eventId: string): string {
  return getEventDeepLink(sportId, eventId);
}
