/* View templates — markup and styling mirror Milana Capture Flow.dc.html exactly.
   Interactive elements carry data-act / data-input attributes handled in app.js. */

const CATS = ['Joinery', 'Windows & doors', 'Natural stone', 'Sintered slabs', 'Tiles', 'Lighting', 'Hardware', 'Bathrooms', 'Stone fabrication', 'Furniture', 'Appliances', 'Other'];
const ROOMS_TOP = ['Kitchen', 'Main ensuite', 'Hidden pantry', 'Wine display', 'Main bedroom', 'Walk-in robe', 'Laundry', 'Entry'];
const ROOMS_MORE = ['Formal lounge', 'Study', 'Bedrooms', 'Pool', 'Exterior', 'General'];
/* Places are user-managed records: {id, name, type}. The type drives the
   grouping in the sheet and the session word (booth / factory / showroom). */
const PLACE_TYPES = [
  { key: 'fair', group: 'Fairs', word: 'booth', add: 'Fair' },
  { key: 'factory', group: 'Factories', word: 'factory', add: 'Factory' },
  { key: 'showroom', group: 'Showrooms & markets', word: 'showroom', add: 'Showroom' },
  { key: 'road', group: 'On the road', word: 'company', add: 'On the road' },
  { key: 'other', group: 'Other places', word: 'company', add: 'Other' },
];

const DEFAULT_PLACES = [
  { name: 'Canton Fair Phase 1', type: 'fair' },
  { name: 'Canton Fair Phase 2', type: 'fair' },
  { name: 'Canton Fair Phase 3', type: 'fair' },
  { name: 'CCIH CeramBath', type: 'fair' },
  { name: 'China Ceramics City', type: 'fair' },
  { name: 'Joinery Factory A', type: 'factory' },
  { name: 'Joinery Factory B', type: 'factory' },
  { name: 'Windows & Doors Factory', type: 'factory' },
  { name: 'Stone Fabricator', type: 'factory' },
  { name: 'Meiju', type: 'showroom' },
  { name: 'Huayi', type: 'showroom' },
  { name: 'Hotel / evening', type: 'road' },
  { name: 'Other stop', type: 'road' },
];
const ST = {
  'Preferred':    { bg: '#e3efe8', fg: '#355f4b' },
  'Shortlisted':  { bg: '#e3efe8', fg: '#355f4b' },
  'Captured':     { bg: '#ebe3d8', fg: '#625852' },
  'Needs review': { bg: '#f5ead8', fg: '#94601e' },
  'Quote requested': { bg: '#f5ead8', fg: '#94601e' },
  'Rejected':     { bg: '#f6e5e3', fg: '#8b2d2d' },
};
const CHIP_IDLE = { bg: '#fffdf9', fg: '#201a17', bd: '1px solid #d7cbbd' };

/* safe-area paddings used inline (design: 64/60px tops inside the phone frame) */
const T64 = 'calc(var(--sat) + 14px)';
const T60 = 'calc(var(--sat) + 10px)';
const B_TAB = 'calc(var(--sab) + 8px)';
const B_BAR = 'calc(var(--sab) + 12px)';
const B_CAM = 'calc(var(--sab) + 26px)';
const B_SHEET = 'calc(var(--sab) + 22px)';
const B_BODY = 'calc(var(--sab) + 110px)';

function chipStyle(sel, selBg) {
  return sel
    ? `background:${selBg};color:#fff;border:1px solid ${selBg}`
    : `background:${CHIP_IDLE.bg};color:${CHIP_IDLE.fg};border:${CHIP_IDLE.bd}`;
}

function statusChip(c) {
  const label = displaySt(c);
  const st = ST[label] || ST.Captured;
  return `<span style="font-size:10.5px;font-weight:800;border-radius:999px;padding:5px 9px;background:${st.bg};color:${st.fg};flex-shrink:0">${esc(label)}</span>`;
}

function rowHTML(c, opts = {}) {
  const first = c.photos.product[0];
  const count = c.photos.product.length;
  // home "Latest captures" rows show the company only, no photo-count badge (design)
  const sub = opts.home ? supName(c) : supName(c) + ' · ' + c.venue;
  return `<div data-act="openDetail" data-arg="${c.id}" role="button" style="display:flex;align-items:center;gap:12px;background:#fffdf9;border:1px solid #d7cbbd;border-radius:16px;padding:10px 12px;cursor:pointer">
    <div style="width:52px;height:52px;border-radius:11px;flex-shrink:0;background:#ebe3d8;position:relative;${thumbBg(photoThumb(first))}">
      ${count > 1 && !opts.home ? `<span style="position:absolute;right:3px;bottom:3px;font-size:9px;font-weight:800;background:rgba(31,25,23,.75);color:#fff;border-radius:6px;padding:2px 5px">×${count}</span>` : ''}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(dispName(c))}</div>
      <div style="font-size:12px;color:#625852;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</div>
    </div>
    ${statusChip(c)}</div>`;
}

/* ───────────────────────── Today (home) ───────────────────────── */
function homeView() {
  const todayCount = S.captures.filter(c => dayKey(c.createdAt) === dayKey()).length;
  const shortCount = S.captures.filter(c => c.status === 'Shortlisted' || c.status === 'Preferred').length;
  const pending = S.captures.filter(c => c.needsReview);
  const localCount = S.captures.filter(c => c.syncStatus !== 'synced').length;
  const recent = S.captures.slice(0, 3);
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T64} 18px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <div class="serif" style="width:36px;height:36px;border:1px solid rgba(201,170,120,.55);border-radius:50%;display:grid;place-items:center;font-weight:700;color:#c9aa78">M</div>
        <div style="min-width:0">
          <div class="serif" style="font-size:19px;letter-spacing:.02em">Milana Source</div>
          <div style="font-size:10.5px;color:rgba(255,255,255,.62);white-space:nowrap">China Sourcing · October 2026</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <button data-act="openSettings" style="display:flex;align-items:center;gap:6px;min-height:36px;font-size:11px;color:rgba(255,255,255,.72);background:rgba(255,255,255,.08);border:0;border-radius:999px;padding:0 11px;white-space:nowrap"><span style="width:7px;height:7px;border-radius:50%;background:#e0a746"></span>${localCount} local</button>
        <button data-act="openSettings" style="width:44px;height:44px;flex-shrink:0;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.72);font-size:18px;line-height:1;padding:0;display:grid;place-items:center" aria-label="Settings">⚙</button>
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:20px 18px ${B_BODY}">
      <button data-act="openVenueSheet" style="border:0;background:transparent;padding:2px 0;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.09em;color:#9d7643;text-transform:uppercase">Day ${dayNumber()} · at ${esc(S.venue)} <span style="font-size:9px">▾</span></button>
      <h1 class="serif" style="font-size:27px;line-height:1.08;margin:6px 0 16px">${greeting()}, ${esc(firstName())}.</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#fffdf9;border:1px solid #d7cbbd;border-radius:18px;padding:14px 15px">
          <strong class="serif" style="display:block;font-size:28px">${todayCount}</strong>
          <span style="color:#625852;font-size:11.5px">Captured today</span>
        </div>
        <div style="background:#fffdf9;border:1px solid #d7cbbd;border-radius:18px;padding:14px 15px">
          <strong class="serif" style="display:block;font-size:28px">${shortCount}</strong>
          <span style="color:#625852;font-size:11.5px">Shortlisted</span>
        </div>
      </div>
      ${pending.length ? `<div data-act="nav" data-arg="review" role="button" style="margin-top:12px;background:linear-gradient(120deg,#241c19,#4b2530 75%);border-radius:18px;padding:15px 16px;color:#fff;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 8px 22px rgba(39,28,20,.18)">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(201,170,120,.18);display:grid;place-items:center;color:#c9aa78;font-size:18px;flex-shrink:0">▣</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14.5px;font-weight:800">Evening review · ${pending.length} to complete</div>
          <div style="font-size:11.5px;color:rgba(255,255,255,.7);margin-top:2px">Cards &amp; labels read to text — just confirm</div>
        </div>
        <span style="color:#c9aa78;font-size:18px">›</span>
      </div>` : ''}
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin:22px 0 10px">
        <h2 class="serif" style="font-size:19px;margin:0">Latest captures</h2>
        <button data-act="nav" data-arg="products" class="hit44" style="border:0;background:transparent;font-size:12px;color:#6f273a;font-weight:800;padding:4px">All ${S.captures.length} →</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${recent.length ? recent.map(c => rowHTML(c, { home: true })).join('') : `<div style="text-align:center;padding:40px 20px;color:#625852;border:1px dashed #d7cbbd;border-radius:18px;font-size:13px"><b style="display:block;color:#201a17;font-family:Georgia,'Times New Roman',serif;font-size:19px;margin-bottom:7px">Nothing captured yet</b>Tap the ＋ button — the first save works with no signal at all.</div>`}
      </div>
      <p style="font-size:12px;color:#625852;line-height:1.5;margin:18px 2px 0">Everything saves on this phone first — no signal needed at the fair, the factory or on the road.</p>
    </div>
  </div>`;
}

/* ───────────────────────── Products ───────────────────────── */
function productsView() {
  const ql = S.q.toLowerCase();
  const filtered = S.captures.filter(c =>
    (!ql || (dispName(c) + ' ' + supName(c) + ' ' + c.venue).toLowerCase().includes(ql)) &&
    (S.catFilter === 'All' || c.category === S.catFilter) &&
    (S.venueFilter === 'All places' || c.venue === S.venueFilter));
  const presentCats = ['All'].concat(CATS.filter(c => S.captures.some(x => x.category === c)));
  const presentVenues = ['All places'].concat([...new Set(S.captures.map(c => c.venue))]);
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T64} 18px 12px">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div class="serif" style="font-size:22px">Products</div>
        <div style="font-size:11px;color:rgba(255,255,255,.6)">${filtered.length} records</div>
      </div>
      <input class="hdr-input" data-input="q" value="${esc(S.q)}" placeholder="Search product, company or place" style="margin-top:10px" />
    </header>
    <div class="vscroll" style="flex:1;padding:12px 18px ${B_BODY}">
      <div class="hscroll" style="display:flex;gap:7px;padding-bottom:8px;margin:0 -18px;padding-left:18px;padding-right:18px">
        ${presentCats.map(name => `<button data-act="catFilter" data-arg="${esc(name)}" style="flex-shrink:0;min-height:38px;padding:0 13px;border-radius:999px;font-size:12.5px;font-weight:700;white-space:nowrap;${chipStyle(S.catFilter === name, '#6f273a')}">${esc(name)}</button>`).join('')}
      </div>
      <div class="hscroll" style="display:flex;gap:7px;padding-bottom:10px;margin:0 -18px;padding-left:18px;padding-right:18px">
        ${presentVenues.map(name => `<button data-act="venueFilter" data-arg="${esc(name)}" style="flex-shrink:0;min-height:34px;padding:0 12px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;${chipStyle(S.venueFilter === name, '#201a17')}">◎ ${esc(name)}</button>`).join('')}
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">${filtered.map(c => rowHTML(c)).join('')}</div>
      ${filtered.length ? '' : `<div style="text-align:center;padding:40px 20px;color:#625852;border:1px dashed #d7cbbd;border-radius:18px;font-size:13px">Nothing matches — clear the search or capture it now.</div>`}
    </div>
  </div>`;
}

/* ───────────────────────── Companies ───────────────────────── */
function suppliersView() {
  const rows = companyRows();
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T64} 18px 14px">
      <div class="serif" style="font-size:22px">Companies</div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">One record per company — booth, factory or showroom</div>
    </header>
    <div class="vscroll" style="flex:1;padding:14px 18px ${B_BODY};display:flex;flex-direction:column;gap:9px">
      ${rows.map(sp => `<div data-act="openCompany" data-arg="${esc(sp.key)}" role="button" style="display:flex;align-items:center;gap:12px;background:#fffdf9;border:1px solid #d7cbbd;border-radius:16px;padding:12px;cursor:pointer">
        <div class="serif" style="width:44px;height:44px;border:1px solid #c9aa78;border-radius:50%;display:grid;place-items:center;font-size:17px;font-weight:700;color:#9d7643;flex-shrink:0;${sp.cardPhoto ? thumbBg(sp.cardThumb || sp.cardPhoto) : ''}">${sp.cardPhoto ? '' : esc(sp.initial)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sp.name)}</div>
          <div style="font-size:12px;color:#625852;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sp.nameZh ? esc(sp.nameZh) + ' · ' : ''}${esc(sp.sub)}</div>
        </div>
        <span style="color:#9d7643;font-size:17px">›</span>
      </div>`).join('')}
      ${rows.length ? '' : `<div style="text-align:center;padding:40px 20px;color:#625852;border:1px dashed #d7cbbd;border-radius:18px;font-size:13px">No companies yet — shoot a company card during a capture and it lands here.</div>`}
      <p style="font-size:12px;color:#625852;line-height:1.5;margin:8px 2px 0">Card photos become full company records (name, WeChat, contact) at evening review — nothing typed on the floor.</p>
    </div>
  </div>`;
}

/* ───────────────────────── Compare ───────────────────────── */
function compareView() {
  const cmp = S.compareIds.map(id => S.captures.find(c => c.id === id)).filter(Boolean);
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T64} 18px 14px">
      <div class="serif" style="font-size:22px">Compare</div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">${cmp.length} of 3 selected</div>
    </header>
    <div class="vscroll" style="flex:1;padding:14px 18px ${B_BODY}">
      ${cmp.length ? '' : `<div style="text-align:center;padding:44px 22px;color:#625852;border:1px dashed #d7cbbd;border-radius:18px;background:rgba(255,255,255,.4)">
        <strong class="serif" style="display:block;color:#201a17;font-size:19px;margin-bottom:7px">Nothing to compare</strong>
        <p style="margin:0;font-size:13px;line-height:1.5">Open a product and tap “Add to compare” — up to three side by side.</p>
        <button data-act="nav" data-arg="products" style="margin-top:16px;min-height:46px;padding:0 18px;border:0;border-radius:13px;background:#201a17;color:#fff;font-size:14px;font-weight:800">Open products</button>
      </div>`}
      <div class="hscroll" style="display:flex;gap:10px;align-items:stretch;padding-bottom:8px">
        ${cmp.map(c => {
          const first = c.photos.product[0];
          const st = ST[displaySt(c)] || ST.Captured;
          return `<div style="flex-shrink:0;width:206px;background:#fffdf9;border:1px solid #d7cbbd;border-radius:18px;overflow:hidden;display:flex;flex-direction:column">
          <div style="height:110px;background:#ebe3d8;position:relative;${thumbBg(photoThumb(first))}">
            <button data-act="toggleCompare" data-arg="${c.id}" class="hit44" style="position:absolute;right:7px;top:7px;width:30px;height:30px;border:0;border-radius:50%;background:rgba(31,25,23,.78);color:#fff;font-size:13px" aria-label="Remove">✕</button>
          </div>
          <div style="padding:12px 13px;display:flex;flex-direction:column;gap:7px;flex:1">
            <div style="font-size:14px;font-weight:800;line-height:1.25">${esc(dispName(c))}</div>
            <div style="font-size:11.5px;color:#625852">${esc(supName(c))}</div>
            <div style="border-top:1px solid #ece3d6;padding-top:7px;font-size:12px;display:flex;justify-content:space-between"><span style="color:#625852">Rating</span><b style="color:#9d7643">${c.rating ? '★ ' + c.rating + '/5' : '—'}</b></div>
            <div style="font-size:12px;display:flex;justify-content:space-between"><span style="color:#625852">Price</span><b>${c.price ? esc(c.currency + ' ' + c.price) : '—'}</b></div>
            <div style="font-size:12px;display:flex;justify-content:space-between;gap:8px"><span style="color:#625852">Rooms</span><b style="text-align:right">${esc((c.rooms || []).slice(0, 2).join(', ') || '—')}</b></div>
            <div style="font-size:12px;display:flex;justify-content:space-between;gap:8px"><span style="color:#625852">Place</span><b style="text-align:right">${esc(c.venue)}</b></div>
            <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:6px">
              <span style="font-size:10.5px;font-weight:800;border-radius:999px;padding:5px 9px;background:${st.bg};color:${st.fg}">${esc(displaySt(c))}</span>
              <button data-act="openDetail" data-arg="${c.id}" class="hit44" style="border:0;background:transparent;color:#6f273a;font-size:12px;font-weight:800;padding:6px 2px">Open →</button>
            </div>
          </div>
        </div>`; }).join('')}
      </div>
    </div>
  </div>`;
}

/* ───────────────────────── Evening review (list) ───────────────────────── */
function reviewView() {
  const pending = S.captures.filter(c => c.needsReview);
  const today = S.captures.filter(c => dayKey(c.createdAt) === dayKey());
  const todayCount = (today.length ? today : S.captures).length;
  return `<div class="screen" style="z-index:25">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 14px;display:flex;align-items:center;gap:10px">
      <button data-act="nav" data-arg="home" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:19px;flex-shrink:0" aria-label="Back">‹</button>
      <div style="flex:1">
        <div class="serif" style="font-size:18px">Evening review</div>
        <div style="font-size:10.5px;color:rgba(255,255,255,.6);margin-top:1px">${pending.length} records to complete</div>
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:14px 18px calc(var(--sab) + 30px);display:flex;flex-direction:column;gap:9px">
      <div style="background:#fffdf9;border:1px solid #d7cbbd;border-radius:18px;padding:14px 15px">
        <div style="font-size:14px;font-weight:800">Day pack · ${todayCount} captures</div>
        <div style="font-size:12px;color:#625852;margin-top:3px;line-height:1.45">One tidy file for Fiona and the builder — photos, notes and quotes together.</div>
        <div style="display:flex;gap:8px;margin-top:11px">
          <button data-act="exportPack" data-arg="pdf" id="btn-export-pdf" style="flex:1;min-height:44px;border:0;border-radius:12px;background:#201a17;color:#fff;font-size:13px;font-weight:800">Export PDF</button>
          <button data-act="exportPack" data-arg="share" id="btn-share-pack" style="flex:1;min-height:44px;border:1px solid #d7cbbd;border-radius:12px;background:#fffdf9;color:#201a17;font-size:13px;font-weight:800">Share to WeChat</button>
        </div>
      </div>
      ${pending.length ? '' : `<div style="text-align:center;padding:36px 20px;color:#625852;border:1px dashed #d7cbbd;border-radius:18px;font-size:13px"><b style="color:#355f4b">✓ All records complete.</b><br>Every capture has a name and a company.</div>`}
      ${pending.map(c => {
        const first = c.photos.product[0];
        return `<div data-act="openReview" data-arg="${c.id}" role="button" style="display:flex;align-items:center;gap:12px;background:#fffdf9;border:1px solid #d7cbbd;border-radius:16px;padding:10px 12px;cursor:pointer">
        <div style="width:52px;height:52px;border-radius:11px;flex-shrink:0;background:#ebe3d8;${thumbBg(photoThumb(first))}"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(dispName(c))}</div>
          <div style="display:flex;gap:5px;margin-top:5px;flex-wrap:wrap">
            ${(c.missing && c.missing.length ? c.missing : ['name', 'company']).map(m => `<span style="font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;background:#f6e5e3;color:#8b2d2d">${esc(m)}</span>`).join('')}
          </div>
        </div>
        <span style="color:#9d7643;font-size:17px">›</span>
      </div>`; }).join('')}
    </div>
  </div>`;
}

/* Every line the OCR read, offered as tap-to-use chips — when the guessed
   field is wrong or partial, the right line is one tap away, not a retype. */
function readLineChips(grp) {
  const arr = S.rvLines[grp] || [];
  if (!arr.length) return '';
  return `<div style="margin-top:10px">
    <div class="mono" style="font-size:10px;color:#625852;margin-bottom:6px">everything read from the photo — tap a line to use it</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${arr.slice(0, 12).map((t, i) => `<button data-act="useLine" data-arg="${grp}@${i}" class="mono" style="max-width:100%;min-height:34px;padding:6px 10px;border:1px solid #d7cbbd;border-radius:9px;background:#fffdf9;color:#3d3530;font-size:11px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t)}</button>`).join('')}
    </div>
  </div>`;
}

/* The characters as they were read, kept under the translated field so a wrong
   reading can be checked — or tapped back in — instead of being lost. */
function zhHint(field) {
  const zh = S.rvZh[field];
  if (!zh || zh === S.rv[field]) return '';
  return `<div style="display:flex;align-items:center;gap:6px;margin-top:5px">
    <span style="font-size:12.5px;color:#625852;min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(zh)}">${esc(zh)}</span>
    <button data-act="useZh" data-arg="${field}" class="mono" style="flex-shrink:0;min-height:28px;padding:0 9px;border:1px solid rgba(157,118,67,.45);border-radius:8px;background:rgba(157,118,67,.12);color:#9d7643;font-size:10px;font-weight:700">use 中文</button>
  </div>`;
}

/* ───────────────────────── Complete record (OCR) ───────────────────────── */
function reviewItemView() {
  const c = S.captures.find(x => x.id === S.reviewId);
  if (!c) return reviewView();
  const cardBlob = photoThumb(c.photos.card);
  const labelBlob = photoThumb(c.photos.label);
  const tag = (busy, has) => busy
    ? `<span class="mono" style="font-size:10px;color:#9d7643;background:rgba(157,118,67,.12);border-radius:6px;padding:3px 6px"><span class="spin" style="width:9px;height:9px;border-width:1.5px;vertical-align:-1px"></span> reading…</span>`
    : has ? `<span class="mono" style="font-size:10px;color:#9d7643;background:rgba(157,118,67,.12);border-radius:6px;padding:3px 6px">read on device</span>`
    : `<span class="mono" style="font-size:10px;color:#94601e;background:#f5ead8;border-radius:6px;padding:3px 6px">no photo — type it in</span>`;
  return `<div class="screen" style="z-index:26">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 14px;display:flex;align-items:center;gap:10px">
      <button data-act="nav" data-arg="review" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:19px;flex-shrink:0" aria-label="Back">‹</button>
      <div style="flex:1;min-width:0">
        <div class="serif" style="font-size:18px">Complete record</div>
        <div style="font-size:10.5px;color:rgba(255,255,255,.6);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(dispName(c))} · ${esc(supName(c))}</div>
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:16px 18px 24px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852">FROM THE COMPANY CARD</div>
        ${tag(S.rvBusy.card, !!cardBlob)}
      </div>
      <div style="display:flex;gap:12px;margin-top:9px">
        <div style="width:74px;height:96px;border-radius:11px;border:1px solid #d7cbbd;background:#ebe3d8;flex-shrink:0;${cardBlob ? thumbBg(cardBlob) : ''}"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0">
          <div>
            <input class="fld fld-strong" data-input="rv.company" value="${esc(S.rv.company)}" placeholder="Company name" />
            ${zhHint('company')}
          </div>
          <div>
            <input class="fld" data-input="rv.contact" value="${esc(S.rv.contact)}" placeholder="Contact person" />
            ${zhHint('contact')}
          </div>
          <input class="fld" data-input="rv.wechat" value="${esc(S.rv.wechat)}" placeholder="WeChat / phone" />
        </div>
      </div>
      ${readLineChips('card')}
      <div class="mono" style="font-size:11px;color:#94601e;margin-top:8px;line-height:1.45">check the characters against the card photo before confirming</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:20px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852">FROM THE LABEL</div>
        ${tag(S.rvBusy.label, !!labelBlob)}
      </div>
      <div style="display:flex;gap:12px;margin-top:9px">
        <div style="width:74px;height:96px;border-radius:11px;border:1px solid #d7cbbd;background:#ebe3d8;flex-shrink:0;${labelBlob ? thumbBg(labelBlob) : ''}"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0">
          <div>
            <input class="fld fld-strong" data-input="rv.pname" value="${esc(S.rv.pname)}" placeholder="Product name" />
            ${zhHint('pname')}
          </div>
          <input class="fld" data-input="rv.code" value="${esc(S.rv.code)}" placeholder="Model / code" />
          <input class="fld" data-input="rv.size" value="${esc(S.rv.size)}" placeholder="Size / spec" />
        </div>
      </div>
      ${readLineChips('label')}
      ${S.rv.company.trim() ? lookupSectionHTML({
        name: S.rv.company.trim(), website: S.rv.website, notes: S.rv.notes, bio: S.rv.bio,
        pending: S.rvLookupPending, prefix: 'rv', fetchArg: 'rv',
      }) : ''}
    </div>
    <div style="background:rgba(255,253,249,.97);border-top:1px solid #d7cbbd;padding:10px 16px ${B_BAR}">
      <button data-act="confirmReview" class="pf p98" style="width:100%;min-height:58px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:17px;font-weight:800">✓ Confirm record</button>
    </div>
  </div>`;
}

/* ───────────────────────── Company lookup (shared section) ─────────────────
   Rendered on the Complete Record screen (prefix 'rv' — saved on confirm) and
   the company detail view (prefix 'co' — saved as you type). */
function lookupAiHTML(o) {
  if (S.bioBusy) {
    return `<div style="margin-top:10px"><button disabled style="min-height:46px;padding:0 15px;border-radius:13px;border:1px solid rgba(157,118,67,.5);background:rgba(157,118,67,.10);color:#9d7643;font-size:13.5px;font-weight:800"><span class="spin" style="width:12px;height:12px;border-width:2px;vertical-align:-2px"></span> Looking up…</button></div>`;
  }
  if (o.bio) {
    return `<div style="margin-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
        <span class="mono" style="font-size:10px;color:#94601e;background:#f5ead8;border-radius:6px;padding:3px 6px">AI lookup — verify yourself</span>
        ${S.aiKey ? `<button data-act="fetchBio" data-arg="${esc(o.fetchArg)}" class="hit44" style="border:0;background:transparent;color:#9d7643;font-size:11.5px;font-weight:800;padding:2px">↻ Fetch again</button>` : ''}
      </div>
      <textarea class="fld" data-input="${o.prefix}.bio" rows="6" style="resize:none;line-height:1.5">${esc(o.bio)}</textarea>
    </div>`;
  }
  if (!S.aiKey) {
    return `<div style="font-size:11.5px;color:#625852;margin-top:10px;line-height:1.45">Optional: save an AI lookup API key in Settings and a “Fetch company bio” button appears here.</div>`;
  }
  if (o.pending) {
    return `<div style="margin-top:10px;display:flex;align-items:center;gap:10px;border:1px solid #e5cfa9;background:#f9efdd;border-radius:13px;padding:10px 13px">
      <span style="flex:1;font-size:12.5px;color:#94601e;font-weight:700;line-height:1.4">Lookup pending — it didn’t go through last time.</span>
      <button data-act="fetchBio" data-arg="${esc(o.fetchArg)}" style="flex-shrink:0;min-height:40px;padding:0 14px;border:0;border-radius:11px;background:#94601e;color:#fff;font-size:12.5px;font-weight:800">Retry</button>
    </div>`;
  }
  return `<div style="margin-top:10px"><button data-act="fetchBio" data-arg="${esc(o.fetchArg)}" style="min-height:46px;padding:0 15px;border-radius:13px;border:1px solid rgba(157,118,67,.5);background:rgba(157,118,67,.10);color:#9d7643;font-size:13.5px;font-weight:800">✦ Fetch company bio</button></div>`;
}

function lookupSectionHTML(o) {
  return `<div style="margin-top:22px">
    <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852">LOOK UP COMPANY</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:9px">
      ${Lookup.searchUrls(o.name).map(l => `<button data-act="openSearch" data-arg="${esc(l.url)}" style="min-height:44px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:700;background:#fffdf9;color:#201a17;border:1px solid #d7cbbd">${esc(l.label)} ↗</button>`).join('')}
    </div>
    <div style="font-size:11.5px;color:#625852;margin-top:7px;line-height:1.45">Each opens a ready-made search in a new tab — Bing works in mainland China. Paste what you find below.</div>
    <input class="fld" data-input="${o.prefix}.website" value="${esc(o.website)}" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="Website" style="margin-top:10px" />
    <textarea class="fld" data-input="${o.prefix}.notes" rows="3" placeholder="Notes from your lookup" style="margin-top:8px;resize:none;line-height:1.5">${esc(o.notes)}</textarea>
    ${lookupAiHTML(o)}
  </div>`;
}

/* ───────────────────────── Tab bar ───────────────────────── */
function tabbar() {
  const fg = v => (S.view === v ? '#6f273a' : '#625852');
  const cmpN = S.compareIds.length;
  return `<nav style="position:absolute;left:0;right:0;bottom:0;z-index:20;background:rgba(255,253,249,.97);border-top:1px solid #d7cbbd;display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;padding:6px 8px ${B_TAB}">
    <button data-act="nav" data-arg="home" style="border:0;background:transparent;color:${fg('home')};min-height:54px;display:grid;place-items:center;gap:1px;font-size:10px;font-weight:700;border-radius:12px"><b style="font-size:19px;line-height:1">⌂</b>Today</button>
    <button data-act="nav" data-arg="products" style="border:0;background:transparent;color:${fg('products')};min-height:54px;display:grid;place-items:center;gap:1px;font-size:10px;font-weight:700;border-radius:12px"><b style="font-size:19px;line-height:1">◫</b>Products</button>
    <div style="display:grid;place-items:center">
      <button data-act="startCapture" class="pf p94t" style="width:62px;height:62px;border-radius:50%;border:0;background:#6f273a;color:#fff;font-size:30px;line-height:1;box-shadow:0 8px 20px rgba(111,39,58,.38);transform:translateY(-16px)" aria-label="New capture">＋</button>
    </div>
    <button data-act="nav" data-arg="suppliers" style="border:0;background:transparent;color:${fg('suppliers')};min-height:54px;display:grid;place-items:center;gap:1px;font-size:10px;font-weight:700;border-radius:12px"><b style="font-size:19px;line-height:1">◎</b>Companies</button>
    <button data-act="nav" data-arg="compare" style="border:0;background:transparent;color:${fg('compare')};min-height:54px;display:grid;place-items:center;gap:1px;font-size:10px;font-weight:700;border-radius:12px;position:relative"><b style="font-size:19px;line-height:1">⇄</b>Compare
      ${cmpN ? `<span style="position:absolute;top:4px;right:14px;min-width:16px;height:16px;border-radius:999px;background:#6f273a;color:#fff;font-size:9.5px;font-weight:800;display:grid;place-items:center;padding:0 4px">${cmpN}</span>` : ''}
    </button>
  </nav>`;
}

/* ───────────────────────── Capture — Shoot ───────────────────────── */
function slotDefs() {
  const sw = sessWord();
  return [
    { k: 'product', n: '1', label: 'Product', hint: 'every face of it — next when done' },
    { k: 'label', n: '2', label: 'Label / spec', hint: 'sticker, model no., sizes' },
    { k: 'card', n: '3', label: 'Company', hint: 'card or signage — once per ' + sw },
  ];
}

function slotState(d) {
  const dr = S.draft;
  const co = sessionCompany();
  const sessionCard = co ? (co.cardThumb || co.cardPhoto) : null;
  const blob = d.k === 'product' ? photoThumb(dr.product[0])
    : d.k === 'label' ? photoThumb(dr.label)
    : (dr.card ? photoThumb(dr.card) : sessionCard);
  const reused = d.k === 'card' && !dr.card && sessionCard;
  const n = dr.product.length;
  const sw = sessWord();
  return {
    ...d, blob, filled: !!blob, reused, nProd: n,
    overlay: d.k === 'product' ? '✓ Product · ' + n + (n > 1 ? ' photos' : ' photo')
      : d.k === 'label' ? '✓ Label / spec'
      : reused ? '✓ Same ' + sw + ' · ' + ord(sessionCount() + 1) + ' product' : '✓ Company card',
    action: d.k === 'product' ? '＋ Add more'
      : d.k === 'card' ? (reused ? '↻ New ' + sw + ' / new card' : '↻ New card') : '↻ Retake',
  };
}

function shootView() {
  const dr = S.draft;
  const slots = slotDefs().map(slotState);
  const nProd = dr.product.length;
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 10px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <button data-act="closeFlow" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:17px" aria-label="Close">✕</button>
        <div style="text-align:center">
          <div class="serif" style="font-size:19px">New capture</div>
          <div style="font-size:10.5px;color:rgba(255,255,255,.6)">Shoot · tag · save</div>
        </div>
        <div style="width:44px"></div>
      </div>
      <button data-act="openVenueSheet" style="margin-top:9px;width:100%;border:0;border-radius:11px;background:rgba(201,170,120,.14);color:#c9aa78;font-size:12px;font-weight:700;min-height:36px;display:flex;align-items:center;justify-content:center;gap:6px">◎ ${esc(S.venue)} <span style="opacity:.6">▾</span></button>
    </header>
    <div style="flex:1;display:flex;flex-direction:column;gap:9px;padding:12px 14px;min-height:0">
      ${slots.map(s => `<div data-act="openCam" data-arg="${s.k}" role="button" style="flex:${s.k === 'product' ? '1.3' : '1'};min-height:96px;border-radius:20px;border:${s.filled ? '1px solid #d7cbbd' : '2px dashed #bcae9f'};background:${s.filled ? '#ebe3d8' : '#faf7f2'};position:relative;overflow:hidden;cursor:pointer;${s.blob ? thumbBg(s.blob) : ''}">
        ${!s.filled ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px">
          <div class="serif" style="width:40px;height:40px;border-radius:50%;border:2px solid #9d7643;color:#9d7643;display:grid;place-items:center;font-size:19px;font-weight:700">${s.n}</div>
          <div style="font-size:16px;font-weight:800">${esc(s.label)}</div>
          <div class="mono" style="font-size:11.5px;color:#625852;text-align:center">${esc(s.hint)}</div>
        </div>` : `<div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:${s.reused ? '5px 5px 5px 13px' : '9px 13px'};background:rgba(31,25,23,.72);color:#fff">
          <span style="font-size:13px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.overlay)}</span>
          ${s.reused
            ? `<button data-act="newBooth" style="flex-shrink:0;min-height:38px;padding:0 12px;border:1px solid rgba(201,170,120,.6);border-radius:10px;background:rgba(201,170,120,.16);color:#c9aa78;font-size:12px;font-weight:800;white-space:nowrap">${esc(s.action)}</button>`
            : `<span style="font-size:12px;color:rgba(255,255,255,.75);flex-shrink:0">${esc(s.action)}</span>`}
        </div>`}
      </div>`).join('')}
    </div>
    <div style="background:rgba(255,253,249,.97);border-top:1px solid #d7cbbd;padding:10px 16px ${B_BAR}">
      ${nProd ? '' : `<div style="text-align:center;font-size:12px;color:#94601e;font-weight:700;padding-bottom:8px">Shoot at least one product photo</div>`}
      <button data-act="toDetails" ${nProd ? '' : 'disabled'} class="pf p98" style="width:100%;min-height:58px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:17px;font-weight:800;opacity:${nProd ? '1' : '0.45'}">Tag it →</button>
    </div>
  </div>`;
}

/* ───────────────────────── Capture — Tag it ───────────────────────── */
function tagView() {
  const dr = S.draft;
  const slots = slotDefs().map(slotState);
  const sw = sessWord();
  const sessionCo = sessionCompany();
  const companyOn = dr.card || sessionCo;
  const namedCos = S.companies.filter(co => co.name).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 2);
  const roomsShown = dr.roomsMore ? ROOMS_TOP.concat(ROOMS_MORE) : ROOMS_TOP;
  const barFlip = S.leftHanded ? 'row-reverse' : 'row';
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <button data-act="backToShoot" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:19px" aria-label="Back">‹</button>
        <div class="serif" style="font-size:19px">Tag it</div>
        <div style="width:44px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        ${slots.map(s => `<div data-act="openCam" data-arg="${s.k}" role="button" style="flex:1;height:46px;border-radius:10px;border:${s.filled ? '1px solid rgba(255,255,255,.35)' : '1px dashed rgba(255,255,255,.35)'};background:rgba(255,255,255,.08);display:grid;place-items:center;cursor:pointer;position:relative;${s.blob ? thumbBg(s.blob) : ''}">
          ${!s.filled ? `<span style="font-size:10px;color:rgba(255,255,255,.55);font-weight:700">+ ${esc(s.label)}</span>` : ''}
          ${s.k === 'product' && s.nProd > 1 ? `<span style="position:absolute;right:4px;bottom:4px;font-size:9px;font-weight:800;background:rgba(31,25,23,.75);color:#fff;border-radius:6px;padding:2px 5px">×${s.nProd}</span>` : ''}
        </div>`).join('')}
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:16px 16px 24px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin:0 0 9px">WHAT IS IT?</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${CATS.map(name => `<button data-act="pickCat" data-arg="${esc(name)}" class="pf1 p96" style="min-height:48px;padding:0 16px;border-radius:14px;font-size:14px;font-weight:700;${chipStyle(dr.category === name, '#201a17')}">${esc(name)}</button>`).join('')}
      </div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin:22px 0 9px">WHICH ROOM?</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${roomsShown.map(name => `<button data-act="toggleRoom" data-arg="${esc(name)}" class="pf1 p96" style="min-height:44px;padding:0 15px;border-radius:999px;font-size:13.5px;font-weight:700;${chipStyle(dr.rooms.includes(name), '#6f273a')}">${esc(name)}</button>`).join('')}
        <button data-act="toggleRoomsMore" style="min-height:44px;padding:0 15px;border-radius:999px;font-size:13.5px;font-weight:800;border:1px dashed #9d7643;background:transparent;color:#9d7643">${dr.roomsMore ? 'Fewer rooms' : '+' + ROOMS_MORE.length + ' more'}</button>
      </div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin:22px 0 6px">YOUR CALL</div>
      <div style="display:flex;gap:4px">
        ${[1, 2, 3, 4, 5].map(n => `<button data-act="setRating" data-arg="${n}" style="width:52px;height:52px;border:0;background:transparent;font-size:36px;line-height:1;padding:0;color:${dr.rating >= n ? '#9d7643' : '#cfc6b8'}">★</button>`).join('')}
      </div>
      <div style="margin-top:12px">
        ${dr.rec === 'idle' ? `<button data-act="rec" style="width:100%;min-height:54px;border:1px solid #d7cbbd;border-radius:14px;background:#fffdf9;color:#201a17;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:9px"><span style="width:10px;height:10px;border-radius:50%;background:#8b2d2d"></span>Record a voice note</button>` : ''}
        ${dr.rec === 'rec' ? `<button data-act="rec" style="width:100%;min-height:54px;border:0;border-radius:14px;background:#6f273a;color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:9px"><span class="anim-pulse" style="width:10px;height:10px;border-radius:50%;background:#fff"></span><span id="rec-label">Recording ${fmtClock(dr.recSec)} — tap to stop</span></button>` : ''}
        ${dr.rec === 'done' ? `<div style="display:flex;align-items:center;gap:10px;border:1px solid #d7cbbd;border-radius:14px;background:#fffdf9;padding:8px 8px 8px 15px;min-height:54px">
          <span data-act="playVoice" role="button" style="font-size:14.5px;font-weight:700;flex:1;cursor:pointer">▶ Voice note · ${fmtClock(dr.voice ? dr.voice.duration : 0)}</span>
          <button data-act="delVoice" class="hit44" style="width:40px;height:40px;border:0;border-radius:11px;background:#ebe3d8;color:#625852;font-size:15px" aria-label="Delete voice note">✕</button>
        </div>` : ''}
      </div>
      <div style="margin-top:12px">
        ${!dr.priceOpen ? `<button data-act="togglePrice" class="hit44" style="border:0;background:transparent;color:#6f273a;font-size:14px;font-weight:800;padding:10px 2px">＋ Add quoted price</button>`
        : `<div style="display:flex;gap:8px;align-items:stretch">
            ${['CNY', 'USD', 'AUD'].map(cu => `<button data-act="setCurrency" data-arg="${cu}" style="min-width:56px;min-height:48px;border-radius:12px;font-size:13px;font-weight:800;${chipStyle(dr.currency === cu, '#201a17')}">${cu}</button>`).join('')}
            <input data-input="price" value="${esc(dr.price)}" inputmode="decimal" placeholder="Quoted amount" style="flex:1;min-width:0;border:1px solid #d7cbbd;border-radius:12px;padding:0 13px;background:#fff;color:#201a17;outline:none" />
          </div>`}
      </div>
      <div style="font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin:22px 0 9px">COMPANY</div>
      ${companyOn ? `<div style="border:1px solid #b9d2c4;background:#e9f2ec;border-radius:14px;padding:13px 15px">
        <div style="font-size:14px;font-weight:800;color:#355f4b">${dr.card ? '✓ Company card captured' : '✓ Same ' + sw + ' as your last capture'}</div>
        <div style="font-size:12.5px;color:#4a6355;line-height:1.45;margin-top:3px">${dr.card ? 'The company record is created from this card — nothing to type on the floor.' : 'This will file as the ' + ord(sessionCount() + 1) + ' product for this ' + sw + '.'}</div>
        <button data-act="newBooth" class="hit44" style="margin-top:9px;border:0;background:transparent;color:#355f4b;font-size:12.5px;font-weight:800;padding:4px 0;text-decoration:underline">Different company? Shoot the new card</button>
      </div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:8px">
        ${namedCos.map(co => `<button data-act="pickSupplier" data-arg="${esc(co.key)}" style="min-height:44px;padding:0 15px;border-radius:999px;font-size:13.5px;font-weight:700;${chipStyle(dr.supplierKey === co.key, '#201a17')}">${esc(co.name)}</button>`).join('')}
        <button data-act="openCam" data-arg="card" style="min-height:44px;padding:0 15px;border-radius:999px;font-size:13.5px;font-weight:800;border:1px dashed #9d7643;background:transparent;color:#9d7643">＋ Shoot the card</button>
      </div>`}
    </div>
    <div style="background:rgba(255,253,249,.97);border-top:1px solid #d7cbbd;padding:10px 16px ${B_BAR};display:flex;gap:10px;flex-direction:${barFlip}">
      <button data-act="backToShoot" style="width:58px;min-height:58px;border:1px solid #d7cbbd;border-radius:16px;background:#fffdf9;color:#201a17;font-size:20px" aria-label="Back to photos">‹</button>
      <button data-act="save" ${dr.category ? '' : 'disabled'} class="pf p98" style="flex:1;min-height:58px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:17px;font-weight:800;opacity:${dr.category ? '1' : '0.45'}">${dr.category ? 'Save capture' : 'Pick a category first'}</button>
    </div>
  </div>`;
}

/* ───────────────────────── Saved ───────────────────────── */
function savedView() {
  const sv = S.lastSaved;
  if (!sv) return homeView();
  const sw = sv.sessWord;
  return `<div class="screen">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 14px;text-align:center">
      <div class="serif" style="font-size:19px">Capture saved</div>
      <div style="font-size:10.5px;color:rgba(255,255,255,.6);margin-top:2px">${esc(sv.venue)}</div>
    </header>
    <div class="vscroll" style="flex:1;padding:26px 20px 24px;text-align:center">
      <div class="anim-pop" style="width:86px;height:86px;border-radius:50%;background:#9d7643;color:#fff;font-size:38px;display:grid;place-items:center;margin:0 auto;box-shadow:0 10px 26px rgba(157,118,67,.35)">✓</div>
      <h2 class="serif" style="font-size:25px;margin:18px 0 4px">Saved on this device</h2>
      <p style="font-size:12.5px;color:#625852;margin:0">Captured in ${fmtClock(sv.sec)} · syncs to ${esc(projName())} when online.</p>
      <div class="anim-rise" style="background:#fffdf9;border:1px solid #d7cbbd;border-radius:18px;padding:14px;margin-top:22px;text-align:left">
        <div style="display:flex;gap:8px">
          ${sv.slots.map(s => `<div style="flex:1;height:64px;border-radius:11px;border:${s.blob ? '1px solid #d7cbbd' : '2px dashed #bcae9f'};background:${s.blob ? '#ebe3d8' : '#faf7f2'};display:grid;place-items:center;position:relative;${s.blob ? thumbBg(s.blob) : ''}">
            ${!s.blob ? `<span style="font-size:9.5px;color:#a2937f;font-weight:700">skipped</span>` : ''}
            ${s.count > 1 ? `<span style="position:absolute;right:4px;bottom:4px;font-size:9px;font-weight:800;background:rgba(31,25,23,.75);color:#fff;border-radius:6px;padding:2px 5px">×${s.count}</span>` : ''}
          </div>`).join('')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:11px">
          ${sv.chips.map(ch => `<span style="font-size:11.5px;font-weight:700;border-radius:999px;padding:6px 10px;background:${ch.bg};color:${ch.fg}">${esc(ch.t)}</span>`).join('')}
        </div>
      </div>
      <p style="font-size:11.5px;color:#625852;margin:14px 4px 0;line-height:1.5">Name, code and company details get read from your photos at evening review.</p>
    </div>
    <div style="padding:10px 16px ${B_BAR};display:flex;flex-direction:column;gap:8px">
      <button data-act="startCapture" class="pf p98" style="width:100%;min-height:58px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:17px;font-weight:800">${sv.sessionOn ? '＋ Next capture · same ' + sw : '＋ Next capture'}</button>
      <button data-act="nav" data-arg="home" style="width:100%;min-height:48px;border:0;background:transparent;color:#625852;font-size:14px;font-weight:700">Back to today</button>
    </div>
  </div>`;
}

/* ───────────────────────── Product detail (overlay) ───────────────────────── */
function detailOverlay() {
  const c = S.captures.find(x => x.id === S.detailId);
  if (!c) return '';
  const inCmp = S.compareIds.includes(c.id);
  const chips = [];
  const st = ST[displaySt(c)] || ST.Captured;
  chips.push({ t: displaySt(c), bg: st.bg, fg: st.fg });
  chips.push({ t: c.category, bg: '#201a17', fg: '#fff' });
  chips.push({ t: '◎ ' + c.venue, bg: '#ebe3d8', fg: '#625852' });
  (c.rooms || []).forEach(r => chips.push({ t: r, bg: '#f4e6ea', fg: '#6f273a' }));
  if (c.rating) chips.push({ t: '★ ' + c.rating + '/5', bg: '#f5ead8', fg: '#94601e' });
  if (c.code) chips.push({ t: 'Code ' + c.code, bg: '#ebe3d8', fg: '#625852' });
  if (c.size) chips.push({ t: c.size, bg: '#ebe3d8', fg: '#625852' });
  if (c.price) chips.push({ t: c.currency + ' ' + c.price, bg: '#ebe3d8', fg: '#625852' });
  const photos = c.photos.product.map((p, i) => ({ blob: photoThumb(p), cap: 'product · face ' + (i + 1) }));
  if (c.photos.label) photos.push({ blob: photoThumb(c.photos.label), cap: 'label / spec' });
  if (c.photos.card) photos.push({ blob: photoThumb(c.photos.card), cap: 'company card' });
  return `<div class="screen" style="z-index:30">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 14px;display:flex;align-items:center;gap:10px">
      <button data-act="closeDetail" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:19px;flex-shrink:0" aria-label="Back">‹</button>
      <div style="min-width:0;flex:1">
        <div class="serif" style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(dispName(c))}</div>
        ${c.nameZh ? `<div style="font-size:11px;color:rgba(255,255,255,.8);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.nameZh)}</div>` : ''}
        <div style="font-size:10.5px;color:rgba(255,255,255,.6);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(supName(c))} · ${esc(c.venue)} · ${esc(fmtTime(c.createdAt))}</div>
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:16px 18px calc(var(--sab) + 24px)">
      ${c.needsReview ? `<button data-act="openReview" data-arg="${c.id}" style="width:100%;margin-bottom:12px;min-height:50px;border:1px solid #e5cfa9;border-radius:14px;background:#f9efdd;color:#94601e;font-size:13.5px;font-weight:800;display:flex;align-items:center;justify-content:center;gap:8px">▣ Complete this record — read card &amp; label →</button>` : ''}
      <div class="hscroll" style="display:flex;gap:8px;padding-bottom:6px">
        ${photos.map((ph, i) => `<div style="flex-shrink:0;width:128px">
          <div style="height:108px;border-radius:13px;border:1px solid #d7cbbd;background:#ebe3d8;position:relative;${thumbBg(ph.blob)}">
            <button data-act="sharePhoto" data-arg="${c.id}@${i}" class="hit44" style="position:absolute;right:6px;top:6px;width:30px;height:30px;border:0;border-radius:50%;background:rgba(31,25,23,.78);color:#fff;font-size:14px;line-height:1;padding:0" aria-label="Save to Photos">⇪</button>
          </div>
          <div class="mono" style="font-size:10px;color:#625852;font-weight:700;margin-top:4px;text-align:center">${esc(ph.cap)}</div>
        </div>`).join('')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">
        ${chips.map(ch => `<span style="font-size:11.5px;font-weight:700;border-radius:999px;padding:6px 10px;background:${ch.bg};color:${ch.fg}">${esc(ch.t)}</span>`).join('')}
      </div>
      ${c.note ? `<div style="margin-top:14px;background:#fffdf9;border:1px solid #d7cbbd;border-radius:14px;padding:13px 15px;font-size:13.5px;line-height:1.5;color:#3d3530">${esc(c.note)}</div>` : ''}
      ${c.voiceNote ? `<div style="margin-top:14px;display:flex;align-items:center;gap:10px;border:1px solid #d7cbbd;border-radius:14px;background:#fffdf9;padding:8px 8px 8px 15px;min-height:54px">
        <span data-act="playVoiceOf" data-arg="${c.id}" role="button" style="font-size:14.5px;font-weight:700;flex:1;cursor:pointer" id="voice-row-${c.id}">▶ Voice note · ${fmtClock(c.voiceNote.duration)}</span>
      </div>` : ''}
      <div style="display:flex;gap:10px;margin-top:16px">
        <button data-act="setStatus" data-arg="Shortlisted" class="pf1 p97" style="flex:1;min-height:52px;border:0;border-radius:14px;background:#201a17;color:#fff;font-size:15px;font-weight:800">★ Shortlist</button>
        <button data-act="setStatus" data-arg="Rejected" class="pf1 p97" style="flex:1;min-height:52px;border:1px solid #e0c4c0;border-radius:14px;background:#f8e7e5;color:#8b2d2d;font-size:15px;font-weight:800">Reject</button>
      </div>
      <button data-act="toggleCompare" data-arg="${c.id}" style="width:100%;margin-top:10px;min-height:52px;border:1px solid #d7cbbd;border-radius:14px;background:${inCmp ? '#201a17' : '#fffdf9'};color:${inCmp ? '#fff' : '#201a17'};font-size:15px;font-weight:800">⇄ ${inCmp ? 'In compare — remove' : 'Add to compare'}</button>
      <button data-act="deleteCapture" data-arg="${c.id}" style="width:100%;margin-top:18px;min-height:44px;border:0;background:transparent;color:#8b2d2d;font-size:12.5px;font-weight:700">Delete this capture</button>
    </div>
  </div>`;
}

/* ───────────────────────── Company detail (overlay) ───────────────────────── */
function companyOverlay() {
  const co = companyOf(S.companyKey);
  if (!co) return '';
  const list = S.captures.filter(c => c.companyKey === co.key);
  const card = co.cardThumb || co.cardPhoto;
  const facts = [];
  if (co.contact) facts.push(['Contact', co.contact + (co.contactZh && co.contactZh !== co.contact ? ' · ' + co.contactZh : '')]);
  if (co.wechat) facts.push(['WeChat / phone', co.wechat]);
  if (co.venue) facts.push(['Met at', co.venue]);
  return `<div class="screen" style="z-index:32">
    <header style="background:#201a17;color:#fff;padding:${T60} 14px 14px;display:flex;align-items:center;gap:10px">
      <button data-act="closeCompany" style="width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.10);color:#fff;font-size:19px;flex-shrink:0" aria-label="Back">‹</button>
      <div style="min-width:0;flex:1">
        <div class="serif" style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(coName(co))}</div>
        ${co.nameZh && co.nameZh !== co.name ? `<div style="font-size:11px;color:rgba(255,255,255,.8);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(co.nameZh)}</div>` : ''}
        <div style="font-size:10.5px;color:rgba(255,255,255,.6);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${list.length}${list.length === 1 ? ' product' : ' products'}${co.venue ? ' · ' + esc(co.venue) : ''}</div>
      </div>
    </header>
    <div class="vscroll" style="flex:1;padding:16px 18px calc(var(--sab) + 24px)">
      ${card ? `<div style="height:190px;border-radius:16px;border:1px solid #d7cbbd;background:#ebe3d8;${thumbBg(card)}"></div>
      <div class="mono" style="font-size:10px;color:#625852;font-weight:700;margin-top:5px">company card</div>` : ''}
      ${facts.length ? `<div style="margin-top:${card ? '14px' : '0'};background:#fffdf9;border:1px solid #d7cbbd;border-radius:16px;padding:6px 15px">
        ${facts.map(([k, v], i) => `<div style="display:flex;gap:12px;padding:9px 0;border-bottom:${i === facts.length - 1 ? '0' : '1px solid #ece3d6'};font-size:13px"><span style="color:#625852;flex-shrink:0;width:104px">${esc(k)}</span><b style="min-width:0;overflow-wrap:anywhere">${esc(v)}</b></div>`).join('')}
      </div>` : ''}
      ${lookupSectionHTML({
        name: coName(co), website: co.website || '', notes: co.notes || '', bio: co.bio || '',
        pending: !!co.lookupPending, prefix: 'co', fetchArg: co.key,
      })}
      <button data-act="openCompanyProducts" data-arg="${esc(co.key)}" style="width:100%;margin-top:22px;min-height:52px;border:0;border-radius:14px;background:#201a17;color:#fff;font-size:15px;font-weight:800">◫ Open ${list.length ? 'the ' + list.length : ''} product${list.length === 1 ? '' : 's'} →</button>
    </div>
  </div>`;
}

/* ───────────────────────── Place sheet ───────────────────────── */
function venueSheet() {
  const counts = {};
  S.captures.forEach(c => { counts[c.venue] = (counts[c.venue] || 0) + 1; });
  return `<div style="position:fixed;inset:0;z-index:50">
    <div data-act="closeVenueSheet" style="position:absolute;inset:0;background:rgba(31,25,23,.45)"></div>
    <div class="anim-sheet vscroll" style="position:absolute;left:0;right:0;bottom:0;background:#fffdf9;border-radius:24px 24px 0 0;padding:18px 18px ${B_SHEET};max-height:82%;box-shadow:0 -14px 40px rgba(39,28,20,.25)">
      <div style="width:38px;height:4px;border-radius:99px;background:#d7cbbd;margin:0 auto 14px"></div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <div class="serif" style="font-size:20px">Where are you?</div>
        <button data-act="togglePlaceEdit" class="hit44" style="border:0;background:transparent;color:#6f273a;font-size:12.5px;font-weight:800;padding:4px 2px">${S.placeEdit ? 'Done' : 'Edit places'}</button>
      </div>
      <div style="font-size:12px;color:#625852;margin:4px 0 6px;line-height:1.45">Captures file under this place. Moving to a new place resets the company card.</div>
      ${PLACE_TYPES.map(t => {
        const list = S.places.filter(p => p.type === t.key);
        if (!list.length) return '';
        return `<div style="margin-top:14px">
          <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">${esc(t.group)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${list.map(p => S.placeEdit
              ? `<span style="display:inline-flex;align-items:center;gap:6px;min-height:46px;padding:0 8px 0 15px;border-radius:13px;font-size:13.5px;font-weight:700;background:#fffdf9;color:#201a17;border:1px solid #d7cbbd">${esc(p.name)}${counts[p.name] ? `<b style="font-size:11px;color:#625852;font-weight:700">${counts[p.name]}</b>` : ''}
                  <button data-act="deletePlace" data-arg="${esc(p.id)}" style="width:30px;height:30px;border:0;border-radius:50%;background:#f8e7e5;color:#8b2d2d;font-size:13px;line-height:1;padding:0" aria-label="Remove ${esc(p.name)}">✕</button>
                </span>`
              : `<button data-act="pickVenue" data-arg="${esc(p.id)}" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(S.venue === p.name, '#6f273a')}">${esc(p.name)}</button>`).join('')}
          </div>
        </div>`;
      }).join('')}
      <div style="margin-top:18px;border-top:1px solid #ece3d6;padding-top:14px">
        ${S.addPlaceOpen ? `<div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">Add a place</div>
          <input class="fld fld-strong" data-input="newPlace" id="new-place-input" value="${esc(S.newPlace)}" placeholder="e.g. Joinery Factory C" />
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:9px">
            ${PLACE_TYPES.map(t => `<button data-act="setNewPlaceType" data-arg="${t.key}" style="min-height:40px;padding:0 13px;border-radius:11px;font-size:12.5px;font-weight:700;${chipStyle(S.newPlaceType === t.key, '#201a17')}">${esc(t.add)}</button>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button data-act="addPlaceSave" style="flex:1;min-height:46px;border:0;border-radius:13px;background:#6f273a;color:#fff;font-size:13.5px;font-weight:800">Save place</button>
            <button data-act="addPlaceCancel" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(false, '#201a17')}">Cancel</button>
          </div>`
        : `<button data-act="addPlaceOpen" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:800;border:1px dashed #9d7643;background:transparent;color:#9d7643">＋ Add a place</button>`}
      </div>
    </div>
  </div>`;
}

/* ───────────────────────── Settings sheet ───────────────────────── */
function settingsSheet() {
  const u = S.user || { name: '', role: '' };
  return `<div style="position:fixed;inset:0;z-index:50">
    <div data-act="closeSettings" style="position:absolute;inset:0;background:rgba(31,25,23,.45)"></div>
    <div class="anim-sheet vscroll" style="position:absolute;left:0;right:0;bottom:0;background:#fffdf9;border-radius:24px 24px 0 0;padding:18px 18px ${B_SHEET};max-height:82%;box-shadow:0 -14px 40px rgba(39,28,20,.25)">
      <div style="width:38px;height:4px;border-radius:99px;background:#d7cbbd;margin:0 auto 14px"></div>
      <div class="serif" style="font-size:20px">Settings &amp; backup</div>
      <div style="font-size:12px;color:#625852;margin:4px 0 6px;line-height:1.45">Signed in on this device as <b>${esc(u.name)}</b> · ${esc(u.role)} · ${esc(projName())}. Records stay on the phone; cloud sync is the next activation step.</div>
      <div style="margin-top:14px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">Project</div>
        <input class="fld fld-strong" data-input="projectName" value="${esc(S.projectName)}" placeholder="My project" />
        <div style="font-size:11.5px;color:#625852;margin-top:6px;line-height:1.45">Used on the saved screen, the day pack and exports.</div>
      </div>
      <div style="margin-top:14px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">Camera &amp; ergonomics</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button data-act="toggleLeftHanded" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(S.leftHanded, '#6f273a')}">${S.leftHanded ? '✓ ' : ''}Left-handed mode</button>
          <button data-act="toggleNativeCamera" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(S.nativeCamera, '#6f273a')}">${S.nativeCamera ? '✓ ' : ''}Use native camera</button>
        </div>
        <div style="font-size:11.5px;color:#625852;margin-top:6px;line-height:1.45">Native camera: the shutter opens the iPhone camera app, so shots come back at full sensor quality.</div>
      </div>
      <div style="margin-top:16px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">Backup &amp; transfer</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button data-act="exportJSON" style="min-height:46px;padding:0 15px;border-radius:13px;background:#201a17;color:#fff;border:0;font-size:13.5px;font-weight:800">Export full backup</button>
          <button data-act="exportCSV" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(false, '#201a17')}">Export CSV</button>
          <label style="min-height:46px;padding:12px 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(false, '#201a17')};display:inline-flex;align-items:center;cursor:pointer">Import backup<input id="import-json" type="file" accept="application/json" style="display:none"></label>
        </div>
        <div style="font-size:11.5px;color:#625852;margin-top:8px;line-height:1.45">Export a full backup before and after each sourcing day — it carries every photo and voice note.</div>
      </div>
      <div style="margin-top:16px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">AI lookup</div>
        <input class="fld mono" data-input="aiKey" value="${esc(S.aiKey)}" placeholder="AI lookup API key (sk-ant-…)" autocomplete="off" autocapitalize="off" spellcheck="false" style="font-size:12px" />
        <div style="font-size:11.5px;color:#625852;margin-top:6px;line-height:1.45">Optional. With an Anthropic API key saved, company records get a “Fetch company bio” button — a short web-researched bio you verify yourself. The key stays on this phone and is never exported.</div>
      </div>
      <div style="margin-top:16px">
        <div style="font-size:10.5px;font-weight:800;letter-spacing:.08em;color:#9d7643;text-transform:uppercase;margin-bottom:8px">Device</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button data-act="signOut" style="min-height:46px;padding:0 15px;border-radius:13px;font-size:13.5px;font-weight:700;${chipStyle(false, '#201a17')}">Sign out on this device</button>
          <button data-act="eraseData" style="min-height:46px;padding:0 15px;border-radius:13px;border:1px solid #e0c4c0;background:#f8e7e5;color:#8b2d2d;font-size:13.5px;font-weight:800">Clear all data</button>
        </div>
        <div style="font-size:11.5px;color:#625852;margin-top:6px;line-height:1.45">Clear all data wipes every capture and company on this phone${S.user && S.user.pin ? ' — it asks for your PIN first' : ''}. Good for clearing test records before the trip.</div>
        <div class="mono" style="font-size:10.5px;color:#9d7643;margin-top:12px">Milana Source v1.0 · offline-first · OCR on device</div>
      </div>
    </div>
  </div>`;
}

/* ───────────────────────── Login / unlock ───────────────────────── */
function loginBg() {
  return 'background:radial-gradient(circle at 20% 10%, rgba(157,118,67,.24), transparent 34%), radial-gradient(circle at 88% 78%, rgba(111,39,58,.30), transparent 38%), #201a17';
}

function loginView() {
  return `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;${loginBg()}">
    <form id="login-form" style="width:min(400px,100%);background:#fffdf9;border-radius:24px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="color:#6f273a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">Your sourcing project</div>
      <h1 class="serif" style="margin:5px 0 8px;font-size:34px">Milana Source</h1>
      <p style="font-size:13px;color:#625852;line-height:1.5;margin:0 0 16px">Shoot the product, its label and the company card. Everything else waits for the evening.</p>
      <label style="display:block;font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin-bottom:7px">YOUR NAME</label>
      <input class="fld fld-strong" name="name" data-input="login.name" value="${esc(S.loginTmp.name)}" required placeholder="Damian" autocomplete="name" style="margin-bottom:13px">
      <label style="display:block;font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin-bottom:7px">PROJECT NAME</label>
      <input class="fld fld-strong" name="project" data-input="login.project" value="${esc(S.loginTmp.project)}" placeholder="My project" autocomplete="off" style="margin-bottom:13px">
      <label style="display:block;font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin-bottom:7px">ROLE</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:13px">
        ${['Owner', 'Builder', 'Designer', 'Advisor'].map(r => `<button type="button" data-act="pickRole" data-arg="${r}" style="min-height:44px;padding:0 15px;border-radius:999px;font-size:13.5px;font-weight:700;${chipStyle(S.loginRole === r, '#201a17')}">${r}</button>`).join('')}
      </div>
      <label style="display:block;font-size:11px;font-weight:800;letter-spacing:.08em;color:#625852;margin-bottom:7px">LOCAL PIN (OPTIONAL)</label>
      <input class="fld" name="pin" data-input="login.pin" value="${esc(S.loginTmp.pin)}" inputmode="numeric" maxlength="6" placeholder="4–6 digits" autocomplete="off" style="margin-bottom:16px">
      <button class="pf p98" style="width:100%;min-height:54px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:16px;font-weight:800">Enter the project</button>
      <p style="font-size:11.5px;color:#625852;line-height:1.5;margin:13px 0 0">Stored on this phone only. Install: Share → Add to Home Screen.</p>
    </form>
  </div>`;
}

function unlockView() {
  return `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;${loginBg()}">
    <form id="unlock-form" style="width:min(400px,100%);background:#fffdf9;border-radius:24px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="color:#6f273a;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase">${esc(projName())}</div>
      <h1 class="serif" style="margin:5px 0 8px;font-size:28px">Welcome back, ${esc(firstName())}</h1>
      <p style="font-size:13px;color:#625852;line-height:1.5;margin:0 0 16px">Enter the local PIN for this device.</p>
      <input class="fld fld-strong" name="pin" data-input="login.pin" inputmode="numeric" maxlength="6" required autofocus placeholder="PIN" autocomplete="off" style="margin-bottom:16px">
      <button class="pf p98" style="width:100%;min-height:54px;border:0;border-radius:16px;background:#6f273a;color:#fff;font-size:16px;font-weight:800">Unlock</button>
    </form>
  </div>`;
}

/* ───────────────────────── Camera overlay (chrome; video is attached by app.js) ───────────────────────── */
function cameraHTML() {
  const k = S.camera;
  if (!k) return '';
  const dr = S.draft;
  const nProd = dr.product.length;
  const sw = sessWord();
  const defs = slotDefs();
  const def = defs.find(d => d.k === k);
  const sessionCard = sessionCompany() ? sessionCompany().cardPhoto : null;
  const done = { product: nProd > 0, label: !!dr.label, card: !!(dr.card || sessionCard) };
  const camMeta = {
    product: nProd ? nProd + ' taken — shutter for another face' : 'step back — get the whole product',
    label: 'fill the frame with the spec sticker',
    card: 'card or signage — reused for every product at this ' + sw,
  };
  const lastShotRaw = k === 'product' ? (nProd ? dr.product[nProd - 1] : null) : k === 'label' ? dr.label : dr.card;
  const lastShotBlob = lastShotRaw ? photoThumb(lastShotRaw)
    : k === 'card' && sessionCompany() ? (sessionCompany().cardThumb || sessionCompany().cardPhoto) : null;
  const nextReady = k === 'product' && nProd > 0;
  return `<div class="cam${S.leftHanded ? ' flip' : ''}">
    <div id="cam-video-wrap" style="position:absolute;inset:0;overflow:hidden"></div>
    <div class="cam-top">
      <button data-act="cancelCam" style="min-height:44px;padding:0 12px;border:0;border-radius:13px;background:rgba(255,255,255,.14);color:#fff;font-size:14px;font-weight:700">Cancel</button>
      <div style="text-align:center">
        <div style="font-size:15px;font-weight:800">${def ? def.n + ' · ' + esc(def.label) : ''}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px">${esc(camMeta[k] || '')}</div>
      </div>
      <div style="display:flex;gap:6px;min-width:44px;justify-content:flex-end">
        ${defs.map(d => `<span style="width:8px;height:8px;border-radius:50%;background:${done[d.k] ? '#c9aa78' : d.k === k ? 'transparent' : 'rgba(255,255,255,.22)'};border:${d.k === k ? '2px solid #fff' : '2px solid transparent'}"></span>`).join('')}
      </div>
    </div>
    <div class="cam-marks"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
    <div class="cam-note">
      <div id="cam-fallback-note" class="mono hidden" style="display:none;color:rgba(255,255,255,.55);font-size:11.5px;text-align:center;line-height:1.6;background:rgba(22,17,15,.55);border-radius:12px;padding:10px 14px">${S.nativeCamera ? 'native camera on —<br>the shutter opens the iPhone camera' : 'camera not available here —<br>the shutter opens the system camera'}</div>
    </div>
    <div class="cam-ctrl">
      <div class="cam-side cam-side-a">
        <div style="width:48px;height:48px;border-radius:11px;border:${lastShotBlob ? '1px solid rgba(255,255,255,.4)' : '1px dashed rgba(255,255,255,.25)'};background:rgba(255,255,255,.06);position:relative;${lastShotBlob ? thumbBg(lastShotBlob) : ''}">
          ${k === 'product' && nProd > 0 ? `<span style="position:absolute;right:-6px;top:-6px;font-size:10px;font-weight:800;background:#c9aa78;color:#231a15;border-radius:999px;padding:3px 7px">×${nProd}</span>` : ''}
        </div>
      </div>
      <button data-act="snap" class="pf1 p90" style="width:78px;height:78px;border-radius:50%;border:4px solid #fff;background:transparent;display:grid;place-items:center;flex-shrink:0" aria-label="Shutter">
        <span style="width:60px;height:60px;border-radius:50%;background:#fff;display:block;pointer-events:none"></span>
      </button>
      <div class="cam-side cam-side-b">
        <button data-act="camNext" class="pf1 p95" style="min-height:48px;padding:0 14px;border:0;border-radius:999px;background:${nextReady ? '#c9aa78' : 'rgba(255,255,255,.10)'};color:${nextReady ? '#231a15' : 'rgba(255,255,255,.75)'};font-size:14px;font-weight:800;white-space:nowrap">${nextReady ? 'Next →' : 'Skip'}</button>
      </div>
    </div>
  </div>`;
}
