/* Chinese → English for OCR results.
   Two layers, both on-device and offline:
     1. a trade glossary for the words that actually appear on building-materials
        business cards and spec labels (company suffixes, cities, roles, finishes);
     2. pinyin (vendored pinyin-pro) for proper nouns the glossary can't know.
   The original Chinese is never thrown away — every translation returns both,
   so a wrong reading can always be checked against the characters. */

const ZH = {
  /* Longest-match glossary. Keys are matched greedily, longest first. */
  TERMS: {
    // ── company suffixes / legal forms ──
    '股份有限公司': 'Co., Ltd', '有限责任公司': 'Co., Ltd', '有限公司': 'Co., Ltd',
    '集团有限公司': 'Group Co., Ltd', '集团': 'Group', '公司': 'Company',
    '实业': 'Industrial', '贸易': 'Trading', '进出口': 'Import & Export',
    '科技': 'Technology', '工贸': 'Industry & Trade', '商行': 'Trading Firm',
    '工厂': 'Factory', '制造': 'Manufacturing', '厂': 'Factory',
    '销售部': 'Sales Department', '事业部': 'Division', '分公司': 'Branch',
    '展厅': 'Showroom', '展位': 'Booth', '门店': 'Store',

    // ── trades / product categories ──
    '建筑材料': 'Building Materials', '建材': 'Building Materials',
    '装饰材料': 'Decorative Materials', '装饰': 'Decoration', '装修': 'Renovation',
    '陶瓷': 'Ceramics', '瓷砖': 'Tiles', '岩板': 'Sintered Stone', '大板': 'Large Slab',
    '微晶石': 'Crystallised Stone', '通体': 'Full Body',
    '石材': 'Stone', '大理石': 'Marble', '花岗岩': 'Granite', '石英石': 'Quartz',
    '人造石': 'Engineered Stone', '天然石': 'Natural Stone', '荒料': 'Block',
    '木业': 'Wood Industry', '木门': 'Wooden Doors', '实木': 'Solid Wood',
    '板材': 'Panels', '饰面板': 'Veneer Panels', '贴面': 'Veneer',
    '门窗': 'Doors & Windows', '门业': 'Door', '窗业': 'Window',
    '断桥铝': 'Thermal Break Aluminium', '铝业': 'Aluminium', '系统窗': 'System Windows',
    '玻璃': 'Glass', '不锈钢': 'Stainless Steel', '金属': 'Metal',
    '五金': 'Hardware', '拉手': 'Pulls', '铰链': 'Hinges', '锁具': 'Locks',
    '灯饰': 'Lighting', '照明': 'Lighting', '灯具': 'Light Fittings',
    '卫浴': 'Bathroom', '洁具': 'Sanitaryware', '龙头': 'Tapware', '浴缸': 'Bathtub',
    '家具': 'Furniture', '家私': 'Furniture', '家居': 'Home', '软装': 'Soft Furnishings',
    '橱柜': 'Cabinetry', '衣柜': 'Wardrobes', '定制': 'Custom', '全屋定制': 'Whole-home Custom',
    '地板': 'Flooring', '涂料': 'Paint', '油漆': 'Paint', '墙布': 'Wallcovering',
    '电器': 'Appliances', '厨电': 'Kitchen Appliances', '智能': 'Smart',
    '幕墙': 'Curtain Wall', '吊顶': 'Ceiling', '楼梯': 'Staircase',

    // ── roles / titles ──
    '董事长': 'Chairman', '总裁': 'President', '总经理': 'General Manager',
    '副总经理': 'Deputy General Manager', '销售总监': 'Sales Director',
    '营销总监': 'Marketing Director', '总监': 'Director',
    '外贸经理': 'Export Manager', '出口经理': 'Export Manager',
    '销售经理': 'Sales Manager', '业务经理': 'Business Manager',
    '客户经理': 'Account Manager', '区域经理': 'Regional Manager',
    '项目经理': 'Project Manager', '厂长': 'Factory Manager', '经理': 'Manager',
    '主管': 'Supervisor', '业务员': 'Sales Representative', '销售': 'Sales',
    '外贸': 'Export', '业务': 'Business', '工程师': 'Engineer',
    '设计师': 'Designer', '设计': 'Design', '助理': 'Assistant', '顾问': 'Consultant',

    // ── card labels ──
    '联系人': 'Contact', '姓名': 'Name', '手机号码': 'Mobile', '手机': 'Mobile',
    '电话': 'Tel', '座机': 'Landline', '传真': 'Fax', '邮箱': 'Email',
    '电子邮箱': 'Email', '邮编': 'Postcode', '地址': 'Address', '厂址': 'Factory Address',
    '网址': 'Website', '微信': 'WeChat', '微信号': 'WeChat ID', '公众号': 'WeChat Official',
    '抖音': 'Douyin', '阿里巴巴': 'Alibaba', '客服': 'Customer Service',

    // ── spec-label words ──
    '产品名称': 'Product Name', '品名': 'Product', '名称': 'Name',
    '规格': 'Size', '尺寸': 'Dimensions', '型号': 'Model', '货号': 'Item No.',
    '编号': 'Code', '系列': 'Series', '材质': 'Material', '材料': 'Material',
    '颜色': 'Colour', '色号': 'Colour Code', '表面': 'Surface', '工艺': 'Finish',
    '厚度': 'Thickness', '长度': 'Length', '宽度': 'Width', '高度': 'Height',
    '重量': 'Weight', '数量': 'Quantity', '单价': 'Unit Price', '价格': 'Price',
    '产地': 'Origin', '等级': 'Grade', '批号': 'Batch', '密度': 'Density',
    '包装': 'Packing', '每箱': 'Per Carton', '平方米': 'sqm', '片': 'pcs',

    // ── finishes / faces ──
    '抛光': 'Polished', '光面': 'Polished', '哑光': 'Matt', '亚光': 'Matt',
    '柔光': 'Soft Matt', '细面': 'Fine Finish', '磨面': 'Honed', '哑面': 'Matt',
    '荔枝面': 'Bush-hammered', '火烧面': 'Flamed', '拉丝': 'Brushed',
    '喷砂': 'Sandblasted', '仿古': 'Antique', '木纹': 'Wood Grain',
    '岩石纹': 'Stone Grain', '大理石纹': 'Marble Grain', '纹理': 'Grain',

    // ── colours ──
    '白色': 'White', '黑色': 'Black', '灰色': 'Grey', '米黄': 'Beige',
    '米白': 'Off-white', '金色': 'Gold', '银色': 'Silver', '古铜': 'Bronze',
    '咖啡色': 'Coffee', '棕色': 'Brown', '绿色': 'Green', '蓝色': 'Blue',
    '香槟': 'Champagne', '玫瑰金': 'Rose Gold', '胡桃': 'Walnut', '橡木': 'Oak',

    // ── manufacturing cities / districts commonly on cards ──
    '广东省': 'Guangdong', '福建省': 'Fujian', '浙江省': 'Zhejiang',
    '佛山市': 'Foshan', '佛山': 'Foshan', '广州市': 'Guangzhou', '广州': 'Guangzhou',
    '深圳市': 'Shenzhen', '深圳': 'Shenzhen', '东莞市': 'Dongguan', '东莞': 'Dongguan',
    '中山市': 'Zhongshan', '中山': 'Zhongshan', '江门': 'Jiangmen', '珠海': 'Zhuhai',
    '惠州': 'Huizhou', '汕头': 'Shantou', '潮州': 'Chaozhou', '云浮': 'Yunfu',
    '顺德': 'Shunde', '南海': 'Nanhai', '禅城': 'Chancheng', '三水': 'Sanshui',
    '厦门市': 'Xiamen', '厦门': 'Xiamen', '泉州': 'Quanzhou', '水头': 'Shuitou',
    '南安': 'Nanan', '莆田': 'Putian', '福州': 'Fuzhou', '晋江': 'Jinjiang',
    '上海市': 'Shanghai', '上海': 'Shanghai', '北京': 'Beijing', '杭州': 'Hangzhou',
    '宁波': 'Ningbo', '义乌': 'Yiwu', '温州': 'Wenzhou', '嘉兴': 'Jiaxing',
    '临沂': 'Linyi', '淄博': 'Zibo', '唐山': 'Tangshan', '成都': 'Chengdu',
    '重庆': 'Chongqing', '天津': 'Tianjin', '青岛': 'Qingdao',
    '市': 'City', '省': 'Province', '区': 'District', '镇': 'Town', '村': 'Village',
    '路': 'Road', '街': 'Street', '号': 'No.', '栋': 'Building', '层': 'Floor',
    '工业园': 'Industrial Park', '产业园': 'Industrial Park', '开发区': 'Development Zone',
  },

  _keys: null,
  _keysByLen() {
    if (!this._keys) {
      this._keys = Object.keys(this.TERMS).sort((a, b) => b.length - a.length);
      this._maxLen = this._keys[0].length;
    }
    return this._keys;
  },

  CJK: /[㐀-䶿一-鿿豈-﫿]/,
  hasCJK(s) { return this.CJK.test(String(s || '')); },

  /* proportion of "meaningful" chars that are CJK vs latin */
  scriptOf(s) {
    const str = String(s || '');
    let cjk = 0, latin = 0;
    for (const ch of str) {
      if (this.CJK.test(ch)) cjk++;
      else if (/[A-Za-z]/.test(ch)) latin++;
    }
    if (!cjk && !latin) return 'neutral';
    return cjk >= latin ? 'cjk' : 'latin';
  },

  /* The 100 or so surnames that cover most cards. Only consulted for people's
     names (person:true) — 金兰 is a brand, 金 as a surname would break it. */
  SURNAMES: ('王李张刘陈杨黄赵周吴徐孙朱马胡郭林何高梁郑罗宋谢唐韩曹许邓萧冯曾程蔡彭潘袁于董余苏'
    + '叶吕魏蒋田杜丁沈姜范江傅钟卢汪戴崔任陆廖姚方金邱夏谭韦贾邹石熊孟秦阎薛侯雷白龙段郝孔邵史毛'
    + '常万顾赖武康贺严尹钱施牛洪龚').split(''),
  SURNAMES2: ['欧阳', '司马', '上官', '诸葛', '司徒', '夏侯'],

  _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; },

  _syllables(run) {
    try {
      if (typeof pinyinPro === 'undefined') return [];
      return pinyinPro.pinyin(run, { toneType: 'none', type: 'array' }).filter(p => /^[a-z]+$/i.test(p));
    } catch (err) { return []; }
  },

  _pinyin(run) {
    const parts = this._syllables(run);
    return parts.length ? this._cap(parts.join('')) : '';
  },

  /* "李小明" → "Li Xiaoming" (surname kept as its own word) */
  _pinyinName(run) {
    const parts = this._syllables(run);
    if (!parts.length) return '';
    if (run.length >= 3 && run.length <= 4 && this.SURNAMES2.includes(run.slice(0, 2)) && parts.length > 2) {
      return this._cap(parts.slice(0, 2).join('')) + ' ' + this._cap(parts.slice(2).join(''));
    }
    if (run.length >= 2 && run.length <= 4 && this.SURNAMES.includes(run[0]) && parts.length > 1) {
      return this._cap(parts[0]) + ' ' + this._cap(parts.slice(1).join(''));
    }
    return this._cap(parts.join(''));
  },

  /* Greedy longest-match over the glossary; unmatched Chinese runs become pinyin.
     opts.person splits a leading surname so people read as "Li Xiaoming". */
  translate(text, opts = {}) {
    const src = String(text || '').trim();
    if (!src) return { en: '', zh: '', translated: false };
    if (!this.hasCJK(src)) return { en: src, zh: '', translated: false };

    this._keysByLen();
    const out = [];
    let run = '';           // unmatched CJK accumulating for pinyin
    let hit = false;
    const flushRun = () => {
      if (!run) return;
      const py = opts.person ? this._pinyinName(run) : this._pinyin(run);
      out.push(py || run);
      run = '';
    };

    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (!this.CJK.test(ch)) {
        flushRun();
        out.push(ch);
        i += 1;
        continue;
      }
      let matched = null;
      for (let len = Math.min(this._maxLen, src.length - i); len >= 1; len--) {
        const slice = src.slice(i, i + len);
        if (this.TERMS[slice]) { matched = { slice, en: this.TERMS[slice] }; break; }
      }
      if (matched) {
        flushRun();
        out.push(' ' + matched.en + ' ');
        hit = true;
        i += matched.slice.length;
      } else {
        run += ch;
        i += 1;
      }
    }
    flushRun();

    let en = out.join('')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,，.。:：;；)）])/g, '$1')
      .replace(/([(（])\s+/g, '$1')
      .replace(/\s*,\s*Ltd/g, ', Ltd')
      .trim();
    // "Foshan City Jinlan" reads better without a bare trailing "City"
    en = en.replace(/\bCity\b\s+/g, ' ').replace(/\s+/g, ' ').trim();
    // 灯饰 + 照明 both mean Lighting — don't say it twice
    en = en.replace(/\b(\w[\w'-]*)(\s+\1\b)+/gi, '$1').trim();
    return { en, zh: src, translated: hit || en !== src };
  },

  /* Convenience: English preferred, Chinese kept for checking. */
  pair(text, opts) {
    const t = this.translate(text, opts);
    return { value: t.en || String(text || ''), zh: t.zh, translated: t.translated };
  },
};
