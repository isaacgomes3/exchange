import type { LiveGame } from "@/types/exchange";

export const INITIAL_GAMES: LiveGame[] = [
  {
    id: "game-1",
    externalId: "ex-1001",
    sport: "futebol",
    competition: "Brasileirão Série A",
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    status: "LIVE",
    score: { home: 1, away: 0 },
    minute: 67,
    totalVolume: 245000,
    lastUpdated: new Date().toISOString(),
    markets: [
      {
        id: "m1",
        name: "Resultado Final",
        selections: [
          { id: "s1", name: "Flamengo", backOdds: 1.85, layOdds: 1.87, volume: 98000 },
          { id: "s2", name: "Empate", backOdds: 3.4, layOdds: 3.45, volume: 52000 },
          { id: "s3", name: "Palmeiras", backOdds: 5.2, layOdds: 5.3, volume: 95000 },
        ],
      },
    ],
  },
  {
    id: "game-2",
    externalId: "ex-1002",
    sport: "futebol",
    competition: "Premier League",
    homeTeam: "Manchester United",
    awayTeam: "Liverpool",
    status: "LIVE",
    score: { home: 2, away: 2 },
    minute: 78,
    totalVolume: 512000,
    lastUpdated: new Date().toISOString(),
    markets: [
      {
        id: "m2",
        name: "Resultado Final",
        selections: [
          { id: "s4", name: "Man United", backOdds: 2.1, layOdds: 2.12, volume: 180000 },
          { id: "s5", name: "Empate", backOdds: 2.8, layOdds: 2.82, volume: 150000 },
          { id: "s6", name: "Liverpool", backOdds: 4.5, layOdds: 4.6, volume: 182000 },
        ],
      },
    ],
  },
  {
    id: "game-3",
    externalId: "ex-1003",
    sport: "futebol",
    competition: "La Liga",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    status: "LIVE",
    score: { home: 0, away: 1 },
    minute: 34,
    totalVolume: 890000,
    lastUpdated: new Date().toISOString(),
    markets: [
      {
        id: "m3",
        name: "Resultado Final",
        selections: [
          { id: "s7", name: "Real Madrid", backOdds: 2.4, layOdds: 2.42, volume: 320000 },
          { id: "s8", name: "Empate", backOdds: 3.1, layOdds: 3.15, volume: 280000 },
          { id: "s9", name: "Barcelona", backOdds: 3.2, layOdds: 3.25, volume: 290000 },
        ],
      },
    ],
  },
  {
    id: "game-4",
    externalId: "ex-1004",
    sport: "tenis",
    competition: "ATP Wimbledon",
    homeTeam: "Alcaraz C.",
    awayTeam: "Sinner J.",
    status: "LIVE",
    score: { home: 2, away: 1 },
    minute: 0,
    totalVolume: 156000,
    lastUpdated: new Date().toISOString(),
    markets: [
      {
        id: "m4",
        name: "Vencedor",
        selections: [
          { id: "s10", name: "Alcaraz", backOdds: 1.55, layOdds: 1.57, volume: 85000 },
          { id: "s11", name: "Sinner", backOdds: 2.8, layOdds: 2.85, volume: 71000 },
        ],
      },
    ],
  },
  {
    id: "game-5",
    externalId: "ex-1005",
    sport: "futebol",
    competition: "Champions League",
    homeTeam: "Bayern Munich",
    awayTeam: "PSG",
    status: "SUSPENDED",
    score: { home: 1, away: 1 },
    minute: 55,
    totalVolume: 420000,
    lastUpdated: new Date().toISOString(),
    markets: [
      {
        id: "m5",
        name: "Resultado Final",
        selections: [
          { id: "s12", name: "Bayern", backOdds: 2.0, layOdds: 2.02, volume: 150000 },
          { id: "s13", name: "Empate", backOdds: 3.0, layOdds: 3.05, volume: 130000 },
          { id: "s14", name: "PSG", backOdds: 4.0, layOdds: 4.1, volume: 140000 },
        ],
      },
    ],
  },
];
