// 貼文備份網站：單頁瀏覽（時間軸／標籤／搜尋／單篇），可直接從電腦打開 index.html 使用
(function () {
  'use strict';
  const A = window.ARCHIVE;
  const app = document.getElementById('app');
  const P = A.profile, PER = 20;
  const byId = Object.fromEntries(A.threads.map(t => [t.id, t]));
  const tagCount = {};
  A.threads.forEach(t => { if (t.tag) tagCount[t.tag] = (tagCount[t.tag] || 0) + 1; });
  const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const fmt = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const av = P.avatar ? `<img class="av" src="${esc(P.avatar)}" alt="">` : '<div class="av"></div>';

  function media(list, max) {
    if (!list || !list.length) return '';
    const shown = max ? list.slice(0, max) : list;
    const cells = shown.map((m, i) => {
      if (m.big) return m.link ? `<a class="cell big link" data-i="${i}" href="${esc(m.link)}" target="_blank" rel="noopener"><span>▶ 觀看影片<br><small>（另開新視窗）</small></span></a>` : `<div class="cell big" data-i="${i}"><span>這支影片超過 25 MB<br>沒有放上網站</span></div>`;
      const inner = m.kind === 'video'
        ? `<video ${m.sp ? 'data-src' : 'src'}="${esc(m.src)}" preload="metadata" playsinline muted></video>`
        : `<img ${m.sp ? 'data-src' : 'src'}="${esc(m.src)}" loading="lazy" alt="">`;
      return `<div class="cell${m.sp ? ' veiled' : ''}" data-i="${i}">${inner}${m.sp ? '<div class="vl"><span>防雷</span></div>' : ''}</div>`;
    }).join('');
    const extra = max && list.length > max ? `<div class="count">共 ${list.length} 張，點進貼文看全部</div>` : '';
    return `<div class="media${list.length === 1 ? ' one' : ''}" data-all='${esc(JSON.stringify(list.map(m => [m.src, m.kind])))}'><div class="track">${cells}</div>${extra}</div>`;
  }

  function card(t, q) {
    const r = t.items[0];
    let text = r.text || (r.lt ? r.lt : '');
    const cut = text.length > 240 || (!!r.lt && !!r.text);
    if (cut) text = text.slice(0, 240) + '…';
    let html = linkify(text);
    if (q) html = html.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
    const n = t.items.length - 1;
    return `<article class="post">${av}<div>
      <div class="meta"><span class="who">${esc(P.name || P.username)}</span><time>${fmt(r.t)}</time>${t.tag ? `<a class="chip" href="#/tag/${encodeURIComponent(t.tag)}">${esc(t.tag)}</a>` : ''}</div>
      <p class="text">${html}</p>${cut ? `<a class="more" href="#/p/${t.id}">繼續閱讀</a>` : ''}
      ${media(r.media, 6)}
      <div class="foot">${n ? `<span>作者追加 ${n} 則</span>` : ''}<a href="#/p/${t.id}">查看這串 →</a></div>
    </div></article>`;
  }

  function header(cur) {
    const strip = tags.length ? `<nav class="tags"><a href="#/"${cur ? '' : ' aria-current="page"'}>全部</a>${tags.map(([k, n]) => `<a href="#/tag/${encodeURIComponent(k)}"${cur === k ? ' aria-current="page"' : ''}>${esc(k)}<span>${n}</span></a>`).join('')}</nav>` : '';
    const first = A.threads.length ? A.threads[A.threads.length - 1].items[0].t : 0;
    const lastT = A.threads.length ? A.threads[0].items[0].t : 0;
    const y = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
    return `<header class="profile"><div><h1>${esc(P.name || P.username)}</h1><div class="handle">@${esc(P.username)}・貼文備份</div></div>
      ${P.avatar ? `<img class="avatar" src="${esc(P.avatar)}" alt="">` : ''}
      ${P.bio ? `<p class="bio">${linkify(P.bio)}</p>` : ''}</header>
      <div class="stats"><span>${A.total || A.threads.length} 串貼文</span>${first ? `<span>${y(first)} – ${y(lastT)}</span>` : ''}</div>${strip}`;
  }

  // 記住每個列表頁看到哪裡（載入了幾篇、捲到哪），從單篇返回時還原
  const memo = {};
  let curList = null;
  const keyNow = () => location.hash || '#/';
  function list(threads, cur, q) {
    const k = keyNow(), saved = memo[k];
    let shown = saved ? saved.shown : PER;
    curList = { k, get shown() { return shown; } };
    const render = () => {
      app.innerHTML = (q === undefined ? header(cur) : searchBox(q)) +
        (q !== undefined && q ? `<p class="hint">${threads.length} 串符合「${esc(q)}」</p>` : '') +
        threads.slice(0, shown).map(t => card(t, q)).join('') +
        (threads.length > shown ? '<div class="pager"><button type="button" id="more">載入更多</button></div>' : '');
      const b = document.getElementById('more');
      if (b) b.onclick = () => { const y = scrollY; shown += PER; render(); scrollTo(0, y); };
      bindSearch();
    };
    render();
    scrollTo(0, saved ? saved.y : 0);
  }

  function searchBox(q) {
    return `<form class="searchbox" id="sf"><input id="q" type="search" placeholder="搜尋貼文內容" value="${esc(q || '')}" autofocus><button>搜尋</button></form>`;
  }
  function bindSearch() {
    const f = document.getElementById('sf');
    if (f) f.onsubmit = e => { e.preventDefault(); location.hash = '#/search/' + encodeURIComponent(document.getElementById('q').value.trim()); };
  }

  function thread(t) {
    app.innerHTML = `<a class="back" href="#/" id="back">‹ 返回</a><section class="thread">` + t.items.map((it, i) => `
      <article class="post"><div class="rail">${av}${i < t.items.length - 1 ? '<span class="line"></span>' : ''}</div><div>
        <div class="meta"><span class="who">${esc(P.name || P.username)}</span><time>${fmt(it.t)}</time>${i === 0 && t.tag ? `<a class="chip" href="#/tag/${encodeURIComponent(t.tag)}">${esc(t.tag)}</a>` : ''}</div>
        ${it.text ? `<p class="text">${linkify(it.text)}</p>` : ''}${it.lt ? `<details class="lt"${it.text ? '' : ' open'}><summary>附加長文<span>約 ${it.lt.length} 字・點開閱讀</span></summary><p class="text">${linkify(it.lt)}</p></details>` : ''}${media(it.media)}
      </div></article>`).join('') + '</section>';
    document.getElementById('back').onclick = e => { e.preventDefault(); if (navs > 0) history.back(); else location.hash = '#/'; };
    scrollTo(0, 0);
  }

  function route() {
    // 離開列表頁前，記下目前位置
    if (curList) { memo[curList.k] = { shown: curList.shown, y: lastY }; curList = null; }
    const h = decodeURIComponent(location.hash.slice(1) || '/');
    let m;
    if ((m = h.match(/^\/p\/(.+)$/)) && byId[m[1]]) return thread(byId[m[1]]);
    if ((m = h.match(/^\/tag\/(.+)$/))) return list(A.threads.filter(t => t.tag === m[1]), m[1]);
    if ((m = h.match(/^\/search\/?(.*)$/))) {
      const q = m[1];
      const hits = q ? A.threads.filter(t => t.items.some(it => (it.text + '\n' + (it.lt || '')).toLowerCase().includes(q.toLowerCase()))) : [];
      return list(hits, null, q);
    }
    list(A.threads, null);
  }
  let lastY = 0;
  addEventListener('scroll', () => { if (curList) lastY = scrollY; }, { passive: true });
  let navs = -1; // 站內瀏覽了幾頁（返回時用；避免在預覽框裡跳離）
  addEventListener('hashchange', () => { navs++; route(); });
  route(); navs = 0;
  // 站內連結一律只改 #，不重新載入頁面（在工具的預覽框裡也能正常瀏覽）
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const h = a.getAttribute('href');
    if (location.hash !== h) location.hash = h;
  });

  // 防雷：點一下顯示；圖片：點一下放大
  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.innerHTML = '<div class="lt"></div><button class="x" aria-label="關閉">✕</button><button class="pv" aria-label="上一張">‹</button><button class="nx" aria-label="下一張">›</button><div class="n"></div>';
  document.body.appendChild(lb);
  const lt = lb.querySelector('.lt'), n = lb.querySelector('.n');
  const idx = () => Math.round(lt.scrollLeft / Math.max(1, lt.clientWidth));
  const go = i => lt.scrollTo({ left: i * lt.clientWidth });
  const close = () => { lb.classList.remove('open'); document.documentElement.classList.remove('lock'); lt.innerHTML = ''; };
  lt.onscroll = () => { n.textContent = (idx() + 1) + ' / ' + lt.children.length; };
  lb.querySelector('.x').onclick = close;
  lb.querySelector('.pv').onclick = () => go(idx() - 1);
  lb.querySelector('.nx').onclick = () => go(idx() + 1);
  lt.onclick = e => { if (!/IMG|VIDEO/.test(e.target.tagName)) close(); };
  addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(idx() - 1); else if (e.key === 'ArrowRight') go(idx() + 1);
  });
  app.addEventListener('click', e => {
    const c = e.target.closest('.cell');
    if (!c || c.classList.contains('big')) return;
    const box = c.closest('.media');
    if (c.classList.contains('veiled')) {
      box.querySelectorAll('.cell.veiled').forEach(v => {
        v.classList.remove('veiled');
        const el = v.querySelector('[data-src]');
        if (el) { el.src = el.dataset.src; el.removeAttribute('data-src'); }
        const vl = v.querySelector('.vl'); if (vl) vl.remove();
      });
      return;
    }
    const all = JSON.parse(box.dataset.all);
    lt.innerHTML = all.map(([s, k]) => `<div class="ls">${!s ? '<p class="lbig">這支影片超過 25 MB，沒有放上網站</p>' : k === 'video' ? `<video src="${esc(s)}" controls playsinline></video>` : `<img src="${esc(s)}" alt="">`}</div>`).join('');
    lb.classList.add('open'); document.documentElement.classList.add('lock');
    go(+c.dataset.i); n.textContent = (+c.dataset.i + 1) + ' / ' + all.length;
  });
})();
