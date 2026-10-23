# Source: `news` — online news, rumours and stable comments (key-less feeds usable from Node)

Research date: 2026-10-23. Researched from a container that **cannot reach news/racing/bookmaker hosts** (every direct probe of
news.google.com, bing.com, reddit.com, html.duckduckgo.com, racenet.com.au, punters.com.au, racing.com, racingnsw.com.au,
justhorseracing.com.au, news.com.au, rss.feedspot.com returned `CONNECT tunnel failed, 403` from the proxy). Nothing below is a live
response. Evidence comes from public code, saved captures and docs on GitHub (read via raw.githubusercontent.com and GitHub code
search) plus web search. Every fact carries a confidence:

* **high** – seen in a real saved response or in several independent code bases
* **medium** – one source, or inferred from a well-known convention (e.g. WordPress `/feed/`)
* **low** – from memory or an unverified directory listing; the app's `probe-sources` tool must confirm before use

Fixtures live in `research/fixtures/news/` (list at the end). Four of them are **real captures copied from public repos**
(`*.real-sample.*`), the rest are constructed for Flemington, Saturday 2026-10-24, and say so in a top-of-file `_fixtureNote`.
All fixtures were parsed in this repo with `fast-xml-parser` 5 (`{ ignoreAttributes:false }`) and `cheerio`; the key names quoted
below are the ones Node sees.

---

## 0. What this source can and cannot give RaceLens

This source is **unstructured text**. It does not return meetings, race cards, form, or results as data. What it supplies:

| Canonical need | From `news` | How |
|---|---|---|
| Meetings for a date | no (corroboration only) | headline mentions "Flemington … Saturday" |
| Race card (runners, barrier, jockey, trainer, weight, scratched, odds) | **partial, text** | late scratchings, jockey changes, "firmed $4.60 → $3.80" market moves, gear changes, stable quotes |
| Form / career stats / pedigree | no | — |
| Results for finished races | text only (headline "X wins …"); use a results source instead | — |
| Track condition / rail / weather | **yes, text** – often the earliest public mention | regex over titles/snippets: `/(Firm|Good|Soft|Heavy)\s*\(?(\d{1,2})\)?/`, `/rail\s+(out\s+)?(\d+(\.\d+)?)\s*m|true position/i`, `/penetrometer\s+(\d+(\.\d+)?)/i` |
| Rumours / stable confidence / sentiment | **yes** – the reason this source exists | Reddit threads, "stable mail", "stable comments" articles, trainer quotes |

Use it to (a) raise/lower confidence on facts other adapters already hold, (b) detect **changes** (scratching, rider change, track
downgrade) between the overnight research pass and the pre-race recheck, and (c) feed a sentiment/mention-count factor. Every
extracted fact must stay tagged `source:"news"`, with the publisher domain and timestamp, and never overwrite a structured source.

Five independent channels are documented so that no single outage blinds the adapter:

1. Google News RSS search (aggregator; ~100 items)
2. Bing News RSS search (aggregator; ~12–14 items; different index to Google)
3. Reddit search JSON (community rumours)
4. Publisher RSS feeds (racing sites, news.com.au)
5. DuckDuckGo HTML search (fallback for "stable comments" pages that no feed exposes)

---

## 1. Google News RSS search

**Base URL:** `https://news.google.com/rss` — confidence **high**
(pygooglenews `BASE_URL = 'https://news.google.com/rss'`: https://github.com/kotartemiy/pygooglenews/blob/master/pygooglenews/__init__.py)

### 1.1 Endpoints (all `GET`, no auth, no API key)

| Purpose | URL pattern | Confidence | Evidence |
|---|---|---|---|
| Keyword search (the one RaceLens uses) | `https://news.google.com/rss/search?q={q}&hl=en-AU&gl=AU&ceid=AU:en` | high | pygooglenews `'/search?q={}' + '?ceid={country}:{lang}&hl={lang}&gl={country}'`; real capture https://github.com/nerevu/riko/tree/master/riko/data (file `news.google.com_rss_hl=en-US&gl=US&ceid=US_3Aen&q=enterprise+mashup.xml`); TS example https://github.com/mreflow/control-center/blob/main/app/api/live/mentions/route.ts |
| Top stories | `https://news.google.com/rss?hl=en-AU&gl=AU&ceid=AU:en` | high | pygooglenews README |
| Section headlines | `https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-AU&gl=AU&ceid=AU:en` (IDs: WORLD, NATION, BUSINESS, TECHNOLOGY, ENTERTAINMENT, SCIENCE, SPORTS, HEALTH) | high | pygooglenews `__init__.py` |
| Arbitrary topic id | `https://news.google.com/rss/topics/{topicId}?...` | high | pygooglenews |
| Geo headlines | `https://news.google.com/rss/headlines/section/geo/{place}?...` | high | pygooglenews |
| Resolve an item link to the publisher URL | see §1.5 | medium | googlenewsdecoder |

### 1.2 Query parameters

| Param | Meaning | Notes / confidence |
|---|---|---|
| `q` | search string, URL-encoded (`quote_plus`); implicit AND between words | high |
| `hl` | UI language, `en-AU` | high |
| `gl` | country, `AU` | high |
| `ceid` | edition `COUNTRY:lang` = `AU:en`; **must agree with hl/gl** or results go inconsistent/empty | high (https://cloro.dev/blog/google-news-rss/, pygooglenews) |

Operators inside `q` (all **high**, from pygooglenews source and the gist below):

* `when:1h` / `when:12h` / `when:24h` / `when:7d` — recency window (pygooglenews appends `' when:' + when`; hours/days/months; bad values are silently ignored). Ignored if `after:`/`before:` are present.
* `after:2026-10-17 before:2026-10-25` — `%Y-%m-%d` date range.
* `"exact phrase"`, `OR`, `-excluded`, `intitle:`, `allintext:` — standard Google operators (https://docs.feedly.com/article/375-what-are-some-of-the-advanced-keyword-alerts-google-news-search-parameters).
* `site:racenet.com.au` — restrict to a publisher; multiple with `site:a.com OR site:b.com`. The space after `site:x` must be encoded (`%20`) or the search returns nothing (https://gist.github.com/akhileshdarjee/e50d7a888d24f1dfe6b7b21ec7c26243). **This is the fallback for every racing site that has no RSS feed.**

Suggested RaceLens queries (one request each, ~1.5 s apart):
`"{horse}" when:30d`, `"{horse}" racing when:7d`, `"{trainer}" stable when:7d`, `"{jockey}" when:7d`,
`Flemington "track" OR "rail" OR "penetrometer" when:2d`, `Flemington scratching OR scratched when:1d`,
`site:racenet.com.au Flemington when:3d`, `site:punters.com.au Flemington when:3d`, `site:racing.com Flemington when:3d`.

### 1.3 Headers / auth / limits

* No API key, no cookies. pygooglenews sends **no User-Agent** and works; send a descriptive UA anyway. Confidence high.
* **Max ~100 items** per feed (https://www.codewords.ai/blog/google-news-rss, https://apify.com/fascinating_lentil/google-news-scraper; the real riko capture holds 63 items for a niche query). No pagination. Confidence medium.
* `when:` narrows to fewer, fresher items; combine several narrow queries rather than one broad one.
* Errors seen in the wild: `503` from some cloud (Cloudflare Worker) egress (comment in https://github.com/Pranith-Jain/dfir-threat-intel-platform/blob/main/api/src/lib/cti-collector.ts: "news.google.com 503s Worker egress"); `429` only when hammering the article-decode path (§1.5). From a home IP, 1 req/s is fine. Confidence medium.
* `<copyright>` in every response: "made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use" (verbatim in `google-news-rss.real-sample.xml`). RaceLens is personal use on the owner's machine; do not republish the feed.

### 1.4 Response shape (RSS 2.0) — confidence **high** (real capture)

```xml
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
 <channel>
  <generator>NFE/5.0</generator>
  <title>"Flemington" - Google News</title>              <!-- '"{q}" - Google News' -->
  <link>https://news.google.com/search?hl=en-AU&amp;gl=AU&amp;ceid=AU:en&amp;q=Flemington</link>
  <language>en-AU</language>
  <webMaster>news-webmaster@google.com</webMaster>
  <copyright>Copyright © 2026 Google. …</copyright>
  <lastBuildDate>Fri, 23 Oct 2026 21:05:12 GMT</lastBuildDate>      <!-- RFC-822 -->
  <image><title/><url/><link/><height>256</height><width>256</width></image>
  <description>Google News</description>
  <item>
   <title>Headline text - Publisher Name</title>           <!-- publisher suffix after " - " on EVERY item (63/63 in capture) -->
   <link>https://news.google.com/rss/articles/{opaqueId}?oc=5</link>   <!-- Google redirect, NOT publisher URL -->
   <guid isPermaLink="false">{opaqueId}</guid>
   <pubDate>Fri, 23 Oct 2026 19:40:00 GMT</pubDate>
   <description>&lt;a href="https://news.google.com/rss/articles/{opaqueId}?oc=5" target="_blank"&gt;Headline text&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Publisher Name&lt;/font&gt;</description>
   <source url="https://www.publisher.tld">Publisher Name</source>
  </item>
```

Field table (per `<item>`):

| Element | Type | Notes |
|---|---|---|
| `title` | string | `"{headline} - {publisher}"`; strip with `/\s-\s[^-]+$/` or prefer `source` |
| `link` | URL | `https://news.google.com/rss/articles/{id}?oc=5`; opaque since 2024 (not base64 of the URL) |
| `guid` (`@isPermaLink="false"`) | string | the same opaque id; stable dedupe key per article |
| `pubDate` | RFC-822 GMT | `new Date(pubDate)` works in Node |
| `description` | HTML-escaped string | search feeds: one `<a>` + `<font color="#6f6f6f">publisher</font>`; **top-stories/topic feeds instead carry `<ol><li><a href>title</a> <font>publisher</font></li>…</ol>` sub-articles** (pygooglenews parses `li.a['href']`, `li.a.text`, `li.font.text`) |
| `source` (`@url`) | string + attr | publisher display name and homepage; `url` is the publisher origin (e.g. `https://www.racenet.com.au`) |
| `media:content` | absent in search feeds | older (2019) feeds had a 150×150 thumbnail (gist above); the 2026 capture has none |

With `fast-xml-parser` (`ignoreAttributes:false`, defaults `@_` / `#text`) the item parses to
`{ title, link, guid:{'#text','@_isPermaLink':'false'}, pubDate, description, source:{'#text':'Racenet','@_url':'https://www.racenet.com.au'} }`
(verified on both fixtures). A single-item channel yields an object, not an array — wrap with `Array.isArray(x)?x:[x]`.

### 1.5 Getting the real article URL (needed to dedupe against Bing/RSS/Reddit)

* The `/rss/articles/{id}` id is **opaque** ("After 2024 that id is opaque — it is not a base64 publisher URL": https://github.com/SSujitX/google-news-url-decoder README). Old base64 decoding no longer works. Confidence high.
* Working method (googlenewsdecoder, "proved live 2026-09-21" per its AGENTS.md):
  1. `GET https://news.google.com/rss/articles/{id}?hl=en-AU&gl=AU&ceid=AU:en` (returns 200 HTML; `/articles/{id}` and `/read/{id}` 302 to `google.com/sorry`).
  2. Read attributes `data-n-a-sg` (signature) and `data-n-a-ts` (timestamp) from the page (`re /data-n-a-sg="([^"]+)"/`).
  3. `POST https://news.google.com/_/DotsSplashUi/data/batchexecute` with body `f.req=` + urlencoded JSON `[[["Fbv4je", "<json of ['garturlreq', CTX, id, ts, sg]>", null, "<reqId>"]]]`; many ids may share one POST.
  4. Response starts with `)]}'`; rows with `row[0]=="wrb.fr"`/`row[1]=="Fbv4je"` carry the decoded URL. `sg`/`ts` change per fetch — cache the decoded URL, not the signature. Each article page is ~590 KB and `429` appears on many GETs; pace them (`interval`) and decode lazily only for items that survive relevance filtering.
  Source: https://github.com/SSujitX/google-news-url-decoder/blob/main/googlenewsdecoder/_parse.py and AGENTS.md. Confidence medium (protocol is private and has changed before).
* Cheaper alternative: follow the redirect with a real browser-like `GET` and read the final `Location` (works in browsers, often `google.com/sorry` from scripts — low). Or simply dedupe on **normalised title + publisher domain from `source@url`** and skip decoding — recommended default.

### 1.6 Fixtures

* `google-news-rss.flemington-2026-10-24.xml` — constructed, 6 items, AU edition.
* `google-news-rss.real-sample.xml` — real capture (first 3 of 63 items) from the riko repo.

---

## 2. Bing News RSS search

**Base URL:** `https://www.bing.com/news/search` — confidence **high**

### 2.1 Endpoint

`GET https://www.bing.com/news/search?q={q}&format=rss&mkt=en-AU` — confidence high
(real captures https://github.com/prof18/RSS-Parser/blob/master/rssparser/src/commonTest/resources/feed-bing-image.xml,
https://github.com/shyamddesai/NewsBridgeAI/blob/main/RSS/Bing%20News.xml; code: https://github.com/mreflow/control-center/blob/main/app/api/live/mentions/route.ts,
https://github.com/razrfly/dictionary/blob/main/docs/integrations/bing-news.md, https://researchbuzz.me/2017/06/27/cooking-up-lots-of-rss-to-feed-your-news-monitoring-needs/).

| Param | Meaning | Confidence / evidence |
|---|---|---|
| `q` | query; send **unquoted** (quoted phrases returned fewer usable results) | medium (razrfly doc) |
| `format=rss` (or `RSS`) | required to get XML | high |
| `mkt=en-AU` | market; **pin it** — without it Bing infers market from the caller IP and results change completely | high for the behaviour (razrfly), medium for the `en-AU` value (seen `en-US`, `zh-CN`, `it-it` in code) |
| `setlang=en-AU`, `cc=AU` | language / country; `setlang`/`setmkt` were byte-identical to `mkt` in tests | medium (https://github.com/Ulchemist/D-bank app/src/main/ai/currentEventsCollector.ts uses `mkt`+`setlang`+`cc`) |
| `count=N` | **ignored / capped ~14** | medium (razrfly: ignored; https://techcommunity.microsoft.com/discussions/bing/bing-news-search-exploratory-rss-view/4259846: "around 14 articles max") |
| `qft=interval="7"` | last-7-days filter; one repo says it stabilises results (https://github.com/Trade-Offf/typhoon-bavi-tracker/blob/main/worker/news.ts), razrfly found it *dropped* recent items | conflicting → low; filter on `pubDate` yourself |
| `qft=sortbydate="1"` | newest first | low (ResearchBuzz 2017) |

### 2.2 Headers / limits

* No key. Own User-Agent accepted; no browser impersonation needed (razrfly). Confidence medium.
* Measured: 20 requests at 1 req/s → 20×`200`, no `429`, no `Retry-After`, latency 238/262/409 ms (razrfly). Pace at ≥1 s per request anyway.
* ≤ ~12–14 items, **no pagination**. A query with no news returns `200` with an empty `<channel>` — test for `<channel>`, not for items.
* It is a *search*, not a wire: items years old can appear → apply your own recency gate on `pubDate`.
* `<copyright>` restricts use to "rendering Bing results within an RSS aggregator for your personal, non-commercial use" (verbatim in the real fixture).
* Known quirk: link URLs carry a per-response `tid`/`c`, so feed readers see duplicates (https://forum.newsblur.com/t/bing-news-rss-feeds/10620). Dedupe on the decoded publisher URL.

### 2.3 Response shape — confidence **high** (two real captures)

```xml
<rss version="2.0" xmlns:News="https://www.bing.com/news/search?q=Flemington&amp;format=rss">   <!-- namespace URI == the request URL -->
 <channel>
  <title>Flemington - BingNews</title>
  <link>…request url…</link>
  <description>Search results</description>
  <image><url>http://www.bing.com/rsslogo.gif</url><title>Flemington</title><link>…</link></image>
  <copyright>Copyright © 2026 Microsoft. …</copyright>
  <item>
   <title>Headline</title>
   <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid={32hex}&amp;url={percent-encoded publisher URL}&amp;c={digits}&amp;mkt=en-au</link>
   <description>Plain-text teaser, may end with " ..."</description>
   <pubDate>Fri, 23 Oct 2026 08:15:00 GMT</pubDate>
   <News:Source>Racenet</News:Source>
   <News:Image>http://www.bing.com/th?id=OVFT.xxxx&amp;pid=News</News:Image>   <!-- sometimes RELATIVE: /th?id=... -->
   <News:ImageSize>w={0}&amp;h={1}&amp;c=14</News:ImageSize>
   <News:ImageMaxWidth>700</News:ImageMaxWidth>
   <News:ImageMaxHeight>394</News:ImageMaxHeight>
  </item>
```

| Element | Type | Notes |
|---|---|---|
| `title` | string | no publisher suffix |
| `link` | URL | usually the `apiclick.aspx` tracker → take `new URL(link).searchParams.get('url')` (lower-case percent escapes `%3a%2f%2f` decode fine). **Some items carry the direct publisher URL** (seen in the NewsBridgeAI capture) — handle both. |
| `description` | string | teaser; no HTML |
| `pubDate` | RFC-822 GMT | — |
| `News:Source` | string | publisher masthead ("Racenet", "news.com.au") |
| `News:Image` | URL (abs or relative) | Bing-hosted thumbnail; no licence — do not download |
| `News:ImageSize`, `News:ImageMaxWidth`, `News:ImageMaxHeight` | template / int | ignore |
| `guid` | **absent** | dedupe on decoded URL |

Parsing gotcha: HTML-ish parsers lower-case namespaced tags (`news:source`) and CSS-escaped selectors then match nothing (razrfly; the
prehensile gist uses `item.find("news:image")`). `fast-xml-parser` keeps the prefix: keys are literally `'News:Source'`, `'News:Image'` …
(verified). One repo simply does `xml.replace(/<News:Source>/g,'<source>')` before parsing (https://github.com/iqui27/nuvio-native-legacy servidor/recomendacoes/src/index.js).

### 2.4 Fixtures

* `bing-news-rss.flemington-2026-10-24.xml` — constructed, 4 items incl. one direct link and one relative image.
* `bing-news-rss.real-sample.xml` — real capture (prof18/RSS-Parser), verbatim.

---

## 3. Reddit search JSON

Reddit's old `.json` endpoints need no key for reads. Confidence **high** for shape (real capture), **medium** for current limits.

### 3.1 Endpoints (`GET`)

| Purpose | URL pattern | Evidence |
|---|---|---|
| Search inside a subreddit | `https://www.reddit.com/r/{sub}/search.json?q={q}&restrict_sr=1&sort={sort}&t={t}&limit={1..100}&raw_json=1` | https://github.com/YD811/potbot-v2/blob/main/apps/potbot-mcp/src/data/social.ts, https://github.com/skainguyen1412/social-media-research-skill/blob/main/src/core/clients/reddit.ts, https://github.com/tanmingtao1994-gif/fincrew/blob/main/packages/tools/getNews/news.ts, https://github.com/flyanima/open-search-mcp/blob/main/src/engines/reddit-api-manager.ts |
| Site-wide search | `https://www.reddit.com/search.json?q={q}&sort=new&t=week&limit=25&raw_json=1&type=link` | open-search-mcp |
| Newest posts in a sub | `https://www.reddit.com/r/{sub}/new.json?limit=100` (also `hot.json`, `top.json?t=week`) | https://github.com/neverbiasu/awesome-gemini-prompts/blob/main/src/scripts/scraper/reddit-scraper.ts |
| Comments of a thread (for discussion threads) | `https://www.reddit.com{permalink}.json?limit=200&depth=2&raw_json=1` | medium (convention; permalink from the listing) |
| OAuth variant (60 req/min) | `https://oauth.reddit.com/r/{sub}/search?...` with `Authorization: Bearer` from `https://www.reddit.com/api/v1/access_token` | open-search-mcp; out of scope (needs app registration) |

Params: `q` (Reddit search syntax: `"phrase"`, `title:word`, `flair:News`, `self:yes`), `restrict_sr=1|on|true`, `sort` ∈ `relevance|hot|top|new|comments`,
`t` ∈ `hour|day|week|month|year|all`, `limit` ≤ 100 (public callers cap at 25 in several repos), `after`/`before` = fullname cursor (`t3_…`) for paging,
`count` = items already seen, `raw_json=1` (unescapes `&lt;` etc. in `selftext_html`), `type=link|sr|user`. Confidence high for the common ones (multiple repos), medium for `type`/`count`.

### 3.2 Headers and rate limits

* **User-Agent is mandatory and must be unique/descriptive**: format `<platform>:<app ID>:<version string> (by /u/<reddit username>)`,
  e.g. `web:racelens:v0.1.0 (by /u/yourname)`. "Many default User-Agents (like 'Python/urllib' or 'Java') are drastically limited";
  "NEVER lie about your user-agent" (https://github.com/reddit-archive/reddit/wiki/API). A bare request gets `429`; the throttle is keyed on UA
  (https://til.simonwillison.net/reddit/scraping-reddit-json). One repo comments "Reddit returns 403/429 if no User-Agent" (potbot-v2). Confidence high.
* `Accept: application/json`.
* Rate: OAuth clients "may make up to 60 requests per minute" (wiki). Anonymous `.json` is lower; third parties cite ~10–30/min
  (https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/social-media/social-media-reddit-reading). Read headers
  `X-Ratelimit-Used`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (seconds to period end) and sleep when remaining < 2. On `429` back off 10–15 s. Confidence medium.
* **Datacenter/cloud IPs get `403` regardless of UA** (several 2025 reports; also the reason this container cannot test). From the user's home connection this is not an issue. Confidence medium.
* `www.reddit.com` sometimes 302s to `https://www.reddit.com/…?rdt=…`; follow redirects. `old.reddit.com` serves the same JSON (low).

### 3.3 Response shape — confidence **high** (real capture `reddit-search.real-sample.json`, 108 keys per post)

```json
{ "kind": "Listing",
  "data": { "after": "t3_1oa5d0m", "dist": 3, "modhash": "", "geo_filter": "", "before": null,
            "children": [ { "kind": "t3", "data": { …post… } } ] } }
```

Listing (`data`): `after`/`before` = fullname cursors or `null` (https://github.com/reddit-archive/reddit/wiki/JSON), `dist` = items in this page, `modhash` = `""` for anonymous reads, `geo_filter` = `""`, `children` = array of things. `kind` prefixes: `t1` comment, `t3` link/post, `t5` subreddit, `more` for collapsed comments.

Important `t3.data` fields (types from the wiki + real capture):

| Field | Type | Use |
|---|---|---|
| `id` / `name` | string / `t3_{id}` | dedupe key; `name` is the paging cursor |
| `title` | string | may contain newlines |
| `selftext` / `selftext_html` | string / string\|null | post body (markdown / escaped HTML); `""`/`null` for link posts |
| `is_self` | bool | self post vs link post |
| `url` | string | link target, or the permalink for self posts |
| `url_overridden_by_dest` | string (link posts only) | same as `url` |
| `domain` | string | `self.horseracing` or `racenet.com.au` |
| `permalink` | string | relative; prefix `https://www.reddit.com` |
| `subreddit`, `subreddit_name_prefixed`, `subreddit_id`, `subreddit_subscribers` | string/string/string/int | |
| `author`, `author_fullname` | string / `t2_…` | `[deleted]` possible |
| `score`, `ups`, `downs`, `upvote_ratio` | int/int/int/float | `downs` is always 0, `score` is fuzzed |
| `num_comments` | int | engagement signal |
| `created_utc`, `created` | int epoch seconds | `new Date(created_utc*1000)` |
| `link_flair_text`, `link_flair_css_class` | string\|null | e.g. "News", "Discussion" |
| `stickied`, `pinned`, `distinguished` | bool/bool/string\|null | daily/weekend discussion threads are `stickied:true`, `distinguished:"moderator"` |
| `over_18`, `spoiler`, `locked`, `archived`, `removed_by_category` | bool/bool/bool/bool/string\|null | filter |
| `thumbnail`, `thumbnail_width/height`, `preview`, `post_hint` | string / int / obj / string | `thumbnail` may be `"self"`, `"default"`, `"image"`; `preview`/`post_hint` only on media/link posts |
| `edited` | `false` or epoch | |
| `media`, `secure_media`, `media_embed`, `gildings`, `all_awardings`, `treatment_tags`, `mod_reports`, `user_reports` … | misc | ignore |

Full key list (108) is in the real fixture. Link-type posts add `post_hint`, `preview`, `url_overridden_by_dest`; self posts omit them (verified in both fixtures).

### 3.4 Which subreddits

* `r/horseracing` — exists; "anything related to horse racing in any and all varieties" (https://forums.feedspot.com/horse_racing_forums/). Member count not confirmed (medium). Mostly US/UK but Australian carnival threads appear.
* `r/HorseRacingUK` — ~14k members, UK/IRE; useful for international raiders (https://gummysearch.com/r/HorseRacingUK). Medium.
* `r/australia`, `r/melbourne`, `r/sydney` — general subs; search `"Flemington" OR "Melbourne Cup"` with `restrict_sr=1`; expect noise. Low value, high volume.
* No active Australian-racing-specific subreddit was found (searched; none surfaced) — low confidence that one exists.
* Query recipe: `q="{horse name}"`, `sort=new`, `t=month`; and the stickied weekend discussion thread (`stickied:true`, title matching `/discussion thread/i`) → fetch its comments `.json` and grep for runner names.

### 3.5 Fixtures

* `reddit-search.flemington-2026-10-24.json` — constructed Listing (self post, link post, stickied weekend thread) built on the real 108-key template.
* `reddit-search.real-sample.json` — real Listing capture (2 posts) from https://github.com/beetisushruth/reddit-stock-screener/blob/main/lambda/reddit-listings-sample.json (one `_fixtureNote` key added).

---

## 4. Publisher RSS feeds (racing sites and news.com.au)

FeedSpot's "Top 30 Australian Horse Racing RSS Feeds" (https://rss.feedspot.com/australian_horse_racing_rss_feeds/, updated 2026-09-10) lists feeds for
Racenet News, Punters News, Racing Victoria News, Racing Queensland » Thoroughbred, Racing SA, Just Horse Racing, Races.com.au, Elite Racing,
HorseRacing.com.au and several newspaper racing sections — but the page itself was unreachable from here, so only the URLs that appear in
public code are confirmed. Everything else is a **probe candidate** the app must verify once (`npm run probe`) and otherwise replace with
Google/Bing `site:` queries. Machine-readable version: `fixtures/news/news-feed-registry.json`.

| Site | Feed URL | Status / confidence | Evidence |
|---|---|---|---|
| Just Horse Racing | `https://www.justhorseracing.com.au/feed/` ; category feeds `https://www.justhorseracing.com.au/category/betting/feed` | confirmed / **medium-high** | https://github.com/Gmpho/strike-tips-autonomous- (core_agent/skills/swarm_researcher.py lists `{"source":"Just Horse Racing","region":"Australia","url":"https://www.justhorseracing.com.au/feed/"}`); https://github.com/enkyuan/kyomi/blob/main/packages/catalog/inputs/feedspot/australian%20betting.json (`feed_url` for the betting category); FeedSpot |
| news.com.au Sport (Superracing lives under `/sport/superracing/`) | `https://www.news.com.au/content-feeds/latest-news-sport/` (siblings: `latest-news-national`, `-world`, `-entertainment`, `-technology`, `-lifestyle`, `-finance`, `-travel`) | confirmed / **high** | calibre recipe https://github.com/kovidgoyal/calibre/blob/master/recipes/the_oz.recipe; https://github.com/ausnews/ausnews-search/blob/main/crawler/RISJbot/spiders/newscomau.py; captures in https://github.com/rumca-js/RSS-Link-Database-2025 show article links end in `?from=rss-basic` |
| news.com.au Superracing-only feed | `https://www.news.com.au/content-feeds/latest-news-sport-superracing/` (guess from the pattern) | probe / **low** | none — filter the sport feed on `/sport/superracing/` in `link`, or Google `site:news.com.au/sport/superracing` |
| Races.com.au | `https://www.races.com.au/feed/` | directory-listed / medium | FeedSpot listing (via search snippet) |
| Elite Racing | `https://www.eliteracing.com.au/feed/` | directory-listed / medium | FeedSpot listing |
| Horsebetting.com.au news | `https://horsebetting.com.au/category/news/au/feed/` | confirmed / medium | kyomi FeedSpot catalog |
| Racenet news | unknown — FeedSpot lists "Racenet News RSS Feed"; news index is `https://www.racenet.com.au/news` | probe `/rss`, `/news/rss`, `/feed` / **low** | https://bloggers.feedspot.com/australian_horse_racing_blogs (news page), FeedSpot RSS list |
| Punters news | unknown — FeedSpot lists "Punters News RSS Feed"; news index `https://www.punters.com.au/news/` | probe `/news/rss/`, `/rss/`, `/news/feed/` / **low** | same |
| Racing.com (Racing Victoria media arm) | unknown; no feed found in any repo or search | probe `/rss`, `/news/rss` / **low**; use `site:racing.com` | — |
| Racing Victoria | unknown — FeedSpot lists "Racing Victoria News RSS Feed"; news at `https://www.racingvictoria.com.au/news/…` | probe / **low** | FeedSpot |
| Racing NSW | unknown; news index `https://www.racingnsw.com.au/news/latest-racing-news` | probe `/feed/`, `/rss` / **low** | search result page |
| Racing Queensland | unknown — FeedSpot lists "Racing Queensland » Thoroughbred RSS Feed" (WordPress-style title → likely `/category/thoroughbred/feed/`) | probe / **low** | FeedSpot |
| Thoroughbred News (thoroughbrednews.com.au) | unknown; nothing found | probe `/rss`, `/feed` / **low** | — |
| TTR AusNZ (ttrausnz.com.au, formerly TDN AusNZ) | no feed found; content is a daily email edition at `https://www.ttrausnz.com.au/edition/{YYYY-MM-DD}/{slug}` | low; scrape edition index or `site:ttrausnz.com.au` | https://www.ttrausnz.com.au/edition/2024-04-12/daily-news-wrap |
| ABC / SBS / Guardian AU sport (general) | `https://www.abc.net.au/news/feed/45910/rss.xml` (ABC Sport) | low (memory) | — |

### 4.1 Shape of publisher feeds

WordPress sites (JHR, Elite Racing, Races.com.au, Horsebetting — the `/feed/` and `/category/x/feed` patterns are WordPress) emit standard RSS 2.0 with
`xmlns:content`, `xmlns:dc`, `xmlns:wfw`, `xmlns:slash`, `xmlns:sy`, `xmlns:atom`; items: `title`, `link`, `comments`, `dc:creator` (CDATA), `pubDate` (RFC-822 `+0000`),
`category`×n (CDATA), `guid isPermaLink="false"` (`https://site/?p=123`), `description` (CDATA excerpt), `content:encoded` (CDATA full HTML), `wfw:commentRss`,
`slash:comments`. Default 10 items, `sy:updatePeriod hourly`. Confidence medium (convention; `content:encoded` is where the trainer quotes are).
news.com.au content feeds: RSS 2.0 with `media:content` thumbnails and `?from=rss-basic` on links (shape medium; link suffix high).

With `fast-xml-parser` the keys are `'dc:creator'`, `'content:encoded'`, `'media:content'` (verified on the fixtures). Strip `?from=rss-basic` and `utm_*` before deduping.

Headers: send a browser-like or descriptive UA; News Corp sites sit behind Akamai/Cloudflare and may `403` default library UAs (medium). Poll each feed at most every 10–15 min; honour `ETag`/`Last-Modified` (`If-None-Match`/`If-Modified-Since`).

### 4.2 Fixtures

* `site-rss.justhorseracing.xml` — constructed WordPress-style feed, 2 items.
* `site-rss.newscomau-sport.xml` — constructed news.com.au content feed, 2 items.

---

## 5. DuckDuckGo HTML search (fallback for "stable comments" pages)

**Endpoints** — confidence **high** (many open-source scrapers):

| Endpoint | Method / params | Evidence |
|---|---|---|
| `https://html.duckduckgo.com/html/` | `POST` form `q={q}&kl=au-en&b=&df={d|w|m|y}` (`Content-Type: application/x-www-form-urlencoded`, `Referer: https://html.duckduckgo.com/`) | https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/web/search/providers/duckduckgo.ts |
| same, `GET` | `https://html.duckduckgo.com/html/?q={q}&kl=au-en` | https://github.com/pipeshub-ai/pipeshub-ai/blob/main/backend/python/app/web/search/duckduckgo_html.py, https://github.com/nicobailon/pi-web-access/blob/main/duckduckgo.ts |
| Next page | `POST /html/` with the hidden inputs of the `div.nav-link form`: `q, s (offset, 23 then 73…), nextParams, v=l, o=json, dc, api=d.js, vqd, kl` | oh-my-pi ("hidden `s` and `vqd` inputs from the next-page form are reused") |
| `https://lite.duckduckgo.com/lite/` | `GET ?q={q}&kl=au-en` or `POST`; even simpler HTML (`a.result-link`, `td.result-snippet`) | https://github.com/ggml-org/llama.vscode/blob/master/src/web-browser.ts, https://github.com/open-mercato/open-mercato/blob/main/packages/web-research-serp/src/profiles.ts, https://github.com/PawanOsman/OpenCursor/blob/main/src/agent/tools/web.ts (html first, lite as fallback) |

`kl` region codes (full allow-list in oh-my-pi): `au-en` for Australia, `wt-wt` = no region, `uk-en`, `us-en`, `nz-en`. `df` = `d|w|m|y` recency.
Other params seen: `kp` (safe search), `ia=web`, `t` (low).

Headers: a realistic browser UA (`Mozilla/5.0 …`) plus `Accept: text/html`, `Accept-Language: en-AU,en;q=0.9`, `Referer`. Cookies not required (medium).

### 5.1 Result DOM (medium — consistent across scrapers, not verified live here)

* container: `div.result.results_links.results_links_deep.web-result` (pipeshub selects `.web-result`; oh-my-pi/pi-web-access select `.result`); sponsored rows add class `result--ad` — skip them.
* title/link: `h2.result__title > a.result__a[href]`. `href` is `//duckduckgo.com/l/?uddg={percent-encoded target}&rut=…` → `decodeURIComponent(/[?&]uddg=([^&]+)/.exec(href)[1])`; prepend `https:` to `//…`; occasionally a direct `https://` href. (`uddg` unwrapping is in every implementation: oh-my-pi, pipeshub, pi-web-access, https://github.com/dmitriii501/aiapp WebTools.cs.)
* snippet: `a.result__snippet` (or `div/span.result__snippet`), with `<b>` highlights.
* display URL: `div.result__extras__url > a.result__url`; a `<span>` there may start with `YYYY-MM-DD` = published date (oh-my-pi).
* empty: `.no-results` / `.no-results__message`.
* paging form: `div.nav-link form` as above.

### 5.2 Bot blocking — the main operational risk (confidence **high**)

* DDG returns a **challenge page instead of results**, "often as a 202" but also as 200/403 ("DDG mixes status codes, so the body is the reliable signal" — oh-my-pi). Python's `duckduckgo_search`/`ddgs` surfaces it as `https://html.duckduckgo.com/html 202 Ratelimit` (https://community.agno.com/t/duckduckgo-search-rate-limit-issue/1021).
* Body markers to test (lower-cased): `anomaly-modal`, `anomaly.js`, `challenge-form`, `bots use duckduckgo too`, `please complete the following challenge`
  (https://github.com/TokenRhythm/opensquilla/blob/main/src/opensquilla/search/providers/duckduckgo.py `_BLOCKED_MARKERS`; pi-web-access checks `.anomaly-modal__box, #challenge-form`; https://github.com/AI-Shell-Team/aish crates/aish-tools/src/web_search/duckduckgo.rs "throttles shared-egress IPs").
* Triggers: datacenter/shared IPs, bursts, identical UA. From a home IP a few queries per minute are normally fine; keep ≥ 5–10 s between DDG requests, add jitter, cache results for the day, never retry a 202 in a loop (exponential backoff ≥ 60 s, then fall back to `lite.duckduckgo.com`, then to Bing/Google `site:` RSS).
* Each block should be logged as a *source degraded* event, not an error, so the verification engine lowers the weight of the `news` source for that run rather than failing the run.

### 5.3 Fixtures

* `duckduckgo-html.flemington-stable-comments.html` — constructed results page (1 ad + 3 organic, next-page form).
* `duckduckgo-html.anomaly-block.html` — constructed challenge page carrying all block markers.

---

## 6. Cross-verification rules for the `news` adapter

1. **Normalise every item to** `{ sourceChannel: 'google'|'bing'|'reddit'|'rss'|'ddg', publisherDomain, canonicalUrl|null, title, snippet, publishedAt, fetchedAt, query, rawId }`.
   `publisherDomain` comes from Google `source@url`, Bing `News:Source` + decoded `url=`, Reddit `domain`, RSS `link` host, DDG unwrapped `uddg`.
2. **Canonical URL**: lower-case scheme/host, drop fragment, drop `utm_*`, `fbclid`, `from=rss-basic`, `ref=`, sort remaining params; Google items without a decoded URL dedupe on `normalise(title without " - Publisher") + publisherDomain`.
3. **Corroboration** = the same claim (e.g. "Soft 5", "rail out 6m", "scratched", "T. Marsden to ride") from ≥2 *publisher domains* (not ≥2 channels — Google and Bing often carry the same article). Publisher tiers: official bodies (`racingvictoria.com.au`, `racingnsw.com.au`, `racingqueensland.com.au`, `racing.com`) > racing press (`racenet.com.au`, `punters.com.au`, `justhorseracing.com.au`, `news.com.au/sport/superracing`, `theage.com.au`, `heraldsun.com.au`) > blogs/tipsters > Reddit (rumour only, never a fact source).
4. **Recency**: track/rail/scratching claims expire fast — weight by hours since `publishedAt`; anything older than the previous official update is discarded.
5. **Entity matching**: match horse names case-insensitively as whole words, also with the apostrophe/space variants (`"Southern Compass"`, `Southern-Compass`); require race context (meeting name, date within ±2 days) to avoid same-named horses.
6. **Outage behaviour**: each channel is optional. If Google 503s, Bing still gives 12–14 items; if DDG 202s, skip it for the run. Record `channelsOk/channelsTried` so the UI can show "news: 3 of 5 channels responded".

## 7. Node implementation notes (verified with this repo's dependencies)

```ts
import { XMLParser } from 'fast-xml-parser';
const xp = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = <T,>(v: T | T[] | undefined): T[] => Array.isArray(v) ? v : v == null ? [] : [v];

// Google News: items → { title, link, guid:{'#text','@_isPermaLink'}, pubDate, description, source:{'#text','@_url'} }
const g = xp.parse(xml); const gItems = arr(g.rss.channel.item);
const publisher = it.source?.['#text'], publisherUrl = it.source?.['@_url'], googleId = it.guid?.['#text'];

// Bing News: keys keep the namespace prefix
const b = xp.parse(xml); for (const it of arr(b.rss.channel.item)) {
  const link = String(it.link).trim();
  const real = link.includes('apiclick.aspx') ? new URL(link).searchParams.get('url')! : link;
  const masthead = it['News:Source'];
}

// Reddit
const res = await fetch(url, { headers: { 'User-Agent': 'web:racelens:v0.1.0 (by /u/you)', Accept: 'application/json' } });
const posts = (await res.json()).data.children.map((c: any) => c.data);

// DuckDuckGo (cheerio)
const $ = cheerio.load(html);
if (res.status === 202 || /anomaly-modal|anomaly\.js|challenge-form|bots use duckduckgo too/i.test(html)) throw new SourceDegraded('ddg-blocked');
$('.result').not('.result--ad').each((_, r) => { const href = $(r).find('a.result__a').attr('href') ?? '';
  const m = /[?&]uddg=([^&]+)/.exec(href); const target = m ? decodeURIComponent(m[1]) : href.replace(/^\/\//, 'https://'); });
```

* Use Node 22 global `fetch` with `AbortSignal.timeout(15000)`; set a per-host token bucket (`news.google.com` 1.5 s, `bing.com` 1 s, `reddit.com` 2.5 s, `duckduckgo.com` 6 s, publisher feeds 10–15 min).
* `fast-xml-parser` returns numbers for numeric text (`News:ImageMaxWidth` → `700`); `pubDate` stays a string. Trim Bing values (captures contain whitespace/newlines inside tags).
* Decode HTML entities in Google `description` before regexing (`&amp;nbsp;` double-escaping is normal).
* Cache raw responses per `(channel, query, hour)` on disk so the pre-race recheck can diff against the overnight pass.

## 8. Fixtures in `research/fixtures/news/`

| File | Kind | Provenance |
|---|---|---|
| `google-news-rss.flemington-2026-10-24.xml` | constructed | shape copied from the real capture; AU edition; 6 items |
| `google-news-rss.real-sample.xml` | **real** | first 3 of 63 items of a saved `news.google.com/rss/search` response in https://github.com/nerevu/riko |
| `bing-news-rss.flemington-2026-10-24.xml` | constructed | 4 items incl. direct-link and relative-image quirks |
| `bing-news-rss.real-sample.xml` | **real** | verbatim https://github.com/prof18/RSS-Parser test resource |
| `reddit-search.flemington-2026-10-24.json` | constructed | 3 posts built on the real 108-key `t3` template |
| `reddit-search.real-sample.json` | **real** | Listing capture from https://github.com/beetisushruth/reddit-stock-screener (+ `_fixtureNote`) |
| `duckduckgo-html.flemington-stable-comments.html` | constructed | results page: 1 ad, 3 organic, paging form |
| `duckduckgo-html.anomaly-block.html` | constructed | bot-check page with all block markers |
| `site-rss.justhorseracing.xml` | constructed | WordPress-style publisher feed |
| `site-rss.newscomau-sport.xml` | constructed | news.com.au content feed with `?from=rss-basic` |
| `news-feed-registry.json` | data | all endpoints/feeds with status + confidence for the adapter and probe tool |

## 9. Caveats / not verified

* No live response was fetched; AU-edition specifics (`hl=en-AU&gl=AU&ceid=AU:en`, `mkt=en-AU`, `kl=au-en`) follow documented patterns but were not exercised.
* Racenet, Punters, Racing.com, Racing Victoria, Racing NSW, Racing Queensland, Thoroughbred News and TTR AusNZ feed URLs are **unconfirmed**; FeedSpot says feeds exist for the first four but the exact URLs were not visible. The app must probe the candidates in the registry and otherwise rely on Google/Bing `site:` queries.
* Google News article-URL decoding uses a private endpoint that Google has changed before (2024); treat it as optional.
* Reddit anonymous limits and the `403` for datacenter IPs are community-reported, not documented by Reddit.
* DuckDuckGo class names are consistent across 2025–2026 scrapers but DDG can change markup without notice; keep selectors in one place and fall back to `lite.duckduckgo.com`.
* Google and Bing feeds carry personal, non-commercial-use notices; RaceLens is a personal desktop tool, but these feeds must not be re-served to third parties.

## 10. Sources consulted

Google News: https://github.com/kotartemiy/pygooglenews · https://github.com/nerevu/riko/tree/master/riko/data · https://github.com/disler/pi-durable-news-agent (apps/dna-server-api/fixtures/news/google_news.xml) · https://github.com/alaaeddine-ahriz/vantage (scripts/fixtures/gnews.xml) · https://gist.github.com/akhileshdarjee/e50d7a888d24f1dfe6b7b21ec7c26243 · https://github.com/SSujitX/google-news-url-decoder · https://www.codewords.ai/blog/google-news-rss · https://cloro.dev/blog/google-news-rss/ · https://docs.feedly.com/article/375-what-are-some-of-the-advanced-keyword-alerts-google-news-search-parameters · https://github.com/mreflow/control-center · https://github.com/Pranith-Jain/dfir-threat-intel-platform
Bing News: https://github.com/prof18/RSS-Parser · https://github.com/shyamddesai/NewsBridgeAI · https://github.com/TheOriUHD/atelier (packages/core/src/search/__fixtures__/bing-news.xml) · https://github.com/razrfly/dictionary/blob/main/docs/integrations/bing-news.md · https://gist.github.com/prehensile/5926461 · https://github.com/strebo/strebo (Strebo/SocialNetworks/BingNews.php) · https://github.com/Trade-Offf/typhoon-bavi-tracker · https://github.com/Ulchemist/D-bank · https://github.com/iqui27/nuvio-native-legacy · https://techcommunity.microsoft.com/discussions/bing/bing-news-search-exploratory-rss-view/4259846 · https://forum.newsblur.com/t/bing-news-rss-feeds/10620 · https://researchbuzz.me/2017/06/27/cooking-up-lots-of-rss-to-feed-your-news-monitoring-needs/
Reddit: https://github.com/reddit-archive/reddit/wiki/JSON · https://github.com/reddit-archive/reddit/wiki/API · https://github.com/beetisushruth/reddit-stock-screener · https://github.com/flyanima/open-search-mcp · https://github.com/YD811/potbot-v2 · https://github.com/skainguyen1412/social-media-research-skill · https://github.com/tanmingtao1994-gif/fincrew · https://til.simonwillison.net/reddit/scraping-reddit-json · https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/social-media/social-media-reddit-reading · https://forums.feedspot.com/horse_racing_forums/ · https://gummysearch.com/r/HorseRacingUK
DuckDuckGo: https://github.com/can1357/oh-my-pi · https://github.com/pipeshub-ai/pipeshub-ai · https://github.com/nicobailon/pi-web-access · https://github.com/TokenRhythm/opensquilla · https://github.com/AI-Shell-Team/aish · https://github.com/dmitriii501/aiapp · https://github.com/ggml-org/llama.vscode · https://github.com/open-mercato/open-mercato · https://github.com/PawanOsman/OpenCursor · https://community.agno.com/t/duckduckgo-search-rate-limit-issue/1021 · https://apiserpent.com/blog/scrape-duckduckgo-serp-for-free
Racing feeds: https://rss.feedspot.com/australian_horse_racing_rss_feeds/ · https://bloggers.feedspot.com/australian_horse_racing_blogs · https://github.com/enkyuan/kyomi · https://github.com/Gmpho/strike-tips-autonomous- · https://github.com/kovidgoyal/calibre/blob/master/recipes/the_oz.recipe · https://github.com/ausnews/ausnews-search · https://github.com/rumca-js/RSS-Link-Database-2025 · https://www.racingnsw.com.au/news/latest-racing-news · https://www.ttrausnz.com.au/edition/2024-04-12/daily-news-wrap
