/* Company lookup — evening desk research on a confirmed company name.
   Level 1 needs no key: pre-filled searches that open in a new tab. Bing is
   used instead of Google because Google is blocked in mainland China.
   Level 2 is optional: with an Anthropic API key saved in Settings, a short
   company bio is fetched via the Claude API (web search enabled). */

const Lookup = {
  searchUrls(name) {
    const q = encodeURIComponent(name);
    return [
      { label: '🔎 Bing search', url: 'https://www.bing.com/search?q=' + q },
      { label: '🖼 Bing images', url: 'https://www.bing.com/images/search?q=' + q },
      { label: 'Alibaba suppliers', url: 'https://www.alibaba.com/trade/search?SearchText=' + q },
      { label: '1688.com', url: 'https://s.1688.com/company/company_search.htm?keywords=' + q },
    ];
  },

  _prompt(info) {
    const details = [
      'Company name: ' + info.name,
      info.nameZh && info.nameZh !== info.name ? 'Chinese name: ' + info.nameZh : '',
      info.contact ? 'Contact person: ' + info.contact : '',
      info.wechat ? 'WeChat / phone: ' + info.wechat : '',
      info.venue ? 'Met at: ' + info.venue + ' (China sourcing trip)' : '',
    ].filter(Boolean).join('\n');
    return 'You are helping a home builder vet a Chinese building-products supplier met on a sourcing trip. Research the company below with web search.\n\n'
      + details + '\n\n'
      + 'Reply in plain text, no markdown, under 180 words, covering:\n'
      + '1. A 2-3 sentence bio of the company.\n'
      + '2. Main products.\n'
      + '3. Website, if you find an official site or storefront.\n'
      + '4. Verified-supplier signals (Alibaba verified/Gold Supplier years, certifications).\n'
      + '5. Anything a buyer should check before ordering.\n'
      + 'If you cannot find the company, say so plainly rather than guessing.';
  },

  /* One Claude API call (claude-haiku, web search on). Throws with a
     human-readable message on any failure so the caller can queue a retry. */
  async fetchBio(apiKey, info) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: [{ role: 'user', content: this._prompt(info) }],
        }),
      });
    } catch (err) {
      throw new Error('No connection to the lookup service — it will retry.');
    }
    if (!res.ok) {
      let msg = 'The lookup failed (HTTP ' + res.status + ').';
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (e) { /* keep the status message */ }
      if (res.status === 401) msg = 'The API key was not accepted — check it in Settings.';
      if (res.status === 429) msg = 'The lookup service is rate-limited — try again in a minute.';
      if (res.status >= 500) msg = 'The lookup service had a hiccup — try again.';
      throw new Error(msg);
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('The lookup came back empty — try again.');
    return text;
  },
};
