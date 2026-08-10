# Handoff: Milana Source — field sourcing app (China buying trip)

## ✅ THE APP IS BUILT — how to put it on your phone

The production app now lives in this folder (`index.html` plus the `css/`, `js/`, `icons/` and `vendor/` folders). To get it onto your iPhone:

1. Go to **[netlify.com](https://www.netlify.com)** (free account), open **Add new site → Deploy manually**, and drag this whole folder onto the page. It gives you a link like `https://something.netlify.app`.
2. Open that link on your iPhone in **Safari**, enter your name, then tap **Share → Add to Home Screen**. That's the app installed — icon, offline and all.
3. Open it once on hotel wifi and leave it for a minute: it downloads the on-device OCR (about 38 MB, Chinese + English) and from then on **everything works with no signal at all** — the fair, the factory, the plane.

Notes for the trip:
- Everything (photos, voice notes, records) stays on the phone. Use **the "N local" pill (top-right of Today) → Export full backup** at the end of each day — it saves a single file with every photo inside.
- The **Day pack** (Evening review screen) builds a PDF of the day and hands it to the iPhone share sheet — AirDrop, WeChat, email, whatever you use.
- The camera, microphone and photos never leave the device. OCR runs on the phone itself.

The sections below are the original design/build brief the app was built from, kept for reference.

---

## START HERE (for Damian — the owner, not a developer)

You don't need to read the rest of this file. Do this:

1. Install **Claude Code** on a computer (instructions at `claude.com/claude-code`) — it's Claude acting as your developer.
2. Open Claude Code in this unzipped folder and paste this:

> Build the app described in README.md as an installable offline-first PWA (single-page web app). Use `milana-source-prototype.html` (v0.1) as the architectural starting point — it already has working IndexedDB storage, camera input, voice notes, PIN lock, and JSON/CSV export. Recreate the UI and flows pixel-perfectly from `Milana Capture Flow.dc.html` (the design reference). Add: service worker for full offline install, on-device OCR for business cards and labels (Tesseract.js with `chi_sim` + `eng`), the per-venue company-card session logic, evening review flow, compare tray, and day-pack export (PDF + share sheet). Target iPhone Safari, portrait, one-handed.

3. When it's done it gives you one HTML file (or small folder). Drag it onto **netlify.com** (free) → open the link on your iPhone → Share → **Add to Home Screen**. That's the app installed.

---

## Overview

Milana Source is a personal field-sourcing app for the Villa Milana d'Oro project's China buying trip (October 2026). The user (Damian, owner) walks trade fairs (Canton Fair), factories, and showrooms capturing products at speed, then completes records each evening. Core promise: **a full capture in under 60 seconds, with zero typing on the floor** — photos + taps only; text entry is deferred to evening review, where OCR pre-fills it.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to ship directly:

- `Milana Capture Flow.dc.html` — the high-fidelity design + interaction reference. Every exact color, font size, radius, and spacing value is an inline style in this file; treat it as the source of truth. (It uses a small template/logic format; the markup between `<x-dc>` tags and the `Component` class at the bottom contain everything. `ios-frame.jsx` is only a phone bezel for desktop preview — not part of the app.)
- `milana-source-prototype.html` — **v0.1, a genuinely working local-first app** (IndexedDB, `<input capture>` camera, MediaRecorder voice notes, PIN, JSON/CSV export/import, service-worker registration hook). Its architecture is sound; its UI is superseded by the design reference.

The task is to **recreate the design reference in a production PWA**, reusing v0.1's storage/data patterns where sensible. No framework requirement — vanilla JS (like v0.1), Preact, or React are all fine; pick what keeps it a small, fast, single-deploy artifact.

## Fidelity

**High-fidelity.** Recreate the UI pixel-perfectly: exact hex colors, type sizes, radii, and spacing from `Milana Capture Flow.dc.html`. The only simulated parts to replace with real implementations: camera (use `getUserMedia`/`<input capture>`), photo thumbnails (real images, stored as Blobs), OCR (Tesseract.js `chi_sim`+`eng`, run at review time), audio playback, PDF export, and share sheet (`navigator.share`).

## Screens / Views

App shell: 100dvh, portrait, `#f4f0e9` paper background, system sans UI font (`-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif`), display font Georgia serif. All headers are ink `#201a17` with white text and safe-area top padding. Bottom elements pad for the home indicator. **Every hit target ≥ 44px.**

### 1. Today (home)
- Header: brand mark "M" in a 36px circle (1px `rgba(201,170,120,.55)` border, Georgia, `#c9aa78`), title "Milana Source" (Georgia 19px), subtitle trip name (10.5px, 62% white). Right: sync pill "N local" with amber dot `#e0a746` (background `rgba(255,255,255,.08)`, radius 999).
- Body (scrolls, 18px side padding): tappable place line "DAY N · AT {venue} ▾" (11px/800, letter-spacing .09em, uppercase, `#9d7643`) → opens the place sheet; greeting h1 Georgia 27px; two stat cards (`#fffdf9`, 1px `#d7cbbd`, radius 18, Georgia 28px number + 11.5px `#625852` label): Captured today / Shortlisted.
- Evening-review banner (only when records need completion): gradient `linear-gradient(120deg,#241c19,#4b2530 75%)`, radius 18, white; icon tile 40px `rgba(201,170,120,.18)`; "Evening review · N to complete" 14.5px/800 + "Cards & labels read to text — just confirm" 11.5px 70% white; chevron `#c9aa78`. → Review screen.
- "Latest captures" (Georgia 19px) + "All N →" wine text button; 3 recent rows (see Products row spec).
- Bottom tab bar (all tab screens): `rgba(255,253,249,.97)`, 1px top border `#d7cbbd`, 5 columns: Today ⌂, Products ◫, center **capture button** (62px wine `#6f273a` circle, white ＋ 30px, shadow `0 8px 20px rgba(111,39,58,.38)`, raised −16px), Companies ◎, Compare ⇄ (with count badge when items selected). Active tab `#6f273a`, inactive `#625852`, 10px/700 labels.

### 2. Capture — Shoot (entry point; opening capture ALSO opens the camera on slot 1 immediately)
- Header: ✕ close (44px, `rgba(255,255,255,.10)`, radius 14), centered "New capture" Georgia 19px + "Shoot · tag · save" 10.5px; below, full-width place button "◎ {venue} ▾" (36px min-height, `rgba(201,170,120,.14)` bg, `#c9aa78` text, 12px/700) → place sheet.
- Three photo slots stacked (12px/14px padding, 9px gap; product slot flex 1.3, others 1; radius 20):
  - Empty: 2px dashed `#bcae9f` border, `#faf7f2` bg; centered 40px numbered circle (2px `#9d7643` border, Georgia 19px `#9d7643`), slot name 16px/800, hint 11.5px `#625852` monospace.
  - Slots: **1 Product** "every face of it — next when done" · **2 Label / spec** "sticker, model no., sizes" · **3 Company** "card or signage — once per {booth|factory|showroom}".
  - Filled: photo fills slot; bottom overlay bar `rgba(31,25,23,.72)`, white: "✓ Product · N photos" / "✓ Label / spec" / "✓ Same {word} · Nth product" 13px/700; right action 12px 75% white: "＋ Add more" / "↻ Retake" / "↻ New card". Product slot shows a "×N" count badge when >1.
- Bottom bar: helper line "Shoot at least one product photo" (12px/700 `#94601e`) when product empty; primary button "Tag it →" (full width, 58px, wine, radius 16, 17px/800; 45% opacity disabled until ≥1 product photo).

### 3. Camera (full-screen overlay, `#16110f`)
- Top: Cancel pill; center title "N · {slot}" 15px/800 + contextual hint 11px 55% white; right: 3 progress dots (done `#c9aa78`, current white-outlined, todo `rgba(255,255,255,.22)`).
- Middle: 82%-width 4:3 framing guide — four 30px corner brackets, 3px `#c9aa78`.
- Bottom row: last-shot thumb 48px (with `×N` brass badge on product) · white shutter (78px ring, 4px border + 60px filled inner circle; scales .9 on press) · right pill button: **"Next →"** (brass `#c9aa78` bg, `#231a15` text) once the product has ≥1 shot, otherwise "Skip" (`rgba(255,255,255,.10)`).
- Behavior: shutter flash (white overlay, .3s fade). **Product = multi-shot**: shutter keeps adding (cap 6 with toast); "Next →" advances. Label = single shot, auto-advances. Company = single shot, auto-advances to Tag. If a company card is already on file for this place (session), the label shot skips straight to Tag.

### 4. Capture — Tag it (all taps, no keyboard except optional price)
- Header: ‹ back, "Tag it" Georgia 19px; 3 slot thumbnails (46px tall, tap to reopen camera; product thumb shows ×N).
- Sections (11px/800 letter-spacing .08em `#625852` labels): **WHAT IS IT?** 12 category chips (48px min-height, radius 14, 14px/700; idle `#fffdf9`/1px `#d7cbbd`; selected ink bg, white text) — single-select, required. **WHICH ROOM?** 8 primary room chips + "+6 more" expander (44px pills; selected = wine bg) — multi-select. **YOUR CALL** five 52px stars (36px glyph; active `#9d7643`, idle `#cfc6b8`); voice-note button (54px: idle white w/ wine dot "Record a voice note"; recording wine bg, pulsing dot, "Recording 0:07 — tap to stop"; done row with ▶ duration + ✕ delete); "＋ Add quoted price" reveals CNY/USD/AUD segmented buttons + decimal input. **COMPANY**: if a card is on file → green info card (`#e9f2ec`, 1px `#b9d2c4`): "✓ Same {word} as your last capture" + "This will file as the Nth product for this {word}." + underlined "Different company? Shoot the new card"; if none → two known-supplier pills + dashed "＋ Shoot the card".
- Bottom bar: ‹ back square (58px) + "Save capture" (wine, 58px; disabled reading "Pick a category first" until category chosen).

### 5. Saved (confirmation)
- Ink header "Capture saved" + venue. Brass `#9d7643` 86px check circle (pop animation), "Saved on this device" Georgia 25px, "Captured in M:SS · syncs to Villa Milana d'Oro when online." Summary card: 3 slot thumbs (skipped = dashed + "skipped") + chips (category ink, venue, rooms wine-tint `#f4e6ea`/`#6f273a`, ★ rating amber-tint, price, "Nth product at this {word}" green-tint, voice). Footer note: "Name, code and company details get read from your photos at evening review."
- Buttons: "＋ Next capture · same {word}" (wine 58px; keeps the company session) + "Back to today" text button.

### 6. Products
- Ink header with count + search input (`rgba(255,255,255,.10)` bg, white text, radius 12, placeholder "Search product, company or place").
- Two horizontally scrolling filter rows: categories (wine selected) and places "◎ {venue}" (ink selected).
- Rows: 52px photo thumb (+×N badge), name 14.5px/700, "{company} · {place}" 12px `#625852`, right status chip — Preferred/Shortlisted `#e3efe8`/`#355f4b`, Captured `#ebe3d8`/`#625852`, Needs review `#f5ead8`/`#94601e`, Rejected `#f6e5e3`/`#8b2d2d`. Dashed empty state.

### 7. Product detail (overlay)
- Ink header: ‹ back, name, "{company} · {place} · {time}".
- If incomplete: amber banner button "▣ Complete this record — read card & label →" (`#f9efdd`, 1px `#e5cfa9`, `#94601e`) → Complete record screen.
- Horizontal photo strip (128×108 tiles, monospace captions: "product · face 1", "label / spec", "company card"); chip row (status, category, ◎ place, rooms, ★ rating, code, size, price); note card if present.
- Actions: "★ Shortlist" (ink solid) + "Reject" (`#f8e7e5` / `#8b2d2d`); full-width "⇄ Add to compare" toggle (ink solid when already in compare).

### 8. Companies
- One record per company. Rows: 44px initial circle (1px `#c9aa78` border, Georgia `#9d7643`), name, "N products · {places}". Tap → Products filtered to that company. Footer note: card photos become full company records at evening review.

### 9. Compare
- Up to 3 products, horizontal cards (206px): photo with ✕ remove, name, company, and Rating / Price / Rooms / Place rows + status chip + "Open →". Empty state points to Products. Tab badge shows count.

### 10. Evening review (list)
- Ink header ‹ "Evening review · N records to complete". "Day pack · N captures" card with **Export PDF** (ink) and **Share to WeChat** (outline) buttons. Pending rows: thumb, name, red missing-field chips (`#f6e5e3`/`#8b2d2d`: "name", "company", "code", "label photo"). Green dashed all-done state.

### 11. Complete record (the OCR screen)
- Ink header ‹ "Complete record" + record name.
- Two sections, each: section label + monospace "read on device" tag (`rgba(157,118,67,.12)` bg, `#9d7643`); 74×96 photo thumb beside three stacked inputs.
  - **FROM THE COMPANY CARD**: Company name (bold), Contact person, WeChat / phone. Amber monospace caution: "check the characters against the card photo before confirming".
  - **FROM THE LABEL**: Product name (bold), Model / code, Size / spec.
- Inputs pre-filled by OCR; user edits then taps "✓ Confirm record" (wine, 58px). **Confirming a company name applies it to every record sharing that company key** (whole booth/factory at once).

### 12. Place sheet (bottom sheet, any screen)
- Dim backdrop `rgba(31,25,23,.45)`; sheet `#fffdf9`, radius 24 top corners, grab handle, slides up .25s.
- "Where are you?" Georgia 20px + "Captures file under this place. Moving to a new place resets the company card."
- Groups (10.5px/800 uppercase `#9d7643`): **Fairs** (Canton Fair Phase 1/2, CCIH CeramBath, China Ceramics City) · **Factories** (Joinery A/B, Windows & Doors, Stone Fabricator) · **Showrooms & markets** (Meiju, Huayi) · **On the road** (Hotel / evening, Other stop). Buttons 46px, selected = wine. Users must be able to add custom places in production.

## Interactions & Behavior

- **60-second rule**: capture opens directly into the camera on slot 1; product photos are multi-shot with explicit Next; label/company auto-advance; the final shot lands on Tag; save requires only a category. Elapsed time is recorded and shown once on Saved (no visible timer during capture).
- **Company session**: shooting a company card starts a session keyed `Card #N · {place}`. Subsequent captures at the same place reuse it (slot 3 pre-filled "Same {word} · Nth product"), skip the card camera step, and increment the count on save. Changing place clears the session (toast: "New place — the company card was reset."). The session word adapts: booth (fairs), factory, showroom, company.
- **OCR (production)**: at review time, run Tesseract.js (`chi_sim`+`eng`) on card + label photos; pre-fill the six fields; never auto-commit — user confirms. Confirmed company names propagate to all records with the same company key.
- Toasts: ink pill, bottom-center above the tab bar, ~2.4s.
- Press feedback: buttons scale .94–.98 on press (`transform`, ~.1s).
- Animations: shutter flash .3s fade; saved check pop .35s; summary rise .4s; sheet slide-up .25s.
- Left-handed mode (setting): mirrors the camera bottom row and tag-screen action bar (`row-reverse`).

## State Management

- **Stores (IndexedDB, from v0.1)**: `captures` (keyPath `id`; indexes createdAt, supplierKey, status, category, venue), `suppliers`/companies (keyed by company key; fields name/contact/wechat/cardPhoto), `settings` (user, pin, currentVenue, session).
- **Capture record**: id, createdAt/updatedAt, createdBy, venue, category, rooms[], rating, currency+price, note, voiceNote (Blob), photos { product: Blob[] (≤6), label: Blob|null, card: Blob|null }, companyKey, status (Captured | Needs review | Shortlisted | Preferred | Quote requested | Rejected), needsReview, missing[], syncStatus.
- **Draft state** during capture: photos, category, rooms, rating, price, voice, session — cleared on save/close; session and venue persist across captures.
- **Sync**: v1 is local-first with JSON/CSV export-import (v0.1 has this working); cloud sync is a later phase — keep `syncStatus` on every record.

## Design Tokens

Colors: ink `#201a17` · ink-soft `#625852` · paper `#f4f0e9` · paper-2 `#ebe3d8` · card `#fffdf9` · line `#d7cbbd` · brass `#9d7643` · brass-2 `#c9aa78` · wine `#6f273a` · wine-2 `#8b3b52` · green `#355f4b` · green-tint `#e3efe8` · amber `#94601e` · amber-tint `#f5ead8` · red `#8b2d2d` · red-tint `#f6e5e3` · wine-tint `#f4e6ea` · camera bg `#16110f`.

Typography: display Georgia serif (19–27px screens, 25–28 numerals); UI system sans 10–17px; section labels 11px/800 uppercase +.08em; monospace (`ui-monospace, Menlo`) for hints/OCR tags.

Radii: 999 pills · 24 sheets · 20 photo slots · 16–18 cards · 13–14 buttons/chips · 11–12 inputs/thumbs. Hit targets ≥44px; primary buttons 58px. Standard border 1px `#d7cbbd`; dashed empties `#bcae9f`.

## Assets

None required — no icon fonts, no images. Glyphs are unicode (⌂ ◫ ◎ ⇄ ★ ✕ ‹ ▣ ●). Product photo areas in the design files use CSS-gradient stand-ins; production uses real camera Blobs. App icon (for Add to Home Screen): brass "M" in a circle on ink `#201a17`.

## Files

- `Milana Capture Flow.dc.html` — hi-fi design + interaction reference (source of truth for all styling)
- `milana-source-prototype.html` — working v0.1 app (storage/camera/export architecture to reuse)
- `ios-frame.jsx` — desktop preview phone bezel only; ignore for production
