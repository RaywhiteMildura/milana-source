#!/bin/bash
# Concatenate content modules into app/content.js (weeks in order, then scripts, templates, role-plays).
# Week files are taken from content/ (falls back to content3/ then content2/ during the build).
set -e
cd "$(dirname "$0")"
OUT=app/content.js
echo "/* Launchpad 300·30·3 — generated content bundle. Source modules live in content/. */" > $OUT
echo "window.LAUNCHPAD_CONTENT = window.LAUNCHPAD_CONTENT || { weeks: [], scripts: [], templates: [], rolePlays: [] };" >> $OUT
n=0
for i in $(seq 1 12); do
  for d in content content3 content2; do f=$d/week-$i.js; if [ -f "$f" ]; then cat "$f" >> $OUT; echo >> $OUT; n=$((n+1)); break; fi; done
done
if [ "$n" = "0" ] && [ -f test/week-stub.js ]; then cat test/week-stub.js >> $OUT; echo "(stub week used)"; fi
for f in content/scripts.js content/templates.js content/roleplays.js; do if [ -f "$f" ]; then cat "$f" >> $OUT; echo >> $OUT; fi; done
if [ ! -f content/roleplays.js ] && [ -f test/roleplay-stub.js ]; then cat test/roleplay-stub.js >> $OUT; echo "(stub role-play used)"; fi
node -e "global.window={}; require('./$OUT'); const c=window.LAUNCHPAD_CONTENT; console.log('content.js: weeks', c.weeks.length, 'scripts', c.scripts.length, 'templates', c.templates.length, 'rolePlays', c.rolePlays.length, 'bytes', require('fs').statSync('$OUT').size)"
