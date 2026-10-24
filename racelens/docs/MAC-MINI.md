# RaceLens on your phone, served by your Mac mini

You use RaceLens on your **phone**. The Mac mini just runs it quietly in the background. After this one-off setup
you never need to sit at the Mac: it starts RaceLens by itself, keeps it running, does the race-day checks
and results on its own – and you install updates from your phone.

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
4. Still at **login.tailscale.com**, open **Machines**, tap the **…** next to the Mac mini and choose
   **Disable key expiry**. Otherwise Tailscale signs the Mac out every few months and your phone loses it until
   someone signs in again at the Mac.

(You can skip Tailscale – RaceLens then works on the Mac mini's Wi-Fi only, at home or in the office. You can add
Tailscale later and simply run the installer again. Your phone address then changes to the new `https://…`
address: delete the old RaceLens icon from your home screen and add it again from the new address.)

## Step 2 – One line on the Mac mini (5–10 minutes, mostly waiting)

1. On the Mac mini open **Terminal** (Spotlight: press ⌘ Space, type *Terminal*, press Return).
2. Copy this whole line, paste it into Terminal and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/RaywhiteMildura/milana-source/refs/heads/claude/horse-racing-predictor-ts4iet/racelens/scripts/mac/bootstrap.sh | bash
```

3. It downloads what it needs and builds RaceLens (a few minutes). Then it asks you to **choose a RaceLens
   password** – type it twice (nothing shows while you type; that is normal). Use plain letters, digits, spaces
   and ordinary punctuation (no accents or emoji). It is stored in the Mac's Keychain.
4. If HTTPS Certificates are not switched on yet (Step 1.3), it stops and tells you: switch them on from your
   phone, then press Return in Terminal.
5. It asks whether to set the Mac to **never sleep and restart after a power cut** – press Return for yes, then
   type your **Mac's** login password when asked.
6. At the end it shows your phone address – `https://<your-mac>.<something>.ts.net` – and a **QR code**.

**After a power cut.** RaceLens and Tailscale start as soon as your user is logged in, so the Mac should log in
by itself: **System Settings → Users & Groups → Automatically log in as** your user. The installer tells you
whether that is set. One catch: if **FileVault** (disk encryption, on by default in new Macs) is on, macOS does
not allow automatic login – after a power cut the Mac waits at its password screen, and nothing starts until
someone types the Mac's password at the Mac. Your choice:

* keep FileVault on (best if the Mac could be stolen) and accept a trip to the Mac after a power cut, or
* turn it off (**System Settings → Privacy & Security → FileVault → Turn Off**), then switch on automatic login –
  RaceLens then comes back by itself.

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

## Looking after it

| To… | Do this |
|---|---|
| Update RaceLens to the latest version | **On your phone:** Settings → RaceLens version → **Update RaceLens**. It takes a few minutes; RaceLens keeps working meanwhile and restarts by itself at the end. (Or run the one-line command again on the Mac.) Your research, settings and password are kept. |
| See whether it is running | In Terminal on the Mac: `bash ~/RaceLens/app/scripts/mac/status.sh` (also checks Tailscale and the phone address) |
| Change the RaceLens password | In Terminal on the Mac: `bash ~/RaceLens/app/scripts/mac/install.sh --new-password` (every phone then signs in again) |
| Remove it | In Terminal on the Mac: `bash ~/RaceLens/app/scripts/mac/uninstall.sh` (add `--purge` to delete your saved research too) |

If an update ever goes wrong, RaceLens goes back to the version you had by itself and says so on the phone – you
do not need to do anything. (If your RaceLens was installed before the **Update RaceLens** button existed, run the
one-line command on the Mac once; from then on updates work from the phone.)

The phone's Update button covers most looking-after. For the rest you need the Mac's screen, which you can also
reach from your phone:

* once, while at the Mac: **System Settings → General → Sharing** → switch on **Screen Sharing**;
* then from the phone: a VNC app such as **Screens 5** or **RealVNC Viewer**, connecting to
  `<your-mac>.<something>.ts.net` (Tailscale switched on) and signing in with the Mac's user name and password.

## If something is not right

| What you see | What to do |
|---|---|
| The phone cannot open the address | Is Tailscale switched on on the phone? Is the Mac mini on and connected? Run `status.sh` on the Mac – it says what is wrong with Tailscale. |
| After a power cut nothing works until someone goes to the Mac | FileVault is on, so the Mac waits at its password screen (see *After a power cut* in Step 2). Type the Mac's password at the Mac, or turn FileVault off and switch on automatic login. |
| After the Mac restarted, RaceLens is not answering | Make sure the Mac logs in automatically (Users & Groups). RaceLens starts as soon as your user is logged in. |
| "Host … is not allowed" | Reload once. If it stays, run the installer again on the Mac (it re-reads its addresses). |
| The installer says Tailscale "could not publish an https address" | Do Step 1.3 (MagicDNS + HTTPS Certificates), then run the installer again. If it shows a link from Tailscale, open that link on your phone. If it still fails, replace the App Store Tailscale with the **Standalone** version from tailscale.com/download/mac and run the installer again. |
| The phone address changed after running the installer again | You added Tailscale since the first install: delete the old RaceLens icon from your home screen and add it again from the new `https://…` address. |
| **Update RaceLens** says the update failed | RaceLens went back to the version you had, so it keeps working. Try again later. If it keeps failing, check the Mac mini's internet; the details are in `~/Library/Logs/RaceLens/update.log`. |
| **Update RaceLens** says it works on the Mac mini installation only, or nothing happens | Run the one-line command on the Mac once; it sets up updating from the phone. |
| Sources show red on the home page | Tap **Check sources**. If everything is red, the Mac mini has no internet. If only some are red, research still completes with the rest. |
| You want the old version back | If **Update RaceLens** said the update failed, you are already back on the old version – nothing to do. Otherwise, in Terminal: `cd ~/RaceLens && [ -d app-previous ] && rm -rf app-broken && mv app app-broken && mv app-previous app && bash app/scripts/mac/install.sh` (it does nothing when there is no previous version) |

Where things live on the Mac: the app in `~/RaceLens/app` (its version in `~/RaceLens/app/VERSION.json`), your
research and settings in `~/Library/Application Support/RaceLens`, the logs in `~/Library/Logs/RaceLens`
(`server.log`, and `update.log` for updates from the phone), the password in the Keychain (item "RaceLens").
