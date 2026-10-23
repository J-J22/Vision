// The QA agent: reads failed tests, explains them in plain words and tells the backend what to fix.
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import type { TestResult } from "../types";

const QaSchema = z.object({
  summary: z.string(),
  fixes: z.array(z.object({ file: z.string(), instruction: z.string() })).default([]),
});
export type QaReport = z.infer<typeof QaSchema>;

const SYSTEM = `You are the QA tester on an AI developer team. Automatic edge-case tests ran against the marketplace
the team built. For the failed tests:
- "summary": one or two plain sentences a non-technical person understands (e.g. "Two people could buy the same last book.")
- "fixes": for each file that must change, a precise instruction for the backend developer.
Only name files in routes/ or db/. Return {"summary": "...", "fixes": [{"file": "routes/020_orders.js", "instruction": "..."}]}`;

export async function reviewFailures(failures: TestResult[], files: Record<string, string>): Promise<QaReport> {
  const fallback: QaReport = {
    summary: `${failures.length} test${failures.length === 1 ? "" : "s"} failed: ${failures.map((f) => f.name).join("; ")}.`,
    fixes: [],
  };
  if (config.fakeAgents) return fallback;
  try {
    return await callLLM({
      label: "qa",
      slot: "qa",
      system: SYSTEM,
      schema: QaSchema,
      messages: [
        {
          role: "user",
          content: `FAILED TESTS:\n${failures.map((f) => `- ${f.name}: ${f.detail}`).join("\n")}\n\nBACKEND FILES:\n${Object.entries(files)
            .filter(([p]) => (p.startsWith("routes/") || p.startsWith("db/")) && !p.startsWith("routes/00") && p !== "db/001_core.sql")
            .map(([p, c]) => `--- ${p}\n${c.slice(0, 4000)}`)
            .join("\n\n")}`,
        },
      ],
    });
  } catch (err) {
    console.warn(`[qa] failed: ${err}`);
    return fallback;
  }
}
