/* Company lookup — evening desk research on a confirmed company name.
   Level 1 needs no key: pre-filled searches that open in a new tab. Bing is
   used instead of Google because Google is blocked in mainland China.
   Level 2 is optional: with an Anthropic API key saved in Settings, a short
   company bio is fetched via the Claude API (web search enabled). */

const Lookup = {
  /* Pre-filled searches. 1688 and image search are indexed under the Chinese
     characters — a pinyin rendering finds nothing there — so those use the
     Chinese name whenever the card had one; Alibaba and Bing web use the
     English. */
  searchUrls(name, nameZh) {
    const en = encodeURIComponent(name || '');
    const zh = encodeURIComponent(nameZh || name || '');
    const out = [
      { label: '🔎 Bing search', url: 'https://www.bing.com/search?q=' + en },
      { label: '🖼 Bing images', url: 'https://www.bing.com/images/search?q=' + zh },
      { label: 'Alibaba suppliers', url: 'https://www.alibaba.com/trade/search?SearchText=' + en },
      { label: '1688.com', url: 'https://s.1688.com/company/company_search.htm?keywords=' + zh },
    ];
    if (nameZh && nameZh !== name) out.splice(1, 0, { label: '🔎 Bing 中文', url: 'https://www.bing.com/search?q=' + zh });
    return out;
  },

  _prompt(info) {
    const details = [
      'Company name: ' + info.name,
      info.nameZh && info.nameZh !== info.name ? 'Chinese name: ' + info.nameZh : '',
      info.contact ? 'Contact person: ' + info.contact : '',
      info.wechat ? 'WeChat / phone: ' + info.wechat : '',
      info.venue ? 'Met / found at: ' + info.venue : '',
    ].filter(Boolean).join('\n');
    return 'You are helping a home builder vet a building-products supplier. Research the company below with web search. '
      + 'Do not assume where the company is based — it may be in Australia, China or anywhere else; work that out from what you find.\n\n'
      + details + '\n\n'
      + 'Reply in plain text, no markdown, under 180 words, covering:\n'
      + '1. A 2-3 sentence bio of the company.\n'
      + '2. Main products.\n'
      + '3. Website, if you find an official site or storefront.\n'
      + '4. Trust signals (verified-supplier status, certifications, reviews, years trading).\n'
      + '5. Anything a buyer should check before ordering.\n'
      + 'If you cannot find the company, or several companies share the name, say so plainly rather than guessing.';
  },

  /* One Claude API call (claude-haiku, web search on). Throws with a
     human-readable message on any failure so the caller can queue a retry.
     A 30 s timeout: on networks where the host is blackholed the request
     would otherwise hang forever with the button stuck on "Looking up…". */
  TIMEOUT_MS: 30000,
  _inflight: null,
  cancel() { if (this._inflight) { try { this._inflight.abort(); } catch (e) { /* done */ } } },
  /* Where the service is not reachable at all (mainland-China networks block
     it) the owner needs to hear "roaming or VPN", not a raw network error. */
  UNREACHABLE: 'The lookup service could not be reached from this network — in mainland China it needs roaming data or a VPN. The Bing, Alibaba and 1688 buttons still work.',
  async _call(apiKey, messages, ac) {
    // a smart quote or a space pasted along with the key is the usual cause
    // of an "invalid header" failure that looks like a network problem
    if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new Error('The API key contains a character that cannot be sent (a space or a curly quote, usually) — re-paste it in Settings.');
    const timer = setTimeout(() => ac.abort(), this.TIMEOUT_MS);
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ac.signal,
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
          messages,
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('The lookup timed out — ' + this.UNREACHABLE);
      throw new Error(navigator.onLine === false ? 'No signal — try again when you are back online.' : this.UNREACHABLE);
    }
    clearTimeout(timer);
    if (!res.ok) {
      let msg = 'The lookup failed (HTTP ' + res.status + ').';
      try {
        const err = await res.json();
        if (err && err.error && err.error.message) msg = err.error.message;
      } catch (e) { /* keep the status message */ }
      if (res.status === 400) msg = 'The lookup request was rejected: ' + String(msg).slice(0, 100);
      if (res.status === 401) msg = 'The API key was not accepted — check it in Settings.';
      if (res.status === 403) msg = 'The lookup service is not available from this network or region, or the key is not allowed in a browser — try roaming data or a VPN, and check the key.';
      if (res.status === 429) msg = 'The lookup service is rate-limited — try again in a minute.';
      if (res.status >= 500) msg = 'The lookup service had a hiccup — try again.';
      throw new Error(msg);
    }
    return res.json();
  },

  /* The answer, without the "I'll research this company…" preamble that
     precedes the searches: keep the text written after the last search
     result when there is any, else everything. */
  _answerText(content) {
    const blocks = Array.isArray(content) ? content : [];
    let lastSearch = -1;
    blocks.forEach((b, i) => { if (b && (b.type === 'web_search_tool_result' || b.type === 'server_tool_use')) lastSearch = i; });
    const after = blocks.slice(lastSearch + 1).filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
    if (after) return after;
    return blocks.filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
  },
  async fetchBio(apiKey, info) {
    const ac = new AbortController();
    this._inflight = ac;
    const messages = [{ role: 'user', content: this._prompt(info) }];
    try {
      let data = await this._call(apiKey, messages, ac);
      // a long search can be handed back mid-way ("pause_turn"): send the
      // partial turn back so the answer is finished, a couple of times at most
      for (let i = 0; i < 2 && data && data.stop_reason === 'pause_turn' && Array.isArray(data.content); i++) {
        messages.push({ role: 'assistant', content: data.content });
        data = await this._call(apiKey, messages, ac);
      }
      const text = this._answerText(data.content);
      if (!text) throw new Error('The lookup came back empty — try again.');
      return data.stop_reason === 'max_tokens' ? text + ' …' : text;
    } finally {
      this._inflight = null;
    }
  },
};
