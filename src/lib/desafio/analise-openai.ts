import { analisarHeuristica } from "./analise-heuristica";
import { analiseSchema, DESAFIO_CRITERIOS, type AnaliseDesafio, type JogoDesafio } from "./types";

function buildPrompt(jogos: JogoDesafio[]): string {
  return `Você é um analista de indicações para a área "Sugestão de Desafio" de uma exchange/surebet.

Critérios fixos do Desafio:
- Mercado: ${DESAFIO_CRITERIOS.mercado}
- Casa: ${DESAFIO_CRITERIOS.casa}
- Faixa de odd: ${DESAFIO_CRITERIOS.oddMin}–${DESAFIO_CRITERIOS.oddMax}
- Janela de entrada: ${DESAFIO_CRITERIOS.janela}
- Origem: ${DESAFIO_CRITERIOS.origem}

Contexto: a lista cobre jogos das próximas 24h. Só marque "entrar" se também estiver na janela pré-live de 30 min e na faixa de odd. Jogos mais distantes devem ser "observar" (promissores) ou "descartar".

Analise cada jogo e devolva APENAS um JSON array (sem markdown) com objetos neste formato:
{
  "jogoId": string,
  "aprovado": boolean,
  "confianca": number 0-100,
  "veredito": "entrar" | "observar" | "descartar",
  "tese": string curta em português,
  "riscos": string[],
  "encaixaCriterios": { "mercado": boolean, "faixaOdd": boolean, "janelaPreLive": boolean },
  "fonte": "openai"
}

Jogos:
${JSON.stringify(jogos, null, 2)}`;
}

export async function analisarComOpenAI(
  jogos: JogoDesafio[],
  apiKey: string,
  model = "gpt-4.1-mini"
): Promise<AnaliseDesafio[]> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Responda só com JSON válido. Use a chave raiz \"analises\" com o array de análises.",
        },
        { role: "user", content: buildPrompt(jogos) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { analises?: unknown } | unknown[];
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { analises?: unknown }).analises)
      ? (parsed as { analises: unknown[] }).analises
      : [];

  const byId = new Map(jogos.map((j) => [j.id, j]));
  const out: AnaliseDesafio[] = [];

  for (const item of list) {
    const withFonte = { ...(item as object), fonte: "openai" };
    const result = analiseSchema.safeParse(withFonte);
    if (result.success && byId.has(result.data.jogoId)) {
      out.push(result.data);
    }
  }

  // Garante 1 análise por jogo (fallback heurístico se a IA omitir algum)
  return jogos.map((jogo) => out.find((a) => a.jogoId === jogo.id) ?? analisarHeuristica(jogo));
}
