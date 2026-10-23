# Vision

A platform where a team of AI agents takes an app idea from first conversation to a running website.

1. **Discovery**: a few questions about the user set how technical the rest of the conversation is.
2. **AI parliament**: four reviewers (architect, product, security & payments, skeptic), each a different model, review the plan. A chair picks the questions that matter, a translator words them for the user's level, and this repeats until confidence reaches 80% or 3 rounds pass.
3. **Blueprint**: the final plan plus the parliament's minutes (decisions, defaults, disagreements).
4. **Team build**: a planner splits the Blueprint into tasks; backend and frontend agents work in dependency order and leave each other notes.
5. **Test & fix**: the generated app starts in its own folder and 12 edge-case tests run against it. QA explains failures and the backend agent gets one try to fix them.

Built for a 24-hour hackathon. The first app type is a marketplace.

## Run it

Step-by-step guide (Windows too): [LAUNCH.md](LAUNCH.md)

Needs Node 22.13+ and Python 3.9+.

```bash
npm run setup                 # installs Vision and the marketplace template
npm run doctor                # checks this PC and says exactly what to fix
npm run dev                   # http://localhost:3000, then plug in free AI keys at /parts
```

`npm run models` lists the models your Groq key can use.

- **http://localhost:3000**: the full flow
- **http://localhost:3000/parts**: plug in AI keys (stored encrypted) and choose which AI runs each position
- **http://localhost:3000/build/sample**: skips Discovery and builds `lib/sample-blueprint.json`

**No Groq key yet, or working on screens?** Set `VISION_FAKE_AGENTS=1` in `.env.local`. The build agents then skip Groq and use the hand-written reference code, so a build finishes in about 15 seconds with all tests passing. (Discovery always needs a key.)

## Where things are

| Path | What | Owner |
|---|---|---|
| `lib/types.ts` | Shared data formats. Tell the team before changing. | everyone |
| `lib/llm.ts`, `lib/config.ts` | Groq wrapper (JSON validation, retries, rate limits) and model names | Person 2 |
| `lib/agents/discovery.ts` | Profile questions, first Blueprint draft, merging answers | Person 1 |
| `lib/parliament/` | Members, chair, translator, confidence score, one round | Person 1 |
| `lib/discovery-session.ts`, `app/api/discovery` | Discovery steps and session state | Person 1 |
| `app/discovery` | Discovery screen | Person 1 |
| `lib/agents/planner.ts` | Blueprint → tasks | Person 2 |
| `lib/runner.ts`, `app/api/build` | Runs tasks, tests, fix loop; streams events | Person 2 |
| `app/build/[id]` | Task board, team chat, tests, preview link | Person 2 |
| `lib/agents/coders.ts` | Backend and frontend agents | Person 3 |
| `lib/agents/qa.ts` | Explains failed tests, tells the backend what to fix | Person 2 |
| `lib/sandbox.ts` | Workspaces, starting generated apps, running tests | Person 3 |
| `templates/marketplace` | Starter app the agents extend; `CONVENTIONS.md` is the agents' rulebook | Person 3 |
| `tests/edge-cases/run.mjs` | The 12 edge-case tests | Person 3 |
| `tests/reference` | Hand-written core API; `npm run test:reference` proves the tests are right | Person 3 |

Generated apps go in `workspaces/<build id>/` (not committed).

## Docs

- [15-hour build plan](PLAN.md): scope, architecture, contracts, who does what
- [Build night plan by person](docs/build-plan.html): open in a browser
- [Project plan](docs/plan.html): open in a browser
