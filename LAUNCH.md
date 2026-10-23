# Launching Vision on your PC

## First time

1. **Get the code** (you need access to the private repo first):
   ```
   git clone https://github.com/J-J22/Vision.git
   cd Vision
   ```
2. **Install everything:**
   ```
   npm run setup
   ```
3. **Keys:** you can plug them in on the website after step 6 (**AI parts** page, stored encrypted), or put them in a file:
   - Windows: `copy .env.example .env.local`, Mac/Linux: `cp .env.example .env.local`, then fill in any keys you have.
   Free keys: Groq (https://console.groq.com/keys), Gemini (https://aistudio.google.com/apikey),
   NVIDIA (https://build.nvidia.com), Mistral (https://console.mistral.ai/api-keys).
   Make **your own** keys: each has its own limits, so the team won't slow each other down.
4. No key yet? Set `VISION_FAKE_AGENTS=1` in `.env.local` to try the build screen without AI.
5. **Check your PC:**
   ```
   npm run doctor
   ```
   Fix anything marked `FIX`; it says how.
6. **Start it:**
   ```
   npm run dev
   ```
   Open **http://localhost:3000** in your browser. **http://localhost:3000/parts** is where you plug in keys and choose which AI runs each step.

## Every time after that

```
git pull
npm run setup
npm run dev
```

## Good to know

- **Run only one `npm run dev` per folder.** Two at once overwrite each other's files and pages break.
  Stop a server with **Ctrl+C** in its terminal.
- **Never commit `.env.local`** or paste your key in chats. It's already ignored by git.
- A build takes about 9 minutes on Groq's free tier. **http://localhost:3000/build/sample** builds a ready-made plan,
  and with `VISION_FAKE_AGENTS=1` it finishes in about 15 seconds.
- "fetch failed" or "network error" in the terminal means the internet dropped. It retries on its own;
  if it keeps happening, try a phone hotspot.
