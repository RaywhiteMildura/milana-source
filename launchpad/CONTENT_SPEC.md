# Launchpad 300·30·3 — content spec

The app is a 12-week (3-month) accountability + learning program for brand-new real-estate associates at
Ray White Mildura (Victoria, Australia). It is the office's own program. Core targets:
300 geo data (one unit = a NEW CONTACT RECORD from the geographic farm area: owner name + phone and/or email + address,
added to the CRM), 30 appraisals, 3 listings. Two managers coach them: Damian and Luke.

Voice: plain Australian English, second person ("you"), short sentences, warm but direct, like a good coach.
No marketing fluff, no em-dashes, no emoji. Everything is written in the office's own words: scripts, letters, SMS, forms
and key lines included. Use "Ray White Mildura" for the office and "(your name)" for the associate. Never name an outside coach,
trainer, program or document: the course is the material.
keyLine is a short, memorable line in the office's own words. Never invent statistics. Keep the program's benchmarks
(18 to 24 calls, 8 to 12 connections, 1 to 3 appointments per 45-minute session; 45 on, 15 off; weekly contact for 1 to 2 month
leads, monthly for 2 to 12 month leads; letter days 2, 9, 14, 18, 21, 24) and keep the content specific to the 300/30/3 chain:
geo data -> calls -> appraisals -> listings.

The six modules: Database Foundations, The Doorstep Appraisal, Pipeline Rhythm, The 30-Day Trust Plan, Neighbourhood Campaigns,
The Scoreboard. Lead groups are Cold, Warm and Hot.

## File conventions
Every content file is a browser script. First line exactly:
  window.LAUNCHPAD_CONTENT = window.LAUNCHPAD_CONTENT || { weeks: [], scripts: [], templates: [], rolePlays: [] };
then push into the right array. Plain JS object literals only (no functions, no template-literal interpolation of variables,
no external references). Validate with:
  node -e "global.window={}; require('<file>'); const c=window.LAUNCHPAD_CONTENT; console.log(JSON.stringify(c).length)"

Text fields use "markdown-lite": paragraphs separated by a blank line; lines starting with "- " are bullets;
lines starting with "## " are sub-headings; **bold** allowed; > at line start is a quote block. Nothing else.

## Week file: build/content/week-N.js  (N = 1..12)
window.LAUNCHPAD_CONTENT.weeks.push({
  week: N,
  theme: "Short theme (max 7 words)",
  tagline: "One line that sells the week (max 16 words)",
  module: "one of the six module names above",
  focus: "2-3 sentences: what the numbers should look like this week and why (use the suggestedTargets from synthesis as a guide, phrased softly: 'aim for about...'; the app computes exact pace)",
  intro: "markdown-lite, 120-220 words, addressed to the associate: why this week matters in the 300/30/3 chain",
  lessons: [            // 4 to 6 lessons, each a 3-6 minute read (250-550 words of body)
    { id: "wN-lK", title: "...", minutes: 4,
      body: "markdown-lite",
      keyTakeaways: ["2-4 short lines"],
      keyLine: "one short line that captures the lesson, or omit the key entirely" }
  ],
  drills: [             // 3 to 5 concrete actions for the week; the app shows them as a checklist
    { id: "wN-dK", title: "imperative, max 10 words", detail: "exactly what to do, 1-3 sentences", kind: "field|desk|roleplay|review" }
  ],
  scripts: ["script ids from the fixed list below that the associate should master this week"],
  templates: ["template ids from the fixed list below used this week"],
  rolePlays: ["role-play ids from the fixed list below relevant this week"],
  quiz: [               // 6 to 8 questions, 4 options each, exactly one correct, answer = index; explain = 1-2 sentences
    { id: "wN-qK", q: "...", options: ["...","...","...","..."], answer: 0, explain: "..." }
  ],
  coachNote: "markdown-lite, 60-120 words for Damian and Luke: what to check in this week's Monday meeting, what good looks like, the one ratio to watch"
});

## Fixed id lists (use these exact ids)
SCRIPT IDS (spoken): farm-intro-phone, farm-intro-door, two-minute-close, fifty-neighbours, quarterly-market-update-call,
  database-call-script, call-toolkit (extenders + appointment setters + enders), pipeline-1-2-month-call, pipeline-2-12-month-call,
  traffic-call-buyer, doorstep-script, touch-point-in-person, touch-point-phone, timing-question-buyer-line,
  monthly-video-script, market-update-video-script, cold-warm-hot-lines, just-listed-door-knock, just-listed-phone,
  just-sold-door-knock, just-sold-phone, buyers-post-sale-call, ofi-callback, objection-handlers
TEMPLATE IDS (written): street-appraisal-letter, seven-year-letter, twelve-month-appraisal-letter, twelve-month-reappraisal-automation-letter,
  introduction-letter, testimonial-letter, presentation-letter, legal-letter, broker-letter, storage-letter, just-listed-letter,
  just-sold-letter, ofi-invitation, just-listed-email, just-sold-email, monday-market-note, one-line-checkin-sms,
  appraisal-sms-30-prior, appraisal-sms-2-hours-after, appraisal-sms-anniversary, just-listed-sms, just-sold-sms,
  daily-call-sheet, call-session-rules, quick-appraisal-form, full-appraisal-form,
  trust-plan-self-check, thirty-day-commitment, campaign-snapshot, monday-meeting-agenda, monday-plan,
  targets-vs-actuals, preferred-partners, video-library, letter-schedule, trust-plan-sequences, lost-listing-case-study,
  missed-sales-audit, capacity-tiers, ai-message-prompt, pre-visit-checklist, geo-data-definition
ROLE-PLAY IDS: rp-farm-intro-door, rp-farm-intro-phone, rp-fifty-neighbours, rp-two-minute-close, rp-doorstep,
  rp-database-call, rp-pipeline-touch-phone, rp-ofi-callback, rp-just-listed-door, rp-just-sold-door, rp-just-sold-phone,
  rp-buyers-post-sale, rp-timing-question, rp-objections

## Scripts file: build/content/scripts.js
window.LAUNCHPAD_CONTENT.scripts.push({
  id: "<SCRIPT ID>", title: "...", category: "Prospecting|Appraisal|Pipeline|Neighbourhood Campaigns|Buyers|Video",
  when: "when to use it, one sentence", goal: "what a win looks like, one sentence",
  steps: [ { label: "beat name e.g. Introduce", line: "the words to say, with placeholders: (your name), Ray White Mildura, (address)" } ],
  tips: ["2-4 short coaching tips"]
});
Cover EVERY script id. objection-handlers: 6-8 common objections (not interested / already have an agent / how did you get my number /
what's it worth / just send me something / we're not selling / I'm busy / take me off your list) each with a 1-3 sentence response
consistent with the program's style (courtesy, value first, never burn a bridge, offer two times).

## Templates file: build/content/templates.js
window.LAUNCHPAD_CONTENT.templates.push({
  id: "<TEMPLATE ID>", title: "...", kind: "letter|email|sms|form|checklist|worksheet",
  when: "one sentence", body: "full text, markdown-lite, with [brackets] for merge fields; letters to prospects carry the exclusive-agency note"
});
Cover EVERY template id. For forms/worksheets list the fields as bullets. trust-plan-sequences holds all three
30-day sequences day by day. monday-market-note is a fill-in-the-blanks email.

## Role-plays file: build/content/roleplays.js
window.LAUNCHPAD_CONTENT.rolePlays.push({
  id: "<ROLE-PLAY ID>", title: "...", scriptId: "<script id>", setting: "phone|door|open home",
  persona: "150-250 words for the AI to play the other person: name, home, situation in Mildura, mood, what they want, two realistic objections they will raise, what would make them say yes, what makes them hang up. Realistic Mildura detail (e.g. suburbs Irymple, Red Cliffs, Mildura South, Merbein; the river; dried-fruit and citrus blocks) is welcome but no invented statistics.",
  opener: "who speaks first and the exact first line of the other person if they open, otherwise 'associate opens'",
  goal: "what the associate must achieve, one sentence",
  rubric: ["5-7 observable criteria the coach scores 0-2, e.g. 'Introduced self and Ray White Mildura in the first 10 seconds'"],
  difficulty: "easy|medium|hard"
});
Cover EVERY role-play id.
