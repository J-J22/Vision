# crossexam 0.6.1 (vendored)

Unmodified copy of `crossexam.py` from https://pypi.org/project/crossexam/0.6.1/ (MIT, see LICENSE).
Vision runs it as the debate panel: `lib/council.ts` starts `crossexam.py run` with one seat per panel member,
pointing every seat at Vision's own model relay (`/api/council-llm/v1`), which forwards to Groq with
rate-limit pacing and retries. To upgrade, replace `crossexam.py` with a newer release.
