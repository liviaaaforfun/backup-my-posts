// 讀取 Meta「下載你的資訊」匯出的貼文資料（JSON 格式）以及上次產生的備份 zip，
// 合併成可編輯的資料模型。支援「上次的備份 + 新的匯出檔」接續備份。
(function (global) {
  'use strict';

  const ARCHIVE_DIR = '② 存檔（自己留著，下次備份用）/';
  const SITE_DIR = '① 網站（可以用於上傳公開）/';
  const OLD_ARCHIVE_DIRS = ['存檔資料（請勿上傳）/'];
  const SELF_GAP = 48 * 3600; // 回覆自己的貼文，若在 48 小時內，歸到前一串

  // Meta 匯出的 JSON 把 UTF-8 位元組當成 Latin-1 字元存，需要轉回來
  function fixText(s) {
    if (!s) return '';
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return s; // 已經是正常字串
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return new TextDecoder('utf-8').decode(b);
  }

  // 用「發文時間＋內容」產生穩定的編號，不同次匯出時同一則貼文的編號相同
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  const postId = (t, text, n) => 'p' + t + '_' + hash(text + '|' + n);

  async function importAll(files, onProgress) {
    const say = onProgress || (() => {});
    const entries = new Map();
    const seen = new Set();
    let dup = 0;
    const exportsRoots = [];
    let projectPath = null;
    for (const f of files) {
      say(`讀取 ${f.name}…`);
      const list = await MiniZip.readZip(f);
      const sig = f.size + ':' + list.length + ':' + list.slice(0, 20).map(e => e.name + e.csize).join('|');
      if (seen.has(sig)) { dup++; continue; }
      seen.add(sig);
      for (const en of list) if (!entries.has(en.name)) entries.set(en.name, en);
    }
    const names = [...entries.keys()];
    projectPath = names.find(n => [ARCHIVE_DIR, ...OLD_ARCHIVE_DIRS].some(d => n === d + 'project.json')) || null;
    names.forEach(n => { const m = n.match(/^(.*?)threads\/threads_and_replies\.json$/); if (m) exportsRoots.push(m[1]); });
    if (!projectPath && !exportsRoots.length) {
      if (names.some(n => /threads_and_replies\.html$/.test(n))) throw new Error('這是 HTML 格式的匯出檔。請重新匯出，在「格式」選擇 JSON。');
      throw new Error('找不到貼文資料。請放入 Meta 匯出的 zip（JSON 格式），或上次用這個工具產生的 post-backup.zip（舊版叫 threads-backup.zip）。');
    }
    const readJson = async p => JSON.parse(new TextDecoder().decode(await MiniZip.entryData(entries.get(p))));

    // ---------- 上次的備份 ----------
    let state = { profile: { username: '', name: '', bio: '', avatar: null }, posts: {}, threads: [], settings: null, custom: {}, lastBackup: 0 };
    if (projectPath) {
      say('讀取上次的備份…');
      const pj = await readJson(projectPath);
      state.profile = Object.assign(state.profile, pj.profile || {});
      if (pj.profile && pj.profile.avatarPath && entries.has(pj.profile.avatarPath)) state.profile.avatar = { entry: pj.profile.avatarPath };
      state.settings = pj.settings || null;
      state.bgPath = pj.bgPath && entries.has(pj.bgPath) ? pj.bgPath : null;
      state.lastBackup = pj.lastBackup || 0;
      for (const p of pj.posts) {
        p.media = (p.media || []).filter(m => entries.has(m.path));
        p.media.forEach(m => { if (!m.link) delete m.link; if (!m.origPath || !entries.has(m.origPath)) delete m.origPath; });
        p.isNew = false;
        state.posts[p.id] = p;
      }
      state.threads = (pj.threads || []).filter(t => (t.items = t.items.filter(i => state.posts[i])).length);
      state.threads.forEach(t => { t.isNew = false; });
    }

    // ---------- 新的匯出檔 ----------
    const fresh = [];
    for (const root of exportsRoots) {
      // 個人資料（沒有上次的備份時才採用）
      const piPath = root + 'threads/personal_information.json';
      if (!projectPath && entries.has(piPath)) {
        try {
          const pi = await readJson(piPath);
          const rec = (Object.values(pi)[0] || [])[0] || {};
          const sm = rec.string_map_data || {};
          state.profile.username = fixText((sm.Username || {}).value || '') || state.profile.username;
          state.profile.name = fixText((sm.Name || {}).value || '') || state.profile.name;
          state.profile.bio = fixText((sm.Bio || {}).value || '') || state.profile.bio;
          const photo = ((rec.media_map_data || {})['Profile Photo'] || {}).uri;
          if (photo) {
            const en = entries.get(root + photo) || [...entries.values()].find(e => e.name.endsWith(photo));
            if (en) state.profile.avatar = { entry: en.name };
          }
        } catch (e) { console.warn(e); }
      }
      say('整理貼文…');
      const raw = (await readJson(root + 'threads/threads_and_replies.json')).text_post_app_text_posts || [];
      for (const x of raw) {
        const media = x.media || [];
        const m0 = media[0] || {};
        const tp = m0.text_app_post || {};
        const t = m0.creation_timestamp || x.creation_timestamp || 0;
        const text = fixText(m0.title || x.title || '');
        // Threads「附加文字」（長文）：匯出檔放在 text_app_post.snippet_text_attachment（純文字，沒有粗體等格式）
        const lt = fixText(media.map(m => (m.text_app_post || {}).snippet_text_attachment).find(Boolean) || '');
        const files = media.filter(m => m.uri && entries.has(root + m.uri)).map(m => ({
          path: root + m.uri, kind: /\.(jpe?g|png|webp|gif|heic)$/i.test(m.uri) ? 'image' : 'video', spoiler: false,
        }));
        const id = postId(t, text, media.filter(m => m.uri).length);
        if (state.posts[id]) { if (lt && !state.posts[id].lt) state.posts[id].lt = lt; continue; } // 已經備份過（舊版沒有長文的話補上）
        const p = { id, t, text, lt: lt || undefined, media: files, isReply: !!tp.is_reply, replyTo: tp.in_reply_to_username ? fixText(tp.in_reply_to_username) : null, isNew: !!projectPath };
        state.posts[id] = p;
        fresh.push(p);
      }
    }

    // 沒有帳號名稱時，用「最常被自己回覆的名字」推測
    if (!state.profile.username) {
      const c = {};
      Object.values(state.posts).forEach(p => { if (p.replyTo) c[p.replyTo] = (c[p.replyTo] || 0) + 1; });
      state.profile.username = Object.entries(c).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
    }
    const me = state.profile.username;

    // ---------- 新貼文分串 ----------
    fresh.sort((a, b) => a.t - b.t);
    const P = state.posts;
    const lastOf = t => Math.max(...t.items.map(i => P[i].t));
    for (const p of fresh) {
      if (p.isReply && p.replyTo === me) {
        // 找最近一串（自己的貼文）且在 48 小時內
        let best = null, bestT = -1;
        for (const t of state.threads) {
          if (t.kind !== 'post') continue;
          const lt = lastOf(t);
          if (lt <= p.t && lt > bestT) { best = t; bestT = lt; }
        }
        if (best && p.t - bestT <= SELF_GAP) { best.items.push(p.id); best.items.sort((a, b) => P[a].t - P[b].t); continue; }
        state.threads.push({ id: 't' + p.id, items: [p.id], tag: '', hidden: false, kind: 'post', isNew: p.isNew });
      } else if (p.isReply) {
        state.threads.push({ id: 't' + p.id, items: [p.id], tag: '', hidden: false, kind: 'reply', replyTo: p.replyTo, isNew: p.isNew });
      } else {
        state.threads.push({ id: 't' + p.id, items: [p.id], tag: '', hidden: false, kind: 'post', isNew: p.isNew });
      }
    }
    state.threads.sort((a, b) => P[b.items[0]].t - P[a.items[0]].t);

    const nNew = fresh.length;
    const msg = projectPath
      ? `已接續上次的備份：新增 ${nNew} 則貼文／回覆`
      : `完成：${Object.keys(P).length} 則貼文／回覆`;
    say(msg + (dup ? `（有 ${dup} 個重複的 zip，已自動略過）` : ''));
    return { entries, ...state, resumed: !!projectPath, newCount: nNew };
  }

  global.Importer = { importAll, fixText, ARCHIVE_DIR, SITE_DIR };
})(window);
