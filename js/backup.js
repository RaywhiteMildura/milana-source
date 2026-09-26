/* Backup — the trip's records and photos as files the owner keeps.

   Photos are stored at full resolution and a day runs to hundreds of MB, so
   the old "one JSON with every photo base64-inlined" cannot work: it had to
   hold the whole trip in memory as text. This container never does. A file is

     "MILANA1\n"  (8 bytes)
     manifest length, 16 ASCII digits
     manifest JSON  (records; each photo listed as an entry {offset, size, type})
     the photo / voice blobs, back to back

   and is assembled as new Blob([header, manifest, ...blobs]) — the browser
   references the stored blobs, it does not copy them into memory. Import reads
   the manifest with file.slice() and revives each photo as a slice of the
   file, one record at a time. Files are split per day and, past ~450 MB, into
   parts, so each stays AirDrop / Files / WeChat sized. Legacy .json backups
   still import. */

const Backup = {
  MAGIC: 'MILANA1\n',
  PART_BYTES: 450 * 1024 * 1024,

  slug(s) { return String(s || 'project').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'project'; },

  /* Group captures by calendar day, newest day first. */
  dayGroups(captures) {
    const map = new Map();
    captures.forEach(c => {
      const k = dayKey(c.createdAt);
      if (!map.has(k)) map.set(k, { key: k, date: new Date(c.createdAt), items: [] });
      map.get(k).items.push(c);
    });
    return [...map.values()].sort((a, b) => b.date - a.date);
  },

  _photoBytes(c) {
    let n = 0;
    (c.photos.product || []).forEach(p => { n += p.blob ? p.blob.size : 0; });
    if (c.photos.label && c.photos.label.blob) n += c.photos.label.blob.size;
    if (c.photos.card && c.photos.card.blob) n += c.photos.card.blob.size;
    if (c.voiceNote && c.voiceNote.blob) n += c.voiceNote.blob.size;
    return n;
  },

  /* Split one day's captures into parts under PART_BYTES (a single capture
     can exceed it on its own; it then travels alone). */
  _parts(items) {
    const parts = [[]];
    let bytes = 0;
    for (const c of items) {
      const n = this._photoBytes(c);
      if (parts[parts.length - 1].length && bytes + n > this.PART_BYTES) { parts.push([]); bytes = 0; }
      parts[parts.length - 1].push(c);
      bytes += n;
    }
    return parts;
  },

  /* Build the File objects for `captures` (all of them, or one day's).
     onProgress({label, done, total}) fires per capture. */
  async build(captures, companies, settings, onProgress) {
    const groups = this.dayGroups(captures);
    const total = captures.length;
    let done = 0;
    const files = [];
    const dateStamp = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    for (const g of groups) {
      const parts = this._parts(g.items);
      for (let pi = 0; pi < parts.length; pi++) {
        const items = parts[pi];
        const entries = [];
        const blobs = [];
        let offset = 0;
        const addEntry = (blob) => {
          if (!blob || !(blob instanceof Blob)) return null;
          entries.push({ offset, size: blob.size, type: blob.type || 'application/octet-stream' });
          blobs.push(blob);
          offset += blob.size;
          return entries.length - 1;
        };
        const usedCompanyKeys = new Set(items.map(c => c.companyKey).filter(Boolean));
        const manifest = {
          app: 'milana-source', format: 1, exportedAt: new Date().toISOString(),
          day: g.key, part: pi + 1, parts: parts.length,
          project: settings.projectName || '',
          settings: { places: settings.places || [], cardN: settings.cardN || 0, venue: settings.venue || '', tripStart: settings.tripStart || null },
          captures: items.map(c => {
            const { _company, photos, voiceNote, ...rest } = c;
            return {
              ...rest,
              photos: {
                product: (photos.product || []).map(p => ({ id: p.id, entry: addEntry(p.blob) })),
                label: photos.label ? { id: photos.label.id, entry: addEntry(photos.label.blob) } : null,
                card: photos.card ? { id: photos.card.id, entry: addEntry(photos.card.blob) } : null,
              },
              voiceNote: voiceNote && voiceNote.blob ? { duration: voiceNote.duration, entry: addEntry(voiceNote.blob) } : null,
            };
          }),
          companies: companies.filter(co => usedCompanyKeys.has(co.key) || co.name).map(co => {
            const { cardPhoto, cardThumb, ...rest } = co;
            return { ...rest, cardPhoto: addEntry(cardPhoto) };
          }),
          entries,
        };
        const manifestBytes = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
        const header = this.MAGIC + String(manifestBytes.size).padStart(16, '0');
        const blob = new Blob([header, manifestBytes, ...blobs], { type: 'application/octet-stream' });
        const name = 'milana-' + this.slug(settings.projectName) + '-' + dateStamp(g.date)
          + (parts.length > 1 ? '-part' + (pi + 1) + 'of' + parts.length : '') + '.milana';
        files.push(new File([blob], name, { type: 'application/octet-stream' }));
        done += items.length;
        if (onProgress) onProgress({ label: 'Packing', done, total });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return { files, bytes: files.reduce((n, f) => n + f.size, 0) };
  },

  /* Read back one or more backup files. Records are written one at a time;
     a malformed record is skipped and counted, never allowed to stop the
     import or to land half-formed. Returns {captures, companies, skipped, notes}. */
  async importFiles(fileList, onProgress) {
    const files = [...fileList];
    const summary = { captures: 0, companies: 0, skipped: 0, notes: [] };
    const existingCaps = new Set(S.captures.map(c => c.id));
    const existingCos = new Map(S.companies.map(co => [co.key, co]));
    let total = 0;
    const plans = [];
    for (const file of files) {
      try {
        const plan = await this._plan(file);
        if (!plan) { summary.notes.push(file.name + ': not a Milana backup'); continue; }
        plans.push(plan);
        total += plan.captures.length;
      } catch (err) {
        summary.notes.push(file.name + ': could not be read (' + (err && err.message || 'unknown error') + ')');
      }
    }
    let done = 0;
    const okCap = c => c && typeof c.id === 'string' && typeof c.createdAt === 'string' && c.photos && Array.isArray(c.photos.product);
    for (const plan of plans) {
      for (const co of plan.companies) {
        if (!co || typeof co.key !== 'string') { summary.skipped++; continue; }
        const prev = existingCos.get(co.key);
        if (prev && String(prev.updatedAt || prev.createdAt || '') >= String(co.updatedAt || co.createdAt || '')) continue;
        try {
          const cardPhoto = await plan.blobOf(co.cardPhoto);
          const cardThumb = cardPhoto ? await downscaleImage(cardPhoto, 480, 0.72) : null;
          const rec = { ...co, cardPhoto, cardThumb: cardThumb === cardPhoto ? null : cardThumb };
          await dbPut('companies', rec);
          existingCos.set(rec.key, rec);
          summary.companies++;
        } catch (err) { summary.skipped++; }
      }
      for (const c of plan.captures) {
        done++;
        if (onProgress) onProgress({ label: 'Importing', done, total });
        if (!okCap(c)) { summary.skipped++; continue; }
        if (existingCaps.has(c.id)) continue;
        try {
          const revive = async (p) => {
            const blob = await plan.blobOf(p && p.entry !== undefined ? p.entry : p);
            if (!blob) return null;
            const thumb = await downscaleImage(blob, 480, 0.72);
            return { id: (p && p.id) || uid('ph'), blob, thumb: thumb === blob ? null : thumb };
          };
          const rec = { ...c, photos: { product: [], label: null, card: null }, voiceNote: null };
          for (const p of c.photos.product) { const ph = await revive(p); if (ph) rec.photos.product.push(ph); }
          if (c.photos.label) rec.photos.label = await revive(c.photos.label);
          if (c.photos.card) rec.photos.card = await revive(c.photos.card);
          if (c.voiceNote) {
            const vb = await plan.blobOf(c.voiceNote.entry !== undefined ? c.voiceNote.entry : c.voiceNote);
            if (vb) rec.voiceNote = { duration: c.voiceNote.duration || 1, blob: vb };
          }
          if (!Array.isArray(rec.rooms)) rec.rooms = [];
          if (typeof rec.category !== 'string') rec.category = 'Other';
          await dbPut('captures', rec);
          existingCaps.add(rec.id);
          summary.captures++;
        } catch (err) { summary.skipped++; }
        if (done % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      if (plan.settings) await this._mergeSettings(plan.settings);
    }
    return summary;
  },

  /* Understand a file without reading it whole: the container, or a legacy
     JSON (bounded — a giant one is refused rather than attempted). */
  async _plan(file) {
    const head = await file.slice(0, 8).text();
    if (head === this.MAGIC) {
      const len = parseInt(await file.slice(8, 24).text(), 10);
      if (!len || len > 64 * 1024 * 1024) throw new Error('bad header');
      const manifest = JSON.parse(await file.slice(24, 24 + len).text());
      if (manifest.app !== 'milana-source') return null;
      const base = 24 + len;
      const entries = manifest.entries || [];
      return {
        captures: manifest.captures || [], companies: manifest.companies || [], settings: manifest.settings || null,
        blobOf: async (ref) => {
          if (ref === null || ref === undefined) return null;
          const e = entries[typeof ref === 'number' ? ref : -1];
          if (!e) return null;
          return file.slice(base + e.offset, base + e.offset + e.size, e.type);
        },
      };
    }
    if (/\.json$/i.test(file.name) || head.trim().startsWith('{')) {
      if (file.size > 200 * 1024 * 1024) throw new Error('this JSON backup is too large to open on a phone — use the newer backup format');
      const data = JSON.parse(await file.text());
      if (data.app !== 'milana-source') return null;
      return {
        captures: data.captures || [], companies: data.companies || [], settings: data.settings || null,
        blobOf: async (ref) => {
          const dataUrl = ref && typeof ref === 'object' ? ref.dataUrl : (typeof ref === 'string' ? ref : null);
          return dataUrl ? dataURLToBlob(dataUrl) : null;
        },
      };
    }
    return null;
  },

  async _mergeSettings(st) {
    let changed = false;
    for (const p of st.places || []) {
      if (p && p.name && !placeByName(p.name)) { S.places.push({ id: uid('pl'), name: p.name, type: p.type || 'other' }); changed = true; }
    }
    if (changed) await settingSet('places', S.places);
    if (!S.projectName && st.projectName) { S.projectName = st.projectName; await settingSet('projectName', S.projectName); }
    if (!S.tripStart && st.tripStart) { S.tripStart = st.tripStart; await settingSet('tripStart', S.tripStart); }
  },
};
