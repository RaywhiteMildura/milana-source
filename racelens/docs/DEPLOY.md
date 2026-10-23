# Use RaceLens on your phone

> **Have a Mac mini (or any Mac that can stay on)? Use [MAC-MINI.md](MAC-MINI.md) instead** – one line in Terminal sets
> up everything below for you (background service, password in the Keychain, Tailscale https address, never-sleep,
> restart after a power cut). This page covers the other options and the details.

RaceLens is two things: a **small server program** that does the work (fetches the sources, rates the races, watches for results all day) and a **web page** that shows you the answers. Your phone only ever opens the web page. The server has to be **running somewhere for the whole race day** – on a computer at the office or at home, on a hosted machine in the cloud, or (Android only) on the phone itself.

That is the only decision to make. Once the server is up, the phone side is the same every time: open the address, sign in once, add it to your home screen, and it behaves like an app.

## Do I have to press a button to get results?

No. While the server is running:

* **Results are fetched by the server on its own**, starting two minutes after each race's scheduled start, and it keeps trying for up to four hours until a result is published.
* **The remaining races are re-rated automatically** every time a result lands (day patterns such as "leaders are winning" are picked up and applied to the rest of the card).
* **The phone screen updates itself**: an open race page checks with the server every 30 seconds, refreshes when something changed and shows a small message only for news – "R3 result in", a corrected result, a scratching or rider change, new picks.
* **Opening a race page also catches up**: if automatic results are on and a race that jumped more than three minutes ago still has no result, and the server either never checked it or is more than a minute and a half late with its next check (for example because the computer was asleep), the page quietly asks the server to check now. Nothing shows while it checks; the "R3 result in" message appears if a result came in.

The *Pre-race check* and *Fetch results* buttons are still there for manual control; you do not need them on a normal day. The full timeline is in [What happens automatically on race day](#what-happens-automatically-on-race-day) further down.

## Pick where the server runs

| | A. Office/home computer + phone | B. Hosted online (Fly.io / Render) | C. Android phone only (Termux) |
|---|---|---|---|
| Cost | Free | Roughly a few dollars a month | Free |
| Works away from the computer? | Same Wi-Fi only, or anywhere with Tailscale | Anywhere | Anywhere (it is on the phone) |
| Australian IP (TAB / Sportsbet odds) | Yes | Fly.io Sydney: yes. Render Singapore: no | Yes |
| Needs a computer switched on all day | Yes | No – nothing of yours needs to be on | No, but the phone must stay on |
| Full-screen app on Android | Only with the Tailscale https address (step 5) | Yes | Yes |
| Setup effort | 5 minutes | 15–20 minutes once | 10 minutes, fiddly |
| iPhone | Yes | Yes | No (iPhones cannot run it) |

**Recommended:** A if the office computer can stay on during race days; B if you want nothing to depend on a computer being awake.

---

## Option A – office or home computer + phone

### 1. Start the server for your network

On the computer, in the `racelens` folder:

```bash
npm install        # first time only
npm run build      # first time only (and after an update)
npm run start:phone
```

Or double-click **`scripts\start-phone.cmd`** (Windows) / run **`bash scripts/start-phone.sh`** (macOS, Linux). The script does the install and build for you the first time, asks for a password, and starts the server. Keep that window open.

The window prints something like:

```
RaceLens listening on http://localhost:4850 (mode: live) – reachable from other devices on your network
On your phone (same Wi-Fi), open http://192.168.1.23:4850 – or scan:
[QR code]
```

The first time on Windows, the Firewall asks whether Node.js may talk on the network – tick **Private networks** and **Allow**, or the phone will not connect.

### 2. Open it on the phone

Point the phone's camera at the QR code (same Wi-Fi as the computer) and tap the link, or type the `http://192.168…:4850` address into the browser. The same QR code and address are also shown in RaceLens itself under **Settings → Use RaceLens on your phone**, so once you have opened it on the computer you can read it from there. If the computer joins the Wi-Fi (or Tailscale) after RaceLens started, the new address appears there within a minute – no restart needed.

Then **add it to your home screen** (steps at the end of this guide) so it has its own icon. On an iPhone it then opens full-screen. On Android a plain `http://` address opens in a normal Chrome tab with the address bar; for the full-screen app on Android use the https address from step 5.

### 3. Put a password on it

Anyone on the same Wi-Fi could otherwise open RaceLens and change your settings or results. Set `RACELENS_PASSWORD` before starting and the app shows a login screen. A phone stays signed in for 30 days, extended each time you use it, up to 90 days after you signed in – then it asks once more. Choose at least 8 characters; the server warns about anything shorter.

* **The start scripts ask for the password** every time and hide it while you type (Enter alone = no password).
* **To skip the question** (and to start RaceLens automatically, step 6) on Windows, open Command Prompt once and type `setx RACELENS_PASSWORD "my pass phrase"`, then close it. Every window opened afterwards – the start script and a Task Scheduler task too – uses it. Windows keeps it in your account's settings, where you and the programs you run can read it, so lock the screen when you leave the desk.
* **Or give it when starting:** `scripts\start-phone.cmd "my pass phrase"` or `bash scripts/start-phone.sh "my pass phrase"`. Keep the quotes if it has spaces – without them the script stops and tells you, rather than starting with only the first word. A password given this way shows in Task Manager on Windows and is saved in the Terminal history on a Mac, so the question (or `setx`) is more private.
* **By hand:** Windows Command Prompt `set RACELENS_PASSWORD=my pass phrase` then `npm run start:phone` (same window); Windows PowerShell `$env:RACELENS_PASSWORD="my pass phrase"` then `npm run start:phone`; macOS / Linux `RACELENS_PASSWORD="my pass phrase" npm run start:phone`.

**Forgot it, or think someone else knows it?** Stop the server and start it again with a new password. Every phone and computer that was signed in – yours included – is asked to sign in again, with the new password. Nothing else changes.

### 4. Away from the office: Tailscale

Same-Wi-Fi only is fine at the office. To open RaceLens from the track, the car or home while the office computer does the work, use **Tailscale** (free for personal use): it gives both devices a private address that works from anywhere.

1. Install Tailscale on the computer (https://tailscale.com/download) and on the phone (App Store / Play Store). Sign in to the **same account** on both.
2. On the computer, read its Tailscale address in the Tailscale app – it looks like `100.101.102.103`.
3. On the phone, with Tailscale switched on, open `http://100.101.102.103:4850`. Add that one to the home screen too.

RaceLens automatically accepts its own network addresses, including the Tailscale one, so nothing else needs changing – even if you switch Tailscale on while RaceLens is already running (if the very first try says "Host … is not allowed", reload the page once). If you prefer the friendly MagicDNS name (for example `http://office-pc:4850` or `http://office-pc.tail1234.ts.net:4850`), tell RaceLens to accept it: `RACELENS_ALLOWED_HOSTS=office-pc,office-pc.tail1234.ts.net` before starting. Keep the password on – Tailscale is private, but the password is what protects the app itself.

### 5. Optional: an https address, for the full-screen app on Android

Over a plain `http://` address – the Wi-Fi `192.168…` one or the Tailscale `100.…` one – Android Chrome only offers **Add to Home screen**, and that icon opens in a normal Chrome tab with the address bar. Everything works; it just is not full-screen. **Install app** and full-screen need an `https://` address. (An iPhone opens full-screen either way, and Option B is https already.)

Tailscale can give the computer an https address with a proper certificate, which only your own devices can open:

1. In the Tailscale admin console, **DNS** page (https://login.tailscale.com/admin/dns), make sure **MagicDNS** is on and turn on **HTTPS Certificates**.
2. On the computer, in Command Prompt or Terminal, run:
   ```bash
   tailscale serve --bg 4850
   ```
   It prints the address, for example `https://office-pc.tail1234.ts.net`. It keeps running in the background, also after a restart; `tailscale serve reset` switches it off again. (On a Mac where `tailscale` is not found, run `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 4850` instead.)
3. Tell RaceLens that name, then start it as usual. Tailscale passes the name on, and RaceLens refuses names it does not know ("Host … is not allowed").
   * Windows, once in Command Prompt: `setx RACELENS_ALLOWED_HOSTS office-pc.tail1234.ts.net` and `setx RACELENS_PUBLIC_URL https://office-pc.tail1234.ts.net`. Open a new window, then start `scripts\start-phone.cmd`.
   * macOS / Linux: `RACELENS_ALLOWED_HOSTS=office-pc.tail1234.ts.net RACELENS_PUBLIC_URL=https://office-pc.tail1234.ts.net bash scripts/start-phone.sh`

   `RACELENS_PUBLIC_URL` is optional: it makes **Settings → Use RaceLens on your phone** show a QR code for the https address.
4. On the phone, with Tailscale on, open `https://office-pc.tail1234.ts.net`, sign in, then **⋮ → Install app**.

Nothing else is needed: the login cookie is marked secure because Tailscale tells RaceLens the request came over https. (Technical note: everything that comes through Tailscale arrives from the computer itself, so the wrong-password lock treats all your Tailscale devices as one address. If you run RaceLens for this computer only – `npm start` instead of the phone script, so it is reachable through Tailscale's https address alone – you may add `RACELENS_TRUST_PROXY=1` to let it tell them apart. Do not set it with the phone script: devices on the Wi-Fi could then fake their address.)

### 6. Keep the computer awake

A sleeping computer runs nothing. While it sleeps there are no pre-race checks and no results checks.

* **Windows:** Settings → System → Power & battery → Screen and sleep → *When plugged in, put my device to sleep after* = **Never**. Laptop: Control Panel → Power Options → *Choose what closing the lid does* → **Do nothing**. The screen can switch off; that is fine.
* **macOS:** `scripts/start-phone.sh` wraps the server in `caffeinate`, which stops idle sleep while it runs. Leave a MacBook's lid open (or plug in an external display), or set System Settings → Battery/Energy → *Prevent automatic sleeping when the display is off*.
* **Start at logon:** first set the password with `setx` (step 3). Then Windows Task Scheduler → Create Basic Task → *When I log on* → Start a program → `scripts\start-phone.cmd`, and leave *Add arguments* empty. macOS: System Settings → General → Login Items → add a copy of the script named `start-phone.command`.

**What happens if it does sleep:** the server picks up where it left off. Within a minute of the computer waking (five seconds after a restart) the scheduler looks at every race that has jumped, fetches any missing results straight away, re-rates the remaining races and resumes the pre-race checks. The phone's next refresh – or simply opening a race page – shows the catch-up. You lose nothing except the minutes it was asleep.

---

## Option B – hosted online (no computer needed after setup)

The server runs on a small rented machine. Nothing of yours has to be switched on; you open `https://your-app.fly.dev` from anywhere. Costs are **roughly a few dollars a month** for the smallest machine plus a 1 GB disk – check the current pricing page before committing, as the amounts change.

A hosted RaceLens **must have a password**: it can be reached from the whole internet, so it refuses to start without `RACELENS_PASSWORD` (the log says "Refusing to start").

### Fly.io in Sydney (recommended – Australian IP)

Fly.io has a Sydney region, so TAB and Sportsbet see an Australian address. You need one computer for the initial setup (about 15 minutes); after that everything, including updates, can be done without it.

1. Create a Fly.io account at https://fly.io and add a payment method.
2. Install the Fly command-line tool once, on any computer: https://fly.io/docs/flyctl/install/ (Windows: `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`; macOS: `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`). Then `fly auth login`.
3. In the `racelens` folder, create the app without deploying yet:
   ```bash
   fly launch --no-deploy
   ```
   Say **yes** to copying the existing `fly.toml`, give the app a name (it becomes `<name>.fly.dev`) and confirm the Sydney region. Do not let it create a Postgres or Redis – RaceLens needs neither.
4. Create the disk that keeps your research packs and settings between deploys:
   ```bash
   fly volumes create racelens_data --region syd --size 1
   ```
5. Set the password (this is a secret – it is never written to a file; without it the app will not start):
   ```bash
   fly secrets set RACELENS_PASSWORD=choose-a-good-one
   ```
6. Build and start it:
   ```bash
   fly deploy
   ```
   The first deploy takes a few minutes. When it finishes, open **`https://<name>.fly.dev`** on the phone, sign in, add to home screen. **Settings → Use RaceLens on your phone** shows the same address as a QR code.

Afterwards:

* **Updates:** `fly deploy` again from the `racelens` folder, or set up the GitHub Action in `deploy/fly-deploy.yml` (instructions in the file) so every push to `main` deploys by itself – then no computer is needed at all.
* **Change the password:** `fly secrets set RACELENS_PASSWORD=new-one` (the app restarts, and every phone is asked to sign in again with the new password).
* **Your own domain?** Add `RACELENS_PUBLIC_URL = "https://racing.example.com"` under `[env]` in `fly.toml` and deploy, so Settings shows that address.
* **Slow research?** `fly scale memory 512` gives the machine 512 MB. 256 MB is enough for normal use.
* **Logs:** `fly logs` shows what the scheduler is doing ("Auto results: Flemington R3 (attempt 2)"). A results check that fails is logged as a warning and retried five minutes later.
* **Data:** everything lives on the `racelens_data` volume at `/data` and survives deploys and restarts. `fly volumes list` shows it.
* `fly.toml` deliberately keeps one machine running at all times (`auto_stop_machines = "off"`, `min_machines_running = 1`). If Fly ever suggests letting machines stop when idle, say no – the automatic checks would stop with it.

### Render (can be set up entirely from a phone browser)

Render has no Australian region; the closest is **Singapore**. Everything works except the sources that insist on an Australian IP: **TAB and Sportsbet will not answer**. The official Racing Australia and Racing.com sources, Ladbrokes/Neds odds, news and weather still do, so research completes with slightly fewer odds sources and a slightly lower verification score.

1. Push the code to GitHub (the repo must contain `render.yaml` at its root – copy `racelens/render.yaml` to the top folder once; it already points Render at the `racelens` folder).
2. https://dashboard.render.com → **New → Blueprint** → connect the GitHub repo.
3. Render reads `render.yaml` and asks for the one value it does not know: **RACELENS_PASSWORD**. Type one – it is required; without it the service will not start.
4. Choose the **Starter** plan (the free tier sleeps when idle, which would stop the automatic checks) and **Apply**.
5. When the service shows *Live*, open the `https://racelens-xxxx.onrender.com` address it gives you. Settings in RaceLens shows the same address as a QR code.

The disk named `racelens-data` is mounted at `/data` and keeps your packs between deploys. Every push to the GitHub repo redeploys automatically. To change the password: the service's **Environment** page → `RACELENS_PASSWORD` → save; it restarts, and every phone signs in again with the new password.

---

## Option C – Android phone only (Termux)

The server can run on the phone itself with Termux, a Linux terminal app. It works, but the phone has to stay on, Android may kill the app in the background, and research drains the battery. iPhones cannot do this.

1. Install **Termux** from F-Droid or its GitHub releases (the Play Store version is outdated).
2. In Termux:
   ```bash
   pkg update && pkg install nodejs-lts git
   git clone <your repository url>
   cd milana-source/racelens
   npm install
   npm run build:termux
   termux-wake-lock
   RACELENS_PASSWORD="choose-one" npm start
   ```
   (Private GitHub repo: Termux will ask for your GitHub username and a personal access token when cloning, or download the ZIP from GitHub and unzip it instead.)

   Use `npm run build:termux`, not `npm run build`: the fast TypeScript compiler the project normally uses has no Android version, so `npm run build` stops with "Unable to resolve @typescript/typescript-android-arm64". `build:termux` builds the web page the normal way (those tools do have Android versions) and compiles the server with the older TypeScript 5.9, which runs anywhere; it is downloaded the first time, so that step needs internet.
3. Open **http://localhost:4850** in Chrome on the same phone and add it to the home screen (here Chrome offers **Install app** and it opens full-screen, because `localhost` counts as secure).
4. Keep Termux alive: in Android's Settings → Apps → Termux → Battery, choose **Unrestricted** / turn off battery optimisation. `termux-wake-lock` stops the CPU sleeping while Termux runs. Leave the Termux notification in place – swiping it away stops the server.

To update later: `cd milana-source/racelens && git pull && npm install && npm run build:termux`.

---

## What happens automatically on race day

Times are relative to each race's scheduled start. The server checks its to-do list once a minute.

| When | What the server does | What you see on the phone |
|---|---|---|
| The night before or the morning of | Nothing until you choose the meeting and press **Research this meeting** (the one thing that needs a tap) | Progress panel, then the meeting pack with every race rated |
| 10 minutes before each race (Settings → *Auto pre-race check*) | **Pre-race check** of that race: fresh odds, scratchings, rider changes and track rating; any results of earlier races that are due; day patterns; re-rates the race (and every race still to run when a result came in) | "Automatic pre-race check" in the race history; the open page refreshes itself, with a message only for a scratching, rider change or new picks |
| Inside the final 3 minutes | A second pre-race check with the latest market | Same |
| 2 minutes after the jump | **First results check**, asking every results source | Under the race: "The result will be fetched automatically a couple of minutes after the race", then "Nothing published yet (checked 1 min ago, next in 2 min)" |
| Every 2 min until 30 min after | Keeps checking | Same line, with when it last checked and when it checks next |
| Every 5 min until 90 min after; every 15 min until 4 hours after | Keeps checking, less often (late results, protests) | Same |
| From 20 minutes after the jump, while nothing is published | Also asks the race-card sources whether the race was abandoned (at 20, 30, 45, 60 and 90 minutes, then at 2, 3 and 4 hours) and stops watching it if so | "R5 abandoned" message |
| As soon as a result is published | Records it, cross-checks it with every results source, scores the prediction, updates the day patterns and **re-rates every remaining race**. Two agreeing sources settle it. If only one source has it, the server looks up to 3 more times for a second source, then accepts it. If any source still calls it interim (a protest, correct weight not yet signalled), it stays interim and is watched until it is declared final | "R3 result in" message; the scorecard appears; the next races show their new ratings. While it is being confirmed: "Result from TAB only - waiting for a second source"; while interim: "Interim result in" |
| 30 minutes after the jump | One more look at a result that was settled before then, in case a protest or an amended result changed it; after that the race is left alone | "R3 result corrected" message, only if the placings changed |
| Whenever no results source answers (connection down, sources blocking the server) | Keeps to the same schedule and says why | "No results source answered (TAB: HTTP 403; …)" under the race |
| 4 hours after the jump with nothing published | Gives up on that race and says so | "No result published after 4 hours - enter it manually or press Fetch results" ("Could not reach the results sources for 4 hours - …" if no source ever answered; "Result still interim 4 hours after the jump - check it manually" for an interim one) |
| A results check fails on the server (for example a full disk) | Writes a warning in the server's log and tries that meeting again 5 minutes later | Nothing new; the page keeps the last good state |
| Any time a race page is open | – | Checks every 30 seconds and refreshes when the server changed something; a message only for news, never for a routine check that found nothing |
| Opening or returning to a race page after a break | If automatic results are on and a race that jumped more than 3 minutes ago still has no result (or only an interim one), and the server never checked it or is more than 90 seconds late with its next check, the page quietly asks the server to check now – the server only checks what its schedule says is due | Nothing while it checks; an "R3 result in" message if a result came in, otherwise the race line simply updates |
| Server restarted or computer woken up | Looks at every race that has jumped and fetches missing results within a minute (5 seconds after a restart) | The next refresh shows the catch-up |

**Settings → Race day automation** shows what the scheduler is doing right now ("Watching Flemington R3 – next check in 1 min") and lets you turn automatic results or pre-race checks off. With automatic results off, the race line says so, and a result only comes in when a pre-race check runs or you press *Fetch results*.

### What still needs a tap

* **Choosing the meeting and pressing Research this meeting.** The server does not guess which track you are following.
* **Typing a result** with *Enter result manually* if no source publishes one (the race line tells you when the watcher has given up), or correcting one. A result you type in is never replaced by the sources – not by the automatic checks and not when you re-run research.
* **Changing bankroll, unit or risk profile** – done once in Settings.
* **Re-running research** if you want the form and news fetched fresh (the pre-race checks refresh odds, scratchings and results, not the full form guide).

### Add RaceLens to your home screen

The app shows a hint on phones and tablets (not on computers) until you add it or tap *Not now*; these are the steps.

* **iPhone / iPad (Safari):** open the RaceLens address → tap the **Share** button (the square with an arrow) → scroll to **Add to Home Screen** → **Add**. It must be Safari; Chrome on iPhone cannot add web apps. The icon opens RaceLens full-screen, over `http://` or `https://`.
* **Android (Chrome):** open the address → tap the **⋮** menu → **Install app** → **Install**. *Install app* only appears on an `https://` address (Option B, or the Tailscale https address from Option A step 5) or on `http://localhost` (Option C), and that icon opens full-screen. On a plain `http://` address – the Wi-Fi `192.168…` or Tailscale `100.…` one – the menu only has **Add to Home screen**, and that icon opens in a normal Chrome tab with the address bar. It works the same, just not full-screen.

You stay signed in for 30 days, extended while you use it, for at most 90 days after signing in. Sign out from Settings if you hand the phone to someone else – that also ends the session on the server, so a copy of it cannot be used again.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| No QR code or "reachable from other devices" line when starting | The server is listening on this computer only. Start it with `npm run start:phone` (or the script), which sets `RACELENS_HOST=0.0.0.0`. `RACELENS_QR=0` hides the QR code on purpose, and a hosted server (Fly.io, Render, Docker) never prints one – it logs its public address instead, when it knows it. |
| Phone says it cannot connect / the page never loads | Phone and computer must be on the **same Wi-Fi** (not mobile data, not a guest network). On the computer, allow Node.js through the firewall (Windows: Windows Security → Firewall → Allow an app → Node.js, Private ticked). Port **4850** must not be blocked. Try the address in the computer's own browser first. |
| "Host … is not allowed" (error 421) | You opened RaceLens by a name it does not know (a MagicDNS name, a Tailscale https name, a custom domain). Start it with `RACELENS_ALLOWED_HOSTS=thatname`. `RACELENS_ALLOWED_HOSTS=*` (any name) is for hosted platforms only: it also makes RaceLens behave as a hosted server, which needs a password and hides the Wi-Fi addresses. |
| The server stops straight away with "Refusing to start" | It is set up as a hosted server (Fly.io, Render, or `RACELENS_ALLOWED_HOSTS=*` as in the Docker image) but has no password. Set `RACELENS_PASSWORD` (`fly secrets set RACELENS_PASSWORD=…`, the Render dashboard, or `docker run -e RACELENS_PASSWORD=…`). Only on a private network you trust can `RACELENS_ALLOW_OPEN=1` start it without one. |
| Login screen appears but you forgot the password | Change `RACELENS_PASSWORD` (environment variable, or `fly secrets set RACELENS_PASSWORD=…`, or the Render dashboard) and restart. Every phone – yours included – is then asked to sign in with the new password. |
| Every phone is asked to sign in again | Expected after the password was changed, 90 days after a phone signed in, or after `data/.secret` was deleted. Sign in with the current password. |
| "Too many attempts. Wait a minute, then try again." | Five wrong passwords from one phone within ten minutes lock that phone out for a minute. If 30 wrong passwords arrive within ten minutes from different places, every new sign-in pauses for a minute. Phones that are already signed in keep working throughout. Wait, then try again. |
| The phone shows yesterday's numbers | Tap **Refresh** on the page, or pull the app down to reload. Check in **Settings → Race day automation** that the scheduler is running; "The automatic scheduler is not running on the server right now" means the server was started in a way that skipped it – restart it with `npm run start:phone`. |
| A result never arrives | After 4 hours the watcher gives up and says so. Press **Fetch results** to try again, or use **Enter result manually** to type the placings in. Results depend on a source publishing them – very late results sometimes never appear. If the race line says "No results source answered" or "Could not reach the results sources", the server's internet connection or the sources are the problem: press **Check sources** on the home page. |
| Android icon opens in Chrome with the address bar | Expected on a plain `http://` address. For the full-screen app use an `https://` address: Option A step 5 (Tailscale) or Option B. |
| Sources show red on the home page | Press **Check sources**. If every racing source is red, the connection is the problem. If only TAB and Sportsbet are red, you are not on an Australian IP (hosted outside Australia, or a VPN) – the official sources and the other bookmakers still work. `npm run probe -- 2026-10-24 flemington` on the computer prints the detail. |
| Hosted app is slow to research a full card | Fly: `fly scale memory 512`. Render: pick the next plan up. |
| Everything stopped overnight on Fly/Render | Fly: check the machine is running with `fly status`; `fly.toml` keeps one running, but a machine can be stopped from the dashboard by hand. Render: the free plan sleeps – use Starter. |

## Reference – environment variables for phone and hosted use

| Variable | Meaning |
|---|---|
| `RACELENS_HOST` | `127.0.0.1` (default) = this computer only; `0.0.0.0` = every network address (phone, Tailscale, Docker). |
| `RACELENS_PORT` | Port, default `4850`. |
| `RACELENS_PASSWORD` | Turns on the login screen. Changing it signs every device out. Empty = no login (only safe on this computer alone). Required on a hosted server. |
| `RACELENS_ALLOWED_HOSTS` | Extra names RaceLens may be opened by (comma-separated), e.g. a MagicDNS or Tailscale https name. Its own IP addresses are always allowed. `*` = any name, for hosted platforms: it also marks the server as hosted (password required, no Wi-Fi addresses shown). |
| `RACELENS_PUBLIC_URL` | The address phones should use, shown with a QR code under Settings → Use RaceLens on your phone, e.g. `https://office-pc.tail1234.ts.net` or a custom domain. Fly.io (`https://<app>.fly.dev`) and Render fill it in by themselves. |
| `RACELENS_TRUST_PROXY` | `1` = trust the client address passed on by a proxy in front of RaceLens (the wrong-password lock then counts per phone). Automatic on Fly.io and Render; set it yourself only when that proxy is the only way to reach RaceLens. Secure cookies over https work without it. |
| `RACELENS_ALLOW_OPEN` | `1` lets a hosted server start without a password. Only for a private network you trust. |
| `RACELENS_QR` | `0` to skip printing the QR code at start-up. |
| `RACELENS_DATA_DIR` | Where packs, settings and the login secret are kept (`./data`; `/data` in the container). |
| `RACELENS_MODE` | `live` (default) or `demo` (bundled sample meeting, no internet). |
