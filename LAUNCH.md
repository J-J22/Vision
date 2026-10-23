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
3. **Create your settings file:**
   - Windows: `copy .env.example .env.local`
   - Mac/Linux: `cp .env.example .env.local`
4. **Add a Groq key:** open it with `notepad .env.local` (Windows) or any editor, and fill in the first line:
   ```
   GROQ_API_KEY=gsk_your_key_here
   ```
   Best: make **your own free key** at https://console.groq.com/keys. Each key has its own limit
   (8,000 tokens per minute per model), so the team won't slow each other down.
   No key yet? Set `VISION_FAKE_AGENTS=1` instead to try the build screen without AI.
5. **Check your PC:**
   ```
   npm run doctor
   ```
   Fix anything marked `FIX`; it says how.
6. **Start it:**
   ```
   npm run dev
   ```
   Open **http://localhost:3000/discovery** in your browser.

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
