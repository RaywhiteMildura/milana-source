# RaceLens on your phone, served by your Mac mini

You use RaceLens on your **phone**. The Mac mini just runs it quietly in the background. After this one-off setup
you never need to sit at the Mac: it starts RaceLens by itself, keeps it running, and does the race-day checks
and results on its own.

Why the Mac mini rather than a cloud server: it is free, it has an Australian internet address (TAB and Sportsbet
only answer Australian addresses), and no keys or passwords leave your own machine.

You need: the Mac mini (switched on, connected to the internet), your phone, and about 15 minutes.

---

## Step 1 – Tailscale on the Mac mini and on your phone (5 minutes)

Tailscale is a free app that links your own devices privately, so your phone can reach the Mac mini from
anywhere – the track, the car, home – without opening anything to the internet. It also gives RaceLens a proper
`https://` address, which is what lets your phone install it as a full-screen app.

1. **Mac mini:** install **Tailscale** from the Mac App Store, open it, and sign in (Google or Apple account is
   fine). Allow the VPN configuration when macOS asks.
2. **Phone:** install **Tailscale** from the App Store / Play Store and sign in with **the same account**. Leave it
   switched on (it uses almost no battery).
3. **On your phone's browser**, go to **login.tailscale.com → DNS** and switch on **MagicDNS** and
   **HTTPS Certificates** (one tap each). This is a one-time setting for your account.

(You can skip Tailscale – RaceLens then works on the Mac mini's Wi-Fi only, at home or in the office. You can add
Tailscale later and simply run the installer again.)

## Step 2 – One line on the Mac mini (5–10 minutes, mostly waiting)

1. On the Mac mini open **Terminal** (Spotlight: press ⌘ Space, type *Terminal*, press Return).
2. Copy this whole line, paste it into Terminal and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/RaywhiteMildura/milana-source/refs/heads/claude/horse-racing-predictor-ts4iet/racelens/scripts/mac/bootstrap.sh | bash
```

3. It downloads what it needs and builds RaceLens (a few minutes). Then it asks you to **choose a RaceLens
   password** – type it twice (nothing shows while you type; that is normal). It is stored in the Mac's Keychain.
4. It asks whether to set the Mac to **never sleep and restart after a power cut** – press Return for yes, then
   type your **Mac's** login password when asked.
5. At the end it shows your phone address – `https://<your-mac>.<something>.ts.net` – and a **QR code**.

Also check once: **System Settings → Users & Groups → Automatically log in as** your user. Then RaceLens comes
back on its own after a restart or power cut, with nobody at the Mac.

## Step 3 – On your phone (2 minutes)

1. Make sure Tailscale is switched on, then scan the QR code with the camera (or type the address).
2. Sign in with your RaceLens password. You stay signed in.
3. Add it to your home screen:
   * **iPhone:** in **Safari** tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
   * **Android:** in **Chrome** tap **⋮** → **Install app** (or **Add to Home screen**).

From now on, tap the RaceLens icon like any app. The address is also in RaceLens under **Settings → Use RaceLens
on your phone**.

---

## Race day

* **The night before or that morning:** open RaceLens on the phone, pick the date and the meeting, tap
  **Research this meeting**. That is the only tap you have to make.
* **Before each race** the Mac mini re-checks scratchings, riders, odds and the track by itself and re-rates.
* **After each race** it fetches the result by itself, checks it against a second source, scores the prediction,
  learns the day's patterns and re-rates the races still to come. Your phone updates itself within 30 seconds.
* If a result never appears (some sources are slow), type it in under **Result → Enter result manually**.

## Looking after it (from the Mac mini, rarely)

| To… | Do this in Terminal on the Mac mini |
|---|---|
| Update RaceLens to the latest version | Run the same one-line install command again. Your research, settings and password are kept. |
| See whether it is running | `bash ~/RaceLens/app/scripts/mac/status.sh` |
| Change the RaceLens password | `bash ~/RaceLens/app/scripts/mac/install.sh --new-password` (every phone then signs in again) |
| Remove it | `bash ~/RaceLens/app/scripts/mac/uninstall.sh` (add `--purge` to delete your saved research too) |

You can also do these from your phone: in the Tailscale app, use **Screen Sharing** to the Mac mini, or
enable *Remote Login* on the Mac and use any SSH app over Tailscale.

## If something is not right

| What you see | What to do |
|---|---|
| The phone cannot open the address | Is Tailscale switched on on the phone? Is the Mac mini on and connected? Run `status.sh` on the Mac. |
| "Host … is not allowed" | Reload once. If it stays, run the installer again on the Mac (it re-reads its addresses). |
| The installer says Tailscale "could not publish an https address" | Do Step 1.3 (MagicDNS + HTTPS Certificates), then run the installer again. If it still fails, replace the App Store Tailscale with the **Standalone** version from tailscale.com/download/mac and run the installer again. |
| Sources show red on the home page | Tap **Check sources**. If everything is red, the Mac mini has no internet. If only some are red, research still completes with the rest. |
| After the Mac restarted, RaceLens is not answering | Make sure the Mac logs in automatically (Users & Groups). RaceLens starts as soon as your user is logged in. |
| You want the old version back | In Terminal: `cd ~/RaceLens && mv app app-broken && mv app-previous app && bash app/scripts/mac/install.sh` |

Where things live on the Mac: the app in `~/RaceLens/app`, your research and settings in
`~/Library/Application Support/RaceLens`, the log in `~/Library/Logs/RaceLens/server.log`, the password in the
Keychain (item "RaceLens").
