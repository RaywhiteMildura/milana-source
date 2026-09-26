/* Chinese OCR + glossary: a rendered bilingual business card and a bilingual
   spec label must read with English kept English, Chinese kept beside, the
   contact transliterated with the surname split, and the WeChat id found. */
const { URL, launch, loadCJKFont, makeReporter } = require('./harness');

(async () => {
  const { browser, page } = await launch({ camera: false });
  const { errors, check, section } = makeReporter();
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(URL);
  await page.waitForSelector('#login-form');
  await loadCJKFont(page);

  section('Chinese → English glossary + pinyin');
  const zh = await page.evaluate(() => ({
    co1: ZH.translate('佛山市金兰木业有限公司'),
    co2: ZH.translate('厦门万利石材有限公司'),
    co3: ZH.translate('广东顺德华艺灯饰照明股份有限公司'),
    role: ZH.translate('销售经理'),
    role2: ZH.translate('外贸经理 李小明', { person: true }),
    spec: ZH.translate('规格 800×800mm 抛光'),
    mixed: ZH.translate('Taj Mahal 岩板 柔光'),
    latin: ZH.translate('Foshan Jinlan Co., Ltd'),
    script: [ZH.scriptOf('Hello World'), ZH.scriptOf('佛山市'), ZH.scriptOf('123')],
  }));
  Object.entries(zh).forEach(([k, v]) => console.log(' ', k.padEnd(6), Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v.en) + '   [zh: ' + (v.zh || '—') + ']'));
  check(zh.co1.en === 'Foshan Jinlan Wood Industry Co., Ltd', 'company glossary: 佛山市金兰木业有限公司');
  check(zh.co2.en === 'Xiamen Wanli Stone Co., Ltd', 'company glossary: 厦门万利石材有限公司');
  check(zh.role.en === 'Sales Manager', 'role glossary: 销售经理');
  check(/Li Xiaoming/.test(zh.role2.en), 'person name transliterated with surname split: ' + zh.role2.en);
  check(zh.spec.en === 'Size 800×800mm Polished', 'spec glossary keeps numbers and units');
  check(zh.mixed.en === 'Taj Mahal Sintered Stone Soft Matt', 'mixed-script line translated in place');
  check(zh.latin.en === 'Foshan Jinlan Co., Ltd' && !zh.latin.translated, 'Latin text passes through untouched');
  check(JSON.stringify(zh.script) === '["latin","cjk","neutral"]', 'script detection');

  section('card / label parsing rules (no OCR)');
  const rules = await page.evaluate(() => ({
    wechatId: OCR.parseCard(['Shenzhen Brightway Lighting Co., Ltd', 'Amy Chen  Sales Manager', 'WeChat ID: brightway_amy', 'Tel: 0755-2233 4455']).wechat.value,
    wechatWa: OCR.parseCard(['Foshan Lido Ceramics Co., Ltd', 'Kevin Wu | Export Manager', 'WeChat/WhatsApp: +86 135 0000 1234']).wechat.value,
    wx: OCR.parseCard(['佛山市金兰木业有限公司', '李小明 销售经理', '微信号：jinlan_lee88']).wechat.value,
    contactWa: OCR.parseCard(['Foshan Lido Ceramics Co., Ltd', 'Kevin Wu | Export Manager', 'WeChat/WhatsApp: +86 135 0000 1234']).contact.value,
    iso: OCR.parseLabel(['CALACATTA GOLD', 'ISO 9001 certified', 'Made in China 2024-05', 'Model: TX-2040', 'Size: 1200 x 600 mm']),
    noLabel: OCR.parseLabel(['Aqua Shield Sealer', 'ISO 9001', 'AS 3740', 'Batch 2023-11', 'AQS-500 · 5 L']),
    delCo: OCR.parseCard(['Tel: 0755-2233 4455', 'sales@acme.com']).company.value,
  }));
  check(rules.wechatId === 'brightway_amy', '"WeChat ID:" form found — ' + rules.wechatId);
  check(/135 0000 1234/.test(rules.wechatWa), '"WeChat/WhatsApp:" number found — ' + rules.wechatWa);
  check(rules.wx === 'jinlan_lee88', '微信号 form found — ' + rules.wx);
  check(rules.contactWa === 'Kevin Wu', 'contact stripped of role and separator — ' + rules.contactWa);
  check(rules.iso.code.value === 'TX-2040', 'labelled model wins over ISO 9001 / a date — ' + rules.iso.code.value);
  check(rules.iso.size.value === '1200 × 600 mm', 'size read beside standards — ' + rules.iso.size.value);
  check(rules.noLabel.code.value === 'AQS-500', 'standards and batch dates are not model codes — ' + rules.noLabel.code.value);
  check(rules.delCo === '', 'a card with only a phone and an email gets no company guess');

  const makeImg = kind => page.evaluate(async (kind) => {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 850;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#111';
    if (kind === 'card') {
      x.font = 'bold 62px TestSC, sans-serif'; x.fillText('佛山市金兰木业有限公司', 70, 130);
      x.font = 'bold 46px Arial'; x.fillText('FOSHAN JINLAN WOOD CO., LTD', 70, 215);
      x.font = '48px TestSC, sans-serif'; x.fillText('李小明  销售经理', 70, 330);
      x.font = '42px Arial'; x.fillText('Sales Manager', 70, 400);
      x.font = '40px Arial';
      x.fillText('Tel: +86 138 2890 7766', 70, 500);
      x.fillText('WeChat: jinlan_lee88', 70, 570);
      x.fillText('Email: sales@jinlanwood.com', 70, 640);
      x.font = '36px TestSC, sans-serif'; x.fillText('地址：广东省佛山市顺德区乐从镇', 70, 730);
    } else {
      x.font = 'bold 64px TestSC, sans-serif'; x.fillText('岩板 大板', 70, 130);
      x.font = 'bold 56px Arial'; x.fillText('CALACATTA VIOLA', 70, 230);
      x.font = '48px Arial';
      x.fillText('Model: MB-2208', 70, 340);
      x.fillText('Size: 3200 x 1600 x 12 mm', 70, 430);
      x.font = '44px TestSC, sans-serif';
      x.fillText('表面：柔光', 70, 540);
      x.fillText('产地：广东佛山', 70, 620);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    window.__img = window.__img || {};
    window.__img[kind] = blob;
  }, kind);
  await makeImg('card');
  await makeImg('label');

  section('OCR: bilingual business card');
  const t0 = Date.now();
  const card = await page.evaluate(async () => {
    const lines = await OCR.readLines(window.__img.card);
    return { lines: lines.map(l => l.lang + '|' + Math.round(l.conf) + '| ' + l.text), fields: OCR.parseCard(lines) };
  });
  card.lines.forEach(l => console.log('    ' + l));
  console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  check(/FOSHAN JINLAN WOOD/i.test(card.fields.company.value), 'company: printed English preferred — ' + card.fields.company.value);
  check(/有限公司$/.test(card.fields.company.zh) && /[一-鿿]/.test(card.fields.company.zh), 'company: Chinese kept beside — ' + card.fields.company.zh);
  check(/Li Xiaoming/.test(card.fields.contact.value), 'contact transliterated — ' + card.fields.contact.value);
  check(card.fields.wechat.value === 'jinlan_lee88', 'WeChat id found — ' + card.fields.wechat.value);
  check(!card.lines.some(l => /^eng\|.*[一-鿿]/.test(l)), 'no Chinese asserted by the English model');

  section('OCR: bilingual spec label');
  const label = await page.evaluate(async () => {
    const lines = await OCR.readLines(window.__img.label);
    return { lines: lines.map(l => l.lang + '|' + Math.round(l.conf) + '| ' + l.text), fields: OCR.parseLabel(lines) };
  });
  label.lines.forEach(l => console.log('    ' + l));
  check(/CALACATTA VIOLA/i.test(label.fields.pname.value), 'product name: Latin name preferred over the Chinese category — ' + label.fields.pname.value);
  check(/板/.test(label.fields.pname.zh), 'product name: Chinese line kept beside — ' + label.fields.pname.zh);
  check(label.fields.code.value === 'MB-2208', 'model code — ' + label.fields.code.value);
  check(label.fields.size.value === '3200 × 1600 × 12 mm', 'size normalised — ' + label.fields.size.value);

  console.log('\nERRORS (' + errors.length + '):');
  errors.forEach(e => console.log('  ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
