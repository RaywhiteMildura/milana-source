# Model knowledge — quantified factors for predicting Australian thoroughbred races

Source key: **`modelknowledge`** · Researched 2026-10-23 for RaceLens · Fixtures: `research/fixtures/modelknowledge/`

> **Honesty note.** This container cannot open racing, bookmaker, news or academic hosts (DNS is blocked for everything except `github.com` / `raw.githubusercontent.com`). Every figure below therefore comes from one of three places, and each is tagged:
> * **[search]** – the text snippet returned by a web-search engine for a cited page (I could not open the page itself). Treated as **medium** confidence when the snippet quoted numbers directly, **low** when it paraphrased.
> * **[read]** – a GitHub file I actually opened and read (Betfair Australia's `autoHubTutorials` notebooks and code, community racing repos). **High** confidence for what the file says; the *validity* of a community heuristic is separate and is rated on its own.
> * **[memory]** – my own prior knowledge, with no document behind it in this session. Always **low** confidence; verify before relying on it.
>
> "Confidence" on a fact means *how sure I am the source says this*, not how strong the effect is. Effect strength is discussed in the text. Nothing here was fetched live from a racing website.

---

## 0. Executive summary for the model builder

1. **The market is the strongest single predictor.** Australian favourites win roughly **35%** of races (56,616-race sample [S1]); the top two in the market win ~44% and the top three ~57% at a typical provincial track [S3]; and on Betfair the eventual winner traded at $1.01 in-play in 99% of 16,891 races in 2025/26 [S6]. Betfair's own data scientists find the BSP "a very strong estimate of a selection's chance" with calibration close to the diagonal except at sub-$1.20 [S20]. **Any fundamental model should be blended with the market (Benter-style log-odds combination), not run instead of it** (§2.5, §13).
2. **The favourite-longshot bias is real but small at the top of the market.** Flat-staking favourites loses only ~5.5% (5.6M US starts [S4]); the Australian sample above lost ~$689 on 56,616 $1 bets (≈-1.2%) [S1]. Longshots lose far more. Bookmaker and exchange studies show the bias shrinking over time and vanishing in the final 30 minutes of betting [S9][S10]. Implication: **never up-weight roughies to "find value"; value comes from information the market has not priced, not from price bands.**
3. **Form/class/fitness factors are the fundamental core**; jockey and trainer are real but second-order and heavily confounded with horse quality; barrier matters by *track geometry and distance* (strong at Moonee Valley 1200m and Caulfield 1600m, weak on the Flemington straight, inverted-to-wide at Randwick 1600m) (§4); track condition matters mostly through *wet-track form* and *predictability* (heavy tracks are less predictable) (§5).
4. **Suggested starting weights** (§13) keep RaceLens's existing `BASE_WEIGHTS` structure, re-rank a few factors (class/trackDistance up, jockey/gear/lineage down), and add an explicit **market-blend step** with `beta_market ≈ 0.6` and a **confidence rubric** (§14) driven by source agreement, market concentration and conditions volatility.
5. **Staking**: place pays 1st–3rd with 8+ runners, 1st–2nd with 5–7, no place <5 [S40]; use **fractional Kelly (¼ default, ½ max)** with a hard cap in units [S43][S44]; exotics via **flexi** percentages [S41][S42]; tote takeout is ~14.5% win vs 20–22.5% on trifecta/First 4/quaddie [S45], so exotics need a bigger edge.

---

## 1. Baselines of Australian racing (what "average" looks like)

| Quantity | Value | Source / confidence |
|---|---|---|
| Races per season (national) | 19,199 (2023/24); 19,462 (2022/23) | Racing Australia Fact Book 2025 table [S50] **medium [search]** |
| Starters per season | 183,304 (2022/23) | TBNSW citing RA [S51] **medium** |
| Average field size (national) | 9.51 (2023/24), 9.42 (2022/23) | The Straight [S52] **medium** |
| Average field size NSW 2024/25 | 9.35 (lowest since 2004) | The Straight [S52] **medium** |
| Average field size QLD 2024/25 | 9.05–9.07 | The Straight / RQ [S53] **medium** |
| Implied "random" win chance | ≈ 1/9.5 ≈ 10.5% per runner | arithmetic |
| Group 1 races per season | 76 (2025/26) | TTR AusNZ [S60] **medium** |
| Betfair races traded 2025/26 (AU thoroughbred) | 16,891 | Betfair review via SEN [S6] **medium** |

Why it matters: a factor that lifts a runner's win rate from 10% to 15% is a *large* effect (×1.5). Report factor effects as multiples of the field baseline, not as absolute percentages.

---

## 2. Market efficiency, favourites and the favourite-longshot bias

### 2.1 Favourite strike rates (Australia)

| Statistic | Value | Source / confidence |
|---|---|---|
| Favourite win rate, all Australian races, 56,616-race sample | **35.14%** | Kruzey [S1] **medium [search]** (period/methodology not visible) |
| Second favourite | 19.9% | [S1] medium |
| Third favourite | 13.4% | [S1] medium |
| P/L of $1 on every favourite in that sample | about **-$689** (≈ -1.2% ROI) | [S1] medium — unusually small loss; may use best-of-book prices. Treat the *sign* (negative) as reliable, the magnitude as low |
| Top two in market combined (Coffs Harbour sample) | 43.9% | Polson/Breednet [S3] **low-medium** (single track) |
| Top three in market combined (same) | 57% | [S3] low-medium |
| Hawkesbury 1000m favourites 2013–2017 | 50.8% overall; favourites that *led at their last start* 68% (17/25) | Polson/Breednet [S2] **low** (tiny sample; author notes 2013 inflated the figure) |
| UK favourites since 2012 (corroboration) | 33.1% (15,785 / 47,683) | Geegeez [S5] **medium** |
| Melbourne Cup favourites (to 2013) | 34 winners ≈ 22%; winning favourites averaged ~4.4/1 | Quadrant [S7] **medium** |
| 2025 Group 1 winners' average Betfair price | $8.02 (shortest on record), 32 favourites won | Betfair review via SEN [S8] **medium** |

**Model use.** 33–35% is the favourite baseline for ordinary metropolitan/provincial fields; it is lower in big-field handicaps and Group 1 cups (~22% in the Melbourne Cup) and higher in small fields and sprints with a dominant on-pacer. If RaceLens's top pick is not the favourite, that is a strong claim and the confidence rating must say so (§14).

### 2.2 Favourite-longshot bias (FLB)

| Finding | Source / confidence |
|---|---|
| Betting every favourite loses ~**5.5%**; losses grow steadily with odds; extreme longshots lose most (5.6M US starts 1992–2001) | Snowberg & Wolfers, NBER w15923 [S4] **high** (well-known paper; figure in snippet) |
| FLB first noted by Griffith (1949); found in racetrack data worldwide | [S4] high |
| Australian bookmaker-odds study: informational efficiency tests using *bookmaker* (not tote) prices; filter tests on price series through betting | Bird & McCrae 1987, *Management Science* 33(12) [S9] **medium [search]** |
| Bird & McCrae chapter "The Efficiency of Racetrack Betting Markets: Australian Evidence" covers win-market efficiency and FLB, bookmaker odds movements, tipsters, insider information, place anomalies | [S9b] **medium** (contents listing only) |
| NZ pari-mutuel: FLB exists 30 min before close but "is essentially eliminated in the final 30 minutes of betting" | McKee 1998, Massey thesis [S10] **medium** |
| UK flat racing: degree of bias **declines significantly over time**, lower in five years after 2000 than before | Smith & Vaughan Williams [S11] **medium** |
| Adverse selection against bettors with superior information explains at least part of the bias | Vaughan Williams & Paton 1997, *Economic Journal* [S12] **medium** |
| Person-to-person (exchange) markets, Smith, Paton & Vaughan Williams 2006 *Economica* 73(292):673–689 — title only; **[memory]** says exchange prices show a *smaller* FLB than bookmakers | [S13] **low** |
| Starting-price implied probabilities predict results better than first-show odds (UK 2003) | Shing 2005 [S14] **medium** |
| Final-odds implied probabilities "closely correspond" to winning probabilities (Bruce & Johnson 2000, cited) | [S15] **medium** |
| Shin (1993) model for de-biasing bookmaker overround outperforms basic normalisation | [S16] **medium** |

**Model use.**
* Convert market odds to probabilities with **Shin or power normalisation**, not simple proportional normalisation, when using bookmaker fixed odds; use plain normalisation for Betfair (overround ~1–2%).
* **Do not add a "longshot bonus".** The evidence says longshots are *over*-bet.
* Late market (final 10 minutes, Betfair) is more informative than early market (§2.4).

### 2.3 Betfair Australia's own evidence (read from code and notebook outputs)

From `betfair-down-under/autoHubTutorials` [S20][S21] — Australian thoroughbred WIN markets, Pro stream files, 12 months (Jul 2020–Jun 2021; Vic tracks Flemington, Caulfield, Moonee Valley, Bendigo, Sandown in the movements notebook). **High confidence that the notebook says this** [read]:

* BSP calibration plot (implied chance binned in 5% steps vs actual win rate) sits close to the no-bias diagonal "aside from some small sample noise at the top end, with very few horses running at sub 1.20 BSPs". Author: BSP is "a very strong estimate of a selection's chance" but "pretty obviously not perfect".
* About **7%** of thoroughbred traded volume goes through the BSP (mean BSP stake 7,287.52 vs traded limit volume 98,025.71 per market).
* **Volume timing:** nothing meaningful is traded >30 min out; volume roughly doubles from 10 min to 4 min out, doubles again by 1 min out, and nearly doubles again in the final minute — "the majority of traded volume happens in the last 2–5 minutes". Flemington averages ~500k traded per race vs ~120k at Bendigo. Prices more than 10 minutes out should be "viewed with skepticism".
* **Estimating the BSP before the jump:** mean relative absolute error at the scheduled off — best back 0.0917, ladder midpoint 0.0932, geometric midpoint 0.0944, best lay 0.1031, Betfair *near price* 0.1213 (cached, updated only every 60 s), far price 0.578. At the last pre-suspension tick the geometric midpoint is best (0.0396). A random forest on order-book features (back/lay ticks in 30 s, weight of money, best support, WAP movement 10 s) gets 0.0889 / 0.0792 — only a modest gain.
* Author's framing claim (not a result): "Strong movements in betting markets are usually pretty reliable indicators about what is about to happen", with the caveat that a horse backed from $3.50 to $2 still loses ~50% of the time.

**Model use:** when the app polls Betfair in the final minutes, use the **geometric mid of best back/lay** as the market probability; treat prices >10 minutes out as noisy; weight the market blend by *time to jump* (more weight closer to the off).

### 2.4 Market movers (firmers vs drifters)

| Finding | Source / confidence |
|---|---|
| Horses that **shorten** have "comfortably the best strike rate"; more horses drift than shorten | Geegeez UK series [S30] **medium** |
| Horses that drift early→opening show→SP win about **1 in 16**, A/E **0.81**, lose **34p/£** at SP (losses >12p/£ even at BSP) | [S30] medium |
| Betfair SP data: **steamers won 5.5% more often than drifters**, yet strong steamers *lost* 13p/£ at BSP while drifters lost ~1p/£ | Geegeez [S31] **medium** |
| Drifters outside the top two in the market: 13.1% SR, ROI +0.1% ("not bankable") | [S30] medium |
| Betfair Hub race write-ups cite firmers anecdotally (e.g. $2.52→$2.00 winner) — no systematic AU win rate found | [S32] **low** |
| Bond University: a "hot hands" jockey-streak strategy yields a negative return overall and for most hot-hand jockeys | [S33] **medium** |

**Model use:** a firm is **information about win probability** (use it — it is already in the current price) but **not a source of ROI** (the price has moved). In RaceLens, `moneyMove` should mostly *update the market probability used in the blend* and only lightly adjust the fundamental score; never treat a drifter as "value" by default.

### 2.5 The Benter / Bolton–Chapman framework

* Benter (1994) used the **multinomial (conditional) logit** of Bolton & Chapman (1986) "Searching for Positive Returns at the Track"; outputs are probabilities summing to 1 within a race; the fundamental model is **combined with the public's implied probabilities** via a second logit stage — a secondary summary says "nine significant fundamental factors" [S17] **medium [search]**.
* **[memory, low]** The combination is `p_i ∝ exp(α·ln f_i + β·ln m_i)` where `f` is the fundamental estimate and `m` the market probability, with `α, β` fitted; in Benter's Hong Kong work the market coefficient was large and the combined model beat both components. Factors he named (from memory): past finishing positions/margins, speed and sectional figures, distance preference, class/race-level adjustments, weight, jockey, trainer, draw, days since last run, track condition, age.
* Hong Kong "tiny information edge" commentary [S18] **low**.

**Model use:** implement exactly this two-stage structure (§13). It is the single most important architectural decision in this document.

---

## 3. Field position / barrier draw

No source gave a clean barrier-by-distance win table for the four target tracks; all venue claims below are **qualitative or small-sample**. The only hard numbers are for the Melbourne Cup, Caulfield Cup, Flemington 2023 and Randwick 1600m Group 1s. RaceLens should **learn barrier effects from its own results store** and use these as priors only.

### 3.1 Flemington

| Finding | Source / confidence |
|---|---|
| Flemington 2023 (all distances): **barrier 4** produced the most winners, then **6**, then **5** | VRC "Flemington 2023 wrapped" [S70] **medium** |
| **Straight 1200m ("Straight Six")**: no turns, so the draw's positional effect is small; several guides say **wide draws are often better** because they can find better ground and get clear runs; another guide says inside usually performs better — sources conflict | horise / signalscv / thegazette [S71][S72] **low** |
| 2026 Newmarket Handicap: track manager conceded an **inside bias**; writers attributed the result partly to **lack of early pace** down the straight — "a trend recurring regularly of recent times over the straight course at Flemington is a lack of early tempo" | ANZ Bloodstock News [S73]; sportsnews [S74] **low-medium** |
| 1400–1600m: "midfield barriers can be the most ideal"; staying races: barrier matters less; outside barriers "slight advantage in the run home" from better ground | horise [S71] **low** |
| **Melbourne Cup (3200m) 1958–2024**: barrier **11** most winners (7). Wins by original draw: barriers 1–8 → 21, 9–16 → 27, 17–24 → 19 (20–24 under-represented because fields were larger at the draw) | VRC [S75][S76] **medium** |
| Blog table "1200m best barrier range 4–7, 11.8% win rate" — unsourced | horise [S77] **low (do not use as data)** |

**Flemington prior for RaceLens:** straight 1200m → barrier score ≈ 0 (neutral) with a *lane-bias* day pattern learned from earlier races on the card (inside vs outside groups); 1400–1600m → mild penalty for very wide (≥12) and very inside (1–2) in big fields; 2000m+ → small effect.

### 3.2 Caulfield

| Finding | Source / confidence |
|---|---|
| 1100m & 1200m: inside advantage described as **minimal** — ~650m of straight running before the home turn | horise Caulfield track page [S78] **low** |
| **1600m (Caulfield Guineas trip)**: short run to the first turn; barrier draw called "the critical statistic for the Caulfield Guineas" | Racing & Sports 2016 [S79] **medium**; horise [S78] low |
| Caulfield Cup (2400m) since 1922: most successful barriers have 8 wins each; **barrier 1 has one win (1941)** | Breednet [S80] **medium** |
| A separate guide claims ≤1200m inside = high impact and wet tracks flip advantage to wider lanes — contradicts [S78] | horise track-bias guide [S81] **low** |

**Caulfield prior:** 1600m–2000m → strong inside/middle preference (penalise ≥11 in 14+ fields); sprints → mild; 2400m → avoid barrier 1 prior is folklore-level, keep tiny.

### 3.3 Randwick

| Finding | Source / confidence |
|---|---|
| **Epsom Handicap (1600m)**: winner from a **double-digit gate in 12 of the past 19 years**; **Doncaster Mile (1600m)**: 12 of the past 20 winners from barrier 10 or wider | Racing & Sports 2023 [S82] **medium** |
| Wide barriers at Randwick "usually more of a benefit than a hindrance" — long uphill straight rewards backmarkers | The Roar [S83] **low** (opinion) |
| Inside lanes dominant when the rail is "true"; wide lanes win after rail moves / on heavy tracks | horise [S81] **low** |
| 1200m/1400m: no statistics found; race reports mention headwinds and soft tracks affecting sectionals | Racing NSW Punters Intelligence wraps [S84] **low** |

**Randwick prior:** 1600m big-field handicaps → *no* inside bonus; slight bonus to 8–14 when the field is 14+; sprints → neutral pending learned day pattern.

### 3.4 Moonee Valley

| Finding | Source / confidence |
|---|---|
| 1200m: inside barriers advantageous — ~300m to first turn, then ~200m run before the final bend | horise MV page [S85] **low** |
| 1600m: barrier less influential than at 1200m | [S85] low |
| 2040m (Cox Plate trip): inside helpful (short run to first turn); 2600m: little/no advantage; 3000m: minimal | [S85] low |
| Old newspaper claim that most 1600m winners started near the outside (undated) | Trove [S86] **low** |

**Moonee Valley prior:** 1000–1200m → strongest inside preference of the four tracks (penalise ≥9); 2040m → moderate inside preference; 1600m → mild.

### 3.5 General barrier rules (all tracks)

* Effect scales with **field size** and **distance to first turn**, and interacts with **pace**: a wide-drawn leader can cross; a wide-drawn backmarker loses little. RaceLens already scales by field size (`sizeFactor` 0.6/0.85/1.0 ≤8/≤12/>12); keep it.
* Community encodings seen in code (**low**, unvalidated): optimal draw 3 (<1200m), 5 (<1600m), 8 (≥1600m) with −0.05 per slot away [S90]; "wide = better ground" for straight sprints [S71].

---

## 4. Rail position and track bias

* Rail positions are published per meeting ("True", "+3m", "+6m entire circuit" etc.). Community form tooling stores rail as `"True"` or metres out such as `"+6m"`, and a pace-bias scalar from −2 to +2 [S91] **high [read]** (field convention).
* Qualitative evidence: inside lanes dominate when the rail is true; with the rail out several metres the fresh ground is on the inside of the *new* rail and leaders/inside runners often dominate — e.g. Eagle Farm midweek "rail out 9–10m" meetings showed a "leaderish bias" that the writer attributes to **tempo** (slow pace → leaders hold on) rather than ground [S92] **low**.
* Flemington rail moves: trainer Michael Kent argued a faster inside section meant "very few horses able to get there"; he prefers wide rail moves because "if the fence is off everyone gets their chance"; the columnist notes bias "is never quite as pronounced as the initial perception" [S93] **low-medium**.
* An unsourced claim of ">60% of winners from inside barriers on soft going at the 2024 Autumn Carnival" exists [S81] **low — do not use**.
* **No rigorous Australian study** quantifying rail-position effects was found. The practical approach (also recommended by guides) is to **measure it on the day** from early results: winners' barrier groups and settling positions in races 1–3 → day pattern multipliers [S81]. RaceLens's `daypatterns.ts` (`inside/outside`, `leaders/backmarkers`, `favourites/roughies`) is the right mechanism; the priors above only seed it.

---

## 5. Track condition (going)

### 5.1 The rating scale

Adopted by the Australian Racing Board **December 2014** replacing Fast/Dead/Slow [S100][S101] **high**:

| Rating | Label | Description (Racing NSW / RA wording, paraphrased) |
|---|---|---|
| 1 | Firm 1 | Dry, hard track |
| 2 | Firm 2 | Firm track |
| 3 | Good 3 | Good track with reasonable grass coverage, little or no cushion |
| 4 | Good 4 | Track with some give in it ("ideal") |
| 5 | Soft 5 | Track with a reasonable amount of give |
| 6 | Soft 6 | Moist but not badly affected |
| 7 | Soft 7 | More rain-affected, will chop out |
| 8 | Heavy 8 | Rain-affected, will chop out |
| 9 | Heavy 9 | Wet track getting into a squelchy area |
| 10 | Heavy 10 | Heaviest category; "maximum wetness, nearing saturation" |

Synthetic/dirt tracks use Fast/Good/Soft descriptors [S100]. Community code maps these labels to 1–10 integers exactly as above [S94] **high [read]**.

### 5.2 How the rating is set

* **Penetrometer**: a 1 kg weight falls 1 m down a shaft and drives a 1 cm² rod into the soil; readings at **60 positions × 3 drops = 180 drops**, averaged; higher = softer. Readings are taken ≥2 days before the meeting and again on race morning [S102] **high**.
* The rating "is not assessed strictly to a scale of the penetrometer / Clegg hammer": objective readings are combined with a **subjective visual assessment** (turf cover, give, surface moisture); correlations differ between venues by soil type [S102][S103] **high**.
* **Upgrades/downgrades** during a meeting are common after early races; the app must re-read the rating before each race (the "pre-race recheck" requirement) [memory, **low** for the mechanism, high that it happens].

### 5.3 How much wet-track form matters

Direct Australian strike-rate studies by condition were **not found**. Evidence is sire-level and model-level:

| Finding | Source / confidence |
|---|---|
| **Snitzel** progeny: most wet-track winners of any sire since Aug 2018; **15.7% SR on wet** vs **14% overall** | TTR AusNZ 2024 [S104] **medium** |
| **Zoustar** progeny (2019): good tracks **20.56%** (102/496) vs soft/heavy **16.95%** (40/236) | TTR AusNZ 2019 [S105] **medium** |
| Zoustar black-type wins on wet since Aug 2018 at **8.6%** hit rate | [S104] medium |
| Punters' heuristic: if ~8 of 10 wins are on soft/heavy, treat wet as preferred | codesports Melbourne Cup wet guide [S106] **low** |
| Raw wet stats mislead when a horse's best *rating* run was on heavy (e.g. "overall wet stats look poor, one of his best rating efforts was in the Warwick Stakes in heavy going") | R&S 2012 [S107] **low** |
| Community model (AU, 2026): top-pick strike rate **Good 4: 22.5–27.5% (n=320)**, **Heavy 8: 25–28% (n=67)**, **Heavy 9: 14–20% (n=35)**, **Heavy 10: ~36% (n=14)** — heavy tracks noisier (tiny n) | Kelvin-Agents gap report [S95] **low** (one private model) |

**Model use (recommended):**
1. Compute wet-form from the runner's **soft+heavy record** (`starts:wins-seconds-thirds`) *relative to its overall record*, shrunk toward the field mean with a prior of ~6 starts; apply only when today's rating ≥ Soft 5, scaling linearly from Soft 5 (×0.4) to Heavy 10 (×1.0).
2. When the runner has **no wet starts**, fall back to **sire/damsire wet indicators** (§11) at ¼ strength.
3. **Lower overall confidence** on Heavy 8–10 (§14): fewer runners have relevant form, pace/bias effects are larger, late scratchings are common.
4. Community multipliers seen in code (going 1.1/1.0/0.95/0.92/0.90/0.85/0.82/0.80 for Firm→Heavy 10) are *speed* normalisers, not form weights [S90] **low**.

---

## 6. Class, ratings and weight

### 6.1 Benchmark (BM) system

| Fact | Source / confidence |
|---|---|
| A Benchmark race has **no upper eligibility limit**; weights are set from each horse's rating relative to the race benchmark; e.g. a rating-130 horse in a BM78 would carry **86 kg** (consistent with 60 kg at the benchmark + **0.5 kg per rating point**) | R&S on RV benchmarking trial 2012 [S110] **medium-high** |
| **0.5 kg per rating point**: a horse rated 64 carries 3 kg more than one rated 58 in a BM64 | horise handicap guide [S111] **medium** (secondary) |
| A "0–78" **ratings race** restricts eligibility to ≤78; a BM78 does not | [S110] medium |
| Racing Victoria (2022) reintroduced **0–64** races and removed a 2 kg premium from the BM58 scale; (2024) added **BM74** to the metro program | RV media releases [S112][S113] **high** |
| Benchmark ratings differ by state: a BM70 is stronger in VIC/NSW than QLD | gobet [S114] **low** |
| Racing NSW Benchmark & Handicapping Guide (2010) exists | [S115] **medium** (PDF title only) |
| Minimum top-weight/limit weights [memory]: handicaps typically limit 54 kg, metropolitan topweight ≥ 58–61 kg depending on race type | **low** |

### 6.2 Class ladder (lowest → highest)

Maiden → Class 1 → Class 2 → … Class 6 (wins-based) → Benchmark 58/64/70/74/78/84/90/100 (ratings-based) → Open handicap → **Listed** (min $80k, most $100k) → **Group 3** → **Group 2** → **Group 1** [S114][S116] **medium**. "Black type" = Group/Listed, bolded in sale catalogues [S116]. Weight-for-age (WFA) and set-weights races allocate weight by age/sex only (§7).

**Model use:** encode class as a **numeric ladder** (e.g. Maiden 40, Cl1 48, Cl2 52, Cl3 56, BM58 58, BM64 64, BM70 70, BM74 74, BM78 78, BM84 84, BM90 90, Listed 95, G3 100, G2 105, G1 112 — **[memory] low**, intended as ordinal spacing only) and score **class change** as the difference between today's class and the class of the runner's recent *competitive* runs (beaten ≤3 lengths). Community tooling bands class change as drops of 30+/20–29/10–19/<10 points and rises of 20+/10–19/<10 [S91] **high [read]** (convention, not effect size).

### 6.3 Weight carried

| Finding | Source / confidence |
|---|---|
| Doncaster Handicap (18 editions): horses on **56.5 kg won 446 of 698 head-to-heads (64%)** vs 50% par — interpreted as *good horses being under-weighted relative to weaker rivals*, not weight helping | Racing & Sports 2018 [S117] **medium** |
| Topweights win at least as often as chance because talent and weight are positively correlated (UK/IRE critiques); Irish jumps topweights 10.27% (2017–21) → 8.76% after May 2022 | Irish Field / Proform [S118] **low relevance** |
| Bond University thesis examined weight, time and barrier effects on finishing position (findings not visible) | [S119] **low** |
| Rule of thumb **[memory]**: ~1.5 kg ≈ 1 length at 1200m; ~1 kg ≈ 1 length at 2400m+; 3 kg is roughly one "class" | **low** |

**Model use:** weight is a **weak, confounded** factor. Use *weight change vs last start* and *weight relative to field* (after apprentice claim, §8), not absolute weight; keep the weight factor small (RaceLens `weight: 0.4` → suggest **0.3**). Give more weight to **class change** than to kilograms.

---

## 7. Age and sex allowances

| Fact | Source / confidence |
|---|---|
| Racing NSW allowance for **3yo vs older**, 1800m+: **3.5 kg Aug–Oct, 2.5 kg Nov–Jan, 1.5 kg Feb–Apr, 1 kg May–Jul**; 0–1799m: **2.5 / 1.5 / 0.5 / 0 kg** for the same quarters | Racing NSW rules page [S120] **medium** (table in snippet; date not confirmed) |
| **Fillies & mares: 2 kg** allowance vs males in mixed-sex races (NSW); general WFA scale gives 1.5–2 kg | [S120]; The Straight [S121] **medium** |
| Racing Australia AR 170 (from 1 Aug 2019) cut **northern-hemisphere 3yo** allowances over 2000–3000m and 3000m+ after comparison with European scales; no change ≤2000m | Bloodstock.com.au [S122] **medium** |
| Melbourne Cup winners by age (to 2013): 3yo **23** (last 1941), 4yo **44**, 5yo **43**; mares **13**; entires 64, geldings 51, colts 21, fillies 3 | sportsnews 2013 [S123] **medium (dated)** |
| Cox Plate "trending to younger horses" (c.2014); only Makybe Diva and Sunline won it as mares older than four | The Roar [S124] **low** |

**Model use:** in **open handicaps during spring (Aug–Nov)** a well-rated 3yo receiving the full allowance is historically dangerous (it is why so many spring handicaps are won by lightly-weighted 3yos) — modest bonus (+0.1 to +0.2 on the class/weight composite) **[memory] low**. Mares against males at WFA: neutral once the 2 kg is accounted for. Age ≥8: small negative **[memory] low**.

---

## 8. Apprentice claims (AR 92)

| Rule | Source / confidence |
|---|---|
| Metropolitan claim **3 kg until 20 metropolitan flat wins, 2 kg until 50, 1.5 kg until 80** | Racing SA academy, Bloodstock.com.au on RQ, RV [S130][S131][S132] **high** |
| **4 kg until 5 wins** for a new apprentice (country level in most states; a PRA may exempt its territory) | [S131] **high** |
| **No claims in Group or Listed races**; Group/Listed wins count as metropolitan wins | [S130] **high** |
| Victoria aligned its claim calculation with other states from **2023-24** (tracks classed metropolitan/provincial/other) | RV 2023 [S132] **high** |
| SA example: 3 kg metro, 2 kg provincial, none at country | Racing SA 2020 [S133] **medium** |

**Model use:** compute **effective weight = allotted weight − claim**; show the claim on the card (e.g. "(a2)"). An apprentice *claiming* is slightly negative for ride quality but positive for weight — treat as net-neutral unless the apprentice's own strike rate is known **[memory] low**.

---

## 9. Fitness, freshness and days since last run

| Finding | Source / confidence |
|---|---|
| Darren Weir (big-stable AU sample, 2016): **first starters 13%, first-up 12%, second-up 10%, third-up 18%, fourth-up 17%** | Gary Crispe, Racing & Sports [S140] **medium** |
| Danny O'Brien (2016): first-up **10% (8% metro)**, second-up **12% (10% metro)** → "third-up the ideal" | R&S Melbourne Mail [S141] **medium** |
| US Equibase buckets: **1–7 days 16% win / −22% ROI** (n=2,546), **8–30 days 14% / −26%**, **181+ days worst (−32%)**; all buckets lose money | Truenicks [S142] **medium (US)** |
| Days since last run maximised a trainer-venue win ratio at **~15–20 days**; falls off at ~a month | Berkeley SAAS project [S143] **low** |
| Performance rises with time between starts up to **~3 weeks**, then declines (*Animals*, 2021) | DOAJ listing [S144] **medium** |
| Field definitions: **DLR** = days since last run; **DLW** = days since last win; "true value of a strike rate is determined by sample size" | Racing & Sports product docs [S145] **high** |
| Community heuristic: 14–28 days neutral; −3%/day under 14; −1%/day over 28 | velo-oracle code [S90] **low** |

**Model use (RaceLens `fitness`):**
* Bucket DLR: **7–13 d** (quick back-up: neutral-to-slightly-positive, strongest for last-start winners/placegetters), **14–28 d** (ideal, +), **29–60 d** (freshened, slightly −), **61–120 d** (needs run, −; use the horse's *own* first-up record), **>120 d** (first-up from spell: −; check trials).
* Use the runner's own **first-up / second-up record** fields (`starts:wins-seconds-thirds`) when available [S91]; stable-level patterns matter (some stables win first-up, most peak 3rd–4th up).
* Typical pattern: **third-up is the peak** for most Australian stables [S140][S141].

---

## 10. Jockeys, trainers and premierships (2025-26 season, ended 31 Jul 2026)

### 10.1 Results and numbers found

| Item | Value | Source / confidence |
|---|---|---|
| **Champion Australian trainer** | **Chris Waller, 379 wins**; **22 of 76 Group 1s** (record); **16th consecutive Sydney** trainers' premiership; mid-season 370 winners, "clear by 45 with 10 days left" | TTR AusNZ season summary; The Straight; sportsnews [S60][S61][S62] **medium-high** |
| **Melbourne trainers' premiership** | **Ciaron Maher** (6th title). 2024/25: 329.5 winners at **13.6%**. 2025/26 Flemington: most runners (**196**) and most winners; Lindsay Park (Ben, Will & JD Hayes) **152** runners, 2nd ("25 to 18" wins quoted, attribution unclear) | TTR; VRC season review [S60][S63] **medium** |
| Strike rates since 1 Aug 2025 (partial season) | Waller **12.60% from 541 starts**; Maher **11.90% from 159** | Proven Thoroughbreds [S64] **low-medium** |
| Maher Brisbane early-season SR | 38.7% (small n); last-100 starters Feb 2026: 23% | justhorseracing [S65] **low** |
| Waterhouse & Bott / Freedman | Top-5 metro prize money in Sydney / Victoria respectively; **no win totals found** | The Straight [S66] **low** |
| **Sydney metro jockeys' premiership** | **James McDonald**; **88 wins** by 27 Jun 2026 (Zac Lloyd 71, Tommy Berry 68) | TTR [S67] **medium-high** |
| McDonald Group 1s | **17 in 2025/26 — seasonal record — all for Waller** | TTR black-type summary [S61] **medium-high** |
| **Melbourne metro jockeys' premiership** | **Craig Williams** (10th title) + **6th Scobie Breasley Medal** (stewards' 3-2-1 votes per metro meeting); June preview said the race "could go right to the wire" — **single source, final tally not found** | TTR daily wrap 10 Aug 2026 [S68] **medium** |
| 2024/25 Scobie Breasley | Blake Shinn (4th) | RV [S69] **high** |
| Victorian apprentice titles 2025/26 | **Luke Cartwright** (state and metro); Logan Bates VJA Rising Star; Jamie Mott VJA Most Valuable Jockey | [S68] **medium** |
| Sydney apprentice 2025/26 | **Siena Grima** (TTR) — but the same roundup credits **Braith Nock** with the "NSW Apprentice Jockey Premiership"; Grima & Nock level on 31 metro wins in June | TTR; sportsnews [S60][S67b] **low (conflict)** |
| Brisbane jockeys 2025/26 | **Ben Thompson** (first title, returned from HK); **Ryan Maloney 27.9% SR** from 34 metro wins in Nov 2025 | justhorseracing [S70b] **medium** |
| Brisbane apprentice | Jace McMurray (37.5 wins, 15.5 clear with a month left) | [S70c] **low-medium** |
| Damian Lane | "strikes at 22% when riding at Pakenham" (Hub tip) | Betfair Hub via R&S [S32] **low** |
| **Champion sire 2025/26** | **Snitzel** (posthumous, 5th title), progeny earnings **$26,030,662**; **Zoustar** 2nd ($21.8m); **The Autumn Sun** 3rd ($18.8m); Snitzel 6th champion 2yo sire; **Home Affairs** champion first-season sire; individual winners: Zoustar & Capitalist 169 each, Toronado 166 | The Straight; TTR [S150][S151] **medium-high** |

**Not found (budget exhausted):** 2025/26 win totals for Lane, Shinn, Zahra, Kah, Ethan Brown; national jockeys' premiership (usually a country-based rider); Waterhouse–Bott, Freedman, Cummings, Neasham–Archibald season totals; current-season (2026/27) standings. These need live lookup on the user's machine (e.g. `t.racingaustralia.horse/FreeServices/Premierships.aspx?State=VIC` [S152]).

### 10.2 How much do jockey/trainer matter?

* Jockey sex has "minimal effect" on outcomes once rides are controlled (UK 52,464 races: 11.3% vs 10.7%) [S160] **medium** — i.e. the jockey effect is real but **smaller than the mount-quality effect**.
* Bond University: "hot hands" betting on in-form jockeys has **negative returns** [S33] **medium** → jockey form streaks are priced.
* Race-simulation modelling treats jockey effects as a primary influence early in races alongside horse ability and lane [S161] **low**.
* Elite trainers run at **12–14% overall** strike rate (Waller/Maher above) but far higher in metro Saturday features; top metro jockeys **~18–28%** (Maloney 27.9%) **[S64][S70b] medium**; an *average* rider is ~8–10% (≈ field baseline).

**Model use:** keep `jockey` and `trainer` as **tiers with strike-rate overrides when known**; use the **jockey–trainer combination record** when the source provides it (strong practical signal, [memory] low); down-weight both relative to form/class. A late **jockey change to a tier-A rider** is informative (stable intent) — see also news.

---

## 11. Pedigree hints

| Finding | Source / confidence |
|---|---|
| Wet-track sires: Snitzel (15.7% wet SR, most wet winners since 2018); Zoustar relatively weaker on wet (20.56% good vs 16.95% soft/heavy; 8.6% black-type wet) | TTR [S104][S105] **medium** |
| Stamina: **Teofilo** sired three Melbourne Cup winners (Cross Counter, Twilight Payment, Without A Fight); **Galileo / Sadler's Wells line** the main modern staying influence; **Zabeel** four Cup winners (Might And Power, Brew, Delta Blues… listed by source); damsire **Dansili** credited with stayers; a speed-oriented dam line "might prove a hindrance over two miles" | Breednet [S170][S171] **medium** |
| 3yo Group 1 winners 2018/19–2022/23: 71 of 96 debuted at two | ANZ Bloodstock News [S172] **medium** |
| **[memory] low**: other commonly cited wet sires — Shamus Award, So You Think, Pierro, Toronado; precocious speed sires — I Am Invincible, Written Tycoon, Capitalist | **low** |

**Model use:** `lineage` is a **fallback** factor used only when the horse lacks relevant form (debut/first-up at new distance, first wet track). Keep weight low (0.15–0.2); when it fires, say so in the evidence text.

---

## 12. Gear, sectionals, pace and other signals

### 12.1 Gear changes
* UK: **first-time blinkers 8.5% SR, −15.3% ROI** overall — "tend to underperform"; but first-time blinkers **at SP ≤ 9/4: 47.1% (49/104)** [S180] **medium (UK)**. Trainer-specific records vary wildly (19%→31%, one 67% on tiny n) [S181] low.
* **No Australian strike-rate dataset found.** Australian form guides flag blinkers on/off, tongue tie, winkers, visors, cross-over nose band, ear muffs, barrier blanket, pacifiers [memory]. Treat gear as **news-grade** (small, trainer-intent) signal; blinkers-first-time positive only for well-supported runners.

### 12.2 Sectional times and speed
* The last **600m** is the standard closing split in Australia; comparing a runner's L600 with the fastest in its race, and the race's early splits against other races on the card, is the core technique ("Rustic Steel ran his first 800m in 52.29 – compare that to the Benchmark 72 over the mile a few races earlier where the first 800m was 49.17") [S190] **medium**.
* Fast closing sectionals can be *exaggerated* by slow early pace or wind (Flemington example) [S191] **medium** — always read closing speed against overall race time/pace.
* Finishing-speed % ≈ (sectional pace ÷ overall race pace) × 100 [S192] **low**.
* Community data stores `800M/400M` positions, `MARGIN`, `RATING` per past run [S193] **high [read]**.

### 12.3 Early speed / pace maps
* Settling-position labels in common use: **LEADER / ONPACE / MIDFIELD / BACKMARKER** [S91] **high [read]**.
* Narromine (NSW country): "speed horses" (settle 1st–3rd) won **41%** of races with **+13.9% POT**; at 1600m **41.9% / +22.6%** [S194] **low-medium** (single promotional preview, unknown n). On-pace bias at small/tight tracks is folklore-strong; at Flemington/Randwick the long straights reduce it (§3).
* Lack of tempo down the Flemington straight has repeatedly favoured on-pace/inside runners [S73][S74] **low-medium**.
* **Pace scenario** (how many genuine leaders) is a *race-level* feature: lone leader → upgrade leader, downgrade backmarkers; 3+ leaders → the reverse **[memory] low**.

### 12.4 Last-start winners
* Only track-specific evidence found (favourites that led at their last start 68% at Hawkesbury 1000m, n=25) [S2] **low**. **[memory] low**: Australian last-start winners win again roughly 18–22% of the time and are over-bet (negative ROI).

### 12.5 First starters
* US juvenile maidens: debutants **8.6%** vs experienced **11.4%** [S195] **medium (US)**. No AU figure found. Use trial form and stable/sire debut records; lower confidence for races with ≥3 debutants.

---

## 13. Suggested factor weights (starting point) and model structure

### 13.1 Structure (recommended)

1. **Fundamental score** `S_i = Σ_k w_k · f_k(i)` with each `f_k ∈ [−1, 1]` (RaceLens `factors.ts` already does this).
2. **Fundamental probability** via softmax: `p_fund,i = exp(τ·S_i) / Σ_j exp(τ·S_j)` with temperature `τ ≈ 1.5–2.5` (tune so that the model's favourite averages ~30–35% when the market favourite does).
3. **Market probability** `p_mkt,i` from the best available late price: Betfair geometric mid → fixed-odds (Shin/power-normalised) → tote. Fall back gracefully; record which was used.
4. **Blend (Benter)**: `p_i ∝ exp(α·ln p_fund,i + β·ln p_mkt,i)`, start `α = 0.4, β = 0.6`; shift toward `β = 0.75` inside 5 minutes of the jump when Betfair volume is present, toward `β = 0.4` on morning prices or when the market is thin (country meetings, <$50k matched) [S20][S21].
5. **Finishing order**: rank by `p_i`; place probabilities via Harville or (better) Henery/Stern discounting (`p_place` from `p_win^λ`, λ≈0.8) **[memory] low**.
6. **Day patterns** multiply weights (`daypatterns.ts`) — the only legitimate way to react to a biased track within a meeting.

### 13.2 Weights (sum ≈ 8.0; RaceLens `BASE_WEIGHTS` keys)

| Key | Current | **Suggested** | Justification |
|---|---|---|---|
| `recentForm` | 1.00 | **1.00** | Core of every published model (Benter; all AU form tools). Decay 0.4/0.25/0.15/0.12/0.08 is sensible. Normalise by *class* of each run and margin, not just position. |
| `classSuitability` | 0.70 | **0.85** | Class change is the most under-rated factor by casual punters; weight evidence shows "weight" effects are really class effects [S117]. |
| `trackDistance` | 0.70 | **0.75** | Course/distance records are standard AU form columns (T/C/D/W) and distance suitability is a Benter factor. Shrink small samples. |
| `wetForm` | 0.60 | **0.60 (×0 when Good; ramps Soft5→Heavy10)** | Sire and model evidence that wet changes who wins; gate it on today's rating. |
| `barrier` | 0.55 | **0.50** | Track-geometry priors (§3) + day-pattern learning; weak on Flemington straight, strong MV 1200/Caulfield 1600. |
| `pace` | 0.55 | **0.60** | On-pace advantage is pervasive, especially small tracks, slow tempo, rail out [S194][S92]. Make it race-scenario aware. |
| `jockey` | 0.45 | **0.35** | Real but priced and confounded [S33][S160]. Keep tiers; strike-rate override. |
| `trainer` | 0.40 | **0.35** | Same reasoning; stable first-up/second-up patterns belong in `fitness`. |
| `weight` | 0.40 | **0.30** | Weak/confounded [S117]; use *change* and *relative* weight after claims. |
| `fitness` | 0.50 | **0.55** | Clear strike-rate curve first-up → third-up [S140][S141]; DLR sweet spot 14–28 d [S142][S144]. |
| `careerStrike` | 0.50 | **0.45** | Win% and place% are informative but overlap with form/class; shrink for <6 starts. |
| `sourceRatings` | 0.80 | **0.70** | Published ratings (TAB form ratings, Punters/Racenet) are strong but partially *are* the market; avoid double counting with the blend. |
| `moneyMove` | 0.50 | **0.30 (+ market blend)** | Firmers win more but the price already moved [S30][S31]; the blend carries most of this. |
| `news` | 0.35 | **0.30** | Stable comments / stewards / vet news mostly matter when they indicate scratch risk or intent; verify across ≥2 sources. |
| `gear` | 0.20 | **0.15** | No AU evidence; UK evidence negative on average [S180]. |
| `lineage` | 0.20 | **0.15 (fallback only)** | Only when form is missing (§11). |

Add two **race-level modifiers** (not runner weights): `fieldSizeEffect` (barrier/pace effects scale with runners) and `conditionsVolatility` (Heavy ≥8, rail ≥+6m, wind, many scratchings → shrink all fundamental scores toward 0 and raise β).

### 13.3 Calibration loop

Store every prediction with the final market, result and dividends. Weekly, re-fit `α, β, τ` by maximising log-likelihood of winners, and re-estimate each factor's **partial correlation** with winning. Promote/demote weights by at most ±20% per fit; require ≥300 races before trusting any venue-specific barrier prior over the generic one.

---

## 14. Confidence rating — what it should mean and how to compute it

RaceLens exposes a confidence label (`Low / Fair / Good` in `model.ts`). Recommended inputs and rationale:

| Input | Direction | Reason |
|---|---|---|
| **Source agreement** on the card (number, barrier, jockey, weight, scratchings match across ≥2 sources) | ↑ | The user's core requirement; disagreement means the data may be stale. |
| **Market concentration**: top market probability and gap to 2nd (e.g. $2.20 fav vs $6 second ≫ $4/$4.50/$5) | ↑ | Favourites win ~35%; short, clear favourites win far more often [S1][S6]. |
| **Model–market agreement**: same top pick, Spearman ρ of rankings | ↑ | When fundamentals and market agree the blend is sharp; disagreement is where errors (and value) live. |
| **Field size** | ↓ as it grows | More runners → more interference, wider barrier/pace effects, lower favourite SR. |
| **Form completeness**: share of runners with ≥4 past starts and today's distance/condition form | ↑ | Debutants/first-uppers inject noise (§9, §12.5). |
| **Conditions volatility**: Heavy 8–10, rail out ≥6m, strong wind, downgrades during the day, late scratchings | ↓ | Heavy tracks are less predictable [S95], bias stronger (§4, §5). |
| **Day-pattern strength** that *supports* the top pick (inside bias + inside draw) | ↑ ; contradicts → ↓ | Bias measured on the day is the best live information. |
| **Time to jump** when prices were last refreshed | ↑ closer to the off | Market is most informative in the last 10 minutes [S21][S10]. |

Suggested scalar: `C = 0.25·agreement + 0.25·marketConcentration + 0.15·modelMarketAgreement + 0.10·formCompleteness + 0.10·(1 − volatility) + 0.10·fieldSizeScore + 0.05·dayPatternSupport`, each in [0, 1]. Map **C < 0.40 → Low**, **0.40–0.62 → Fair**, **> 0.62 → Good**. Display the two biggest detractors in plain words ("Heavy 9 track; two debutants").

Honest expectation to show the user: a well-calibrated system's top pick wins roughly **30–38%** of the time and finishes top-3 roughly **60–70%** — the same as the favourite, because the market is very good. Confidence "Good" should correspond to ≥45% top-pick win rate in back-testing; if it does not, lower the thresholds.

---

## 15. Staking and bet construction (Australia)

### 15.1 Win / place / each-way rules

| Rule | Source / confidence |
|---|---|
| **8+ runners**: place pays **1st–3rd**; **5–7 runners**: place pays **1st–2nd** ("NTD" – no third dividend); **<5 runners**: no place betting. Field size counted *at bet placement* | PlayWest glossary; Wikipedia [S40][S40b] **high** |
| Each-way = equal stakes on win and place ($10 EW = $5 win + $5 place) | [S40] high |
| Dead heats settled under separate dead-heat rules (stake divided) | [S40] high |
| Fixed-odds each-way place terms at bookmakers [memory]: typically ¼ odds for 8+ runners, ⅕ or ¼ odds in some races; tote place is pool-based | **low** |

### 15.2 Exotics and flexi

| Item | Detail | Source / confidence |
|---|---|---|
| Quinella | 1st & 2nd any order | R&S / RA [S41][S42] **high** |
| Exacta | 1st & 2nd exact order | high |
| Trifecta | 1st, 2nd, 3rd exact order; boxed = all orders; standout/banker = one runner fixed for a position | high / [memory] for standout terminology |
| First 4 | 1st–4th exact order; flexi available | RA [S42] high |
| Quaddie (Quadrella) | winners of four nominated races at one meeting | RA [S42] high |
| Boxing available on Quinella, Exacta, Duet, (Trifecta), First 4 | RA [S42] high |
| **Flexi**: nominate total outlay; dividend paid as **(outlay ÷ full $1 cost) %**. Available on Trifecta, First 4, Quaddie, BIG6 | RA [S42] **high** |
| Worked examples: 3-runner trifecta box = 6 combos ($6 at $1); 5-runner box = 60 combos → **$10 outlay = 16.66%** of the dividend; 4-runner First 4 box = 24 combos ($24) | Haslett (RTIP Arizona); R&S FAQ [S41][S43b] **high** |
| Combinatorics: box trifecta `n(n−1)(n−2)`; box First 4 `n(n−1)(n−2)(n−3)`; quaddie cost = product of runners per leg | arithmetic (matches RaceLens `permutations`) |
| Takeout (QLD regulation 2012, dated): **win 14.5%**, quinella 14.75%, **trifecta 21%**, **First 4 22.5%**, **quaddie 20%**, double 17% | QLD SL 2012-0007 [S45] **medium (dated)** |

**Model use:** exotics are only worth suggesting when the model's **joint** probability beats the pool takeout by a margin (≥25% edge on trifecta/First 4 because of ~21–22.5% takeout). Prefer **standout trifectas/First 4 with the top pick** over full boxes; prefer **quaddie flexi** at ~50–100% with 2–3 runners per leg when confidence is Good in ≥3 legs.

### 15.3 Staking

| Finding | Source / confidence |
|---|---|
| Kelly: `f* = (b·p − q)/b`, `b = decimal odds − 1`, `q = 1 − p`; Betfair's code: `stake = (((odds−1)·p − (1−p)) / (odds−1)) · bankroll · partialKelly` | Betfair `stakingFunctions.py` [S44] **high [read]**; bettingexpert/topendsports [S43] **medium** |
| Kelly assumes true probabilities are known; most bettors overestimate edge → **fractional Kelly**: half-Kelly popular, **quarter-Kelly "the professional default"**, 0.1 ultra-conservative; "if you have no measurable edge the correct Kelly stake is 0" | [S43][S46] **medium** |
| Academic review: an **adaptive fractional Kelly** method is "a very suitable choice across a wide range of settings" | arXiv 2107.08827 [S47] **medium** |
| Multiple runners in one race: per-horse Kelly is **not** optimal; the multi-outcome solution sorts runners by `p_i / statePrice_i`, finds the active set, and stakes the excess of probability over a cash baseline; hedging can justify some negative-EV bets; fractional Kelly is not optimal in that setting | Whelan 2025; Long 2026 [S48][S49] **medium** |
| Betfair's staking simulator compares **fixed stakes**, **% of bankroll**, **stake-to-win % of bankroll**, **martingale**, and **Kelly** over 50,000-bet runs × 10,000 sims with a ruin floor | [S44] **high [read]** |
| Unit staking **[memory] low**: 1 unit = 1–2% of bankroll; cap any single bet at 3–5 units; cap a race at ~5% and a day at ~15% of bankroll | **low** |

**RaceLens `betting.ts` check:** profiles `conservative 0.15 / balanced 0.25 / aggressive 0.40` of Kelly with `maxUnits 1.5 / 3 / 5` are consistent with the evidence (¼-Kelly default, ½ as the upper bound). Each-way only when `slots === 3` and the price is roughly $4–$12 is standard practice **[memory] low**.

---

## 16. Community implementations read (field conventions — useful for parsers)

| Repo / file | What it shows | Confidence |
|---|---|---|
| `Pardosa13/www.theformanalyst.com/chat_assistant.py` [S91] | AU form fields: `last10` string (most recent on the right, `x` = spell, `0` = 10th+), records as `"starts:wins-seconds-thirds"` for career/firm/good/soft/heavy/synthetic/track/distance/track&distance/first-up/second-up; speed map LEADER/ONPACE/MIDFIELD/BACKMARKER; rail `"True"` or `"+6m"`; pace bias −2..+2; class-change bands; ML score 0–100 vs win-probability (sums to ~100 per race); PuntingForm AI rating ("PFAI"); assessed odds / overlay concept | **high [read]** (conventions) |
| `elpresidentepiff/velo-oracle-prime/app/services/feature_engineering.py` [S90] | Going multipliers 1.1→0.80; freshness 14–28 d neutral; barrier optimum 3/5/8 by distance; weight −2%/kg over 56; jockey SR×5, trainer SR×4; combined index weights 0.3/0.2/0.2/0.15/0.15 | **high [read]** that the code says so; **low** validity |
| `Kelvin1761/Kelvin-Agents` AU racing skills [S94][S95] | Rating label↔integer map; weather→track-rating predictor with per-course drainage coefficient (learning rate 0.05); model top-1 strike rates by going (Good 4 n=320 ≈ 22–28%) | **high [read]**; validity low |
| `IanniMuliterno/HorseRace-from-scraping-to-analysis` [S193] | racing.com past-run columns: POS, HORSE/TRAINER/JOCKEY, TRACK/DATE, DIST/COND, PRIZE/CLASS, WGT, 800M/400M, MARGIN, RATING, ODDS | **high [read]** |
| `betfair-down-under/autoHubTutorials` [S20][S21][S44] | BSP mechanics, volume timing, BSP-estimation errors, staking simulators | **high [read]** |

---

## 17. Gaps and what to verify on the user's machine (open internet)

1. **Barrier win tables by venue × distance × condition** — compute from the app's own results store or Racing Australia results; none published freely.
2. **Rail-position effects** — same; log rail per meeting and learn.
3. **Australian gear-change strike rates** (blinkers first time) — no public dataset found.
4. **Final 2025/26 win totals** for Lane, Shinn, Zahra, Kah, Brown; trainer totals for Waterhouse–Bott, Freedman, Cummings, Neasham–Archibald; **current 2026/27 standings** — Racing Australia premiership pages [S152].
5. **Current tote takeout rates** by state (the QLD figures are 2012).
6. **Snowberg–Wolfers full odds-band table** and the **Bird & McCrae Australian chapter** for a quotable FLB curve.
7. **Punters.com.au / Racenet stats articles** on favourites by metro Saturday class — the search engine returned none.

---

## Sources

(Search-snippet sources could not be opened from this container; GitHub sources were read.)

* [S1] https://www.kruzey.com.au/betting-guides/australian-horse-racing-statistics-how-often-does-the-favourite-win/ — favourite 35.14% of 56,616 races; 2nd fav 19.9%; 3rd fav 13.4%; −$689 flat stakes.
* [S2] https://www.breednet.com.au/news/268/Greg-Polson-previews-Hawkesbury-Thursday-August-3 — Hawkesbury favourites 50.8%; led-last-start favourites 68% (17/25).
* [S3] https://www.breednet.com.au/news/884/greg-polson-previews-coffs-harbour-monday-august-28 — top-2 43.9%, top-3 57%.
* [S4] https://www.nber.org/system/files/working_papers/w15923/w15923.pdf — Snowberg & Wolfers; favourites lose 5.5%; 5.6M starts.
* [S5] https://www.geegeez.co.uk/?p=313804 — UK favourites 33.1% (15,785/47,683).
* [S6] https://www.sen.com.au/news/2026/08/03/betfairs-2025-2026-racing-review — 16,891 races; 99% $1.01; 2,744 ≤$1.20 losers.
* [S7] https://quadrant.org.au/?p=36214 — Melbourne Cup favourites 34 wins ≈22%, avg 4.4/1.
* [S8] https://www.sen.com.au/news/2025/12/18/horse-racing-betfair-bad-beats-longest-priced-winners-and-most-backed-horses — 2025 G1 winners avg $8.02; 32 favourites.
* [S9] https://ideas.repec.org/a/inm/ormnsc/v33y1987i12p1552-1562.html — Bird & McCrae 1987.
* [S9b] https://ideas.repec.org/h/wsi/wschap/9789812819192_0057.html — Bird & McCrae, Australian evidence chapter.
* [S10] https://mro.massey.ac.nz/bitstreams/f59655e6-3f82-4a5f-8ed3-edcb00ad28a3/download — McKee 1998 NZ FLB timing.
* [S11] https://irep.ntu.ac.uk/id/eprint/29387/ — Smith & Vaughan Williams, bias declining post-2000.
* [S12] https://ideas.repec.org/a/ecj/econjl/v107y1997i440p150-58.html — Vaughan Williams & Paton 1997.
* [S13] Smith, Paton & Vaughan Williams 2006, *Economica* 73(292) 673–689 (citation only).
* [S14] https://econwpa.ub.uni-muenchen.de/econ-wp/fin/papers/0412/0412010.PDF — Shing 2005.
* [S15] https://scite.ai/reports/investigating-the-roots-of-the-6LY521 — Bruce & Johnson calibration note.
* [S16] https://link.springer.com/article/10.1007/s10479-022-04722-3 — Shin normalisation.
* [S17] https://oddspapi.io/blog/?p=3174 and https://boingboing.net/2018/05/04/profile-of-a-man-who-created-a.html — Benter model summaries; paper at https://www.gwern.net/doc/statistics/decision/1994-benter.pdf (not openable here).
* [S18] https://www.besthub.dev/articles/how-a-tiny-information-edge-beats-market-smarts-in-hong-kong-horse-racing-e65c050f579b
* [S20] https://github.com/betfair-down-under/autoHubTutorials/blob/master/analysingAndPredictingBSP/bsp.ipynb — **read**.
* [S21] https://github.com/betfair-down-under/autoHubTutorials/blob/master/analysingAndPredictingMarketMovments/movements.ipynb — **read**.
* [S30] https://www.geegeez.co.uk/the-truth-about-steamers-and-drifters/ (+ parts 2–3) — drifters 1-in-16, A/E 0.81.
* [S31] https://www.geegeez.co.uk/?p=2882585 — steamers +5.5% SR vs drifters; BSP returns.
* [S32] https://www.racingandsports.com/news/racing/review/2024-04-27/betfair-washup-stars-shine-bright-in-city-of-churches/651314 ; https://www.racingandsports.com/news/betting/horse-racing-tips/2024-01-18/betfair-hub-expert-racing-tips-18th-january-2024/639523
* [S33] https://research.bond.edu.au/en/publications/do-australian-jockeys-have-hot-hands/
* [S40] https://intercom.help/playwest/en/articles/9104123-racing-bet-glossary ; [S40b] https://en.wikipedia.org/wiki/Betting_on_horse_racing
* [S41] https://www.racingandsports.com/faq/types-of-betting/what-is-a-first-four-/453017
* [S42] https://publishingservices.racingaustralia.horse/otherpublications/thechampionships-day1/files/assets/common/downloads/page0067.pdf — RA bet-type and flexi definitions.
* [S43] https://www.topendsports.com/sports-betting/tools/kelly-criterion-calculator/ ; https://www.bettingexpert.com/en-au/learn/successful-betting/the-kelly-criterion ; [S43b] https://rtip.arizona.edu/sites/rtip.arizona.edu/files/Haslett%20Wagering.pdf
* [S44] https://raw.githubusercontent.com/betfair-down-under/autoHubTutorials/master/stakingMethodsAndBankrollManagement/stakingFunctions.py — **read**.
* [S45] https://legislation.qld.gov.au/view/pdf/asmade/sl-2012-0007 — QLD takeout schedule 2012.
* [S46] https://oddspapi.io/blog/?p=2898 — quarter-Kelly as professional default.
* [S47] https://arxiv.org/pdf/2107.08827 — staking strategies review.
* [S48] https://www.karlwhelan.com/?p=2411 ; https://www.karlwhelan.com/Teaching/BettingMarkets/17.TheKellyCriterion.pdf
* [S49] https://arxiv.org/html/2603.13581v1 — Long 2026, multi-outcome Kelly via state prices.
* [S50] https://publishingservices.racingaustralia.horse/Newsletters/2025_Racing_Australia_Fact_Book/69/
* [S51] https://www.tbnsw.com.au/?p=5779 ; [S52] https://thestraight.com.au/?p=18151 ; [S53] https://thestraight.com.au/queensland-to-drop-14-thoroughbred-meetings-as-it-looks-to-boost-field-size/
* [S60] https://www.ttrausnz.com.au/edition/2026-08-03/the-australian-season-that-was-202526-summary
* [S61] https://www.ttrausnz.com.au/edition/2026-07-31/the-season-in-numbers-who-dominated-australias-black-type
* [S62] https://thestraight.com.au/run-the-numbers-waller-scales-up-success-without-increasing-numbers/ ; https://www.sportsnews.com.au/horse-racing/chris-waller-clinches-record-season-with-randwick-kensington-double-in-2026/609687/amp
* [S63] https://cms.vrc.com.au/latest-news/202526-season-in-review-stars-stats-and-standouts/
* [S64] https://proventhoroughbreds.com.au/?p=33456
* [S65] https://www.justhorseracing.com.au/news/australian-racing/maher-making-a-move-in-queensland/873055/amp ; https://www.justhorseracing.com.au/general-news/betting/first-look-randwick-7-2-26/881415/amp
* [S66] https://thestraight.com.au/1-million-a-week-australias-training-duopoly-raking-in-record-rates-of-prize-money
* [S67] https://www.ttrausnz.com.au/edition/2026-06-27/premiership-races-heating-up-as-jockeys-eye-season-honours ; [S67b] https://www.sportsnews.com.au/?p=609485
* [S68] https://www.ttrausnz.com.au/edition/2026-08-10/daily-news-wrap
* [S69] https://www.racingvictoria.com.au/news/2025/08/09/another-win-for-shinn-as-blakes-brilliance-rewarded-with-fourth-scobie-breasley-medal
* [S70] https://vrc.com.au/latest-news/flemington-2023-wrapped ; [S70b] https://www.justhorseracing.com.au/news/australian-racing/ben-thompson-flying-high-in-brisbane/898450/amp ; [S70c] https://www.justhorseracing.com.au/news/australian-racing/mcmurray-closes-in-on-brisbane-apprentice-title/898524
* [S71] https://www.horise.com/guides/barrier-draws/ ; [S72] https://signalscv.com/2025/07/8-must-know-facts-about-the-flemington-racecourse-for-beginner-punters ; https://www.thegazette.com.au/everything-you-need-to-know-about-the-flemington-track
* [S73] https://www.anzbloodstocknews.com/?p=13492 ; [S74] https://www.sportsnews.com.au/?p=610264
* [S75] https://vrc.com.au/latest-news/breaking-down-the-barriers ; [S76] https://cms.vrc.com.au/latest-news/luck-of-the-barrier-draw-in-the-melbourne-cup/
* [S77] https://www.horise.com/blog/barrier-draw-strategies-how-starting-positions-influence-australian-race-outcomes/
* [S78] https://www.horise.com/track/caulfield ; [S79] https://new.racingandsports.com/news/racing-and-sports-newsletter/article/2016-10-01/historical-analysis-of-the-caulfield-guineas/379548 ; [S80] https://breednet.com.au/news/2290/Caulfield-Cup-barrier-draw-fast-facts ; [S81] https://www.horise.com/guides/track-bias/
* [S82] https://old.racingandsports.com/news/racing/news/2023-09-28/eyes-out-wide-in-epsom-handicap/627680 ; [S83] https://www.theroar.com.au/?p=320314 ; [S84] https://www.racingnsw.com.au/news/latest-racing-news/punters-intelligence-wrap-randwick-4th-january-2
* [S85] https://www.horise.com/track/moonee-valley/ ; [S86] https://trove.nla.gov.au/newspaper/page/20678832
* [S90] https://raw.githubusercontent.com/elpresidentepiff/velo-oracle-prime/main/app/services/feature_engineering.py — **read**.
* [S91] https://raw.githubusercontent.com/Pardosa13/www.theformanalyst.com/main/chat_assistant.py — **read**.
* [S92] https://www.horseracingonly.com.au/racing-article.aspx?id=2024 ; [S93] https://www.anzbloodstocknews.com/?p=16512
* [S94] https://raw.githubusercontent.com/Kelvin1761/Kelvin-Agents/main/.agents/scripts/track_bias_tuner.py — **read**; [S95] Kelvin-Agents `docs/…AU vs HKJC Canonical Gap Report.md` (code-search excerpt).
* [S100] https://t.racingaustralia.horse/FAQ/Track-Ratings.aspx ; [S101] https://racingnsw.com.au/rules-policies-whs/racing-nsw-policies/track-rating-system ; https://en.wikipedia.org/wiki/Going_(horse_racing)
* [S102] https://www.brc.com.au/track-information/ ; [S103] https://tasracingcorporate.com.au/wp-content/uploads/2012/11/12905361_86tpol0001-racetrackprepa.pdf
* [S104] https://www.ttrausnz.com.au/edition/2024-04-12/handling-the-wet-the-worthy-stallions-with-extreme-wet-track-credentials ; [S105] https://ttrausnz.com.au/edition/2019-07-18/mastering-the-conditions-australias-top-sires-on-dry-and-wet-tracks
* [S106] https://www.codesports.com.au/horse-racing/the-ultimate-wet-track-melbourne-cup-form-guide-with-ratings/news-story/7fa682ecb7797580a93f9927022ef8db ; [S107] https://new.racingandsports.com/news/front-page/article/2012-07-14/wet-record-favours-world/255178
* [S110] https://new.racingandsports.com/news/racing/press-release/2012-04-30/benchmarking-trial-starts-in-victoria/247679 ; [S111] https://www.horise.com/guides/horse-racing-handicap-ratings/
* [S112] https://www.racingvictoria.com.au/news/2022-06-14/rv-media-release-programming-changes-announced-to-improve-opportunities-for-lower-rated-horses ; [S113] https://racingvictoria.com.au/news/2024-05-16/victorias-race-programs-set-to-feature-two-new-classes
* [S114] https://www.gobet.com.au/horse-racing-tips/guides/horse-racing-classes/ ; [S115] https://www.racingnsw.com.au/wp-content/uploads/Racing-NSW-Benchmark-and-Handicapping-Guide-1Nov2010.pdf ; [S116] https://www.racingnsw.com.au/guide-to-racing/beginners-guide-to/beginners-guide-to-racing ; https://horseracing.com.au/races/listed/
* [S117] https://www.racingandsports.com/news/racing/news/2018-04-04/weighing-up-the-doncaster/442952 ; [S118] https://theirishfield.ie/amp/racing/racing-columns/mark-boylan-tough-at-the-top-how-are-handicap-top-weights-faring-in-ireland-826457 ; [S119] https://research.bond.edu.au/en/publications/statistical-analysis-of-horse-racing-data/
* [S120] https://racingnsw.com.au/news/latest-news/rules-and-regulations ; [S121] https://thestraight.com.au/australian-racings-scale-of-injustice-boss-and-freedmans-call-for-change ; [S122] https://www.bloodstock.com.au/news/story.php?id=33251
* [S123] https://www.sportsnews.com.au/horse-racing/melbourne-cup-2013-statistics-history-and-culture/93320/amp ; [S124] https://www.theroar.com.au/?p=206319
* [S130] https://racingsa.com.au/academy/about/claim-structure ; [S131] https://www.bloodstock.com.au/news/story.php?id=33328 ; [S132] https://racingvictoria.com.au/news/2023-07-13/calculation-of-victorian-apprentice-jockey-claims-to-change ; [S133] https://racingsa.com.au/blog/2020/06/04/2499/calendar
* [S140] https://www.racingandsports.com/news/racing/insight-analysis/2016-05-26/gary-crispes-fundamental-form-analysis-fitness-part-4/366983 ; [S141] https://new.racingandsports.com/news/racing/previews/2016-05-20/the-melbourne-mail-may-21/366415
* [S142] https://www.truenicks.com/articles/292401/odds-and-trends-the-lowdown-on-layoffs ; [S143] https://saas.studentorg.berkeley.edu/rp/predicting-horse-races ; [S144] https://doaj.org/article/708927b1b54e4a45b800a9bb6d686bfe ; [S145] https://files.racingandsports.com/en/user/products/horsestats_explanation.pdf
* [S150] https://thestraight.com.au/snitzel-reclaims-sires-title-in-posthumous-premiership-triumph/ ; [S151] https://www.ttrausnz.com.au/edition/2026-07-17/photo-finish-the-sires-premierships-coming-down-to-the-wire ; https://www.justhorseracing.com.au/news/breeding-news/zoustar-and-capitalist-fight-out-australias-individual-winners-premiership/901665/amp
* [S152] https://t.racingaustralia.horse/FreeServices/Premierships.aspx?State=VIC
* [S160] https://www.nottingham.ac.uk/news/male-jockeys-have-no-more-influence-over-the-performance-of-a-racehorse-than-female-jockeys ; [S161] https://arxiv.org/pdf/2310.01748
* [S170] https://www.breednet.com.au/news/11980/melbourne-cup-pedigree-clues-to-find-the-winner ; [S171] https://www.breednet.com.au/news/34155/melbourne-cup-pedigree-analysis---do-it-yourself-- ; https://breednet.com.au/news/5641/bred-to-win-the-cup ; [S172] https://www.anzbloodstocknews.com/?p=41995
* [S180] https://www.geegeez.co.uk/?p=2884279 ; [S181] https://racingpost.com/horse-racing-tips/sweetspots-newland-can-work-his-magic-with-ford-at-ffos-las-azDGM6C60GUf
* [S190] https://racingnsw.com.au/news/latest-racing-news/punters-intelligence-wrap-gosford-7th-may ; [S191] https://www.anzbloodstocknews.com/?p=14510 ; [S192] https://www.horise.com/guides/speed-ratings-and-sectional-times/
* [S193] https://github.com/IanniMuliterno/HorseRace-from-scraping-to-analysis (notebook excerpt via code search) — **read**.
* [S194] https://www.breednet.com.au/news/506/Greg-Polson-previews-Narromine-Sunday-August-13 ; [S195] https://pastthewire.com/first-time-starter-success-in-two-year-old-maiden-special-weight-races
