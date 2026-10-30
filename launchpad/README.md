# Launchpad 300·30·3

A 12-week training and accountability app for new sales associates at Ray White Mildura, built on six coaching programs (Client Connections, The 15-Minute Appraisal, Sales is a Contact Sport, The 30-Day Lead Amplifier, The Listing Advantage, The Agent Dashboard).

Three numbers in twelve weeks: **300 geo data, 30 appraisals, 3 listings.**

Live app: https://claude.ai/artifact/P2Z9UCWbcymej8pVr1FFZi

## For Damian and Luke: how to run it

**Share it**
1. Open the link above. You are the owner; you see the manager view.
2. Share button (top right). Add each new associate as a **Contributor**. Add Luke as an **Editor** so he gets the manager view and can edit anyone's settings.
3. Associates open the link signed in to claude.ai (a free account on their email works). On first open they enter their name, email, start date and farm area, and they are in.

**What an associate does each day (under a minute)**
- Today tab: tap + for each geo data record, appraisal and listing. Optional call-session counters and a one-line note. Numbers save as they go; "Done for today" shows the verdict and any milestone.
- Adding an appraisal offers a 30-second detail sheet (address, likely-to-list window, lead type, action plan) that puts it in their pipeline with the next touch date, following the program's contact key (1 to 2 months: weekly; 2 to 12 months: monthly).
- Progress tab: rings, the pace needed from here, cumulative vs the soft guide, call ratios against the program benchmarks, logging streak, week by week, pipeline, learning.
- Learn tab: the week's lessons, drills, scripts, templates, quiz. Weeks are open from day one; the current week is marked.
- Practice tab: AI role-play against a Mildura homeowner, then a scorecard against the script's beats. Uses the associate's own Claude usage, so the first call asks their permission.

**What managers see**
- Team tab: every associate with status (Ahead / On track / Slipping / Behind), bars for the three targets, last log, streak, who needs attention, team totals this week.
- Tap a person: their full progress, last seven days with notes, coaching prompts for the Monday meeting, private manager notes, and their settings (start date, email, targets, status, role).
- Program settings: default targets, weeks, working days, office name, manager emails for the Monday report.

**How "on track" is judged (not rigid)**
- A soft guide curve mirrors the program's funnel: geo data front-loaded, appraisals from week 2, listings expected from week 8.
- Every day the app recalculates what is needed per working day from here to hit the target. Someone behind the guide whose recent pace would still get them there reads "On track".
- No judgement in the first three working days. Listings do not drag the status down before they are expected.

**Reminders and reports (email, from Damian's Gmail)**
- Every day at 5:50pm Melbourne time: each active associate gets one short email. Not logged: a nudge. Logged and on track: congratulations with their numbers. Logged and behind: the pace from here plus one practical tip from the program.
- Monday 7:47am: managers get the weekly team report (totals vs targets, this week, days logged, learning, pipeline, coaching prompts per person).
- Recipients come from each person's profile email and the manager list in Program settings. If someone's email is missing they are skipped and named in the task's summary.
- Both are scheduled tasks on Damian's Claude account ("Launchpad daily check-in emails" and "Launchpad Monday team report"). They run inside a dedicated Claude Code session titled "Launchpad mailer", which is where the Gmail connection lives. Pausing or deleting the scheduled tasks stops the emails; archiving that session would too.
- Manager notes written on a person's page are stored separately and are readable only by editors and the owner.

**If something looks wrong**
- An associate sees "Could not save": they were shared as Viewer or Commenter. Change them to Contributor in the Share menu.
- Luke cannot see the Team tab: share with him as Editor, then he picks "I'm a manager" on first open (or change his role on his person page).
- Someone started on the wrong date: open their page in Team and change the start date; every pace number recalculates.
- The daily email did not arrive: check the person's email on their profile, then the scheduled task's last run in claude.ai.

**Definitions**
- Geo data: one new contact record from the farm area (owner name, phone or email, address) added to the CRM. Capture settlement date and email where possible.
- Appraisal: a curbside or quick walk-through, with an action plan and a pipeline category.
- Listing: signed and live.

## Repo layout

- `app/index.html` page shell and styles (published as the artifact page)
- `app/app.js` the app (vanilla JS, no framework)
- `app/pace.js` pacing engine (pure functions, also runs in node)
- `app/content.js` generated bundle of all content (do not edit; run `build-content.sh`)
- `content/*.js` the source content modules: `week-1.js` to `week-12.js`, `scripts.js`, `templates.js`, `roleplays.js`
- `CONTENT_SPEC.md` the schema and writing rules for content modules
- `build-content.sh` concatenates `content/` into `app/content.js`
- `test/mock-claude.js` in-browser mock of the claude.ai artifact runtime (db, user, sample)
- `test/smoke.js` Playwright end-to-end run of the associate and manager flows with screenshots

## Data (claude.ai artifact database)

- `config/program`: targets, weeks, workDays, officeName, managerEmails, nudgeHour, timezone
- `people/<userId>`: name, email, role (associate | manager), startDate, farm, status, targets (optional override), lastLogDate, summary (written by the app on every save), managerNotes
- `people/<userId>/days/<YYYY-MM-DD>`: geo, appraisals, listings, calls, connections, appointments, sessions, note, closed, updatedAt
- `people/<userId>/pipeline/<id>`: address, kind, category (1-2 | 2-12), group (skeptic | audience | advocate), plan, date, lastTouch, nextTouch, reappraisal, status (active | listed | lost), notes
- `people/<userId>/learning/progress`: lessonsRead, drillsDone, quiz, practice

Access rules: config readable by everyone, writable by editors; people readable by every signed-in viewer, each person writes their own subtree, editors write anything.

## Updating the app

Edit the files, run `./build-content.sh` if content changed, run `cd test && node smoke.js all` (needs Playwright with Chromium), then republish the artifact at the same URL with `index.html` as the page and `app.js`, `pace.js`, `content.js` as its files.
