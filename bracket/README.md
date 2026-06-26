# 🦇 Wayne Manor — World Cup Bracket Bash

An interactive World Cup knockout bracket (Round of 32 → Final) where you and
your friends pick every winner and watch how the house votes. Built for Wayne
Manor: gold-and-navy winged **WM** crest, big country flags, and **confetti**
when you crown a champion.

- **Pick winners** in every match — your picks flow forward round by round.
- **"Show the crowd"** reveals how many people picked each team.
- **No passwords.** Friends just type their name to start; returning players
  type-search their name to log back in and load their bracket.
- **Commissioner tools** (behind a code) let you load the *real* 32 teams once
  the draw is set, and lock the bracket when the games begin.

---

## 🔗 How it gets shared & stored (free, no domain to buy)

This runs as a **Cloudflare Worker** with **Workers KV** for storage:

- **Hosting is free** and gives you a public link like
  `https://wayne-manor-bracket.<your-name>.workers.dev` — no domain purchase.
- **Everyone's picks are stored in the cloud (KV)**, so when you share that one
  link, all your friends' votes land in the same place and the crowd numbers are
  live for everyone.

You just share that `workers.dev` link in your group chat. That's it.

> Cloudflare's free tier is *way* more than enough for a frat-sized group
> (100k reads/day, 1k writes/day).

---

## 🚀 Deploy it (about 5 minutes, one time)

You'll need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
Run these from inside the `bracket/` folder:

```bash
# 1. Log in (opens your browser once)
npx wrangler login

# 2. Create the storage namespace
npx wrangler kv namespace create BRACKET_KV
#    -> it prints something like:  id = "abc123..."
#    Copy that id.

# 3. Paste the id into wrangler.jsonc, replacing PASTE_YOUR_KV_NAMESPACE_ID_HERE

# 4. (Recommended) change the Commissioner code in wrangler.jsonc
#    "COMMISSIONER_CODE": "your-secret-here"

# 5. Ship it
npx wrangler deploy
```

`wrangler deploy` prints your shareable URL. Send it to the group. ✅

To update the site later, just run `npx wrangler deploy` again.

---

## 🏟️ Set the real teams (Commissioner)

The app ships with **placeholder matchups** so it works immediately. Once the
real Round-of-32 draw is set:

1. Click the **WM crest** (top-left).
2. Enter your **Commissioner code**.
3. Type the 32 teams **top-to-bottom of the bracket** — `Match 1` is the top
   Round-of-32 game on the left, `Match 9` is the top game on the right half.
   Add a flag emoji (just paste 🇧🇷, 🇦🇷, …) next to each.
4. **Save to cloud** — everyone instantly sees the real teams.

When the tournament kicks off, reopen the crest and tick **"Lock the bracket"**
so no one can change picks — and everyone sees the full crowd results.

> Tip: the team *positions* are what matter — a person's saved pick stays tied
> to a bracket slot even if you fix a team's spelling later.

---

## 🧩 How the bracket works

- 32 teams → 16 → 8 (Quarters) → 4 (Semis) → 2 (Final) → 🏆 Champion.
- Click a team to send it to the next round. Click your pick again to undo it.
- Changing an earlier pick automatically clears any later picks that depended
  on the team you removed.
- The whole diagram scales to fit your screen like a tournament poster, and
  scrolls sideways on phones.

---

## 🛠️ Files

| File | What it does |
|------|--------------|
| `wrangler.jsonc` | Cloudflare Worker + KV config (edit the KV id + code here) |
| `src/index.js` | The Worker: tiny JSON API + serves the site |
| `public/index.html` | App shell + the WM crest SVG |
| `public/styles.css` | The fun festive theme |
| `public/app.js` | Bracket logic, login, confetti, commissioner |
| `public/bracket-data.js` | Bracket tree + the default team list |
| `public/favicon.svg` | The WM crest favicon |

## 👀 Preview without deploying

Open `public/index.html` through any static server (e.g. `npx serve public`).
With no Worker behind it, the app runs in **demo mode** — picks are saved only in
that browser (not shared). Deploy to make it real and shareable.
