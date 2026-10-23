# Source: `tomorrowcard` — Saturday 24 October 2026: Cox Plate day at **Flemington** (and the other Saturday meetings)

Research date: 2026-10-23 (the day before). **Environment limits that shaped this report:** the shared WebSearch budget was already exhausted when this task started, and the sandbox proxy blocks every racing, bookmaker, news, Wikipedia and weather host (racing.com, racingaustralia.horse, racenet, punters, TAB, Sportsbet, Ladbrokes, racingvictoria, vrc.com.au, abc.net.au, smh, bom.gov.au, open-meteo, en.wikipedia.org all returned 403/ENOTFOUND). Only `github.com`, `raw.githubusercontent.com`, `api.github.com` (repo-scoped) and `pypi.org` were reachable. Everything below was therefore assembled from **real third-party captures archived in public GitHub repositories** (found with GitHub-wide code search and pulled from `raw.githubusercontent.com`), plus the sibling research already in this repo (a real Racing Australia results page for Cox Plate day 2025). **Nothing was fetched live from a racing site, and no horse was invented.** Where a runner is known only by a Hong Kong Chinese name it is listed as *unresolved*, not guessed.

Confidence tags: **high** = two or more independent captures, or an official body's text; **medium** = one capture, or an inference with corroborating facts; **low** = single weak capture or inference; **brief** = stated in the orchestrator's workflow brief and not independently verified.

Outputs: `fixtures/tomorrowcard/flemington-2026-10-24.json` (structured pack) and `fixtures/tomorrowcard/evidence/*.json` (trimmed copies of the real captures, each with a provenance `_evidenceNote`).

---

## 0. TL;DR

| Fact | Value | Confidence / source |
|---|---|---|
| Venue | **Flemington**, VIC — Cox Plate day moved from Moonee Valley ("redevelopment underway at Moonee Valley, the 2026 Cox Plate will be held at Flemington for the very first time") | **high** — Transport Victoria article [S1]; HKJC news title [S3]; HKDN ×3 [S5–S8] |
| Gates / first race / last race | 10:30am / **12:25pm** / **5:50pm** AEDT | **high** [S1] |
| Number of races | 9 | brief; consistent with 12:25→17:50 at ~40-min intervals (**medium**) |
| Ladbrokes Cox Plate | G1, **2040m**, WFA, **A$6,000,000**, **12 acceptors (9 are G1 winners)**, barrier draw Tue 20 Oct, start **5:10pm** → inferred **Race 8** | 2040m/12/A$6M **high** [S5][S6][S7]; 5:10pm brief; race number **medium** (inferred: last race is 5:50pm) |
| Moonee Valley Gold Cup | G2 2500m 4:20pm → inferred Race 7 | brief only (**medium-low**) |
| Cox Plate favourite | **Sir Delius (GB)** — Gai Waterhouse & Adrian Bott — **barrier 5** | **high** (barrier: brief + HKDN "5檔起步亦屬理想"; trainer: Idol Horse [S9] + HKDN) |
| Main danger | **Aeliana (NZ)** — Chris Waller — James McDonald — barrier 10 | trainer/jockey **high** (HKDN ×2, HKJC "Waller and McDonald chase history"); barrier 10 brief (**medium**) |
| Other identified runners | **Birdman** (Waller, Ben Melham), **Warwoven** (3yo, Bjorn Baker, Rachel King), **Middle Earth (GB)** (Ciaron Maher) | **medium** (identities inferred from HK Chinese names + corroborating 2026 results, §3.3) |
| Known but unresolved | 加碼一擲 (3yo, Caulfield Guineas runner-up, Jamie Melham); 輕取勝 (Maher, **barrier 11**, on-pace); 川河陸駒 (Maher, **barrier 12**, on-pace); 聖喬治 (Maher) | **medium** facts, identities unknown |
| Still unknown | 3 runners; all saddlecloth numbers; odds; scratchings; the other 7 races' names/fields; track, rail, weather | — |
| Other Saturday meetings | Royal Randwick (Spring Champion Stakes G1 2000m) **medium**; Morphettville **medium**; Yarra Valley **medium**; Brisbane & Perth venues **unknown** | [S11][S12] |

**What the app should do on race morning:** treat this pack as a *cross-check*, not a source. Pull the official card from Racing Australia FreeFields (`Form.aspx?Key=2026Oct24,VIC,Flemington`), racing.com (`getRaceForm(meetCode, raceNumber)`), TAB, Sportsbet and Entain (see sibling reports), then verify against §3 here: a 12-horse Cox Plate with Sir Delius in 5, Aeliana in 10 and two Ciaron Maher on-pacers in 11–12 is what every independent capture describes.

---

## 1. Evidence base (what was actually read)

| # | What | Where it came from (all fetched 2026-10-23 via raw.githubusercontent.com unless noted) | Confidence |
|---|---|---|---|
| S1 | Transport Victoria event article "Public transport for the Cox Plate – Saturday 24 October 2026" (full text, dated 2026-10-14) | GitHub `TransportVic/PTVNewsBot` → `raw-articles/2026-10-14Cox-Plate.json` (commit 6b0f6f3a). Original: https://transport.vic.gov.au/news-and-resources/events-and-public-transport/public-transport-for-the-cox-plate ; links the VRC event page https://www.vrc.com.au/race-days-and-events/2026-2027/2026-cox-plate/ | high |
| S2 | Racing.com TV (RTV) Foxtel EPG for 2026-10-24: "Live: Racing Live – Saturday", "Raceday Mini: Cox Plate", "Racing Review – Flemington / Yarra Valley / Morphettville" | GitHub `Jinx8004NEW/FoxtelEPG` → `data/RTV/2026-10-24.json` (fetched 23/10/2026 14:26 IST) | high for titles |
| S3 | HKJC Racing News English index (22/10/2026): "Cox Plate Preview — Waller and McDonald chase history in G1 W.S. Cox Plate at Flemington"; circulars "Cox Plate Day – Declared Runners", "– Last 5 Performances", "– Racing Colours"; 19/10 "Simulcast arrangement – Cox Plate Day and Kikuka Sho to be beamed live for betting"; 01/10 "Sir Delius set to dominate Turnbull Stakes at Flemington, believes Williams"; 08/10 "Baker confident of success with Warwoven in Caulfield Guineas" | GitHub `sleepingarhat/domain-brain` → `ingestion/chunks/20261022-170441-hkjc-news.json`, `20261003-052400-hkjc-news.json`, `20261008-190502-hkjc-news.json` (titles only; article bodies not captured) | high |
| S4 | Idol Horse front page 2026-10-23: "Kingston Town's Trainer Won Seven Cox Plates – His Daughter Gai Waterhouse Is Still Waiting On One … Sir Delius might be her best chance in more than a decade" (Adam Pengilly) | `sleepingarhat/domain-brain` → `ingestion/chunks/20261023-165922-idol-horse.json`. Original https://idolhorse.com/horse-racing-news/world/why-cant-gai-waterhouse-win-a-cox-plate/ | high |
| S5 | HKDN Racing (hkdnracing.com, Traditional Chinese) 2026-10-20 "一場足以名留青史的覺士盾" — Waller's two runners gallop at Flemington; 12 acceptors; draw Tuesday; Maher has four; Waterhouse & Bott have Sir Delius; Caulfield Guineas 1-2 both run | `domain-brain` `ingestion/chunks/20261021-080650-style-excerpts.json` + `-style-knowledge.json` + `wiki/style/exemplars.json` | high for the excerpt/summary; **medium** for sentences only present in `exemplars.json` (that file mixes real sentences with LLM-written style samples — see §6) |
| S6 | HKDN 2026-10-22 "華禮納再與麥道朗攜手力爭追平覺士盾紀錄" — Maher's 輕取勝 and 川河陸駒 drew **barriers 11 and 12**, both on-pacers; Waller sends 陽光小姐; 12 runners; A$6M (~HK$32M) | `domain-brain` `20261023-080431-style-knowledge.json` (machine summary of the full article) | high |
| S7 | HKDN 2026-10-22 "萬眾矚目的覺士盾將於費明頓上演" — history piece; "12 runners, 9 of them G1 winners"; Via Sistina retired; analysis of Sir Delius (favourite), Aeliana (main danger), Warwoven | same chunk + `exemplars.json` | high (summary) / medium (analysis sentences) |
| S8 | HKDN 2026-10-22 "【凌機一觸】覺士盾兩女將爭創歷史" — Rachel King (金美琪) and Jamie Melham (苗傑美) chase the first female-jockey Cox Plate win on 3yos 戰跡 and 加碼一擲 (first 3yo winner since Shamus Award 2013) | same chunk | high (text) / medium (name mapping) |
| S9 | Sportsbet race-card JSON captures (full form, pedigree, stats, results) for the 2026 Queen Elizabeth Stakes, Tancred Stakes, Verry Elleegant Stakes, plus Doomben Cup/Warwick Farm files | GitHub `kaballas/yy1` → `src/get_data/data/race_10350480_class_1__sportsbet_racing_json_2026-04-11.json`, `race_10298478_class_1___2026-04-04.json`, `race_10197604_class_1__sportsbet_racing_json_2026-02-28.json`, `race_10506805_class_1.json` (commit 0cd4af7b) | high (real captured responses) |
| S10 | 2026 Australian G1 calendar + winners (Japanese fan calendar) | GitHub `meshi-z/horse-racing-calender` → `src/data/australia_race_master.json`, `src/data/race_winners.json` (commit 7d0c9ead) | medium (dates/winners); **venue field wrong for the 2026 Cox Plate** → low for venues |
| S11 | PuntingIQ daily model reports (HTML) for 2026-09-12, 10-03, 10-10, 10-17, 10-19…10-23 — per-race top model pick with odds; Best Bets with jockey/trainer/form | GitHub `puntingiq/puntingiq-site` → `reports/YYYYMMDD/daily-intelligence.html` (20261024 did not exist yet at 11:20 UTC 23 Oct) | high (for what they show) |
| S12 | Real Racing Australia results page, Cox Plate day 2025 (The Valley, 25 Oct 2025) | already in this repo: `research/fixtures/racingaustralia/Results.aspx-REAL-thevalley-2025-10-25.html` (copied from `thumentianlu1993-blip/Umanewsbot`) | high |
| S13 | SMH/ABC racing headlines 2026-10-20: "Jockeys cleared over Ohope Wins's fatal Caulfield Cup fall" (ABC) ; 2026-10-09 "Baker backs relaxed Warwoven to join elite company in Caulfield Guineas" (SMH) | GitHub `hamishivi/hamish-reads` → `docs/data/2026-10-20/news.json`, `docs/data/2026-10-09/news.json` | high (headlines) |
| S14 | Entain (Ladbrokes) daily captures by date — only `racing_data/2026-10-23/` existed (Cranbourne, Ballarat); tomorrow's folder should appear on 24 Oct | GitHub `Josh9456/Racing-Form-` | n/a (shape reference for the Entain adapter) |
| S15 | Betfair Hub tipster results CSV (March 2026) — Warwoven's 2yo wins | `betfair-datascientists/betfair-datascientists.github.io` → `src/data/assets/Hub_Tipster_Results_2026-03.csv` (no 2026-09/10 file exists yet) | medium |

GitHub code searches run (via the GitHub MCP code-search tool): `"Aeliana"`, `"Sir Delius"`, `"Cox Plate" 2026 Flemington`, `"Moonee Valley Gold Cup" 2026`, `"Manikato Stakes" 2026`, `"2026-10-24" Flemington`, `"Cox Plate" "Moonee Valley" redevelopment`, `"Via Sistina" 2026`, `"Treasurethe Moment"`, `"Crockett Stakes" OR "Fillies Classic" OR "Moonee Valley Vase" 2026`, `"Cox Plate" 2026 barrier jockey field`, `"Sir Delius" "Cox Plate"`, `"Aeliana" Waller horse`, `"Warwoven"`, `"Middle Earth" "Cox Plate"`, `repo:sleepingarhat/domain-brain 覺士盾` (+ repo-scoped variants). Searches for the Gold Cup, Vase, Fillies Classic and Crockett Stakes 2026 fields returned **nothing** — those fields are simply not on GitHub yet.

---

## 2. The meeting

* **Flemington, Saturday 24 October 2026, VIC, TAB metropolitan.** Cox Plate day is normally the Moonee Valley Racing Club's meeting at The Valley; in 2026 it is run at Flemington because Moonee Valley is being redeveloped [S1 **high**, S3, S5–S8]. Transport Victoria: gates 10:30am, first race 12:25pm, last race 5:50pm; extra trains Flinders St → Flemington Racecourse 10:10am–5:00pm, return 1:30–9:00pm; very large crowds expected (two other events at the Showgrounds) [S1 **high**].
* **9 races** (brief). Timetable anchors: R1 12:25 [S1], Gold Cup 16:20 (brief), Cox Plate 17:10 (brief), last race 17:50 [S1]. With ~40-minute gaps the Gold Cup is R7 and the Cox Plate R8, with one race after it — **inferred, medium**. If the official card shows the Cox Plate as the last race, the brief's 5:10pm is wrong, not S1.
* **Track condition / rail / penetrometer / weather: not obtainable** (all weather and racing hosts blocked). Indirect hint only: HKDN says the Turnbull Stakes (Flemington, 3 Oct) was run on a heavy/bog track and that Sir Delius "should be better on drier ground" [S7, low]. On the user's machine the sibling adapters get this from racing.com (`getMeeting` → `trackCondition`, `trackRating`, `railPosition`, `weather`), Racing Victoria track reports, BOM (Melbourne Olympic Park 086338 / Essendon) and Open-Meteo (−37.79, 144.91).
* **2025 precedent (real page, [S12]):** 10 races at The Valley, R1 12:10pm, R8 McEwen Stakes G2 1200m WFA A$300k 4:10pm, R9 (Drummond Golf) Vase G2 2040m 3yo SW A$400k 4:50pm, R10 Ladbrokes Cox Plate G1 2040m WFA A$6M 5:40pm, going Good 4. Typical undercard also carries the Moonee Valley Gold Cup (G2 2500m), Fillies Classic (G2 3yo fillies 1600m) and Crockett Stakes (Listed 1200m) — **none of the 2026 undercard races was confirmed**, so they are `null` in the pack. The **Manikato Stakes is not on this card**: the fan calendar has it on 2026-09-25 at Moonee Valley, won by Jimmysstar (Ethan Brown) [S10, medium] — the brief's suggestion to search "Manikato Stakes 2026 field" refers to a race already run.
* **Prize money:** Cox Plate A$6,000,000 (HKDN "總獎金達600萬澳元" [S6][S7] and 2025 [S12]) — **high**. 2025 distribution 4,000,000 / 800,000 / 500,000 / 250,000 / 150,000 / 100,000×3 (assumed unchanged — medium). Other races unknown.

---

## 3. The Ladbrokes Cox Plate 2026 (inferred Race 8, 5:10pm, G1 WFA 2040m, 12 runners)

### 3.1 What is certain
* 12 acceptors, barrier draw held Tuesday 20 Oct [S5 **high**]; "12 runners, 9 of them Group 1 winners" [S7 **high**]; A$6M [S6][S7]; 2040m [S5][S6][S8] + brief. (Flemington has no regular 2040m start — expect a bespoke start; verify distance on the official card.)
* Two Ciaron Maher runners drew the two outside gates, **11 and 12**; both race on the pace [S6 **high**].
* Sir Delius: **barrier 5** (brief and HKDN agree → **high**); Aeliana: **barrier 10** (brief only → medium).
* Chris Waller has **two** runners, Gai Waterhouse & Adrian Bott **one** (Sir Delius), Ciaron Maher **four**, and the **Caulfield Guineas 1st and 2nd** (both 3yos) run [S5 **high**].

### 3.2 Identified runners (5 of 12)

| Horse | Barrier | Jockey | Trainer | Age/sex | WFA weight* | Why we believe it | Conf. |
|---|---|---|---|---|---|---|---|
| **Sir Delius (GB)** — Frankel × Whatami, bay | **5** | Craig Williams (rode him in every 2026 start; quoted in HKJC Turnbull preview; not explicitly booked) | **Gai Waterhouse & Adrian Bott** | 6yo entire (5yo in Apr 2026 per Sportsbet) | 59.0 | Idol Horse [S4]; HKDN "國民樂派" = favourite, "5檔起步亦屬理想" [S7]; brief | name/barrier/trainer **high**, jockey **medium** |
| **Aeliana (NZ)** — Castelvecchio × Temolie, bay | **10** (brief) | **James McDonald** | **Chris Waller** | 5yo mare | 57.0 | HKDN ×2 "陽光小姐由麥道朗策騎" [S5][S6]; HKJC "Waller and McDonald chase history" [S3]; brief | trainer/jockey **high**, barrier **medium** |
| **Birdman** | ? | Ben Melham | Chris Waller | ? | 59.0 if 5yo+ gelding | HKDN: Waller's second runner 「天鳥俠義」 ridden by 苗康文 "won G1s in Brisbane and Melbourne in the last six months", "ran out of petrol in the last 100m last start" [S5]. Birdman won the Doomben Cup (16 May, J McDonald) and Underwood Stakes (19 Sep, Ben Melham) [S10]; 苗 is the HK rendering of Melham | **medium** |
| **Warwoven** | ? | Rachel King | Bjorn Baker ("Baker" in HKJC/SMH headlines) | 3yo | 49.5 (3yo colt/gelding scale; sex not confirmed) | HKDN: 「戰跡」 = Caulfield Guineas winner, ridden by 金美琪 (King) [S5][S8]; Warwoven won the Caulfield Guineas (10 Oct) and Golden Rose (26 Sep) with Rachel King [S10]; HKJC preview "Baker confident of success with Warwoven" [S3] | **medium-high** |
| **Middle Earth (GB)** | ? | ? | Ciaron Maher | older gelding (assumed) | 59.0 | HKDN names 「中土世界」 among Maher's four [S5]; same name was 3rd in the 2025 Melbourne Cup behind Half Yours and Goodie Two Shoes [S6-series article "距離2026年墨爾本盃嘉年華尚有8日"; Sportsbet form line confirms that 1-2] | **medium** |

\*WFA weights are the standard October scale (4yo+ male 59, 5yo+ mare 57, 4yo mare 55.5, 3yo colt 49.5 — cf. 2025 carried weights [S12]); **not read from the 2026 card**.

### 3.3 Known but unresolved (4 of 12) — do **not** guess English names
| HK Chinese name | Facts (all HKDN, medium-high) |
|---|---|
| 加碼一擲 | 3yo; **2nd in the 2026 Caulfield Guineas** (behind Warwoven); to be ridden by **Jamie Melham** (苗傑美). Trainer unknown. |
| 輕取勝 | **Ciaron Maher**; **barrier 11**; on-pace runner. (Light Infantry Man — Maher-trained, 5th in the 2025 Cox Plate, 2026 Australian Cup winner — is a *candidate* only; mapping unverified.) |
| 川河陸駒 | **Ciaron Maher**; **barrier 12**; on-pace runner. |
| 聖喬治 ("St George") | **Ciaron Maher** (his fourth runner). |

**3 runners are completely unknown.** The HKJC circular "Cox Plate Day – Declared Runners" (22 Oct) and the VRC/Racing Victoria fields carry the full 12 — fetch them on the user's machine.

### 3.4 Form of the two headline runners (from real Sportsbet captures [S9] and results [S10][S12])

**Sir Delius (GB)** — 13 starts 7-2-3 to 11 Apr 2026 (12:6-2-3 before the QE Stakes). Good 3:2-1-0, Soft 7:2-1-3, Heavy 2:2-0-0; 2000m 3:2-0-1; first-up 4:2-1-1; Sportsbet settling "Midfield"/"Pace".
2025 spring: 1st Caulfield 1800m 20 Sep 2025 (Underwood Stakes date; class field truncated — medium); **1st Turnbull Stakes G1 2000m Flemington 4 Oct 2025** (58kg, bar 14, $7.00, 1.8L over Antino, 2:02.82, last 600m 33.85); then **withdrawn from the Cox Plate/Cups on vet advice** ("vets cut short his Cox Plate/cups campaign" — Sportsbet comment Feb 2026; HKDN "去年因獸醫檢查後被剔除").
2026 autumn: 3rd Verry Elleegant (Chipping Norton) Stakes G1 1600m Randwick 28 Feb ($8, 3.9L; Autumn Glow 1st, Aeliana 2nd; Soft 5); 3rd Ranvet Stakes G1 2000m Rosehill 21 Mar ($3.00, 1.0L; Aeliana 1st, Lindermann 2nd); **1st Queen Elizabeth Stakes G1 2000m Randwick 11 Apr** ($6.00, bar 3, 59kg, Good 4) from Lindermann ($31) and Autumn Glow ($1.30 fav), Dubai Honour 4th, Light Infantry Man 5th.
2026 spring: Makybe Diva Stakes G1 1600m Flemington 12 Sep — saddlecloth 4, W$4.20 pre-race [S11], **4th** (HKDN "two fourths this season" — medium); Turnbull Stakes G1 2000m Flemington 3 Oct — HKJC preview "set to dominate … believes Williams", **4th** behind Cosmic Crusader (W Pike) on a heavy track with "very fast sectionals" [S7][S10] (medium). HKDN verdict: hot favourite, better on drier ground, barrier 5 ideal.

**Aeliana (NZ)** — 18 starts 6-6-1, A$4.44M to 11 Apr 2026. Good 12:2-4-1, Soft 5:4-1-0, Heavy 1:0-1-0; 2000m 4:1-1-0; first-up 4:0-2-1; settling "Off midfield".
2025: Australian Derby G1 2400m winner ("best win was this trip in last year's Derby" — Sportsbet, medium); ran the Turnbull 4 Oct 2025 (finish not captured); **6th Cox Plate 25 Oct 2025** (5.2L, $8, bar 7, 55.5kg, H Bowman) behind Via Sistina [S12].
2026 autumn: 2nd Apollo Stakes G2 1400m 14 Feb ($14, 2.8L to Autumn Glow); 2nd Verry Elleegant Stakes G1 28 Feb ($12, 0.4L to Autumn Glow); **1st Ranvet Stakes G1 2000m 21 Mar** ($1.60, 0.2L over Lindermann, Sir Delius 3rd); **1st Tancred Stakes G1 2400m 28 Mar** ($1.70, 0.2L over Dubai Honour, Vauban 3rd; Soft 6); Queen Elizabeth Stakes 11 Apr — no placing recorded while the other 7 runners have places 1–7 → apparently last (low).
2026 spring: starts not captured; Waller: last start was a "semi-final" run to standard, she has come up well through winter, "health excellent" [S5]. HKDN: leads Sir Delius **3–1** head-to-head; will come from behind with strong stamina [S7].

### 3.5 Other 2026 spring Group 1 results useful for rating rivals ([S10], medium)
Winx Stakes 22 Aug — Autumn Glow (J McDonald) · Memsie 29 Aug — Beiwacht (N Rawiller) · Moir 5 Sep — My Gladiola · **Makybe Diva 12 Sep — Sheza Alibi (L Nolen)** · **Underwood 19 Sep — Birdman (B Melham)** · Manikato 25 Sep — Jimmysstar (E Brown) · **Golden Rose 26 Sep — Warwoven (R King)** · Epsom 3 Oct — God's Window · Metropolitan 3 Oct — Juja Kibo · Flight 3 Oct — Global Goal · **Turnbull 3 Oct — Cosmic Crusader (W Pike)** · **Caulfield Guineas 10 Oct — Warwoven (R King)** · **Might And Power (Caulfield Stakes) 10 Oct — Land Legend (E Brown)** · Toorak 10 Oct — Lady Shenandoah (J McDonald). The Everest 17 Oct — **Tempted** (C Schofield) beat Ka Ying Rising [S4]. Caulfield Cup 17 Oct — winner not captured; **Ohope Wins (2026 Australian Oaks winner) suffered a fatal fall; Half Yours involved; jockeys cleared** [S13].

### 3.6 History and narrative lines (for the news/sentiment factor)
* Chris Waller seeks a record-equalling **7th** Cox Plate (T.J. Smith 7); James McDonald rides Aeliana [S3][S6]. Gai Waterhouse has **never** won it; Sir Delius "might be her best chance in more than a decade" [S4].
* First 3yo winner since **Shamus Award (2013)** would be Warwoven or 加碼一擲; first female-jockey winner ever would be Rachel King or Jamie Melham [S8].
* Dual winner **Via Sistina** (2024, 2025) has retired [S7]. 2025 result: Via Sistina, Buckaroo, Treasurethe Moment, Attrition, Light Infantry Man, Aeliana, Nepotism, Antino; Globe scratched; 2:05.03, Good 4 [S12 **high**].
* Barrier-draw folklore for a 2040m race with a short run to the first turn: inside is helpful (sibling model-knowledge report) — Sir Delius 5 "ideal" per HKDN; Maher's on-pacers from 11–12 must cross.

---

## 4. Other Saturday meetings (24 Oct 2026)

| City | Venue | Confidence | Evidence |
|---|---|---|---|
| Sydney | **Royal Randwick** — Spring Champion Stakes G1 2000m 3yo SW (2026-au-g1-62) | medium | [S10] (venue field unreliable, but the Spring Champion is a Randwick Everest-carnival race) |
| Melbourne provincial | **Yarra Valley** | medium | RTV "Racing Review – Yarra Valley" [S2] |
| Adelaide | **Morphettville** | medium | RTV "Racing Review – Morphettville" [S2] |
| Brisbane | Eagle Farm or Doomben | unknown | not captured |
| Perth | Ascot or Belmont | unknown | not captured |
| Hong Kong | Sha Tin is **Sunday 25 Oct**; HKJC simulcasts Cox Plate Day for HK betting [S3] | high | an extra independent source of the final field/colours/form and HK tote odds |

Fields for these meetings were **not** obtainable.

---

## 5. Live endpoints the app should hit on the user's machine (none fetched here)

| Need | Endpoint | Notes | Conf. |
|---|---|---|---|
| Official Flemington card, barriers, riders, weights, gear, scratchings | `GET https://racingaustralia.horse/FreeFields/Form.aspx?Key=2026Oct24,VIC,Flemington` (+ `Acceptances.aspx`, `Scratchings.aspx`, `Results.aspx` same Key) | HTML; shape documented in `research/racingcom.md` §Racing Australia and real sample in `research/fixtures/racingaustralia/` | medium (key grammar proven on 2025 page) |
| racing.com card/form/odds, meeting header (track, rail, weather) | `POST https://graphql.rmdprod.racing.com/` → `GetMeetingByDate(date:"2026-10-24")`, `getMeeting`, `getRacesForMeet`, `getRaceForm(meetCode, raceNumber)` | see `research/racingcom.md` | medium |
| VRC event page (times, race list) | `https://www.vrc.com.au/race-days-and-events/2026-2027/2026-cox-plate/` | linked from the Transport Victoria article [S1] | medium |
| Transport Victoria event notice (times) | `https://transport.vic.gov.au/news-and-resources/events-and-public-transport/public-transport-for-the-cox-plate` | captured text in evidence/ | high |
| HKJC simulcast: declared runners, last-5 performances, colours, HK odds | `https://racingnews.hkjc.com/english/` (circulars "Cox Plate Day – …"); simulcast race pages under `https://racing.hkjc.com/racing/information/English/Racing/` | HK Chinese names map: 國民樂派 Sir Delius, 陽光小姐 Aeliana, 精緻之道 Via Sistina, 中土世界 Middle Earth | high that they exist |
| HK Daily News racing previews (Chinese) | `https://hkdnracing.com/zh/news/<title>-YYYYMMDD` | the four article URLs in §1 | high |
| Idol Horse preview | `https://idolhorse.com/horse-racing-news/world/why-cant-gai-waterhouse-win-a-cox-plate/` | | high |
| Community mirrors that may refresh on race morning | `https://raw.githubusercontent.com/puntingiq/puntingiq-site/main/reports/20261024/daily-intelligence.html` (model pick per race, Best Bets with jockey/trainer/form/odds; 404 until published) ; `https://raw.githubusercontent.com/Josh9456/Racing-Form-/main/racing_data/2026-10-24/Flemington_Thoroughbred_AUS_VIC/meeting_info.json` and `Race_NN_<name>.json` (Entain JSON, same shape as `fixtures/entain/`); `https://raw.githubusercontent.com/sleepingarhat/domain-brain/main/ingestion/chunks/<YYYYMMDD-HHMMSS>-hkjc-news.json` | unofficial; treat as low-weight corroboration only | medium |
| 2026 G1 results list | `https://raw.githubusercontent.com/meshi-z/horse-racing-calender/main/src/data/race_winners.json` + `australia_race_master.json` | fan-maintained; venue for 2026 Cox Plate wrong | medium |

---

## 6. Uncertainties, conflicts and traps

1. **Race numbers are inferred** (Gold Cup R7, Cox Plate R8, one race after). Only R1 12:25 and last race 17:50 are documented. Re-key everything by the official card.
2. **Aeliana's barrier 10 rests on the brief alone**; Sir Delius's barrier 5 is corroborated by HKDN. Maher's pair in 11–12 is HKDN only (high-quality summary of a real article).
3. **Chinese-name identifications**: 陽光小姐 = Aeliana ("Aeliana" derives from the Latin for sun; rider McDonald matches), 天鳥俠義 = Birdman (G1s in Brisbane + Melbourne within six months; rider 苗康文 ≈ B. Melham), 戰跡 = Warwoven (Caulfield Guineas winner; rider 金美琪 = King), 中土世界 = Middle Earth (3rd in the 2025 Melbourne Cup), 苗傑美 = Jamie Melham, 金美琪 = Rachel King. These are inferences with supporting facts, not translations read from an official bilingual list. 加碼一擲, 輕取勝, 川河陸駒, 聖喬治 are **not** resolved.
4. **`wiki/style/exemplars.json` in `sleepingarhat/domain-brain` mixes real article sentences with LLM-generated style samples** (one talks about a horse "Gobi Desert"; one says the retired Via Sistina galloped for Saturday). Sentences from it were used only when they match an excerpt/knowledge summary or an independent result (e.g. Birdman's two G1s, the Guineas 1-2, Maher's four). The Sir Delius/Aeliana analysis paragraph is consistent with everything else but is tagged **medium**.
5. The brief's hint to search the **Manikato Stakes 2026 field** is misleading: that race was run on 2026-09-25 (medium).
6. The **meshi-z calendar lists the 2026 Cox Plate at Moonee Valley** — stale; every other source says Flemington.
7. **Sir Delius's exact 2026 spring finishes (two 4ths) come from one HKDN sentence**; the Makybe Diva/Turnbull winners are from the fan calendar. Verify from Racing Australia `Results.aspx?Key=2026Sep12,VIC,Flemington` and `2026Oct03,VIC,Flemington`.
8. **No odds, no track/rail/weather, no scratchings** could be obtained. The pack leaves them `null` on purpose.
9. **Caulfield Cup 2026 fatality (Ohope Wins)** and the related stewards' inquiry are real, recent events that may affect rider bookings and the "news sentiment" factor; the winner of the Caulfield Cup was not captured.
10. Sibling fixtures in `fixtures/racingcom/` and `research/fixtures/news/` for 2026-10-24 are **constructed** (they contain invented horses such as "Brass Lantern"); do not merge them with this pack as if they were real.

---

## 7. Fixtures written

| Path | Kind | Note |
|---|---|---|
| `fixtures/tomorrowcard/flemington-2026-10-24.json` | structured research pack `{meeting, races[], otherSaturdayMeetings, history, formReference2026, newsContext, sources, builtAt, confidenceNotes}` | runners carry `fieldConfidence`; unresolved runners under `races[7].unresolvedRunners`; nulls where unconfirmed |
| `fixtures/tomorrowcard/evidence/ptv-cox-plate-2026-10-14.json` | REAL (verbatim) Transport Victoria article | |
| `fixtures/tomorrowcard/evidence/hkjc-news-index-2026-10-22.json` | REAL HKJC news index capture (titles) | |
| `fixtures/tomorrowcard/evidence/hkdn-cox-plate-articles-2026-10-20..22.json` | REAL HKDN excerpts + knowledge summaries + exemplar sentences (with the mixed-provenance warning) | |
| `fixtures/tomorrowcard/evidence/rtv-epg-2026-10-24.json` | REAL RTV EPG for 24 Oct | |
| `fixtures/tomorrowcard/evidence/au-g1-2026-calendar-and-winners.json` | DERIVED join of two real calendar files | |
| `fixtures/tomorrowcard/evidence/sportsbet-2026-autumn-sir-delius-aeliana.json` | EXTRACT of real Sportsbet captures (QE Stakes, Tancred, Verry Elleegant 2026) | |
| `fixtures/tomorrowcard/evidence/news-headlines-2026-10-20..23.json` | REAL Idol Horse front page + SMH/ABC headline capture | |
