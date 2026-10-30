# Launchpad 300·30·3 — content spec

The app is a 12-week (3-month) accountability + learning program for brand-new real-estate associates at
Ray White Mildura (Victoria, Australia), built on the coaching material in the office's Drive folder. Core targets:
300 geo data (one unit = a NEW CONTACT RECORD from the geographic farm area: owner name + phone and/or email + address,
added to the CRM), 30 appraisals, 3 listings. Two managers coach them: Damian and Luke.

Voice: plain Australian English, second person ("you"), short sentences, warm but direct, like a good coach.
No marketing fluff, no em-dashes, no emoji. The source material is the source of truth; adapt "XYZ real estate" / "ABC real
estate" / "(agency)" to "Ray White Mildura", the example agent's name to "(your name)", "Josh" the prospect stays as a sample name.
NEVER name the author of the source material (or any outside coach or trainer) anywhere in the course: present the methods as the
program's own ("the program", "the script", "the benchmark"). Never invent a key line: keyLine must be verbatim from the source files.
Where the source material has gaps (objection handling, pricing method, compliance), write it clearly as "our office guidance",
not as program material. Never invent statistics. Keep the content specific to the 300/30/3 chain: geo data -> calls -> appraisals -> listings.

Source files (raw text): /tmp/claude-0/-home-user-milana-source/1ecac0c8-d68d-5af7-bd53-2180ed41fbad/scratchpad/content/*.md
Curriculum synthesis (per-week plan to follow): /tmp/claude-0/-home-user-milana-source/1ecac0c8-d68d-5af7-bd53-2180ed41fbad/scratchpad/synthesis.json  (weeklyCurriculum[n])

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
  module: "program module name, e.g. Client Connections / The 15-Minute Appraisal / Sales is a Contact Sport / The 30-Day Lead Amplifier / The Listing Advantage / The Agent Dashboard",
  sources: ["file names used"],
  focus: "2-3 sentences: what the numbers should look like this week and why (use the suggestedTargets from synthesis as a guide, phrased softly: 'aim for about...'; the app computes exact pace)",
  intro: "markdown-lite, 120-220 words, addressed to the associate: why this week matters in the 300/30/3 chain",
  lessons: [            // 4 to 6 lessons, each a 3-6 minute read (250-550 words of body)
    { id: "wN-lK", title: "...", minutes: 4,
      body: "markdown-lite",
      keyTakeaways: ["2-4 short lines"],
      keyLine: "VERBATIM line from the source (no person named), or omit the key entirely",
      source: "file name" }
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
SCRIPT IDS (spoken): train-to-prospect-phone, train-to-prospect-door, two-minute-rule, magic-50, quarterly-market-update-call,
  database-call-script, call-toolkit (extenders + appointment setters + enders), pipeline-1-2-month-call, pipeline-2-12-month-call,
  traffic-call-buyer, front-door-script, touch-point-in-person, touch-point-phone, tighten-timeline-buyer-line,
  monthly-video-script, market-update-video-script, give-ask-lines, just-listed-door-knock, just-listed-phone,
  just-sold-door-knock, just-sold-phone, buyers-post-sale-call, ofi-callback, objection-handlers (office guidance, not from the program)
TEMPLATE IDS (written): appraisal-drive-letter, seven-year-letter, twelve-month-appraisal-letter, twelve-month-reappraisal-automation-letter,
  introduction-letter, testimonial-letter, presentation-letter, legal-letter, broker-letter, storage-letter, just-listed-letter,
  just-sold-letter, ofi-invitation, just-listed-email, just-sold-email, monday-wrap-email, five-star-prospect-sms,
  appraisal-sms-30-prior, appraisal-sms-2-hours-after, appraisal-sms-anniversary, just-listed-sms, just-sold-sms,
  daily-call-sheet, effective-prospecting-sessions, market-update-appraisal-form, appraisal-full-form,
  lead-amplifier-self-assessment, nine-lines-commitment, listing-advantage-snapshot, monday-meeting-agenda, monday-game-plan,
  targets-vs-actuals, preferred-partners, video-bank, letter-bank-schedule, amplifier-sequences, lost-listing-case-study,
  leakage-audit, capacity-tiers, ai-message-prompt, pre-visit-checklist (office guidance), geo-data-definition (office guidance)
ROLE-PLAY IDS: rp-train-to-prospect-door, rp-train-to-prospect-phone, rp-magic-50, rp-two-minute-rule, rp-front-door,
  rp-database-call, rp-pipeline-touch-phone, rp-ofi-callback, rp-just-listed-door, rp-just-sold-door, rp-just-sold-phone,
  rp-buyers-post-sale, rp-tighten-timeline, rp-objections

## Scripts file: build/content/scripts.js
window.LAUNCHPAD_CONTENT.scripts.push({
  id: "<SCRIPT ID>", title: "...", category: "Prospecting|Appraisal|Pipeline|Listing Advantage|Buyers|Video",
  when: "when to use it, one sentence", goal: "what a win looks like, one sentence",
  steps: [ { label: "beat name e.g. Introduce", line: "the words, verbatim from the source with placeholders adapted: (your name), Ray White Mildura, (address)" } ],
  tips: ["2-4 short coaching tips drawn from the material"],
  source: "file name"
});
Cover EVERY script id. Keep the source wording; fix obvious typos only (e.g. 'nnanced' -> 'financed', 'onversation' -> 'conversation').
objection-handlers is office guidance: 6-8 common objections (not interested / already have an agent / how did you get my number /
what's it worth / just send me something / we're not selling / I'm busy / take me off your list) each with a 1-3 sentence response
consistent with the program's style (courtesy, value first, never burn a bridge, offer two times).

## Templates file: build/content/templates.js
window.LAUNCHPAD_CONTENT.templates.push({
  id: "<TEMPLATE ID>", title: "...", kind: "letter|email|sms|form|checklist|worksheet",
  when: "one sentence", body: "full text, markdown-lite, with [brackets] for merge fields; letters keep the exclusive-agency note where the source has it",
  source: "file name"
});
Cover EVERY template id. For forms/worksheets reproduce the fields as bullet lists. For amplifier-sequences include all three
30-day sequences day by day. For monday-wrap-email make a fill-in-the-blanks version of the source example.

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
