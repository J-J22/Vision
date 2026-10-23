// AI parts: which providers are plugged in, which model sits in each slot, and how well it fits.
// GET: everything the AI parts page shows. Keys never leave the server; only their last 4 characters do.
// POST { action: "save-key", provider, key } | { action: "remove-key", provider } | { action: "choose", slot, part }
import { NextResponse } from "next/server";
import { tokensUsed } from "@/lib/activity";
import { checkKey, fetchModels, forgetModels, isProvider, modelsFor, PROVIDER_IDS, PROVIDERS, providerStatus } from "@/lib/providers";
import { chainFor, isSlot, parsePart, partId, ratingOf, readChoices, recommended, setChoice, SLOTS, verdict } from "@/lib/slots";
import { removeKey, saveKey } from "@/lib/vault";

export const dynamic = "force-dynamic";

async function snapshot() {
  const providers = await Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const p = PROVIDERS[id];
      const models = await modelsFor(id);
      return {
        id,
        name: p.name,
        keyUrl: p.keyUrl,
        goodAt: p.goodAt,
        limits: [p.tokensPerMinute ? `${p.tokensPerMinute.toLocaleString()} tokens/min` : "", p.requestsPerMinute ? `${p.requestsPerMinute} requests/min` : ""].filter(Boolean).join(" · "),
        status: providerStatus(id),
        models: models.map((m) => ({ id: m.id, context: m.context, rated: Boolean(ratingOf(m.id)) })),
      };
    }),
  );
  const contextOf = (provider: string, model: string) => providers.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.context;
  const choices = readChoices();
  const used = tokensUsed();

  const slots = await Promise.all(
    SLOTS.map(async (s) => {
      const chain = await chainFor(s.id);
      const rec = await recommended(s.id);
      const describe = (part: (typeof chain)[number]) => ({
        part: partId(part),
        provider: part.provider,
        model: part.model,
        verdict: verdict(s.id, part, { id: part.model, context: contextOf(part.provider, part.model) }),
        rating: ratingOf(part.model, contextOf(part.provider, part.model)),
        tokens: used[partId(part)] ?? 0,
      });
      // Providers this slot would like that aren't plugged in yet, so the page can ask for their key right here
      const wants = [...new Set(s.prefer.map((p) => p.provider))].filter((id) => providerStatus(id).source === "none");
      return {
        id: s.id,
        stage: s.stage,
        title: s.title,
        job: s.job,
        needs: s.needs,
        chosen: choices[s.id] ?? null,
        recommended: rec[0] ? partId(rec[0]) : null,
        chain: chain.map(describe),
        wants,
      };
    }),
  );
  return { providers, slots };
}

export async function GET() {
  return NextResponse.json(await snapshot());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  try {
    if (action === "save-key" || action === "remove-key") {
      const provider = String(body.provider ?? "");
      if (!isProvider(provider)) throw new Error("Unknown provider");
      if (action === "save-key") {
        const key = String(body.key ?? "").trim();
        if (key.length < 10) throw new Error("That doesn't look like a full API key.");
        // Check the key with the provider before storing it: list its models, then get a real 1-token reply
        await checkKey(provider, key, await fetchModels(provider, key));
        saveKey(provider, key);
      } else {
        removeKey(provider);
      }
      forgetModels(provider);
    } else if (action === "choose") {
      const slot = String(body.slot ?? "");
      if (!isSlot(slot)) throw new Error("Unknown position");
      const part = body.part ? String(body.part) : null;
      if (part && !parsePart(part)) throw new Error("Unknown part");
      setChoice(slot, part);
    } else {
      throw new Error(`Unknown action ${action}`);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json(await snapshot());
}
