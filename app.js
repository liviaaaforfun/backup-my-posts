(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const PRESETS = ['#000000', '#5f7d97', '#b0607a', '#6d8b5e', '#8a6bb0', '#c07a3c', '#3f8f8f'];

  let S = null; // { entries, posts, threads, profile, settings }
  let shown = 30;
  const urlCache = new Map();
  const LIMIT = 25 * 1024 * 1024; // Cloudflare／GitHub 單一檔案上限
  const sizeOf = m => m.rep ? m.rep.size : ((S.entries.get(m.path) || {}).usize || 0);
  const isBig = m => sizeOf(m) > LIMIT;
  const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';

  // ---------- 匯入 ----------
  const drop = $('#drop'), fileIn = $('#file'), status = $('#import-status');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => start([...e.dataTransfer.files]));
  fileIn.addEventListener('change', () => start([...fileIn.files]));

  async function start(files) {
    files = files.filter(f => /\.zip$/i.test(f.name));
    if (!files.length) { status.textContent = '請選擇 Meta 匯出的 zip 檔。'; status.className = 'status err'; return; }
    status.className = 'status';
    try {
      const d = await Importer.importAll(files, m => (status.textContent = m));
      S = { ...d, settings: Object.assign({ accent: '#000000', bg: null, others: false }, d.settings || {}), custom: { avatar: null } };
      if (d.bgPath) S.settings.bg = await dataUrl(d.bgPath);
      if (!d.resumed) restore();
      if (!S.custom.avatar && S.profile.avatar) S.custom.avatarUrl = await blobUrl(S.profile.avatar.entry);
      openEditor();
    } catch (e) {
      console.error(e);
      status.textContent = e.message || String(e); status.className = 'status err';
    }
  }

  // ---------- 儲存（瀏覽器本機） ----------
  const key = () => 'tbk:' + (S.profile.username || 'me');
  function save() {
    schedulePreview();
    try {
      const sp = [];
      Object.values(S.posts).forEach(p => p.media.forEach((m, k) => { if (m.spoiler) sp.push(p.id + ':' + k); }));
      localStorage.setItem(key(), JSON.stringify({
        threads: S.threads.map(t => ({ id: t.id, items: t.items, tag: t.tag, hidden: t.hidden, kind: t.kind, replyTo: t.replyTo })),
        spoilers: sp, links: Object.fromEntries(Object.values(S.posts).flatMap(p => p.media.map((m, k) => [p.id + ':' + k, m.link]).filter(x => x[1]))), profile: { name: S.profile.name, username: S.profile.username, bio: S.profile.bio },
        settings: S.settings, avatar: S.custom.avatar,
      }));
    } catch (e) { /* 空間不足時略過，不影響使用 */ }
  }
  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key()) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;
    const ids = new Set(Object.keys(S.posts));
    const all = saved.threads.flatMap(t => t.items);
    if (all.length !== ids.size || !all.every(i => ids.has(i))) return; // 匯出檔不同，不套用
    S.threads = saved.threads;
    const sp = new Set(saved.spoilers || []);
    const ln = saved.links || {};
    Object.values(S.posts).forEach(p => p.media.forEach((m, k) => { m.spoiler = sp.has(p.id + ':' + k); if (ln[p.id + ':' + k]) m.link = ln[p.id + ':' + k]; }));
    Object.assign(S.profile, saved.profile || {});
    Object.assign(S.settings, saved.settings || {});
    S.custom.avatar = saved.avatar || null;
  }

  // ---------- 編輯畫面 ----------
  function openEditor() {
    $('#step-import').hidden = true; $('#step-edit').hidden = false;
    $('#f-name').value = S.profile.name; $('#f-user').value = S.profile.username; $('#f-bio').value = S.profile.bio;
    $('#f-accent').value = S.settings.accent; $('#f-others').checked = S.settings.others; $('#f-noindex').checked = S.settings.noindex !== false;
    $('#presets').innerHTML = PRESETS.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('');
    paintAvatar(); paintBg(); render();
  }
  function paintAvatar() { const src = S.custom.avatar || S.custom.avatarUrl || ''; $('#avatar-preview').src = src; }
  function paintBg() {
    const b = $('#bg-preview'); b.hidden = !S.settings.bg; $('#bg-opts').hidden = !S.settings.bg;
    if (S.settings.bg) b.src = S.settings.bg;
    $('#bg-fit').value = S.settings.bgFit || 'cover'; $('#bg-pos').value = S.settings.bgPos || 'top';
    $('#bg-op').value = Math.round((S.settings.bgOp ?? 0.18) * 100);
  }
  // 背景圖的 CSS（預覽與正式網站共用）
  function bgCss(url) {
    const fit = S.settings.bgFit || 'cover', pos = S.settings.bgPos || 'top', op = S.settings.bgOp ?? 0.18;
    const size = fit === 'repeat' ? 'auto' : fit === 'width' ? '100% auto' : fit;
    const rep = fit === 'repeat' ? 'repeat' : 'no-repeat';
    return `.bg{background-image:url(${url});background-size:${size};background-repeat:${rep};background-position:center ${pos};opacity:${op}}` +
      (fit === 'width' ? 'html{position:relative;min-height:100%}.bg{position:absolute}' : '');
  }
  $('#bg-fit').addEventListener('change', e => { S.settings.bgFit = e.target.value; save(); });
  $('#bg-pos').addEventListener('change', e => { S.settings.bgPos = e.target.value; save(); });
  $('#bg-op').addEventListener('input', e => { S.settings.bgOp = +e.target.value / 100; save(); });

  $('#f-name').addEventListener('input', e => { S.profile.name = e.target.value; save(); });
  $('#f-user').addEventListener('input', e => { S.profile.username = e.target.value.replace(/^@/, ''); save(); });
  $('#f-bio').addEventListener('input', e => { S.profile.bio = e.target.value; save(); });
  $('#f-accent').addEventListener('input', e => { S.settings.accent = e.target.value; save(); });
  $('#presets').addEventListener('click', e => { const c = e.target.dataset.c; if (c) { S.settings.accent = c; $('#f-accent').value = c; save(); } });
  $('#f-others').addEventListener('change', e => { S.settings.others = e.target.checked; save(); render(); });
  $('#f-noindex').addEventListener('change', e => { S.settings.noindex = e.target.checked; save(); });
  $('#avatar-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; S.custom.avatar = await shrink(f, 400, 'image/jpeg'); e.target.value = ''; paintAvatar(); save(); });
  $('#bg-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; S.settings.bg = await shrink(f, 1800, 'image/jpeg'); e.target.value = ''; paintBg(); save(); });
  $('#bg-clear').addEventListener('click', () => { S.settings.bg = null; paintBg(); save(); });
  $('#q').addEventListener('input', () => { shown = 30; render(); });
  $('#show').addEventListener('change', () => { shown = 30; render(); });
  $('#more').addEventListener('click', () => { shown += 30; render(); });

  const included = t => !t.hidden && (t.kind === 'post' || S.settings.others);

  function filtered() {
    const q = $('#q').value.trim().toLowerCase(), mode = $('#show').value;
    return S.threads.filter(t => {
      if (mode === 'visible' && !included(t)) return false;
      if (mode === 'hidden' && !t.hidden) return false;
      if (mode === 'reply' && t.kind !== 'reply') return false;
      if (mode === 'big' && !t.items.some(i => S.posts[i].media.some(m => isBig(m) || m.rep))) return false;
      if (mode === 'new' && !(t.isNew || t.items.some(i => S.posts[i].isNew))) return false;
      if (mode !== 'reply' && t.kind === 'reply' && !S.settings.others) return false;
      if (q && !t.items.some(i => (S.posts[i].text + '\n' + (S.posts[i].lt || '')).toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function render() {
    const list = filtered();
    const inc = S.threads.filter(included);
    const nImg = inc.reduce((a, t) => a + t.items.reduce((b, i) => b + S.posts[i].media.length, 0), 0);
    const newest = Math.max(0, ...Object.values(S.posts).map(p => p.t));
    const d = new Date(newest * 1000), ds = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    $('#summary').innerHTML = `<div class="stat"><b>${inc.length}</b><span>串貼文</span></div><div class="stat"><b>${nImg}</b><span>個圖片／影片</span></div>` +
      (S.resumed ? `<div class="stat new"><b>+${S.newCount}</b><span>本次新增</span></div>` : '') +
      `<div class="datetag"><span class="d"><svg class="i" width="15" height="15"><use href="#i-cal"/></svg>資料到 ${ds}</span>下次匯出選這天之後即可</div>`;
    const tags = [...new Set(S.threads.map(t => t.tag).filter(Boolean))];
    $('#list').innerHTML = `<datalist id="tag-list">${tags.map(t => `<option value="${esc(t)}">`).join('')}</datalist>` +
      list.slice(0, shown).map(card).join('') + (list.length ? '' : '<p class="tip">沒有符合的貼文。</p>');
    $('#more').hidden = list.length <= shown;
    observeThumbs();
  }

  function card(t) {
    const first = S.posts[t.items[0]];
    const items = t.items.map((id, i) => {
      const p = S.posts[id];
      const thumbs = p.media.map((m, k) => `<button type="button" class="thumb${m.spoiler ? ' sp' : ''}" data-post="${id}" data-k="${k}" data-path="${esc(m.path)}" title="點一下切換防雷">
        ${m.kind === 'video' ? '<video muted preload="none"></video>' : '<img alt="">'}${m.spoiler ? '<span class="lbl">防雷</span>' : ''}${isBig(m) ? '<span class="lbl big">超過 25 MB</span>' : ''}${m.rep ? '<span class="lbl rep">已換壓縮版</span>' : ''}</button>`).join('');
      const bigs = p.media.map((m, k) => {
        if (!isBig(m) && !m.rep) return '';
        const d = `data-post="${id}" data-k="${k}"`;
        if (m.rep && !isBig(m)) return `<div class="bigbox ok">第 ${k + 1} 個影片已換成壓縮版（${mb(m.rep.size)}），會放上網站。<button type="button" class="btn small" data-act="unrep" ${d}>換回原檔</button></div>`;
        return `<div class="bigbox">第 ${k + 1} 個${m.kind === 'video' ? '影片' : '檔案'}有 ${mb(sizeOf(m))}，超過 25 MB，放不上網站。` +
          (m.rep ? '換上的壓縮版還是太大，請再壓縮小一點。' : '') +
          (m.link ? `<br>網站上會改放連結：<a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.link)}</a>` : '') +
          (m.link ? '' : '<br><span class="bighint">可以換成自己壓縮好的影片；或自己先把影片上傳到 YouTube 等平台，再貼上連結（工具不會幫你上傳）。</span>') + `<span class="bigacts"><button type="button" class="btn small" data-act="rep" ${d}>換成壓縮後的影片</button>` +
          (m.link ? `<button type="button" class="btn small" data-act="unlink" ${d}>移除連結</button>` : `<button type="button" class="btn small" data-act="link" ${d}>改放影片連結</button>`) +
          (m.rep ? `<button type="button" class="btn small" data-act="unrep" ${d}>換回原檔</button>` : '') + '</span></div>';
      }).join('');
      const long = p.text.length > 140 || (p.text.match(/\n/g) || []).length > 5;
      return `<div class="it"><div class="it-head"><span>${fmt(p.t)}</span>${i ? '<span class="badge">追加</span>' : ''}${p.isNew ? '<span class="badge new">新</span>' : ''}
        ${i ? `<button type="button" class="btn small" data-act="split" data-th="${t.id}" data-post="${id}">拆成獨立一串</button>` : ''}</div>
        <p class="it-text">${esc(p.text) || (p.lt ? '' : '<i>（沒有文字）</i>')}</p>${long ? '<button type="button" class="expand">展開全文</button>' : ''}
        ${p.lt ? `<details class="it-lt"><summary>附加長文・約 ${p.lt.length} 字</summary><p class="it-text">${esc(p.lt)}</p></details>` : ''}
        ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}${bigs}</div>`;
    }).join('');
    return `<article class="th${t.hidden ? ' hidden' : ''}" data-th="${t.id}">
      <div class="th-head">${t.kind === 'reply' ? `<span class="badge">回覆 @${esc(t.replyTo || '')}</span>` : ''}
        <input list="tag-list" placeholder="標籤" value="${esc(t.tag)}" data-act="tag" data-th="${t.id}" aria-label="標籤">
        <span class="grow"></span>
        <button type="button" class="btn small" data-act="merge" data-th="${t.id}">併入上一串</button>
        <button type="button" class="btn small" data-act="hide" data-th="${t.id}">${t.hidden ? '恢復收錄' : '隱藏'}</button>
      </div>${items}</article>`;
  }

  $('#list').addEventListener('click', e => {
    const ex = e.target.closest('.expand');
    if (ex) { const tx = ex.previousElementSibling; tx.classList.toggle('open'); ex.textContent = tx.classList.contains('open') ? '收合' : '展開全文'; return; }
    const th = e.target.closest('.thumb');
    if (th) { const m = S.posts[th.dataset.post].media[+th.dataset.k]; m.spoiler = !m.spoiler; th.classList.toggle('sp', m.spoiler);
      th.querySelector('.lbl') ? th.querySelector('.lbl').remove() : th.insertAdjacentHTML('beforeend', '<span class="lbl">防雷</span>'); save(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.dataset.act === 'tag') return;
    if (['rep', 'unrep', 'link', 'unlink'].includes(b.dataset.act)) {
      const p = S.posts[b.dataset.post], m = p.media[+b.dataset.k];
      if (b.dataset.act === 'rep') { repTarget = m; $('#rep-file').click(); return; }
      if (b.dataset.act === 'unrep') { delete m.rep; urlCache.delete('rep:' + p.id + ':' + b.dataset.k); }
      if (b.dataset.act === 'link') {
        const u = prompt('貼上你自己上傳到 YouTube 等平台的影片網址（工具不會幫你上傳）：', 'https://');
        if (!u || !/^https?:\/\/\S+\.\S+/.test(u.trim())) { if (u && u !== 'https://') alert('請貼上以 https:// 開頭的完整網址。'); return; }
        m.link = u.trim();
      }
      if (b.dataset.act === 'unlink') delete m.link;
      save(); render(); return;
    }
    const idx = S.threads.findIndex(t => t.id === b.dataset.th), t = S.threads[idx];
    if (b.dataset.act === 'hide') { t.hidden = !t.hidden; }
    if (b.dataset.act === 'split') {
      t.items = t.items.filter(i => i !== b.dataset.post);
      S.threads.push({ id: 't' + b.dataset.post, items: [b.dataset.post], tag: t.tag, hidden: false, kind: 'post' });
      sortThreads();
    }
    if (b.dataset.act === 'merge') {
      const t0 = S.posts[t.items[0]].t;
      const prev = S.threads.filter(x => x !== t && x.kind === 'post' && S.posts[x.items[0]].t <= t0).sort((a, z) => S.posts[z.items[0]].t - S.posts[a.items[0]].t)[0];
      if (!prev) { alert('前面沒有可以併入的貼文了。'); return; }
      prev.items = [...prev.items, ...t.items].sort((a, z) => S.posts[a].t - S.posts[z].t);
      S.threads.splice(idx, 1);
    }
    save(); render();
  });
  $('#list').addEventListener('change', e => {
    if (e.target.dataset.act !== 'tag') return;
    S.threads.find(t => t.id === e.target.dataset.th).tag = e.target.value.trim().replace(/^#/, '');
    save(); render();
  });
  const sortThreads = () => S.threads.sort((a, b) => S.posts[b.items[0]].t - S.posts[a.items[0]].t);

  // 換成壓縮後的影片
  let repTarget = null;
  $('#rep-file').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !repTarget) return;
    repTarget.rep = f; repTarget.kind = 'video';
    if (f.size > LIMIT) alert(`這個檔案有 ${mb(f.size)}，還是超過 25 MB，請再壓縮小一點。`);
    repTarget = null; save(); render();
  });

  // 縮圖：捲到才從 zip 讀取
  let io = null;
  function observeThumbs() {
    if (io) io.disconnect();
    io = new IntersectionObserver(ents => ents.forEach(async en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const el = en.target.querySelector('img,video');
      const m = S.posts[en.target.dataset.post].media[+en.target.dataset.k];
      try { el.src = m.rep ? URL.createObjectURL(m.rep) : await blobUrl(en.target.dataset.path); } catch (e) { /* 略過 */ }
    }), { rootMargin: '300px' });
    document.querySelectorAll('.thumb').forEach(t => io.observe(t));
  }
  async function dataUrl(path) {
    const b = await MiniZip.entryData(S.entries.get(path));
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([b], { type: 'image/jpeg' })); });
  }
  async function blobUrl(path) {
    if (urlCache.has(path)) return urlCache.get(path);
    const en = S.entries.get(path);
    const type = /\.mp4$/i.test(path) ? 'video/mp4' : /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
    const u = URL.createObjectURL(new Blob([await MiniZip.entryData(en)], { type }));
    urlCache.set(path, u);
    return u;
  }
  function shrink(file, max, type) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL(type, 0.86));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- 產生網站 ----------
  $('#generate').addEventListener('click', generate);
  $('#gen-close').addEventListener('click', () => { $('#gen-dialog').hidden = true; });

  // ---------- 使用說明（第一次打開時跳出） ----------
  const INTRO_KEY = 'tbk:intro-seen';
  const openIntro = () => { $('#intro-modal').hidden = false; $('#intro-modal .intro').scrollTop = 0; };
  const closeIntro = () => { $('#intro-modal').hidden = true; try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* 略過 */ } };
  document.querySelector('.sig-intro').addEventListener('click', openIntro);
  $('#intro-ok').addEventListener('click', closeIntro);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#intro-modal').hidden) closeIntro(); });
  let seen = false; try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { seen = false; }
  if (!seen) openIntro();

  // ---------- 串文怎麼分的？ ----------
  $('#help-thread').addEventListener('click', e => { const p = $('#help-pop'), open = p.hidden; p.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); });

  // ---------- 上線教學 ----------
  let siteStats = null; // 最近一次產生的網站：檔案數、超過 25 MB 的檔案
  const MB = 1024 * 1024, fmtMB = b => (b / MB).toFixed(1) + ' MB';
  function openGuide() {
    const box = $('#g-stats'), cf = $('#g-cf-note'), gh = $('#g-gh-note');
    cf.innerHTML = gh.innerHTML = '';
    if (siteStats) {
      const { count, total, big } = siteStats;
      box.hidden = false;
      const bar = (label, n, max, text) => { const r = n / max, cls = r > 1 ? 'bad' : r >= 0.8 ? 'warn' : 'ok';
        return `<div class="ubar ${cls}"><span>${label}</span><div class="tr"><div class="fi" style="width:${Math.max(1, Math.min(100, r * 100)).toFixed(1)}%"></div></div><span class="n"><b>${text}</b> / ${max === LIMIT ? '25 MB' : max.toLocaleString()}</span></div>`; };
      box.innerHTML = `<div class="t"><b>你剛產生的網站</b>：${count.toLocaleString()} 個檔案，共 ${fmtMB(total)}</div>` +
        bar('Cloudflare・整個網站', count, 20000, count.toLocaleString()) +
        bar('GitHub・media 一次上傳', siteStats.media, 100, siteStats.media.toLocaleString()) +
        bar('單一檔案最大', siteStats.maxSize, LIMIT, fmtMB(siteStats.maxSize)) +
        '<p class="note legend"><span><i class="dot ok"></i>沒問題</span><span><i class="dot warn"></i>接近上限，下次備份增加檔案後可能會超過</span><span><i class="dot bad"></i>超過上限</span></p>' +
        (big.length ? `<ul>${big.map(b => `<li>${esc(b.name)}（${fmtMB(b.size)}）超過 25 MB，沒有放進網站，` + (b.link ? '網站上會改放你設定的影片連結。' : '貼文裡會顯示「影片超過 25 MB」的提示。想放上網站，請看下方「想放超過 25 MB 的影片？」。') + '原檔留在「② 存檔」裡，不會遺失。</li>').join('')}</ul>` : '');
      cf.innerHTML = count <= 20000 ? '<span class="good">✓ 你的網站可以直接用拖的上傳。</span>'
        : '<span class="bad">你的網站超過 20,000 個檔案，超過免費方案的上限。</span>';
      const nMedia = siteStats.media;
      gh.innerHTML = nMedia <= 100 ? `<span class="good">✓ 你的 media 資料夾有 ${nMedia} 個檔案，照上面分兩批就能上傳完。</span>`
        : `<span class="bad">你的 media 資料夾有 ${nMedia.toLocaleString()} 個檔案，超過一次 100 個的上限，需要再分成更多批上傳。</span>`;
      $('#g-bigv').open = big.some(b => !b.link);
    } else box.hidden = true;
    $('#gen-dialog').hidden = true;
    $('#guide').hidden = false; $('#guide .modal-box').scrollTop = 0;
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-guide]')) openGuide(); });
  const closeGuide = () => { $('#guide').hidden = true; };
  $('#guide-close').addEventListener('click', closeGuide);
  $('#guide-done').addEventListener('click', closeGuide);
  $('#guide').addEventListener('click', e => { if (e.target.id === 'guide') closeGuide(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#guide').hidden) closeGuide(); });
  document.querySelectorAll('[data-gt]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-gt]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-gp]').forEach(p => { p.hidden = p.dataset.gp !== b.dataset.gt; });
  }));

  async function generate() {
    const dlg = $('#gen-dialog'), st = $('#gen-status');
    const bar = { set value(v) { $('#gen-fill').style.width = v + '%'; $('#gen-progress').value = v; } };
    dlg.hidden = false; dlg.classList.remove('done'); $('#gen-done').hidden = true; $('#gen-title').textContent = '正在產生網站…';
    try {
      const inc = S.threads.filter(included);
      const files = [], ROOT = Importer.SITE_DIR, AR = Importer.ARCHIVE_DIR;
      const incPosts = new Set(inc.flatMap(t => t.items));
      // 每個檔案在新 zip 裡的位置：網站要用的放 post-backup/media，其餘（隱藏的、回覆別人的）放存檔資料夾
      const newPath = {}; // 'postId:k' -> zip 路徑
      const copies = [], ownerOf = {}, bigOnes = [], origOf = {};
      let n = 0, nA = 0;
      const all = [];
      for (const p of Object.values(S.posts).sort((x, y) => x.t - y.t)) p.media.forEach((m, k) => all.push([p, m, k]));
      for (let i = 0; i < all.length; i++) {
        const [p, m, k] = all[i];
        const data = m.rep ? new Uint8Array(await m.rep.arrayBuffer()) : await MiniZip.entryData(S.entries.get(m.path));
        if (m.rep) { // 原檔也留在存檔裡，不會遺失
          const oext = (m.path.match(/\.(\w+)$/) || [, 'mp4'])[1].toLowerCase();
          const op = `${AR}media/${String(++nA).padStart(5, '0')}.${oext}`;
          files.push({ name: op, data: await MiniZip.entryData(S.entries.get(m.path)) });
          origOf[p.id + ':' + k] = op;
        }
        else if (m.origPath && S.entries.has(m.origPath)) { // 上次換過壓縮版：原檔繼續留在存檔
          const op = `${AR}media/${String(++nA).padStart(5, '0')}.${(m.origPath.match(/\.(\w+)$/) || [, 'mp4'])[1]}`;
          files.push({ name: op, data: await MiniZip.entryData(S.entries.get(m.origPath)) });
          origOf[p.id + ':' + k] = op;
        }
        // Meta 匯出的影片常常沒有副檔名：看檔頭判斷，影片一律存成 .mp4
        const isVid = data.length > 12 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70; // 'ftyp'
        if (isVid) m.kind = 'video'; else if (m.kind === 'video' && /^\xff\xd8|^\x89PNG/.test(String.fromCharCode(...data.slice(0, 4)))) m.kind = 'image';
        let ext = ((m.rep ? m.rep.name : m.path).match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
        if (isVid) { if (!/^(mp4|mov|m4v)$/.test(ext)) ext = 'mp4'; } else if (!ext) ext = 'jpg';
        const tooBig = data.length > 25 * 1024 * 1024; // Cloudflare／GitHub 單檔上限，放進存檔、網站上顯示提示
        if (tooBig && incPosts.has(p.id)) bigOnes.push({ p, kind: m.kind, size: data.length, link: m.link });
        const zp = incPosts.has(p.id) && !tooBig ? `${ROOT}media/${String(++n).padStart(5, '0')}.${ext}` : `${AR}media/${String(++nA).padStart(5, '0')}.${ext}`;
        newPath[p.id + ':' + k] = zp;
        ownerOf[zp] = p;
        copies.push({ from: m.path, to: zp });
        files.push({ name: zp, data });
        if (i % 10 === 0) { bar.value = Math.round(i / all.length * 90); st.textContent = `複製圖片與影片 ${i}／${all.length}`; }
      }
      const threads = inc.map((t, ti) => ({
        id: String(ti + 1), tag: t.tag || '',
        items: t.items.map(id => {
          const p = S.posts[id];
          return { t: p.t, text: p.text, ...(p.lt ? { lt: p.lt } : {}), media: p.media.map((m, k) => { const zp = newPath[id + ':' + k]; return zp.startsWith(ROOT) ? { src: zp.slice(ROOT.length), kind: m.kind, sp: m.spoiler ? 1 : 0 } : { src: '', kind: m.kind, big: 1, link: m.link || '' }; }) };
        }),
      }));
      const media = copies;
      let avatar = null;
      if (S.custom.avatar) { files.push({ name: ROOT + 'media/avatar.jpg', data: dataUrlBytes(S.custom.avatar) }); avatar = 'media/avatar.jpg'; }
      else if (S.profile.avatar) { files.push({ name: ROOT + 'media/avatar.jpg', data: await MiniZip.entryData(S.entries.get(S.profile.avatar.entry)) }); avatar = 'media/avatar.jpg'; }
      let theme = `:root{--accent:${S.settings.accent}}`;
      if (S.settings.bg) { files.push({ name: ROOT + 'media/bg.jpg', data: dataUrlBytes(S.settings.bg) }); theme += bgCss('media/bg.jpg'); }
      const data = { profile: { name: S.profile.name, username: S.profile.username, bio: S.profile.bio, avatar }, threads, generated: Date.now() };
      files.push({ name: ROOT + 'data.js', data: 'window.ARCHIVE=' + JSON.stringify(data) + ';' });
      // 接續備份用的存檔（包含所有貼文與整理設定；不要上傳到網路）
      const settings = Object.assign({}, S.settings); delete settings.bg;
      const project = {
        version: 1, savedAt: Date.now(),
        lastBackup: Math.max(0, ...Object.values(S.posts).map(p => p.t)),
        profile: { username: S.profile.username, name: S.profile.name, bio: S.profile.bio, avatarPath: avatar ? ROOT + avatar : null },
        settings, bgPath: S.settings.bg ? ROOT + 'media/bg.jpg' : null,
        posts: Object.values(S.posts).map(p => ({ id: p.id, t: p.t, text: p.text, ...(p.lt ? { lt: p.lt } : {}), isReply: p.isReply, replyTo: p.replyTo,
          media: p.media.map((m, k) => ({ path: newPath[p.id + ':' + k], kind: m.kind, spoiler: !!m.spoiler, link: m.link || null, origPath: origOf[p.id + ':' + k] || m.origPath || null })) })),
        threads: S.threads.map(t => ({ id: t.id, items: t.items, tag: t.tag || '', hidden: !!t.hidden, kind: t.kind, replyTo: t.replyTo || null })),
      };
      files.push({ name: AR + 'project.json', data: JSON.stringify(project) });
      files.push({ name: AR + '說明.txt', data: '這個資料夾是給工具用的存檔，不是給人看的。\n\n裡面記著你的「全部」貼文（包括隱藏起來的），以及你整理過的所有設定：標籤、防雷、串文合併、顏色、背景、大頭貼。\n\n下次備份時，把整個 post-backup.zip 和新的 Meta 匯出檔一起拖進工具，就會接著上次繼續，整理過的地方都會保留。\n\n請不要把這個資料夾上傳到網路：裡面有你隱藏的貼文，上傳就等於公開了。想公開網站時，只上傳「① 網站（可以用於上傳公開）」那個資料夾。\n' });
      st.textContent = '組合網站檔案…'; bar.value = 92;
      const T = window.TEMPLATES, html = T['index.html'], css = T['site.css'], js = T['site.js'];
      const title = `${S.profile.name || S.profile.username} 的貼文備份`;
      const noindex = S.settings.noindex !== false;
      files.push({ name: ROOT + 'index.html', data: html.replace('__ROBOTS__', noindex ? '<meta name="robots" content="noindex, nofollow">' : '').replace(/__TITLE__/g, esc(title)).replace(/__DESC__/g, esc((S.profile.bio || '').slice(0, 120))).replace(/__BRAND__/g, esc(title)).replace('__THEME__', theme) });
      files.push({ name: ROOT + 'assets/site.css', data: css });
      files.push({ name: ROOT + 'assets/site.js', data: js });
      st.textContent = '打包 zip…'; bar.value = 96;
      const enc = new TextEncoder(), siteFiles = files.filter(f => f.name.startsWith(ROOT));
      const sizes = siteFiles.map(f => ({ name: f.name.slice(ROOT.length), size: typeof f.data === 'string' ? enc.encode(f.data).length : f.data.length }));
      siteStats = { maxSize: Math.max(0, ...sizes.map(x => x.size)), media: sizes.filter(x => x.name.startsWith('media/')).length, count: sizes.length, total: sizes.reduce((a, b) => a + b.size, 0), big: bigOnes.map(({ p, kind, size, link }) => { const d = new Date(p.t * 1000); return { name: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 「${p.text.replace(/\s+/g, ' ').slice(0, 16)}${p.text.length > 16 ? '…' : ''}」的${kind === 'video' ? '影片' : '圖片'}`, size, link }; }) };
      const zip = MiniZip.makeZip(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip); a.download = 'post-backup.zip'; document.body.appendChild(a); a.click(); a.remove();
      bar.value = 100; st.textContent = `共 ${threads.length} 串貼文、${media.length} 個檔案，約 ${(zip.size / 1e6).toFixed(1)} MB` + (bigOnes.length ? `（${bigOnes.length} 個超過 25 MB 的檔案沒放進網站，詳見上線教學）` : '');
      $('#gen-title').textContent = '網站產生完成'; $('#gen-done').hidden = false; dlg.classList.add('done');
    } catch (e) {
      console.error(e); st.textContent = '發生錯誤：' + (e.message || e); st.className = 'status err';
    }
  }
  function dataUrlBytes(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }


  // ---------- 即時預覽 ----------
  const pvPane = $('#preview-pane'), edPane = $('#edit-pane'), frame = $('#preview');
  let pvTimer = null;
  function showTab(preview) {
    $('#tab-edit').setAttribute('aria-selected', String(!preview));
    $('#tab-preview').setAttribute('aria-selected', String(preview));
    pvPane.hidden = !preview; edPane.hidden = preview;
    if (preview) refreshPreview();
  }
  $('#tab-edit').addEventListener('click', () => showTab(false));
  $('#tab-preview').addEventListener('click', () => showTab(true));
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    frame.style.width = b.dataset.w;
  }));
  function schedulePreview() {
    if (pvPane.hidden) return;
    clearTimeout(pvTimer); pvTimer = setTimeout(refreshPreview, 300);
  }
  async function refreshPreview() {
    const inc = S.threads.filter(included).slice(0, 40);
    const threads = [];
    for (let ti = 0; ti < inc.length; ti++) {
      const t = inc[ti], items = [];
      for (const id of t.items) {
        const p = S.posts[id], media = [];
        for (const m of p.media) {
          let src = '';
          try { src = await blobUrl(m.path); } catch (e) { /* 略過 */ }
          media.push({ src, kind: m.kind, sp: m.spoiler ? 1 : 0 });
        }
        items.push({ t: p.t, text: p.text, ...(p.lt ? { lt: p.lt } : {}), media });
      }
      threads.push({ id: String(ti + 1), tag: t.tag || '', items });
    }
    const avatar = S.custom.avatar || S.custom.avatarUrl || null;
    const data = { profile: { name: S.profile.name, username: S.profile.username, bio: S.profile.bio, avatar }, threads, total: S.threads.filter(included).length };
    const T = window.TEMPLATES;
    let theme = `:root{--accent:${S.settings.accent}}`;
    if (S.settings.bg) theme += bgCss(S.settings.bg);
    const title = `${S.profile.name || S.profile.username} 的貼文備份`;
    const doc = T['index.html']
      .replace('__ROBOTS__', '').replace(/__TITLE__/g, esc(title)).replace(/__DESC__/g, '').replace(/__BRAND__/g, esc(title))
      .replace('__THEME__', theme)
      .replace('<link rel="stylesheet" href="assets/site.css">', () => '<style>' + T['site.css'] + '</style>')
      .replace('<script src="data.js"></script>', () => '<script>window.ARCHIVE=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';</script>')
      .replace('<script src="assets/site.js"></script>', () => '<script>' + T['site.js'].replace(/<\/script/gi, '<\\/script') + '</script>');
    const y = frame.contentWindow ? frame.contentWindow.scrollY : 0;
    const hash = frame.contentWindow ? frame.contentWindow.location.hash : '';
    frame.onload = () => { try { if (hash && hash !== '#') frame.contentWindow.location.hash = hash; frame.contentWindow.scrollTo(0, y); } catch (e) { /* 略過 */ } };
    frame.srcdoc = doc;
  }
  window.__S = () => S; // 除錯用
})();
