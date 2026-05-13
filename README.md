# Pinewood Derby & Beaver Buggies Race Scheduler

**Live app: [derby.987.ca](https://derby.987.ca)**

A free, open-source web app for running pinewood derby races, beaver buggy rallies, kub kar rallies, and similar gravity-car race nights for **Cub Scouts, Scouts, Beavers, Cubs, Boy Scouts, Girl Guides, Brownies, Sparks, AWANA, and 4-H clubs**. No signup. No installs. No fees. Just open the page, name your race, share the link with parents, and start running heats.

If your pack, troop, colony, or unit puts on an annual derby — whether you call it a **pinewood derby**, **beaver buggies**, **kub kar rally**, **powderpuff derby**, **awana grand prix**, **scout car race**, or just **the derby** — this is built for you.

---

## Try it now

👉 **[derby.987.ca](https://derby.987.ca)** — start a race in 10 seconds. Free forever.

---

## What it does

- **Generates a lane-fair heat schedule** so every car runs in every lane an equal number of times (no car gets stuck in the slow lane).
- **Live multi-device scorekeeping.** Open the race URL on any phone, tablet, or laptop. Results sync across every connected device in real time via Firebase Realtime Database.
- **Parents follow along in their pocket.** Share the race link in your group chat. Anyone who opens it sees heats and standings update live as the race runs.
- **Pick your trade-off**: fewer runs per car for a fast event, more runs for tighter standings. Built-in presets (Quick / Balanced / High / Tournament) or set a custom number.
- **Tag-team scorekeeping** with optional passcode protection. Hand off the device, change scorekeepers mid-race, and every recorded result is stamped with the scorekeeper's name and timestamp.
- **Handles DNFs and ties.** Tied cars share the same finishing place (1, 1, 3 — Olympic-style).
- **Export to Excel** when the race is done — heat schedule, lane assignments, lane-fairness audit, full standings — one `.xlsx` for your records.
- **Mobile-first responsive design.** The whole app is usable on a phone at the start line.
- **No accounts. No tracking. No ads.** Race data lives in Firebase Realtime Database under a private per-race URL (UUID). Bookmark the URL to come back later.

---

## How it works

1. **Open [derby.987.ca](https://derby.987.ca)** and click **Start a New Race**. Give it a name (or accept the default "Derby · {today}").
2. **Setup tab**: enter your number of lanes (max 8), number of cars, and runs per car. Optionally turn on a passcode so only trusted helpers can be scorekeepers.
3. Hit **Generate Schedule**. The app builds a lane-fair schedule — every car runs in every lane the same number of times (see the "Lane Fairness" tab of the .xlsx export to verify).
4. **Name the cars** on the Cars tab (or leave them as "Car 1", "Car 2", etc).
5. **Run the heats.** On the Heats tab, the scorekeeper taps **1 / 2 / 3 / 4 / DNF** for each lane after each run. Results sync instantly to every viewer.
6. **Parents watch standings update live** on their phones. The Standings tab shows the top 5 podium plus a full standings table with points, races, place tallies, and DNFs.
7. **Done?** Hit Export .xlsx to download the schedule and final results. Or click the now-green progress bar at the top of the Heats page to jump straight to standings.

The whole event runs out of one shared URL. Print the URL, write it on a whiteboard, text it to the parents' group chat — whatever works for your pack.

---

## Why this exists

Most existing pinewood derby software is either:

- **Expensive** ($50–$300 desktop apps marketed to packs with electronic timing systems), or
- **Stuck on one laptop at the registration table**, with parents craning to see a projector, or
- **A spreadsheet** that someone's volunteer dad rebuilds every year.

This is the alternative: a free, open-source web app that works on any phone, syncs live, and lets the whole pack — parents, siblings, grandparents, scouters — follow the race from wherever they're standing. Built by a parent who got tired of squinting at a 13" laptop screen at the back of the gym.

---

## Live & hosted version

The hosted version at **[derby.987.ca](https://derby.987.ca)** is maintained by the author and free to use for any troop, pack, unit, colony, or guide group. Your race data lives in Firebase under a private UUID URL — share it only with people you want involved.

If you'd rather self-host (e.g. your council wants to run its own deployment for a season of district races), the project is **AGPL-3.0-or-later**: fork it, host it, modify it. The AGPL just asks that if you host a modified version, you share your source code with users of that hosted version.

## Self-hosting

```bash
git clone https://github.com/wongmark/pinewood-derby-cub-cars.git
cd pinewood-derby-cub-cars
npm install
# Replace src/firebase.js with your own Firebase project credentials.
# Set Firebase Realtime Database rules (see below).
npm run build
npx firebase deploy --only hosting
```

### Firebase Realtime Database security rules

The app uses anonymous, per-race writes gated by URL secrecy (a 36-char UUID). Set your RTDB rules to:

```json
{
  "rules": {
    "races": {
      "$raceId": {
        ".read": true,
        ".write": true,
        ".validate": "$raceId.length == 36"
      }
    }
  }
}
```

These rules say: any UUID-shaped path under `/races/` is readable and writable. The URL is the access token — like an unlisted Google Doc.

---

## Tech stack

- **React 18** + **Vite** (single-page app, no backend server)
- **Firebase Realtime Database** for live cross-device sync
- **react-router-dom** for the race-URL routing
- **xlsx** for Excel export
- **qrcode.react** for the share-link QR code
- Inline styles, no CSS framework — easier to fork and re-skin
- Hosted on **Firebase Hosting**

The entire app is a single React component file (`src/DerbyApp.jsx`) plus a thin landing page. Easy to read, easy to fork.

---

## For other scout/guide groups

This app works just as well for:

- 🇨🇦 **Scouts Canada**: Beaver Buggies, Cub Kar Rally, Scout-craft Derby
- 🇺🇸 **BSA (Scouts BSA / Cub Scouts)**: Pinewood Derby, Raingutter Regatta scheduling (lane-fair pairings work for any heat-based race)
- 🇨🇦 **Girl Guides of Canada / Sparks / Brownies**: Themed car races, cookie-box races
- 🇺🇸 **Girl Scouts of the USA**: Powderpuff Derby
- ⛪ **AWANA**: Grand Prix
- 🌾 **4-H**: Soapbox / gravity car competitions

The terminology is generic enough to fit any "build a small car, race it in heats, total the points" event. Rename "Pinewood Derby" via the race-name field at the top.

---

## Contributing

Issues and PRs welcome. This is intentionally a small project — the goal is "scouters can read the source and trust it" rather than "feature-complete race management suite."

Things on the wishlist:

- Optional **electronic timing system integration** (NewBold, FastTrack, TheJudge300 USB readouts) for those who have hardware.
- **Bracket / double-elimination mode** for "race off the top 8" tournaments after heats.
- **Multi-class race** support (Cubs / Webelos / Open all run on the same track, separate standings).
- **Print-friendly heat sheets** for the on-deck volunteer.

---

## License

[AGPL-3.0-or-later](LICENSE). Use it, modify it, fork it — just share your source if you host a modified version.

---

## Keywords for searchers

pinewood derby app · pinewood derby software · pinewood derby scheduler · pinewood derby scoring · pinewood derby timer alternative · pinewood derby lane assignment · pinewood derby online · pinewood derby web app · cub scout pinewood derby · scouts canada beaver buggies · cub kar rally · kub kar rally · scout car race · awana grand prix · powderpuff derby · derby race manager · derby race scoring · derby heat scheduler · derby standings · derby lane fairness · multi-lane derby · free derby software · open source pinewood derby · pinewood derby brackets · pinewood derby parents · pinewood derby live results · pinewood derby phone · pinewood derby ipad · pinewood derby iphone · scout pack race · scout troop race · cub pack derby · girl guide derby · sparks brownies derby · 4-h pinewood derby · pinewood derby for cub scouts · how to run a pinewood derby · pinewood derby check-in
