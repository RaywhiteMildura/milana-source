# Use RaceLens on your phone

RaceLens is two things: a **small server program** that does the work (fetches the sources, rates the races, watches for results all day) and a **web page** that shows you the answers. Your phone only ever opens the web page. The server has to be **running somewhere for the whole race day** – on a computer at the office or at home, on a hosted machine in the cloud, or (Android only) on the phone itself.

That is the only decision to make. Once the server is up, the phone side is the same every time: open the address, sign in once, add it to your home screen, and it behaves like an app.

## Do I have to press a button to get results?

No. While the server is running:

* **Results are fetched by the server on its own**, starting two minutes after each race's scheduled start, and it keeps trying until a result is published.
* **The remaining races are re-rated automatically** every time a result lands (day patterns such as "leaders are winning" are picked up and applied to the rest of the card).
* **The phone screen updates itself**: an open race page refreshes within 30 seconds and shows a small "R3 result in" message.
* **Opening a race also triggers a catch-up**: if a race jumped more than three minutes ago, has no result yet and the server has not looked in the last two minutes (for example because the computer was asleep), the page asks the server to check right now.

The *Pre-race check* and *Fetch results* buttons are still there for manual control; you do not need them on a normal day. The full timeline is in [What happens automatically on race day](#what-happens-automatically-on-race-day) further down.

## Pick where the server runs

| | A. Office/home computer + phone | B. Hosted online (Fly.io / Render) | C. Android phone only (Termux) |
|---|---|---|---|
| Cost | Free | Roughly a few dollars a month | Free |
| Works away from the computer? | Same Wi-Fi only, or anywhere with Tailscale | Anywhere | Anywhere (it is on the phone) |
| Australian IP (TAB / Sportsbet odds) | Yes | Fly.io Sydney: yes. Render Singapore: no | Yes |
| Needs a computer switched on all day | Yes | No – nothing of yours needs to be on | No, but the phone must stay on |
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

Point the phone's camera at the QR code (same Wi-Fi as the computer) and tap the link, or type the `http://192.168…:4850` address into the browser. The same QR code and address are also shown in RaceLens itself under **Settings → Use RaceLens on your phone**, so once you have opened it on the computer you can read it from there.

Then **add it to your home screen** (steps at the end of this guide) so it opens full-screen with its own icon.

### 3. Put a password on it

Anyone on the same Wi-Fi could otherwise open RaceLens and change your settings or results. Set `RACELENS_PASSWORD` before starting and the app shows a login screen; a phone stays signed in for 30 days of use.

* The start scripts ask for the password every time, or take it as an argument: `scripts\start-phone.cmd mypassword`.
* Windows Command Prompt: `set RACELENS_PASSWORD=mypassword` then `npm run start:phone` (same window).
* Windows PowerShell: `$env:RACELENS_PASSWORD="mypassword"` then `npm run start:phone`.
* macOS / Linux: `RACELENS_PASSWORD=mypassword npm run start:phone`.

Forgot it? Stop the server, start it again with a new password. Nothing else changes; the phone just asks you to sign in again.

### 4. Away from the office: Tailscale

Same-Wi-Fi only is fine at the office. To open RaceLens from the track, the car or home while the office computer does the work, use **Tailscale** (free for personal use): it gives both devices a private address that works from anywhere.

1. Install Tailscale on the computer (https://tailscale.com/download) and on the phone (App Store / Play Store). Sign in to the **same account** on both.
2. On the computer, read its Tailscale address in the Tailscale app – it looks like `100.101.102.103`.
3. On the phone, with Tailscale switched on, open `http://100.101.102.103:4850`. Add that one to the home screen too.

RaceLens automatically accepts its own network addresses, including the Tailscale one, so nothing else needs changing. If you prefer the friendly MagicDNS name (for example `http://office-pc:4850` or `http://office-pc.tail1234.ts.net:4850`), tell RaceLens to accept it: `RACELENS_ALLOWED_HOSTS=office-pc,office-pc.tail1234.ts.net` before starting. Keep the password on – Tailscale is private, but the password is what protects the app itself.

### 5. Keep the computer awake

A sleeping computer runs nothing. While it sleeps there are no pre-race checks and no results checks.

* **Windows:** Settings → System → Power & battery → Screen and sleep → *When plugged in, put my device to sleep after* = **Never**. Laptop: Control Panel → Power Options → *Choose what closing the lid does* → **Do nothing**. The screen can switch off; that is fine.
* **macOS:** `scripts/start-phone.sh` wraps the server in `caffeinate`, which stops idle sleep while it runs. Leave a MacBook's lid open (or plug in an external display), or set System Settings → Battery/Energy → *Prevent automatic sleeping when the display is off*.
* **Start at logon:** Windows Task Scheduler → Create Basic Task → *When I log on* → Start a program → `scripts\start-phone.cmd` (put the password in *Add arguments*). macOS: System Settings → General → Login Items → add a copy of the script named `start-phone.command`.

**What happens if it does sleep:** the server picks up where it left off. Within a minute of the computer waking (five seconds after a restart) the scheduler looks at every race that has jumped, fetches any missing results straight away, re-rates the remaining races and resumes the pre-race checks. The phone's next refresh – or simply opening the next race – shows the catch-up. You lose nothing except the minutes it was asleep.

---

## Option B – hosted online (no computer needed after setup)

The server runs on a small rented machine. Nothing of yours has to be switched on; you open `https://your-app.fly.dev` from anywhere. Costs are **roughly a few dollars a month** for the smallest machine plus a 1 GB disk – check the current pricing page before committing, as the amounts change.

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
5. Set the password (this is a secret – it is never written to a file):
   ```bash
   fly secrets set RACELENS_PASSWORD=choose-a-good-one
   ```
6. Build and start it:
   ```bash
   fly deploy
   ```
   The first deploy takes a few minutes. When it finishes, open **`https://<name>.fly.dev`** on the phone, sign in, add to home screen.

Afterwards:

* **Updates:** `fly deploy` again from the `racelens` folder, or set up the GitHub Action in `deploy/fly-deploy.yml` (instructions in the file) so every push to `main` deploys by itself – then no computer is needed at all.
* **Change the password:** `fly secrets set RACELENS_PASSWORD=new-one` (the app restarts).
* **Slow research?** `fly scale memory 512` gives the machine 512 MB. 256 MB is enough for normal use.
* **Logs:** `fly logs` shows what the scheduler is doing ("Auto results: Flemington R3 (attempt 2)").
* **Data:** everything lives on the `racelens_data` volume at `/data` and survives deploys and restarts. `fly volumes list` shows it.
* `fly.toml` deliberately keeps one machine running at all times (`auto_stop_machines = "off"`, `min_machines_running = 1`). If Fly ever suggests letting machines stop when idle, say no – the automatic checks would stop with it.

### Render (can be set up entirely from a phone browser)

Render has no Australian region; the closest is **Singapore**. Everything works except the sources that insist on an Australian IP: **TAB and Sportsbet will not answer**. The official Racing Australia and Racing.com sources, Ladbrokes/Neds odds, news and weather still do, so research completes with slightly fewer odds sources and a slightly lower verification score.

1. Push the code to GitHub (the repo must contain `render.yaml` at its root – copy `racelens/render.yaml` to the top folder once; it already points Render at the `racelens` folder).
2. https://dashboard.render.com → **New → Blueprint** → connect the GitHub repo.
3. Render reads `render.yaml` and asks for the one value it does not know: **RACELENS_PASSWORD**. Type one.
4. Choose the **Starter** plan (the free tier sleeps when idle, which would stop the automatic checks) and **Apply**.
5. When the service shows *Live*, open the `https://racelens-xxxx.onrender.com` address it gives you.

The disk named `racelens-data` is mounted at `/data` and keeps your packs between deploys. Every push to the GitHub repo redeploys automatically.

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
   npm run build
   termux-wake-lock
   RACELENS_PASSWORD=choose-one npm start
   ```
   (Private GitHub repo: Termux will ask for your GitHub username and a personal access token when cloning, or download the ZIP from GitHub and unzip it instead.)
3. Open **http://localhost:4850** in Chrome on the same phone and add it to the home screen.
4. Keep Termux alive: in Android's Settings → Apps → Termux → Battery, choose **Unrestricted** / turn off battery optimisation. `termux-wake-lock` stops the CPU sleeping while Termux runs. Leave the Termux notification in place – swiping it away stops the server.

To update later: `cd milana-source/racelens && git pull && npm install && npm run build`.

---

## What happens automatically on race day

Times are relative to each race's scheduled start. The server checks its to-do list once a minute.

| When | What the server does | What you see on the phone |
|---|---|---|
| The night before or the morning of | Nothing until you choose the meeting and press **Research this meeting** (the one thing that needs a tap) | Progress panel, then the meeting pack with every race rated |
| 10 minutes before each race (Settings → auto pre-race check) | **Pre-race check**: refreshes odds, scratchings and rider changes, pulls the results of races already run, looks for day patterns, re-rates the race and the rest of the card | "Automatic pre-race check" in the race history; the open page refreshes itself |
| 3 minutes before the jump | A second pre-race check with the latest market | Same |
| 2 minutes after the jump | **First results check** across every results source | "Checking for the result automatically – last checked 1 min ago, next in 2 min" under the race |
| Every 2 min until 30 min after | Keeps checking | Same line, counting attempts |
| Every 5 min until 90 min after; every 15 min until 4 hours after | Keeps checking, less often (late results, protests, abandoned races) | Same |
| As soon as a result is published | Records it, cross-checks it against a second source (if only one source has it, it keeps checking a few more times for confirmation), scores the prediction, updates the day patterns and **re-rates every remaining race** | "R3 result in" message; the scorecard appears; the next races show their new ratings |
| 4 hours after the jump with nothing published | Gives up on that race and says so | "No result published after 4 hours – enter it manually or press Fetch results" |
| Any time the page is open | – | The race page refreshes itself every 30 seconds |
| Opening the app or a race after a break | If a race jumped 3+ minutes ago with no result and the server has not checked in the last 2 minutes, the page asks it to check now (catch-up) | A short "checking for results" progress, then the result |
| Server restarted or computer woken up | Looks at every race that has jumped and fetches missing results within a minute | The next refresh shows the catch-up |

**Settings → Race day automation** shows what the scheduler is doing right now ("Watching Flemington R3 – next check in 1 min") and lets you turn automatic results or pre-race checks off.

### What still needs a tap

* **Choosing the meeting and pressing Research this meeting.** The server does not guess which track you are following.
* **Typing a result** with *Enter result manually* if no source publishes one (the race line tells you when the watcher has given up), or correcting one.
* **Changing bankroll, unit or risk profile** – done once in Settings.
* **Re-running research** if you want the form and news fetched fresh (the pre-race checks refresh odds, scratchings and results, not the full form guide).

### Add RaceLens to your home screen

The app itself shows a one-time hint on phones; these are the steps.

* **iPhone / iPad (Safari):** open the RaceLens address → tap the **Share** button (the square with an arrow) → scroll to **Add to Home Screen** → **Add**. It must be Safari; Chrome on iPhone cannot add web apps.
* **Android (Chrome):** open the address → tap the **⋮** menu → **Add to Home screen** or **Install app** → **Install**.

The icon opens RaceLens full-screen. You stay signed in for 30 days of use; sign out from Settings if you hand the phone to someone else.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| No QR code or "reachable from other devices" line when starting | The server is listening on this computer only. Start it with `npm run start:phone` (or the script), which sets `RACELENS_HOST=0.0.0.0`. `RACELENS_QR=0` hides the QR code on purpose. |
| Phone says it cannot connect / the page never loads | Phone and computer must be on the **same Wi-Fi** (not mobile data, not a guest network). On the computer, allow Node.js through the firewall (Windows: Windows Security → Firewall → Allow an app → Node.js, Private ticked). Port **4850** must not be blocked. Try the address in the computer's own browser first. |
| "Host … is not allowed" (error 421) | You opened RaceLens by a name it does not know (a MagicDNS name, a custom domain). Start it with `RACELENS_ALLOWED_HOSTS=thatname`, or `RACELENS_ALLOWED_HOSTS=*` on a hosted platform where the password protects the app. |
| Login screen appears but you forgot the password | Change `RACELENS_PASSWORD` (environment variable, or `fly secrets set RACELENS_PASSWORD=…`, or the Render dashboard) and restart. Existing phone sessions are not affected by a password change until they sign out. |
| "Too many attempts – wait a minute" | Five wrong passwords in ten minutes lock that phone out for sixty seconds. Wait, then try again. |
| The phone shows yesterday's numbers | Tap **Refresh** on the page, or pull the app down to reload. Check in **Settings → Race day automation** that the scheduler is running; "The automatic scheduler is not running" means the server was started in a way that skipped it – restart it with `npm run start:phone`. |
| A result never arrives | After 4 hours the watcher gives up and says so. Press **Fetch results** to try again, or use **Enter result manually** to type the placings in. Results depend on a source publishing them – very late or abandoned races sometimes never appear. |
| Sources show red on the home page | Press **Check sources**. If every racing source is red, the connection is the problem. If only TAB and Sportsbet are red, you are not on an Australian IP (hosted outside Australia, or a VPN) – the official sources and the other bookmakers still work. `npm run probe -- 2026-10-24 flemington` on the computer prints the detail. |
| Hosted app is slow to research a full card | Fly: `fly scale memory 512`. Render: pick the next plan up. |
| Everything stopped overnight on Fly/Render | Fly: check the machine is running with `fly status`; `fly.toml` keeps one running, but a machine can be stopped from the dashboard by hand. Render: the free plan sleeps – use Starter. |

## Reference – environment variables for phone and hosted use

| Variable | Meaning |
|---|---|
| `RACELENS_HOST` | `127.0.0.1` (default) = this computer only; `0.0.0.0` = every network address (phone, Tailscale, Docker). |
| `RACELENS_PORT` | Port, default `4850`. |
| `RACELENS_PASSWORD` | Turns on the login screen. Empty = no login (only safe on localhost). |
| `RACELENS_ALLOWED_HOSTS` | Extra names RaceLens may be opened by (comma-separated), or `*` for any name on a hosted platform. Its own IP addresses are always allowed. |
| `RACELENS_TRUST_PROXY` | `1` to trust a hosting platform's HTTPS proxy for secure cookies; set automatically when `RACELENS_ALLOWED_HOSTS=*`. |
| `RACELENS_QR` | `0` to skip printing the QR code at start-up (hosted platforms). |
| `RACELENS_DATA_DIR` | Where packs, settings and the login secret are kept (`./data`; `/data` in the container). |
| `RACELENS_MODE` | `live` (default) or `demo` (bundled sample meeting, no internet). |
