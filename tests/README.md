# Milana Source — tests

End-to-end and OCR tests. They drive the real app in headless Chromium with a
fake camera, so they exercise capture, review, OCR, exports and offline install.

```
cd tests
npm install                  # playwright-core + a CJK test font (once)
npm run serve &              # static server for the app on 127.0.0.1:8123
npm test                     # full end-to-end suite (~5 min)
npm run test:ocr             # Chinese card / label OCR + glossary (~1 min)
npm run test:labels          # English product labels drawn like phone photos
```

Chromium is expected at `/opt/pw-browsers/chromium` (set `CHROMIUM` to override).
Screenshots of every screen land in `tests/shots/` after a run.

`verify-zip.js` boots a deploy package from a clean extract: unzip it somewhere,
serve that folder on 127.0.0.1:8129, then `npm run verify:zip`.
