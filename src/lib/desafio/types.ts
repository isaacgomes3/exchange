import { z } from "zod";

/** Critérios fixos da área "Sugestão de Desafio" */
export const DESAFIO_CRITERIOS = {
  mercado: "Over/Under 2.5",
  casa: "BetBra",
  oddMin: 1.6,
  oddMax: 1.8,
  janela: "Pré-live 30 min",
  origem: "Surebet Arbishield",
} as const;

export const jogoSchema = z.object({
  id: z.string(),
  liga: z.string(),
  casa: z.string(),
  fora: z.string(),
  inicioEm: z.string(), // ISO
  mercado: z.literal("Over/Under 2.5"),
  selecao: z.enum(["Over 2.5", "Under 2.5"]),
  odd: z.number().positive(),
  bookmaker: z.string(),
  mediaGolsCasa: z.number().nonnegative(),
  mediaGolsFora: z.number().nonnegative(),
  mediaGolsSofridosCasa: z.number().nonnegative(),
  mediaGolsSofridosFora: z.number().nonnegative(),
  bttsPct: z.number().min(0).max(100),
  surebetSpread: z.number().optional(),
});

export type JogoDesafio = z.infer<typeof jogoSchema>;

export const analiseSchema = z.object({
  jogoId: z.string(),
  aprovado: z.boolean(),
  confianca: z.number().min(0).max(100),
  veredito: z.enum(["entrar", "observar", "descartar"]),
  tese: z.string(),
  riscos: z.array(z.string()),
  encaixaCriterios: z.object({
    mercado: z.boolean(),
    faixaOdd: z.boolean(),
    janelaPreLive: z.boolean(),
  }),
  fonte: z.enum(["openai", "heuristica"]),
});

export type AnaliseDesafio = z.infer<typeof analiseSchema>;

export type DesafioPullResult = {
  criterios: typeof DESAFIO_CRITERIOS;
  jogos: JogoDesafio[];
  analises: AnaliseDesafio[];
  analisadoEm: string;
};
