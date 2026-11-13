import { NextResponse } from "next/server";
import { wordsToDigits } from "@/lib/numbers";
import { amountOverrides, parseWithRules, refineWithRules, TRADABLE_HINT, toIntent } from "@/lib/parse";
import type { Intent } from "@/lib/types";
import { universeForPrompt } from "@/lib/universe";
import { SYMBOLS } from "@/lib/types";

// Tried in order; the first model that returns valid JSON for the request wins.
const MODELS = (
  process.env.OPENROUTER_MODELS ??
  "baidu/ernie-5.5-flash-preview:free,nvidia/nemotron-3.5-super-vl:free,recursive/flint-v1.0:free,liquid/lfm-3-1.7b:free"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const SYSTEM = `You are the investment advisor inside a portfolio app for beginners and professionals. Turn the user's request into JSON. Reply with ONLY one JSON object, no prose, no markdown:
{"capitalUsd": number, "allocations": {"BTC": number, ...}, "targetRoiPct": number, "horizonDays": integer, "stopLossPct": number|null, "note": string, "advised": boolean}
THE ONLY ASSETS YOU MAY USE (ticker | name | type | network | real past behaviour):
${universeForPrompt()}
Rules:
- Allocations are percentages (60 means 60) and sum to at most 100; the remainder stays in USDC cash. Use at most 6 assets.
- Never output any other asset. If the user names something not on the list (for example DOGE or SOL), substitute the closest asset from the list and say so in "note".
- If the user gives weights, use them exactly. If they do not (for example "give me the best returns" or "safe strategy for 30% in 2 days"), YOU recommend a mix: match risk to the goal and horizon, diversify across types (crypto, stocks, index funds, bonds, gold) unless they asked for one type, and prefer low-risk assets for "safe", high-risk for "aggressive". A small amount like $10 is fine; do not refuse.
- "advised" is true only when YOU chose the weights because the user gave none, otherwise false.
- The goal and the stop may be given as MONEY instead of a percentage. Convert using capitalUsd: with capitalUsd 10, "target 12 USDC" means targetRoiPct 20 and "stop at 9" means stopLossPct 10 (never 12 and 9 percent). A number with no % sign that is close to the capital amount is money.
- Convert months to 30 days, weeks to 7, years to 365. If no horizon is given use 30. If no target is given pick a modest realistic one for the risk you chose (for example 5 to 15) instead of the highest number. stopLossPct is null unless the user asked for a stop loss, but you may mention in "note" that one would help.
- "note" is 2 short sentences in plain everyday words a beginner understands. First say what you chose and why. Then give an honest warning if the goal is unrealistic for the time or the risk. No jargon, no numbers about the future, no promises.`;

const EDIT_SYSTEM = (current: Intent) => `${SYSTEM}
The user is EDITING an existing strategy. Current strategy as JSON:
${JSON.stringify({
  capitalUsd: current.capitalUsd,
  allocations: Object.fromEntries(Object.entries(current.weights).map(([k, v]) => [k, Math.round(v! * 1000) / 10])),
  targetRoiPct: current.targetRoi * 100,
  horizonDays: current.horizonDays,
  stopLossPct: current.stopLoss != null ? current.stopLoss * 100 : null,
})}
Apply ONLY the change the user asks for and return the FULL updated JSON. Keep every other field unchanged. If the change adds weight to one asset and the total would exceed 100, reduce the others proportionally. "note" should say in one plain sentence what changed.`;

/** The free tier shares one daily quota across models, so a 429 means every model will refuse. */
class RateLimited extends Error {
  constructor() {
    super("AI free-tier daily limit reached");
  }
}

// Repeated prompts are served from memory so they do not burn the small free quota.
const cache = new Map<string, { at: number; value: { intent: Intent; model: string } }>();
const TTL = 10 * 60_000;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

// OPENROUTER_API_KEYS="k1,k2" (or the older single OPENROUTER_API_KEY). A key that hits its daily limit hands over to the next.
const KEYS = (process.env.OPENROUTER_API_KEYS ?? process.env.OPENROUTER_API_KEY ?? "").split(",").map((k) => k.trim()).filter(Boolean);

async function ask(model: string, key: string, system: string, prompt: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 2500, // the fallback models are reasoning models and spend tokens thinking first
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return extractJson(body.choices?.[0]?.message?.content ?? "");
}

async function viaLlm(prompt: string, current: Intent | undefined, userText: string) {
  if (!KEYS.length) throw new Error("OPENROUTER_API_KEYS not set");
  const system = current ? EDIT_SYSTEM(current) : SYSTEM;
  const failures: string[] = [];
  for (const key of KEYS) {
    let limited = false;
    for (const model of MODELS) {
      try {
        const intent = toIntent(await ask(model, key, system, userText), prompt);
        return { intent: current ? { ...intent, advised: undefined } : intent, model };
      } catch (e) {
        if (e instanceof RateLimited) { limited = true; break; } // every model shares this key's daily quota: try the next key
        failures.push(`${model.split("/")[1]?.split(":")[0] ?? model}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
      }
    }
    if (!limited) break; // the key worked; the models just could not answer, a second key would not help
  }
  if (!failures.length) throw new RateLimited();
  throw new Error(failures.join(" | "));
}
export async function POST(req: Request) {
  let body: { prompt?: string; current?: Intent };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const { prompt: raw, current } = body ?? {};
  const prompt = raw ? wordsToDigits(raw) : raw; // "ten thousand dollars" works as typed text too
  if (prompt?.trim() && !current && !/\d/.test(prompt)) return NextResponse.json({ error: "Tell me how much you want to invest (for example \"$500\") so I can build the strategy. I never guess an amount." }, { status: 422 });
  if (!prompt?.trim() || prompt.length > 1000) return NextResponse.json({ error: "Prompt required (max 1000 chars)" }, { status: 400 });
  if (current && !SYMBOLS.some((k) => (current.weights?.[k] ?? 0) > 0)) return NextResponse.json({ error: "Invalid current strategy" }, { status: 400 });

  const fullPrompt = current ? `${current.prompt} | edit: ${prompt}` : prompt;
  let llmError: string | undefined;
  const ck = JSON.stringify([prompt, current ?? null]);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ...hit.value, via: "llm", cached: true });
  try {
    const r = await viaLlm(fullPrompt, current, prompt);
    // goals/stops given as money are converted deterministically; small models tend to read "12 USDC" as 12%
    const ov = amountOverrides(prompt, current?.capitalUsd ?? r.intent.capitalUsd);
    if (ov.targetRoiPct != null) r.intent = { ...r.intent, targetRoi: ov.targetRoiPct / 100 };
    if (ov.stopLossPct != null) r.intent = { ...r.intent, stopLoss: ov.stopLossPct / 100 };
    if (cache.size > 200) cache.clear();
    cache.set(ck, { at: Date.now(), value: r });
    return NextResponse.json({ intent: r.intent, via: "llm", model: r.model });
  } catch (e) {
    llmError = e instanceof Error ? e.message : String(e);
  }
  try {
    const intent = current ? refineWithRules(current, prompt) : parseWithRules(prompt);
    return NextResponse.json({ intent, via: "rules", llmError });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not understand the request", llmError }, { status: 422 });
  }
}
