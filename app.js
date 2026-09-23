/* Factory board — reads the SM tick's state snapshots, no build step.
 *
 * Views: lanes (cards) | diagram (lifecycle rail with PR chips).
 * Per ticket: a mini lifecycle rail SVG on every card.
 * Time travel: if the factory publishes <asset>-history.json (an index of
 * per-tick snapshots), the board offers scrub + playback over past ticks.
 */
(function () {
  'use strict';
  var CFG = window.FACTORY_BOARD_CONFIG;

  // ?repo=Owner/name — ad-hoc factory: probe the canonical asset names on
  // that repo's factory-data branch (the SM tick's statePublish.asset).
  function qs(k) {
    try { return new URLSearchParams(location.search).get(k) || ''; }
    catch (e) { return ''; }
  }
  var dyn = qs('repo');
  if (dyn && dyn.indexOf('/') > 0 &&
      !CFG.factories.some(function (f) { return f.repo === dyn; })) {
    var name = dyn.split('/')[1];
    var cands = ['factory-state.json', name + '-state.json',
                 'fa-state.json', 'dart-state.json'];
    CFG.factories.push({
      id: 'dyn', repo: dyn, name: dyn, accent: '#c084fc',
      stateUrls: cands.map(function (a) {
        return 'https://raw.githubusercontent.com/' + dyn +
               '/factory-data/data/' + a;
      }),
      historyUrls: cands.map(function (a) {
        return 'https://raw.githubusercontent.com/' + dyn + '/factory-data/data/'
               + a.replace(/\.json$/, '-history.json');
      })
    });
  }
  CFG.factories.forEach(function (f) {
    f.stateUrls = f.stateUrls || [f.stateUrl];
    if (!f.historyUrls) {
      f.historyUrls = f.stateUrls.map(function (u) {
        return u.replace(/\.json$/, '-history.json');
      });
    }
  });

  var tabsEl = document.getElementById('factory-tabs');
  var lanesEl = document.getElementById('lanes');
  var diagramEl = document.getElementById('diagram');
  var errEl = document.getElementById('error');
  var statusEl = document.getElementById('statusline');
  var ttBar = document.getElementById('timetravel');
  var ttBanner = document.getElementById('tt-banner');

  var active = 0;
  var cache = {};          // factoryId -> latest live state
  var nextRefreshAt = Date.now() + (CFG.refreshMs || 60000);

  // ---- view mode -------------------------------------------------------
  var viewMode = 'lanes';
  try { viewMode = localStorage.getItem('fb-view') || 'lanes'; } catch (e) {}
  function setView(m) {
    viewMode = m;
    try { localStorage.setItem('fb-view', m); } catch (e) {}
    var st = cache[CFG.factories[active].id];
    if (st) render(CFG.factories[active], st, true);
    var b = document.getElementById('view-btn');
    if (b) b.textContent = m === 'lanes' ? '🧭 diagram' : '▦ lanes';
  }

  // ---- time travel -----------------------------------------------------
  var tt = { snaps: [], pos: -1, playing: null, repo: '' }; // pos -1 = LIVE

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ago(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return Math.max(0, Math.round(s)) + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function hm(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' :
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function verdictClass(v) {
    if (v === 'success') return 'ok';
    if (v && ['failure', 'timed_out', 'startup_failure'].indexOf(v) >= 0) return 'bad';
    return 'run';
  }

  // ---- per-ticket lifecycle mini-rail (SVG) ----------------------------
  var STAGES = [
    { id: 'dev',        title: 'dev',        labels: ['in progress'] },
    { id: 'review',     title: 'review',     labels: ['ai_pr_reviewed'] },
    { id: 'queue',      title: 'queue',      labels: ['pr_approved'] },
    { id: 'validating', title: 'validating', labels: ['ai_validating'] },
    { id: 'green',      title: 'green',      labels: ['ai_validated'] },
    { id: 'merged',     title: 'merged',     labels: ['merged'] }
  ];

  function stageOf(c) {
    var labels = c.labels || [], cur = -1;
    STAGES.forEach(function (s, i) {
      if (s.labels.some(function (l) { return labels.indexOf(l) >= 0; })) cur = i;
    });
    return cur;
  }

  // A small rail graph for one ticket: 6 nodes on an edge, the travelled
  // part filled, the current node glowing in the factory accent.
  function railGraph(c, accent) {
    var cur = stageOf(c);
    if (cur < 0) return '';
    var W = 232, H = 22, y = H / 2;
    var xs = STAGES.map(function (_, i) { return 14 + i * (W - 28) / (STAGES.length - 1); });
    var bad = c.checks && verdictClass(c.checks.verdict) === 'bad';
    var e = '<svg class="rail" viewBox="0 0 ' + W + ' ' + H +
            '" width="' + W + '" height="' + H + '" role="img" ' +
            'aria-label="lifecycle: stage ' + (cur + 1) + ' of ' + STAGES.length + '">';
    for (var i = 0; i < xs.length - 1; i++) {
      e += '<line x1="' + xs[i] + '" y1="' + y + '" x2="' + xs[i + 1] + '" y2="' + y +
           '" class="edge' + (i < cur ? ' edge-done' : '') + '"/>';
    }
    STAGES.forEach(function (s, i) {
      var cls = i < cur ? 'node-done' : (i === cur ? 'node-cur' : 'node-todo');
      if (i === cur && bad) cls = 'node-bad';
      var r = i === cur ? 6 : 4.5;
      e += '<circle cx="' + xs[i] + '" cy="' + y + '" r="' + r + '" class="' + cls +
           '" style="--accent:' + accent + '"/>';
      if (i === cur) {
        e += '<circle cx="' + xs[i] + '" cy="' + y + '" r="9.5" class="node-halo" ' +
             'style="--accent:' + accent + '"/>';
      }
    });
    e += '<title>' + esc(STAGES[cur].title) + '</title></svg>';
    return '<div class="trail" title="lifecycle stage">' + e +
           '<span class="stage-name">' + esc(STAGES[cur].title) + '</span></div>';
  }

  function card(f, c) {
    var badges = (c.labels || []).map(function (l) {
      var hot = CFG.badgeLabels.indexOf(l) >= 0;
      return '<span class="lbl' + (hot ? ' hot' : '') + '">' + esc(l) + '</span>';
    }).join('');
    var checks = c.checks
      ? '<div class="checks"><span class="dot ' + verdictClass(c.checks.verdict) + '">' +
        '</span><span>' + esc(c.checks.verdict) + ' · ' + esc(ago(c.checks.at)) + '</span></div>'
      : '';
    var pos = c.queuePos ? '<span class="pos">#' + c.queuePos + '</span>' : '';
    return '<a class="card" href="' + CFG.prUrl(f.repo, c.pr) + '" target="_blank" rel="noopener">' +
      '<div class="card-top">' + pos + '<span class="pr">!' + esc(c.pr) + '</span>' +
      '<span class="title">' + esc(c.title || '') + '</span></div>' +
      '<div class="labels">' + badges + '</div>' + railGraph(c, f.accent) + checks + '</a>';
  }

  // ---- lifecycle diagram view ------------------------------------------
  // The machine's own lanes drawn as the lifecycle rail; every PR is a
  // chip sitting at its current stage. 5 states: fresh → review →
  // approved → validating → done (merged/validated leaves the board).
  var DIAG = {
    states: [
      { id: 'fresh',          title: 'Fresh',        x: 40  },
      { id: 'review',         title: 'Review',       x: 260 },
      { id: 'approved_queue', title: 'Approved (FIFO)', x: 480 },
      { id: 'validating',     title: 'Validating',   x: 700 },
      { id: 'done',           title: 'Done',         x: 900, virtual: true }
    ],
    w: 170, h: 46, top: 64, chipH: 24, gap: 8
  };

  function chipsFor(st, id) {
    if (id === 'done') {
      // validated PRs (green) — drawn on the Done node instead of their lane
      var all = [];
      CFG.lanes.forEach(function (l) {
        ((st.lanes || {})[l.id] || []).forEach(function (c) { all.push(c); });
      });
      return all.filter(function (c) {
        return (c.labels || []).indexOf('ai_validated') >= 0;
      });
    }
    return ((st.lanes || {})[id] || []).filter(function (c) {
      return (c.labels || []).indexOf('ai_validated') < 0;
    });
  }

  function chip(f, c, x, y, w) {
    var dot = c.checks
      ? '<circle cx="' + (x + 13) + '" cy="' + (y + 12) + '" r="3.5" class="chip-dot ' +
        verdictClass(c.checks.verdict) + '"/>'
      : '';
    var pos = c.queuePos
      ? '<tspan class="chip-pos">#' + esc(c.queuePos) + '</tspan> '
      : '';
    var title = esc(String(c.title || '').slice(0, 26)) +
                (String(c.title || '').length > 26 ? '…' : '');
    return '<a href="' + CFG.prUrl(f.repo, c.pr) + '" target="_blank" rel="noopener">' +
      '<g class="chip">' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + DIAG.chipH +
      '" rx="7" class="chip-rect"/>' + dot +
      '<text x="' + (x + 22) + '" y="' + (y + 16) + '" class="chip-text">' +
      '<tspan class="chip-pr">!' + esc(c.pr) + '</tspan> ' + pos + title +
      '</text></g></a>';
  }

  function diagram(f, st) {
    var W = 1120, laneTop = DIAG.top + DIAG.h + 14;
    var maxChips = 0;
    DIAG.states.forEach(function (s) {
      maxChips = Math.max(maxChips, chipsFor(st, s.id).length);
    });
    var H = laneTop + Math.max(1, maxChips) * (DIAG.chipH + DIAG.gap) + 40;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="diagram-svg" ' +
      'style="--accent:' + esc(f.accent) + '" role="img" aria-label="factory lifecycle">';

    // rail arrows between consecutive states
    for (var i = 0; i < DIAG.states.length - 1; i++) {
      var a = DIAG.states[i], b = DIAG.states[i + 1];
      var x1 = a.x + DIAG.w + 6, x2 = b.x - 6, my = DIAG.top + DIAG.h / 2;
      svg += '<line x1="' + x1 + '" y1="' + my + '" x2="' + (x2 - 7) + '" y2="' + my +
             '" class="rail-arrow"/>' +
             '<polygon points="' + x2 + ',' + my + ' ' + (x2 - 8) + ',' + (my - 4.5) +
             ' ' + (x2 - 8) + ',' + (my + 4.5) + '" class="rail-arrow-head"/>';
    }

    DIAG.states.forEach(function (s) {
      var chips = chipsFor(st, s.id);
      svg += '<rect x="' + s.x + '" y="' + DIAG.top + '" width="' + DIAG.w +
        '" height="' + DIAG.h + '" rx="10" class="state-rect"/>' +
        '<text x="' + (s.x + DIAG.w / 2) + '" y="' + (DIAG.top + 22) +
        '" class="state-title">' + esc(s.title) + '</text>' +
        '<text x="' + (s.x + DIAG.w / 2) + '" y="' + (DIAG.top + 38) +
        '" class="state-count">' + chips.length + '</text>';
      chips.slice(0, 9).forEach(function (c, i) {
        svg += chip(f, c, s.x, laneTop + i * (DIAG.chipH + DIAG.gap), DIAG.w);
      });
      if (chips.length > 9) {
        svg += '<text x="' + (s.x + 8) + '" y="' +
          (laneTop + 9 * (DIAG.chipH + DIAG.gap) + 14) +
          '" class="chip-more">+' + (chips.length - 9) + ' more</text>';
      }
    });
    svg += '</svg>';
    return svg;
  }

  // ---- render ----------------------------------------------------------
  function render(f, st, force) {
    var liveChanged = cache[f.id] !== st;
    cache[f.id] = st;
    if (active !== CFG.factories.indexOf(f)) return;
    // While scrubbing the past, a fresh poll must not clobber the view.
    if (tt.pos >= 0 && !force) { ttBannerNew(); return; }
    document.getElementById('brand-title').textContent =
      (CFG.title || 'Factory') + ' — ' + f.name;
    document.title = f.name + ' — factory board';
    statusEl.hidden = false;
    var t = st.tick || {};
    document.getElementById('tick-pill').innerHTML =
      'tick ' + esc(ago(t.at)) + (t.dryRun ? ' · <b>DRY</b>' : '');
    document.getElementById('counts-pill').textContent =
      CFG.lanes.map(function (l, i) {
        return (st.counts ? (st.counts[l.id] || 0) : 0) + ' ' +
               CFG.lanes[i].title.split(' ')[0].toLowerCase();
      }).join(' · ');
    document.getElementById('repo-pill').textContent = st.repo || '';
    if (viewMode === 'diagram') {
      lanesEl.hidden = true;
      diagramEl.hidden = false;
      diagramEl.innerHTML = diagram(f, st);
    } else {
      diagramEl.hidden = true;
      lanesEl.hidden = false;
      lanesEl.innerHTML = CFG.lanes.map(function (l) {
        var cards = ((st.lanes || {})[l.id] || []).map(function (c) {
          return card(f, c);
        }).join('');
        var n = (st.counts || {})[l.id] || 0;
        return '<div class="lane"><div class="lane-head"><span>' + esc(l.title) +
          '</span><span class="count">' + n + '</span></div>' +
          '<div class="lane-body">' + (cards || '<div class="empty">—</div>') +
          '</div></div>';
      }).join('');
    }
    errEl.hidden = true;
    void liveChanged;
  }

  function fail(f, msg) {
    if (active === CFG.factories.indexOf(f) && tt.pos < 0) {
      errEl.hidden = false;
      errEl.textContent = f.name + ': ' + msg;
    }
  }

  // ---- time travel UI ---------------------------------------------------
  function ttBannerNew() {
    ttBanner.hidden = false;
    ttBanner.innerHTML = '⚑ new tick landed while you are in the past — ' +
      '<a href="#" onclick="return window.__fbLive(), false">jump to LIVE</a>';
  }

  window.__fbLive = function () { goLive(); return false; };

  function goLive() {
    tt.pos = -1;
    stopPlay();
    ttBanner.hidden = true;
    var f = CFG.factories[active];
    var st = cache[f.id];
    if (st) render(f, st, true);
    syncTT();
  }

  function stopPlay() {
    if (tt.playing) { clearInterval(tt.playing); tt.playing = null; }
    var p = document.getElementById('tt-play');
    if (p) p.textContent = '⏵';
  }

  function syncTT() {
    var slider = document.getElementById('tt-slider');
    var label = document.getElementById('tt-label');
    if (!slider) return;
    if (tt.pos < 0 || !tt.snaps.length) {
      slider.value = tt.snaps.length; // right end
      label.textContent = tt.snaps.length
        ? 'LIVE · ' + tt.snaps.length + ' ticks kept'
        : 'LIVE';
      return;
    }
    slider.value = tt.pos;
    var s = tt.snaps[tt.pos];
    label.textContent = '⏪ t−' + (tt.snaps.length - tt.pos) + ' · tick ' +
      hm(s.tick || s.ts) + ' (' + (tt.pos + 1) + '/' + tt.snaps.length + ')';
  }

  function loadSnap(i) {
    if (i < 0 || i >= tt.snaps.length) return;
    tt.pos = i;
    var s = tt.snaps[i];
    fetch(s.url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (st) {
        render(CFG.factories[active], st, true);
        ttBanner.hidden = true;
        syncTT();
      })
      .catch(function (e) {
        ttBanner.hidden = false;
        ttBanner.textContent = 'snapshot load failed: ' + e.message;
      });
  }

  function play() {
    if (tt.playing) { stopPlay(); return; }
    if (tt.pos < 0) tt.pos = Math.max(0, tt.snaps.length - 12);
    else if (tt.pos >= tt.snaps.length - 1) tt.pos = 0;
    var p = document.getElementById('tt-play');
    p.textContent = '⏸';
    tt.playing = setInterval(function () {
      if (tt.pos >= tt.snaps.length - 1) { stopPlay(); syncTT(); return; }
      loadSnap(tt.pos + 1);
    }, 900);
    loadSnap(tt.pos);
  }

  function probeHistory(f) {
    var tryUrl = function (i) {
      if (i >= f.historyUrls.length) return; // stays hidden
      fetch(f.historyUrls[i], { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('no'); return r.json(); })
        .then(function (h) {
          if (active !== CFG.factories.indexOf(f)) return;
          tt.snaps = (h.snapshots || []).filter(function (s) { return s && s.url; });
          tt.pos = -1;
          ttBar.hidden = tt.snaps.length === 0;
          var slider = document.getElementById('tt-slider');
          slider.max = tt.snaps.length;
          slider.value = tt.snaps.length;
          syncTT();
        })
        .catch(function () { tryUrl(i + 1); });
    };
    tryUrl(0);
  }

  // ---- load + tabs ------------------------------------------------------
  function load() {
    var f = CFG.factories[active];
    if (!f) return;
    var tryUrl = function (i, lastErr) {
      if (i >= (f.stateUrls || []).length) {
        fail(f, 'no state yet (' + (lastErr && lastErr.message || 'not found') + ')');
        return;
      }
      fetch(f.stateUrls[i], { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (st) { render(f, st); })
        .catch(function (e) {
          if (i + 1 < f.stateUrls.length) tryUrl(i + 1, e);
          else fail(f, 'no state yet (' + e.message + ')');
        });
    };
    tryUrl(0, null);
    probeHistory(f);
    tabs();
  }

  function tabs() {
    tabsEl.innerHTML = CFG.factories.map(function (f, i) {
      return '<button class="tab' + (i === active ? ' on' : '') +
        '" data-i="' + i + '" style="--accent:' + esc(f.accent) + '">' +
        esc(f.name) + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab'), function (b) {
      b.onclick = function () {
        active = +b.getAttribute('data-i');
        tt.snaps = []; tt.pos = -1; stopPlay(); ttBar.hidden = true;
        ttBanner.hidden = true;
        load();
      };
    });
  }

  function tickClock() {
    document.getElementById('clock').textContent =
      new Date().toLocaleTimeString();
    var left = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
    var el = document.getElementById('next-refresh');
    if (el) el.textContent = 'refresh in ' + left + 's';
  }

  // ---- wiring -----------------------------------------------------------
  document.getElementById('theme-btn').onclick = function () {
    var el = document.documentElement;
    var t = el.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    el.setAttribute('data-theme', t);
    try { localStorage.setItem('fb-theme', t); } catch (e) {}
  };
  var viewBtn = document.getElementById('view-btn');
  if (viewBtn) viewBtn.onclick = function () {
    setView(viewMode === 'lanes' ? 'diagram' : 'lanes');
  };
  var playBtn = document.getElementById('tt-play');
  if (playBtn) playBtn.onclick = play;
  var liveBtn = document.getElementById('tt-live');
  if (liveBtn) liveBtn.onclick = goLive;
  var prevBtn = document.getElementById('tt-prev');
  if (prevBtn) prevBtn.onclick = function () {
    stopPlay();
    if (tt.pos < 0) tt.pos = tt.snaps.length - 1;
    else tt.pos = Math.max(0, tt.pos - 1);
    loadSnap(tt.pos);
  };
  var nextBtn = document.getElementById('tt-next');
  if (nextBtn) nextBtn.onclick = function () {
    stopPlay();
    if (tt.pos < 0) return;
    if (tt.pos >= tt.snaps.length - 1) { goLive(); return; }
    loadSnap(tt.pos + 1);
  };
  var slider = document.getElementById('tt-slider');
  if (slider) slider.oninput = function () {
    stopPlay();
    var v = +slider.value;
    if (v >= tt.snaps.length) { goLive(); return; }
    loadSnap(v);
  };

  tickClock();
  setInterval(tickClock, 1000);
  setView(viewMode === 'diagram' ? 'diagram' : 'lanes');
  tabs();
  load();
  setInterval(function () {
    nextRefreshAt = Date.now() + (CFG.refreshMs || 60000);
    load();
  }, CFG.refreshMs || 60000);
})();
