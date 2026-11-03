/* ============================================================
   正史中的人相食 · 应用逻辑
   数据来源：assets/data.js（由 build/build_data.py 从原库生成）
   ============================================================ */
(function () {
  'use strict';

  var DB = window.DB || {};
  var EPL = window.EVENT_PLACE || {};
  var EPLS = window.EVENT_PLACES || {};   // 多点事件的逐地点定位（地名索引、地图用；不改事件详情）
  var BM = window.BASEMAP || { rivers: [], bbox: [70, 14, 140, 55] };
  var META = DB.meta || {};
  var C = META.counts || {};
  var EVENTS = DB.events || [];
  var EXCL = DB.excluded || [];
  var TCOLOR = DB.type_colors || {};
  var DYN_ORDER = META.dynasty_order || [];
  var TYPE_ORDER = META.type_order || [];
  var PREC_NAME = { exact: '单年', range: '区间', approx: '推定', none: '不详', unknown: '不详' };
  var GEO_PREC = { exact: '精确地点', county: '州县级', region: '区域级', macro: '大范围', unknown: '不详', doubt: '存疑' };

  var byId = {};
  EVENTS.forEach(function (e) { byId[e.id] = e; });

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function cnYear(y) {
    if (y == null) return '—';
    return y < 0 ? '前' + (-y) : String(y);
  }
  function typeColor(t) { return TCOLOR[t] || '#8c3a34'; }
  var PLACE_ALIAS = { '江、淮间': '江、淮' };
  function basePlace(s) {
    var k = String(s || '').replace(/[（(][^）)]*[)）]/g, '').trim();
    return PLACE_ALIAS[k] || k;
  }

  /* 收录判定：原「确认纳入／候选纳入」两级已取消，正式事件一律记为「纳入」 */
  var VERDICT = '纳入';

  /* 地点：一条事件可对应多处（拆分见 places.js 的 EVENT_PLACES），
     地图、地名索引按逐地点处理；事件详情仍用 EVENT_PLACE 的原定位。 */
  function refsOf(id) {
    var a = EPLS[id];
    return a && a.length ? a : (EPL[id] || []);
  }
  function placesOf(e) {
    /* 取定位表解析后的地名（「京师」归洛阳／长安、「金光门（长安）」归长安），
       与地点索引、筛选下拉同口径；无定位表时退回原文基名。 */
    var a = refsOf(e.id);
    return a.length ? a.map(function (r) { return r.n; }) : [basePlace(e.place)];
  }
  function refOfPlace(name, ids) {
    for (var i = 0; i < ids.length; i++) {
      var a = EPLS[ids[i]] || [];
      for (var j = 0; j < a.length; j++) if (a[j].n === name) return a[j];
    }
    return (EPL[ids[0]] || [])[0] || {};
  }

  /* 从年代原文解析区间（仅 prec=range 时） */
  function parseRange(e) {
    if (e.prec !== 'range' || e.year == null) return null;
    var m = String(e.year_text).match(/(\d{1,4})\s*[—–\-~至]\s*(\d{1,4})/);
    if (!m) return null;
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (/前/.test(e.year_text.slice(0, e.year_text.indexOf(m[0]) + 1))) { a = -a; b = -b; }
    if (a > b) { var t = a; a = b; b = t; }
    return [a, b];
  }

  /* 原文渲染：命中句高亮 + 缺字标记 */
  var TRIM_L = '」』】）。，、；：！？…';
  var TRIM_R = '「『【（。，、；：！？…';
  function quoteHTML(r, sim) {
    var t = sim ? (r.full_sim || '') : (r.full || r.quote || '');
    var hs = r.hs, he = r.he;
    var out;
    if (r.full && hs != null && he != null && he > hs && he <= t.length) {
      // 只对显示用的高亮边界做标点修剪，不改动底层偏移与命中句
      var a = hs, b = he;
      while (a < b - 1 && TRIM_L.indexOf(t.charAt(a)) >= 0) a++;
      while (b > a + 1 && TRIM_R.indexOf(t.charAt(b - 1)) >= 0) b--;
      out = esc(t.slice(0, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>' + esc(t.slice(b));
    } else {
      out = esc(t || r.quote || '');
    }
    return out.replace(/[\uE000-\uF8FF]/g, '<span class="pua" title="底本缺字（私用区码位），引用前须核纸本">□</span>');
  }

  /* 概述首句，用作列表摘要 */
  function firstSentence(s, n) {
    s = String(s || '');
    var m = s.match(/^[^。！？]*[。！？]/);
    var t = m ? m[0] : s;
    if (t.length > (n || 52)) t = t.slice(0, n || 52) + '…';
    return t;
  }

  /* ---------------- 状态 ---------------- */
  var state = {
    view: 'overview',
    q: '',
    dyn: '',
    type: '',
    yFrom: '',
    yTo: '',
    prec: '',
    place: '',
    sort: 'time-asc',
    sel: null,
    exGroup: '',
    exQ: '',
    personQ: '',
    placeQ: '',
    book: '',
    mapPrec: '',
    mapPlace: null
  };

  function blankFilter() {
    return { q: '', dyn: '', type: '', yFrom: '', yTo: '', prec: '', place: '', book: '', sort: state.sort };
  }

  /* ---------------- 筛选 ---------------- */
  function match(e, f) {
    if (f.dyn && e.dynasty !== f.dyn) return false;
    if (f.type && e.type !== f.type) return false;
    if (f.prec && e.prec !== f.prec) return false;
    if (f.place && placesOf(e).indexOf(f.place) < 0) return false;
    if (f.book && !e.records.some(function (r) { return r.book === f.book; })) return false;
    if (f.yFrom !== '' && f.yFrom != null) {
      var lo = parseInt(f.yFrom, 10);
      var hi = f.yTo !== '' && f.yTo != null ? parseInt(f.yTo, 10) : 9999;
      var r = parseRange(e);
      var a = r ? r[0] : e.year, b = r ? r[1] : e.year;
      if (b < lo || a > hi) return false;
    }
    if (f.q) {
      var q = f.q.toLowerCase();
      if (e._blob.indexOf(q) < 0) return false;
    }
    return true;
  }

  function buildBlob(e) {
    var parts = [e.id, e.year_text, cnYear(e.year), e.dynasty, e.place, e.type, e.overview, e.note, e.main_src, e.audit];
    e.records.forEach(function (r) {
      parts.push(r.book, r.pian, r.person, r.year_text, r.place, r.quote, r.hit_preview, r.note);
    });
    e._blob = parts.join(' ').toLowerCase();
  }
  EVENTS.forEach(buildBlob);

  function sortEvents(arr, sort) {
    var a = arr.slice();
    var di = function (d) { var i = DYN_ORDER.indexOf(d); return i < 0 ? 99 : i; };
    if (sort === 'time-desc') a.sort(function (x, y) { return (y.year || 0) - (x.year || 0); });
    else if (sort === 'records') a.sort(function (x, y) { return y.n_records - x.n_records || (x.year || 0) - (y.year || 0); });
    else if (sort === 'dynasty') a.sort(function (x, y) { return di(x.dynasty) - di(y.dynasty) || (x.year || 0) - (y.year || 0); });
    else a.sort(function (x, y) { return (x.year || 0) - (y.year || 0); });
    return a;
  }

  function filtered() {
    return sortEvents(EVENTS.filter(function (e) { return match(e, state); }), state.sort);
  }

  /* ---------------- 顶部 / 导航 ---------------- */
  // aux: 不占导航条，放在顶栏右侧（与「简体对照」并列）
  var VIEWS = [
    { k: 'overview', t: '总览' },
    { k: 'events', t: '事件名录' },
    { k: 'timeline', t: '时间轴' },
    { k: 'map', t: '历史地图' },
    { k: 'places', t: '地点索引' },
    { k: 'persons', t: '人物索引' },
    { k: 'excluded', t: '排除材料', aux: 'auxExcluded' },
    { k: 'about', t: '资料说明', aux: 'auxAbout' }
  ];

  function renderNav() {
    var box = $('#nav');
    box.innerHTML = '';
    VIEWS.forEach(function (v) {
      if (v.aux) return;
      var b = el('button', v.k === state.view ? 'on' : '', v.t);
      b.onclick = function () { go(v.k); };
      box.appendChild(b);
    });
    VIEWS.forEach(function (v) {
      if (!v.aux) return;
      var btn = $('#' + v.aux);
      if (btn) btn.classList.toggle('on', v.k === state.view);
    });
  }

  function renderTop() {
    $('#foot').innerHTML =
      '<b>人相食主题总库</b> · 正史中的人相食 · 二十四史与《清史稿》人相食记载专题数据库 · ' +
      '正式事件 ' + C.events + ' 条，关联史料 ' + C.records_events + ' 条；排除材料 ' + C.excluded + ' 条。<br>' +
      '底本为电子转录文本，非校勘定本，正式引用须核对纸本或权威影印本。';
  }

  /* ---------------- 总览 ---------------- */
  function renderOverview() {
    $('#ovStats').innerHTML =
      '<div class="stat"><div class="k">正式事件</div><div class="v">' + C.events + '</div>' +
      '<div class="d">判定为实际发生的人相食事件，构成事件名录、时间轴与地图的主体。</div></div>' +
      '<div class="stat gold"><div class="k">关联史料</div><div class="v">' + C.records_events + '</div>' +
      '<div class="d">正式事件所辖记载条数，来自 ' + C.books + ' 部正史；事件数不等于史料数。</div></div>' +
      '<div class="stat blue"><div class="k">排除材料</div><div class="v">' + C.excluded + '</div>' +
      '<div class="d">检索命中而不符合收录标准者（同形异义、修辞、典故、泛述、族俗等），保留以供检验筛选标准。</div></div>';

    var entries = [
      ['浏览全部事件', '按时间顺序通览 ' + C.events + ' 条正式事件', function () { go('events'); }],
      ['时间轴', '朝代分区 + 年代刻度，可缩放通览', function () { go('timeline'); }],
      ['地点索引', C.places + ' 处地点，按区域分组', function () { go('places'); }],
      ['人物索引', C.persons + ' 位人物，按事件索引', function () { go('persons'); }]
    ];
    var box = $('#ovEntries'); box.innerHTML = '';
    entries.forEach(function (x, i) {
      var b = el('button', 'entry', '<i class="en">0' + (i + 1) + '</i><b>' + x[0] + '</b><span>' + x[1] + '</span>');
      b.onclick = x[2]; box.appendChild(b);
    });

    var maxD = Math.max.apply(null, Object.keys(META.dynasty).map(function (k) { return META.dynasty[k]; }));
    $('#ovBars').innerHTML = Object.keys(META.dynasty).map(function (k) {
      var v = META.dynasty[k];
      return '<div class="bar-row" data-dyn="' + esc(k) + '"><span class="n">' + esc(k) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (v / maxD * 100).toFixed(1) + '%"></span></span>' +
        '<span class="c">' + v + '</span></div>';
    }).join('');
    $$('#ovBars .bar-row').forEach(function (r) {
      r.onclick = function () { state.dyn = r.dataset.dyn; go('events'); };
    });

    var maxT = Math.max.apply(null, Object.keys(META.type).map(function (k) { return META.type[k]; }));
    $('#ovTypes').innerHTML = Object.keys(META.type).map(function (k) {
      var v = META.type[k];
      return '<div class="bar-row" data-type="' + esc(k) + '"><span class="n">' + esc(k) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + (v / maxT * 100).toFixed(1) + '%;background:' + typeColor(k) + '"></span></span>' +
        '<span class="c">' + v + '</span></div>';
    }).join('');
    $$('#ovTypes .bar-row').forEach(function (r) {
      r.onclick = function () { state.type = r.dataset.type; go('events'); };
    });

    renderBookPie();
  }

  /* ---------------- 史书分布（饼图） ---------------- */
  var ALL_BOOKS = ['史记', '汉书', '后汉书', '三国志', '晋书', '宋书', '南齐书', '梁书', '陈书', '魏书',
    '北齐书', '周书', '隋书', '南史', '北史', '旧唐书', '新唐书', '旧五代史', '新五代史',
    '宋史', '辽史', '金史', '元史', '明史', '清史稿'];
  var BOOK_COLORS = ['#8c3a34', '#a04a3c', '#b45a3f', '#c26f45', '#c9854c', '#c99b58', '#bfae63', '#a9ad68',
    '#8fa56b', '#749a6e', '#589073', '#448877', '#3c7f80', '#3f7588', '#456a8b', '#4f5f85',
    '#5d5580', '#6d4c74', '#7d4566', '#8d4455', '#96504a', '#8a5f52'];
  var BOOK_STATS = null, BOOK_SEL = '';

  function bookStats() {
    if (BOOK_STATS) return BOOK_STATS;
    var m = {};
    EVENTS.forEach(function (e) {
      var seen = {};
      e.records.forEach(function (r) {
        var b = r.book;
        if (!b) return;
        if (!m[b]) m[b] = { name: b, count: 0, events: {}, pians: {}, types: {}, years: [] };
        var x = m[b];
        x.count++;
        x.pians[r.pian] = 1;
        if (e.type) x.types[e.type] = (x.types[e.type] || 0) + 1;
        if (!seen[b]) {
          seen[b] = 1;
          x.events[e.id] = 1;
          if (e.year != null) x.years.push(e.year);
        }
      });
    });
    BOOK_STATS = Object.keys(m).map(function (k) {
      var x = m[k];
      return {
        name: k, count: x.count,
        events: Object.keys(x.events).length,
        pians: Object.keys(x.pians).length,
        types: x.types,
        y0: x.years.length ? Math.min.apply(null, x.years) : null,
        y1: x.years.length ? Math.max.apply(null, x.years) : null
      };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'zh'); });
    return BOOK_STATS;
  }

  function polar(cx, cy, r, ang) { return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]; }

  function slicePath(cx, cy, R, r, a0, a1) {
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    var p0 = polar(cx, cy, R, a0), p1 = polar(cx, cy, R, a1);
    var q1 = polar(cx, cy, r, a1), q0 = polar(cx, cy, r, a0);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) +
      'L' + q1[0].toFixed(2) + ' ' + q1[1].toFixed(2) +
      'A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + q0[0].toFixed(2) + ' ' + q0[1].toFixed(2) + 'Z';
  }

  function bookDetailHTML(b, total) {
    var types = Object.keys(b.types).sort(function (x, y) { return b.types[y] - b.types[x]; })
      .map(function (t) { return esc(t) + ' ' + b.types[t]; }).join(' · ');
    var span = (b.y0 == null) ? '年代不详' : (cnYear(b.y0) + (b.y1 !== b.y0 ? '—' + cnYear(b.y1) : '') + ' 年');
    return '<b>' + esc(b.name) + '</b>　记载 <b>' + b.count + '</b> 条（占 ' + (b.count / total * 100).toFixed(1) + '%）' +
      '　·　关联事件 ' + b.events + ' 条　·　篇目 ' + b.pians + ' 篇　·　' + span + '<br>' +
      '<span class="muted">事件类型：' + (types || '—') + '</span>';
  }

  function applyBookSel(name) {
    BOOK_SEL = name || '';
    $$('#ovBookPie .bk-slice').forEach(function (p) { p.classList.toggle('on', p.dataset.b === BOOK_SEL); });
    $$('#ovBookLegend .bk').forEach(function (x) { x.classList.toggle('on', x.dataset.b === BOOK_SEL); });
    var list = bookStats();
    var total = list.reduce(function (s, b) { return s + b.count; }, 0);
    var d = $('#ovBookDetail');
    if (!d) return;
    if (!BOOK_SEL) {
      d.innerHTML = '';
      d.style.display = 'none';
      return;
    }
    d.style.display = '';
    var b = list.filter(function (x) { return x.name === BOOK_SEL; })[0];
    d.innerHTML = b ? bookDetailHTML(b, total) : '';
  }

  function renderBookPie() {
    var list = bookStats();
    var total = list.reduce(function (s, b) { return s + b.count; }, 0);
    var C = 120, R = 108, r0 = 64, a = -Math.PI / 2;
    var paths = '';
    list.forEach(function (b, i) {
      var a2 = a + b.count / total * Math.PI * 2;
      paths += '<path class="bk-slice" data-b="' + esc(b.name) + '" d="' + slicePath(C, C, R, r0, a, a2) +
        '" fill="' + BOOK_COLORS[i % BOOK_COLORS.length] + '" stroke="#fff" stroke-width="1.1"><title>' +
        esc(b.name) + '　' + b.count + ' 条（' + (b.count / total * 100).toFixed(1) + '%）</title></path>';
      a = a2;
    });
    $('#ovBookPie').innerHTML =
      '<svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="史书记载数占比">' +
      paths +
      '<text x="120" y="115" text-anchor="middle" font-size="26" font-family="var(--serif)" fill="#23201d">' + total + '</text>' +
      '<text x="120" y="136" text-anchor="middle" font-size="11" fill="#8a7f72">条记载 · ' + list.length + ' 部</text>' +
      '</svg>';

    $('#ovBookLegend').innerHTML = list.map(function (b, i) {
      return '<button class="bk" data-b="' + esc(b.name) + '"><i style="background:' + BOOK_COLORS[i % BOOK_COLORS.length] + '"></i>' +
        '<span>' + esc(b.name) + '</span><b>' + b.count + '</b></button>';
    }).join('') +
      '<button class="bk zero" title="《周书》无正式事件记载"><i style="background:#cfc8bc"></i><span>周书</span><b>0</b></button>';

    $$('#ovBookPie .bk-slice').forEach(function (p) {
      p.onclick = function () { applyBookSel(p.dataset.b); };
    });
    $$('#ovBookLegend .bk:not(.zero)').forEach(function (x) {
      x.onclick = function () { applyBookSel(BOOK_SEL === x.dataset.b ? '' : x.dataset.b); };
    });
    applyBookSel(BOOK_SEL);
  }

  /* ---------------- 筛选条 ---------------- */
  var PLACE_OPTS = (DB.place_index || []).map(function (p) { return p.name; });

  function filterBarHTML(idPrefix, extra, opts) {
    opts = opts || {};
    var dyns = Object.keys(META.dynasty);
    var types = Object.keys(META.type);
    var h = '';
    if (!opts.noSearch) {
      h += '<div class="f-row">' +
        '<div class="search-box"><input id="' + idPrefix + 'Q" type="search" placeholder="输入关键词（编号、年代、朝代、地点、人物、类型、史书、篇名、原文、概述），按回车或点「搜索」" autocomplete="off" value="' + esc(state.q) + '" />' +
        '<button class="clr" data-clr="q" aria-label="清空搜索">×</button></div>' +
        '<button class="btn primary" data-act="search">搜索</button>' +
        '<button class="btn" data-act="clear">清空筛选</button>' +
        '<span class="f-summary" id="' + idPrefix + 'Sum"></span></div>';
    }

    var g = function (label, inner) {
      return '<span class="fgrp"><span class="f-label">' + label + '</span>' + inner + '</span>';
    };
    h += '<div class="f-row">' +
      g('朝代', '<select class="f" data-f="dyn"><option value="">全部</option>' +
        dyns.map(function (d) { return '<option value="' + esc(d) + '"' + (state.dyn === d ? ' selected' : '') + '>' + esc(d) + '（' + META.dynasty[d] + '）</option>'; }).join('') + '</select>') +
      g('类型', '<select class="f" data-f="type"><option value="">全部</option>' +
        types.map(function (d) { return '<option value="' + esc(d) + '"' + (state.type === d ? ' selected' : '') + '>' + esc(d) + '（' + META.type[d] + '）</option>'; }).join('') + '</select>') +
      g('地点', '<select class="f" data-f="place"><option value="">全部</option>' +
        PLACE_OPTS.map(function (d) { return '<option value="' + esc(d) + '"' + (state.place === d ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>') +
      g('年份', '<input class="f" style="width:82px;padding:7px 8px;border:1px solid var(--line);border-radius:6px;background:var(--paper-2)" data-f="yFrom" placeholder="起（前用-）" value="' + esc(state.yFrom) + '" />' +
        '<span class="muted tiny">—</span>' +
        '<input class="f" style="width:82px;padding:7px 8px;border:1px solid var(--line);border-radius:6px;background:var(--paper-2)" data-f="yTo" placeholder="止" value="' + esc(state.yTo) + '" />') +
      '<select class="f" data-f="prec"><option value="">年份精度不限</option>' +
      ['exact', 'range', 'approx'].map(function (p) { return '<option value="' + p + '"' + (state.prec === p ? ' selected' : '') + '>精度：' + PREC_NAME[p] + '（' + (EVENTS.filter(function (e) { return e.prec === p; }).length) + '）</option>'; }).join('') +
      '</select>' +
      g('史书', '<select class="f" data-f="book"><option value="">全部</option>' +
        Object.keys(META.book).map(function (b) {
          return '<option value="' + esc(b) + '"' + (state.book === b ? ' selected' : '') + '>' + esc(b) + '（' + META.book[b] + '）</option>';
        }).join('') + '</select>') +
      g('排序', '<select class="f" data-f="sort">' +
        [['time-asc', '时间升序'], ['time-desc', '时间降序'], ['records', '关联史料数'], ['dynasty', '朝代顺序']].map(function (o) {
          return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>') + (extra || '') +
      (opts.noSearch ? '<button class="btn" data-act="clear">清空筛选</button>' +
        '<span class="f-summary" id="' + idPrefix + 'Sum"></span>' : '') +
      '</div>';

    h += '<div class="f-row" id="' + idPrefix + 'Chips" style="display:none"></div>';
    return h;
  }

  function wireFilterBar(root, rerender) {
    var q = $('input[type=search]', root);
    var doSearch = function () {
      if (!q) return;
      state.q = q.value.trim();
      rerender();
    };
    if (q) {
      // 只在回车或点「搜索」时检索，避免边打字边跳转
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      });
    }
    var sbtn = $('[data-act=search]', root);
    if (sbtn) sbtn.onclick = doSearch;

    $$('[data-f]', root).forEach(function (s) {
      s.addEventListener('change', function () {
        state[s.dataset.f] = s.value;
        rerender();
      });
    });
    $$('[data-clr]', root).forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.clr; state[k] = '';
        rerender();
      };
    });
    var cb = $('[data-act=clear]', root);
    if (cb) cb.onclick = function () {
      var sort = state.sort;
      Object.keys(blankFilter()).forEach(function (k) { if (k !== 'sort') state[k] = ''; });
      state.sort = sort;
      rerender();
    };
  }

  function updateChips(rootId, count) {
    var box = $('#' + rootId + 'Chips');
    if (!box) return;
    var chips = [];
    if (state.q) chips.push(['q', '关键词：' + state.q]);
    if (state.dyn) chips.push(['dyn', '朝代：' + state.dyn]);
    if (state.type) chips.push(['type', '类型：' + state.type]);
    if (state.place) chips.push(['place', '地点：' + state.place]);
    if (state.prec) chips.push(['prec', '精度：' + PREC_NAME[state.prec]]);
    if (state.book) chips.push(['book', '史书：' + state.book]);
    if (state.yFrom || state.yTo) chips.push(['year', '年份：' + (state.yFrom || '…') + ' — ' + (state.yTo || '…')]);
    if (!chips.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    box.innerHTML = chips.map(function (c) {
      return '<span class="f-chip">' + esc(c[1]) + '<button data-k="' + c[0] + '" aria-label="移除">×</button></span>';
    }).join('');
    $$('button[data-k]', box).forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        if (k === 'year') { state.yFrom = ''; state.yTo = ''; } else state[k] = '';
        renderEvents();
      };
    });
    var s = $('#' + rootId + 'Sum');
    if (s) s.innerHTML = '当前 <b>' + count + '</b> / ' + C.events + ' 条';
  }

  /* ---------------- 事件名录 ---------------- */
  function renderEvents() {
    var box = $('#filters');
    box.innerHTML = filterBarHTML('f1');
    wireFilterBar(box, renderEvents);

    var arr = filtered();
    updateChips('f1', arr.length);
    $('#listCount').textContent = '共 ' + arr.length + ' 条事件';
    $('#listSort').textContent = { 'time-asc': '时间升序', 'time-desc': '时间降序', 'records': '史料数', 'dynasty': '朝代顺序' }[state.sort] || '';

    var list = $('#evList');
    list.innerHTML = '';
    if (!arr.length) {
      list.appendChild(el('div', 'empty', '<div class="big">没有匹配的事件</div><p>请放宽筛选条件，或点击上方「清空筛选」。</p>'));
      renderDetail(null);
      return;
    }
    var frag = document.createDocumentFragment();
    arr.forEach(function (e) {
      var b = el('button', 'ev-item' + (state.sel === e.id ? ' sel' : ''));
      b.dataset.id = e.id;
      b.innerHTML =
        '<div class="l1"><span class="dyn">' + esc(e.dynasty) + '</span>' +
        '<span class="yr">' + esc(e.year_text) + '</span>' +
        '<span class="tag" style="background:' + typeColor(e.type) + '14;color:' + typeColor(e.type) + ';border-color:' + typeColor(e.type) + '33">' + esc(e.type) + '</span>' + '</div>' +
        '<div class="l2">' + esc(firstSentence(e.overview, 54)) + '</div>' +
        '<div class="l3"><span>' + esc(e.place) + '</span><span>·</span><span>' + e.n_records + ' 条史料</span>' +
        '<span>·</span><span>' + esc(e.main_src) + '</span></div>';
      b.onclick = function () { selectEvent(e.id, false); };
      frag.appendChild(b);
    });
    list.appendChild(frag);

    if (state.sel && byId[state.sel] && arr.some(function (x) { return x.id === state.sel; })) {
      renderDetail(byId[state.sel]);
      markSel();
    } else if (window.innerWidth > 820) {
      state.sel = arr[0].id;
      renderDetail(arr[0]);
      markSel();
    } else {
      state.sel = null;
      renderDetail(null);
    }
  }

  function markSel() {
    $$('#evList .ev-item').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.id === state.sel);
    });
  }

  function selectEvent(id, fromMap) {
    state.sel = id;
    markSel();
    var e = byId[id];
    renderDetail(e);
    var node = $('#evList .ev-item[data-id="' + id + '"]');
    if (node) node.scrollIntoView({ block: 'nearest' });
    if (window.innerWidth <= 820) $('#evSplit').classList.add('detail-open');
    if (fromMap) { go('events', true); }
    history.replaceState(null, '', '#/events/' + id);
  }

  function simHTML(r) {
    if (!r.full_sim || r.full_sim === r.full) return '';
    return '<div class="quote-sim"><span class="lab">简体对照（机器转换，仅供阅读；引用以繁体原文为准）</span>' + quoteHTML(r, true) + '</div>';
  }

  function recHTML(r, idx) {
    var v = '<span class="tag green">' + VERDICT + '</span>';
    var pua = r.pua ? '<span class="tag grey" title="底本篇目含私用区缺字">缺字 ' + r.pua + '</span>' : '';
    var sim = simHTML(r);

    return '<div class="rec">' +
      '<div class="rec-h"><span class="src">' + esc(r.book) + '</span><span class="pian">' + esc(r.pian) + '</span>' +
      (r.pian_class ? '<span class="tag grey">' + esc(r.pian_class) + '</span>' : '') +
      '<span class="sp"></span>' + pua + v + '</div>' +
      '<div class="rec-meta">' +
      '<span>记载年代 <b>' + esc(r.year_text || '—') + '</b></span>' +
      '<span>记载地点 <b>' + esc(r.place || '—') + '</b></span>' +
      '<span>相关人物 <b>' + esc(r.person || '—') + '</b></span>' +
      '</div>' +
      '<div class="quote">' + quoteHTML(r, false) + '</div>' + sim +
      '<div class="rec-f"><span>命中句已标黄，此处为命中所在自然段。</span>' +
      '<button class="btn ghost" data-full="' + esc(r.file_path) + '" style="margin-left:auto;padding:2px 10px;font-size:12px">查看整篇原文</button></div>' +
      '</div>';
  }

  function renderDetail(e) {
    var box = $('#detBody');
    if (!e) {
      $('#detWho').textContent = '未选择事件';
      box.innerHTML = '<div class="empty"><div class="big">从左侧选择一条事件</div>' +
        '<p>右侧将固定显示该事件的基本信息、事件概述与全部相关史料原文。切换事件时，左侧列表的位置与筛选条件都会保留。</p></div>';
      return;
    }
    $('#detWho').textContent = e.id + ' · ' + e.dynasty + ' · ' + e.year_text;
    box.innerHTML = detailHTML(e);
    box.scrollTop = 0;
  }

  /* 事件详情 HTML：名录详情面板与预览窗共用 */
  function detailHTML(e) {

    var recs = e.records.slice().sort(function (a, b) {
      var ba = a.book, bb = b.book;
      return ba === bb ? (parseInt(a.rank || 0, 10) - parseInt(b.rank || 0, 10)) : (ba < bb ? -1 : 1);
    });

    var precTxt = PREC_NAME[e.prec] || e.prec;

    var h = '<div class="d-head">' +
      '<div class="eyebrow">' +
      '<span class="tag" style="background:' + typeColor(e.type) + '14;color:' + typeColor(e.type) + ';border-color:' + typeColor(e.type) + '33">' + esc(e.type) + '</span>' +
      '<span class="tag grey">' + esc(e.dynasty) + '</span>' +
      '<span class="tag green">' + VERDICT + '</span>' +
      '<span class="tag grey">' + e.id + '</span></div>' +
      '<h2>' + esc(e.place) + ' · ' + esc(e.year_text) + '</h2>' +
      '<div class="meta"><span>公元 ' + cnYear(e.year) + ' 年</span><span>年份精度：' + precTxt + '</span>' +
      '<span>关联史料 ' + e.n_records + ' 条（独立 ' + e.n_indep + ' 条）</span><span>主要出处：' + esc(e.main_src) + '</span></div>' +
      '</div>';

    h += '<div class="d-sec"><h3>基本信息</h3><div class="kv">' +
      '<div><div class="k">年代原文</div><div class="v serif">' + esc(e.year_text) + '</div></div>' +
      '<div><div class="k">朝代</div><div class="v">' + esc(e.dynasty) + '</div></div>' +
      '<div><div class="k">公元年份</div><div class="v">' + cnYear(e.year) + '（' + precTxt + '）</div></div>' +
      '<div><div class="k">年份精度</div><div class="v">' + precTxt + '</div></div>' +
      '<div><div class="k">地点</div><div class="v">' + esc(e.place) + '</div></div>' +
      '<div><div class="k">事件类型</div><div class="v">' + esc(e.type) + '</div></div>' +
      '<div><div class="k">涉及人物</div><div class="v">' + esc(personsOf(e)) + '</div></div>' +
      '</div></div>';

    h += '<div class="d-sec"><h3>事件概述</h3><div class="overview">' + esc(e.overview) + '</div></div>';

    h += '<div class="d-sec"><h3>相关史料 <span class="cnt">共 ' + recs.length + ' 条</span></h3>' +
      recs.map(recHTML).join('') + '</div>';

    return h;
  }

  /* 人物：一条记载可并列数人（如「董璋、姚洪」），索引与详情按单名拆开；
     「无（城守）」「无（本纪不系人）」等占位值不入索引。 */
  function personsOfRec(p) {
    var out = [];
    if (!p || p === '不详' || String(p).charAt(0) === '无') return out;
    String(p).split(/[、，,]/).forEach(function (x) {
      x = x.trim();
      if (!x || x === '不详' || x.charAt(0) === '无') return;
      if (out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  function personsOf(e) {
    var seen = [];
    e.records.forEach(function (r) {
      personsOfRec(r.person).forEach(function (p) {
        if (seen.indexOf(p) < 0) seen.push(p);
      });
    });
    return seen.join('、') || '—';
  }


  /* ---------------- 预览窗：在地图／时间轴／地点／人物页内先看，再决定是否跳转 ---------------- */
  var PEEK = { kind: '', id: '', place: '' };

  function closePeek() {
    var box = $('#peek');
    if (!box || box.hidden) return;
    box.hidden = true;
    PEEK = { kind: '', id: '', place: '' };
  }

  function peekItemHTML(ev) {
    return '<button class="peek-item" data-ev="' + ev.id + '">' +
      '<div class="l1"><span class="dyn">' + esc(ev.dynasty) + '</span><span class="yr">' + esc(ev.year_text) + '</span>' +
      '<span class="tag" style="background:' + typeColor(ev.type) + '14;color:' + typeColor(ev.type) + ';border-color:' + typeColor(ev.type) + '33">' + esc(ev.type) + '</span>' +
      '<span>' + ev.id + '</span></div>' +
      '<div class="l2">' + esc(firstSentence(ev.overview, 76)) + '</div>' +
      '<div class="l3">' + esc(ev.place) + ' · ' + ev.n_records + ' 条史料 · ' + esc(ev.main_src) + '</div></button>';
  }

  function bindPeekItems() {
    $$('#peekBody [data-ev]').forEach(function (b) {
      b.onclick = function () { openEventPeek(b.dataset.ev); };
    });
  }

  function openEventPeek(id) {
    var e = byId[id];
    if (!e) return;
    PEEK = { kind: 'event', id: id, place: '' };
    $('#peekTitle').textContent = e.place + ' · ' + e.year_text;
    $('#peekSub').textContent = e.id + ' · ' + e.dynasty + ' · ' + e.type;
    $('#peekBody').innerHTML = detailHTML(e);
    $('#peekGo').textContent = '跳转至事件名录 →';
    $('#peekGo').dataset.act = 'event';
    $('#peek').hidden = false;
    $('#peekBody').scrollTop = 0;
  }

  function openPlacePeek(name) {
    var p = (DB.place_index || []).filter(function (x) { return x.name === name; })[0];
    if (!p) return;
    var ref = refOfPlace(name, p.events);
    var evs = p.events.map(function (id) { return byId[id]; }).filter(Boolean)
      .sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
    PEEK = { kind: 'place', id: '', place: name };
    $('#peekTitle').textContent = name;
    $('#peekSub').textContent = (ref.m || '未定位') + ' · ' + evs.length + ' 条事件';
    $('#peekBody').innerHTML =
      '<div class="d-head"><div class="eyebrow">' +
      '<span class="tag grey">地点</span><span class="tag grey">' + esc(p.level || '未分类') + '</span>' +
      '<span class="tag grey">' + esc(p.region || '') + '</span></div>' +
      '<h2>' + esc(name) + '</h2>' +
      '<div class="meta"><span>今地：' + esc(ref.m || '未考') + '</span>' +
      '<span>定位精度：' + (GEO_PREC[ref.p] || '未定') + '</span>' +
      '<span>关联事件 ' + evs.length + ' 条</span></div></div>' +
      '<div class="d-sec"><h3>相关事件</h3>' +
      (evs.length ? evs.map(peekItemHTML).join('') : '<div class="muted tiny">无</div>') + '</div>';
    $('#peekGo').textContent = '跳转至事件名录（按此地点筛选）→';
    $('#peekGo').dataset.act = 'place';
    $('#peek').hidden = false;
    $('#peekBody').scrollTop = 0;
    bindPeekItems();
  }

  function peekGo() {
    if (PEEK.kind === 'event') {
      var id = PEEK.id;
      closePeek();
      selectEvent(id, true);
      return;
    }
    if (PEEK.kind === 'place') {
      var name = PEEK.place;
      closePeek();
      state.place = name;
      go('events');
    }
  }

  /* ---------------- 整篇原文阅读器 ---------------- */
  var TEXT_LOADED = {}, TEXT_FAILED = {};

  function bookOf(fp) {
    var p = String(fp || '').split('/');
    return p.length > 2 ? p[1] : '';
  }

  function loadBook(book, cb) {
    if (TEXT_LOADED[book]) return cb(null);
    if (TEXT_FAILED[book]) return cb('fail');
    var fid = (window.TEXT_FILES || {})[book];
    if (!fid) { TEXT_FAILED[book] = 1; return cb('fail'); }
    var sc = document.createElement('script');
    sc.src = 'assets/texts/' + fid + '.js';
    sc.onload = function () { TEXT_LOADED[book] = 1; cb(null); };
    sc.onerror = function () { TEXT_FAILED[book] = 1; cb('fail'); };
    document.head.appendChild(sc);
  }

  /* 按段落切分，并在 [a,b) 区间插入 mark，偏移严格对应底本字符位置 */
  function chapterHTML(text, a, b) {
    var out = [], i = 0, n = text.length;
    while (i < n) {
      var j = text.indexOf('\n', i);
      if (j < 0) j = n;
      var seg;
      var m0 = Math.max(i, a), m1 = Math.min(j, b);
      if (m0 < m1) {
        seg = esc(text.slice(i, m0)) + '<mark>' + esc(text.slice(m0, m1)) + '</mark>' + esc(text.slice(m1, j));
      } else {
        seg = esc(text.slice(i, j));
      }
      if (seg) out.push('<p>' + seg + '</p>');
      while (j < n && text.charCodeAt(j) === 10) j++;
      i = j;
    }
    return out.join('').replace(/[\uE000-\uF8FF]/g, '<span class="pua" title="底本缺字（私用区码位），引用前须核纸本">□</span>');
  }

  function openReader(r) {
    var fp = r.file_path || '', book = bookOf(fp);
    var box = $('#readerBody');
    $('#readerTitle').textContent = (r.book || '') + ' · ' + (r.pian || '');
    $('#readerSub').textContent = '整篇原文';
    box.innerHTML = '<div class="reader-empty">正在载入……</div>';
    $('#reader').hidden = false;
    document.body.style.overflow = 'hidden';
    loadBook(book, function (err) {
      if (err) {
        box.innerHTML = '<div class="reader-empty">该篇原文未随包提供（<code>assets/texts/</code> 缺失）。<br>命中所在段落仍可在史料卡中查看。</div>';
        return;
      }
      var t = (window.TEXTS || {})[fp];
      if (!t) { box.innerHTML = '<div class="reader-empty">该篇原文未收录。</div>'; return; }
      var a = parseInt(r.sent_start, 10), b = parseInt(r.sent_end, 10);
      if (!(b > a)) { a = -1; b = -1; }
      box.innerHTML = '<p class="reader-note">' + esc(book) + ' · ' + esc(r.pian || '') +
        '　整篇原文（繁体，据底本，未删节）。黄色底纹为命中处。</p>' + chapterHTML(t, a, b);
      var m = box.querySelector('mark');
      if (m) m.scrollIntoView({ block: 'center' });
      else box.scrollTop = 0;
    });
  }

  function closeReader() {
    $('#reader').hidden = true;
    document.body.style.overflow = '';
    $('#readerBody').innerHTML = '';
  }

  function locateHit() {
    var m = $('#readerBody mark');
    if (m) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---------------- 时间轴 ---------------- */
  var TL = { from: -620, to: 1930, pad: 44, zoom: 1 };

  function xOf(y, w) {
    var t = (y - TL.from) / (TL.to - TL.from);
    return TL.pad + t * (w - TL.pad * 2);
  }

  function renderTimeline() {
    var box = $('#filters2');
    box.innerHTML = filterBarHTML('f2', null, { noSearch: true });
    wireFilterBar(box, renderTimeline);
    var arr = filtered();
    updateChips('f2', arr.length);
    $('#tlCount').textContent = '共 ' + arr.length + ' 条事件';

    var scroll = $('#tlScroll');
    var baseW = Math.max(640, scroll.clientWidth || 1100);
    var w = Math.round(baseW * TL.zoom);
    $('#tlInner').style.width = w + 'px';

    var nodes = [];
    arr.forEach(function (e) {
      var r = parseRange(e);
      nodes.push({ e: e, a: r ? r[0] : e.year, b: r ? r[1] : e.year, range: !!r });
    });
    // 分道：同一水平位置按最小间距错开
    var laneEnd = [];
    nodes.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
    nodes.forEach(function (n) {
      var x = xOf(n.a, w);
      var lane = 0;
      while (lane < 15 && laneEnd[lane] != null && x - laneEnd[lane] < 12) lane++;
      laneEnd[lane] = xOf(n.b, w);
      n.lane = lane;
      n.x = x;
      n.x2 = xOf(n.b, w);
    });

    // 朝代带
    var axis = $('#tlAxis');
    var bands = (DB.bands || []).filter(function (b) { return b.end > TL.from && b.start < TL.to; });
    var ah = '';
    bands.forEach(function (b) {
      var x1 = xOf(Math.max(b.start, TL.from), w), x2 = xOf(Math.min(b.end, TL.to), w);
      if (x2 - x1 < 1) return;
      ah += '<div class="tl-band" style="left:' + x1 + 'px;width:' + (x2 - x1) + 'px;background:' + b.color + '33">' +
        (x2 - x1 > 30 ? '<span>' + esc(b.name) + '</span>' : '') + '</div>';
    });
    // 刻度：按像素密度自适应
    var steps = [50, 100, 200, 250, 500];
    var step = steps.find(function (s) { return (w - TL.pad * 2) / ((TL.to - TL.from) / s) > 48; }) || 100;
    for (var y = Math.ceil(TL.from / step) * step; y <= TL.to; y += step) {
      var x = xOf(y, w);
      ah += '<div class="tl-tick" style="left:' + x + 'px"><span>' + (y < 0 ? '前' + (-y) : y) + '</span></div>';
    }
    axis.innerHTML = ah;

    var ph = '';
    var gstep = step * 2;
    for (var g = Math.ceil(TL.from / gstep) * gstep; g <= TL.to; g += gstep) {
      ph += '<div class="tl-gl" style="left:' + xOf(g, w) + 'px"></div>';
    }
    nodes.forEach(function (n) {
      // 纵向以中线为轴上下交替展开，避免密集年份堆成单侧长柱
      var off = (n.lane % 2 === 1) ? -((n.lane + 1) / 2) : (n.lane / 2);
      var top = 152 + off * 16;
      var c = typeColor(n.e.type);
      var tip = n.e.year_text + '｜' + n.e.place + '｜' + n.e.type;
      if (n.range) {
        ph += '<div class="tl-node" data-id="' + n.e.id + '" title="' + esc(tip) + '" ' +
          'style="left:' + n.x + 'px;top:' + top + 'px;width:' + Math.max(10, n.x2 - n.x) + 'px;height:8px;border-radius:4px;background:' + c + '"></div>';
      } else if (n.e.prec === 'approx') {
        ph += '<div class="tl-node" data-id="' + n.e.id + '" title="' + esc(tip) + '（推定）" ' +
          'style="left:' + n.x + 'px;top:' + top + 'px;background:#fff;border:2px dashed ' + c + '"></div>';
      } else {
        ph += '<div class="tl-node" data-id="' + n.e.id + '" title="' + esc(tip) + '" ' +
          'style="left:' + n.x + 'px;top:' + top + 'px;background:' + c + '"></div>';
      }
    });
    $('#tlPlot').innerHTML = '<div class="tl-grid">' + ph + '</div>';

    $$('#tlPlot .tl-node').forEach(function (n) {
      if (n.dataset.id === state.sel) n.classList.add('sel');
      n.onclick = function () { openEventPeek(n.dataset.id); };
    });

    // 工具条
    $('#tlToolbar').innerHTML =
      '<span>时间跨度 前 620 — 1930 年，横轴为等距年代刻度</span><span class="grow"></span>' +
      '<span>缩放</span>' +
      [1, 2, 4, 8].map(function (z) {
        return '<button class="zbtn' + (TL.zoom === z ? ' on' : '') + '" data-z="' + z + '">' + z + '×</button>';
      }).join('') +
      '<button class="zbtn" data-z="fit">适配</button>';
    $$('#tlToolbar .zbtn').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.z === 'fit') TL.zoom = 1;
        else TL.zoom = parseFloat(b.dataset.z);
        renderTimeline();
      };
    });

    $('#tlLegend').innerHTML = Object.keys(META.type).map(function (t) {
      return '<span><i style="background:' + typeColor(t) + '"></i>' + esc(t) + '（' + META.type[t] + '）</span>';
    }).join('') +
      '<span style="margin-left:auto;color:var(--ink-4)">圆点＝单年　空心虚线＝推定年份　长条＝年份区间（按起止年跨度绘制）；纵向位置仅用于避让重叠</span>';

    // 年代不详事件（若有）
    var unknown = EVENTS.filter(function (e) { return e.year == null; });
    $('#tlUnknown').innerHTML = unknown.length
      ? '<h3 class="sec-title" style="font-size:14px">年代不详 <small>' + unknown.length + ' 条，不纳入时间轴</small></h3>' +
        '<div class="box">' + unknown.map(function (e) {
          return '<span class="chip" data-id="' + e.id + '">' + esc(e.id + ' ' + e.place + '（' + e.dynasty + '）') + '</span>';
        }).join('') + '</div>'
      : '';
    $$('#tlUnknown .chip').forEach(function (c) {
      c.onclick = function () { openEventPeek(c.dataset.id); };
    });

    // 列表：点行 → 轴上定位；点「查看详情」→ 打开事件详情
    $('#tlList').innerHTML = '<table class="tbl"><thead><tr><th style="width:74px">朝代</th><th style="width:170px">年代</th>' +
      '<th style="width:110px">地点</th><th style="width:76px">类型</th><th>概述</th><th style="width:92px"></th></tr></thead><tbody>' +
      arr.map(function (e) {
        return '<tr data-id="' + e.id + '"><td>' + esc(e.dynasty) + '</td><td class="num">' + esc(e.year_text) + '</td>' +
          '<td>' + esc(e.place) + '</td><td><span style="color:' + typeColor(e.type) + '">' + esc(e.type) + '</span></td>' +
          '<td><div class="q">' + esc(firstSentence(e.overview, 64)) + '</div></td>' +
          '<td><button class="btn ghost" data-detail="' + e.id + '" style="padding:2px 9px;font-size:12px">查看详情</button></td></tr>';
      }).join('') + '</tbody></table>';
    $$('#tlList tr[data-id]').forEach(function (tr) {
      tr.onclick = function (ev) {
        if (ev.target.dataset && ev.target.dataset.detail) return;
        state.sel = tr.dataset.id;
        $$('#tlPlot .tl-node').forEach(function (n) { n.classList.toggle('sel', n.dataset.id === state.sel); });
        var node = $('#tlPlot .tl-node[data-id="' + state.sel + '"]');
        if (node) {
          var left = parseFloat(node.style.left);
          $('#tlScroll').scrollTo({ left: Math.max(0, left - $('#tlScroll').clientWidth / 2), behavior: 'smooth' });
        }
      };
    });
    $$('#tlList button[data-detail]').forEach(function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); openEventPeek(b.dataset.detail); };
    });
  }

  /* ---------------- 地图 ---------------- */
  var BM = window.BASEMAP || { extent: [68, 17, 143, 53], merc: [0, 0], coast: [], lakes: [], rivers: [] };
  var MAP = {
    raster: BM.extent,              // 栅格覆盖范围 [lon0,lat0,lon1,lat1]
    rasterMerc: BM.merc,            // 对应墨卡托 y
    view: null,                     // 当前视野（墨卡托），随画布比例自适应
    k: 1, tx: 0, ty: 0,
    W: 0, H: 0, s: 1,
    layers: { terrain: true, rivers: true, lakes: true, coast: true },
    mode: 'point',
    sel: null,
    cache: null
  };

  function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI; }

  /* 视野按画布比例自适应：以华北为中心，墨卡托纬度跨度 45.4，经度按宽高比伸缩，
     并夹在栅格范围内，保证底图始终铺满画布、不留空白边。 */
  function fitMap() {
    var R = MAP.raster, RM = MAP.rasterMerc;
    var A = MAP.W / MAP.H;
    var mSpan = 45.4, lonSpan = mSpan * A;
    var maxLon = R[2] - R[0], maxM = RM[1] - RM[0];
    if (lonSpan > maxLon) { lonSpan = maxLon; mSpan = lonSpan / A; }
    if (mSpan > maxM) { mSpan = maxM; lonSpan = mSpan * A; }
    var lonC = 105.0, mC = mercY(34.0);
    var lon0 = Math.max(R[0], Math.min(lonC - lonSpan / 2, R[2] - lonSpan));
    var m1 = Math.min(RM[1], Math.max(mC + mSpan / 2, RM[0] + mSpan));
    MAP.view = [lon0, m1 - mSpan, lon0 + lonSpan, m1];   // [lon0, m0, lon1, m1]
    MAP.s = MAP.W / lonSpan;
  }

  function proj(lon, lat) {
    var v = MAP.view;
    return [(lon - v[0]) * MAP.s, (v[3] - mercY(lat)) * MAP.s];
  }
  function toScreen(p) { return [p[0] * MAP.k + MAP.tx, p[1] * MAP.k + MAP.ty]; }

  /* basemap.js 的坐标已是 [经度, 墨卡托Y]，故此处直接用 mercY 值做视图变换，
     绝不可再对 p[1] 调 mercY（否则矢量层会被二次投影、与底图栅格错位）。 */
  function pathOf(pts, close) {
    var d = '', i, p, v = MAP.view;
    for (i = 0; i < pts.length; i++) {
      p = [ (pts[i][0] - v[0]) * MAP.s, (v[3] - pts[i][1]) * MAP.s ];
      d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }
    return close ? d + 'Z' : d;
  }

  /* 底图矢量路径只与画布尺寸有关，缓存复用 */
  function basePaths() {
    if (MAP.cache && MAP.cache.w === MAP.W && MAP.cache.h === MAP.H) return MAP.cache;
    var coast = (BM.coast || []).map(function (l) { return pathOf(l, false); }).join('');
    var lakes = (BM.lakes || []).map(function (l) { return pathOf(l.r, true); }).join('');
    var r1 = '', r2 = '';
    (BM.rivers || []).forEach(function (r) {
      var d = pathOf(r.c, false);
      if (r.k <= 3) r1 += d; else r2 += d;
    });
    var grat = '';
    var v = MAP.view;
    var lat0 = Math.degrees ? 0 : 0;
    for (var lon = Math.ceil(v[0] / 10) * 10; lon <= v[2]; lon += 10) {
      var a = [ (lon - v[0]) * MAP.s, 0 ], b = [ (lon - v[0]) * MAP.s, MAP.H ];
      grat += 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1);
    }
    for (var lat = 10; lat <= 70; lat += 10) {
      var yy = (v[3] - mercY(lat)) * MAP.s;
      if (yy < 0 || yy > MAP.H) continue;
      grat += 'M0 ' + yy.toFixed(1) + 'L' + MAP.W + ' ' + yy.toFixed(1);
    }
    MAP.cache = { w: MAP.W, h: MAP.H, coast: coast, lakes: lakes, r1: r1, r2: r2, grat: grat };
    return MAP.cache;
  }

  /* 参与绘制的点位：按坐标合并，附事件数组 */
  function mapPoints() {
    var groups = {}, arr = filtered();
    arr.forEach(function (e) {
      var refs = refsOf(e.id);
      refs.forEach(function (r) {
        if (r.x == null) return;
        var key = r.x.toFixed(2) + ',' + r.y.toFixed(2);
        if (!groups[key]) groups[key] = { names: [], m: r.m, x: r.x, y: r.y, p: r.p, events: [] };
        var g = groups[key];
        if (g.names.indexOf(r.n) < 0) g.names.push(r.n);
        if (!g.events.some(function (x) { return x.id === e.id; })) g.events.push(e);
      });
    });
    return Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return a.events.length - b.events.length; });
  }

  function precLevels(pts) {
    var c = {};
    pts.forEach(function (p) { c[p.p] = (c[p.p] || 0) + 1; });
    return c;
  }

  /* ---------------- 控制区 ---------------- */
  function renderMapControls(pts) {
    var box = $('#mapControls');
    var lv = precLevels(pts);
    var dyns = Object.keys(META.dynasty);
    var types = Object.keys(META.type);
    var g = function (label, inner) {
      return '<span class="fgrp"><span class="f-label">' + label + '</span>' + inner + '</span>';
    };
    var h = '<div class="mc-row">' +
      g('朝代', '<select data-mf="dyn"><option value="">全部</option>' +
        dyns.map(function (d) { return '<option value="' + esc(d) + '"' + (state.dyn === d ? ' selected' : '') + '>' + esc(d) + '（' + META.dynasty[d] + '）</option>'; }).join('') + '</select>') +
      g('年份', '<input class="f" data-mf="yFrom" placeholder="起（前用-）" value="' + esc(state.yFrom) + '">' +
        '<span class="muted tiny">—</span>' +
        '<input class="f" data-mf="yTo" placeholder="止" value="' + esc(state.yTo) + '">') +
      g('事件类型', '<select data-mf="type"><option value="">全部</option>' +
        types.map(function (d) { return '<option value="' + esc(d) + '"' + (state.type === d ? ' selected' : '') + '>' + esc(d) + '（' + META.type[d] + '）</option>'; }).join('') + '</select>') +
      g('定位精度', '<select data-mf="prec"><option value="">全部（' + pts.length + ' 处）</option>' +
        ['county', 'region', 'doubt', 'macro'].filter(function (k) { return lv[k]; }).map(function (k) {
          return '<option value="' + k + '"' + (state.mapPrec === k ? ' selected' : '') + '>' + GEO_PREC[k] + '（' + lv[k] + '）</option>';
        }).join('') + '</select>') +
      '<button class="btn" data-mact="clear">重置筛选</button>' +
      '<span class="f-summary">当前 <b>' + filtered().length + '</b> / ' + C.events + ' 条事件 · <b>' + pts.length + '</b> 个地点</span>' +
      '</div>';

    h += '<div class="mc-row mc-layers">' +
      '<span class="f-label">图层</span>' +
      [['terrain', '地形晕渲'], ['rivers', '水系'], ['lakes', '湖泊'], ['coast', '海岸线']].map(function (l) {
        return '<button class="lyr' + (MAP.layers[l[0]] ? ' on' : '') + '" data-layer="' + l[0] + '">' + l[1] + '</button>';
      }).join('') +
      '<span class="f-label" style="margin-left:14px">点位</span>' +
      '<button class="lyr' + (MAP.mode === 'point' ? ' on' : '') + '" data-mode="point">事件点位</button>' +
      '<button class="lyr' + (MAP.mode === 'density' ? ' on' : '') + '" data-mode="density">密度分布</button>' +
      '<span class="mc-hint">底图 东经 ' + MAP.raster[0] + '°–' + MAP.raster[2] + '°　北纬 ' + MAP.raster[1] + '°–' + MAP.raster[3] + '°　墨卡托投影</span>' +
      '</div>';
    box.innerHTML = h;

    $$('[data-mf]', box).forEach(function (el2) {
      el2.addEventListener('change', function () {
        var k = el2.dataset.mf;
        if (k === 'prec') state.mapPrec = el2.value; else state[k] = el2.value;
        renderMap();
      });
    });
    var cb = $('[data-mact=clear]', box);
    if (cb) cb.onclick = function () {
      ['dyn', 'type', 'yFrom', 'yTo', 'place'].forEach(function (k) { state[k] = ''; });
      state.mapPrec = ''; state.q = '';
      renderMap();
    };
    $$('[data-layer]', box).forEach(function (b) {
      b.onclick = function () { MAP.layers[b.dataset.layer] = !MAP.layers[b.dataset.layer]; renderMap(); };
    });
    $$('[data-mode]', box).forEach(function (b) {
      b.onclick = function () { MAP.mode = b.dataset.mode; renderMap(); };
    });
  }

  /* ---------------- 主渲染 ---------------- */
  function renderMap() {
    var stage = $('#mapStage');
    MAP.W = Math.max(320, stage.clientWidth);
    MAP.H = Math.max(320, stage.clientHeight);
    fitMap();

    if (MAP.k < 1) MAP.k = 1;
    clampPan();
    var all = mapPoints();
    var lvAll = precLevels(all);
    if (state.mapPrec && !lvAll[state.mapPrec]) state.mapPrec = '';
    var pts = state.mapPrec ? all.filter(function (p) { return p.p === state.mapPrec; }) : all;
    MAP._pts = pts;
    renderMapControls(pts);

    var svg = $('#mapSvg');
    svg.setAttribute('width', MAP.W);
    svg.setAttribute('height', MAP.H);
    svg.setAttribute('viewBox', '0 0 ' + MAP.W + ' ' + MAP.H);

    var P = basePaths();
    var R = MAP.raster, RM = MAP.rasterMerc;
    var imgX = (R[0] - MAP.view[0]) * MAP.s, imgY = (MAP.view[3] - RM[1]) * MAP.s;
    var iw = (R[2] - R[0]) * MAP.s, ih = (RM[1] - RM[0]) * MAP.s;

    var s = '';
    // 裁剪必须作用在未变换的外层：若把 clip-path 加在带 translate/scale 的图层上，
    // 裁剪框会随图层一起移动，拖拽后画布边缘就会露出空白。
    s += '<defs><clipPath id="mapClip" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="' + MAP.W + '" height="' + MAP.H + '"/></clipPath></defs>';
    s += '<rect x="0" y="0" width="' + MAP.W + '" height="' + MAP.H + '" fill="#e9f0f3"/>';
    s += '<g clip-path="url(#mapClip)"><g id="mapWorld" transform="translate(' + MAP.tx + ',' + MAP.ty + ') scale(' + MAP.k + ')">';

    if (MAP.layers.terrain) {
      s += '<image x="' + imgX.toFixed(1) + '" y="' + imgY.toFixed(1) + '" width="' + iw.toFixed(1) + '" height="' + ih.toFixed(1) +
        '" href="assets/terrain.jpg" preserveAspectRatio="none"/>';
    }
    if (MAP.layers.coast) {
      s += '<path d="' + P.coast + '" fill="none" stroke="#6f828c" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity=".9"/>';
    }
    if (MAP.layers.lakes) {
      s += '<path d="' + P.lakes + '" fill="#cfe4ee" stroke="#93b4c2" stroke-width=".7" vector-effect="non-scaling-stroke" opacity=".95"/>';
    }
    if (MAP.layers.rivers) {
      s += '<path d="' + P.r2 + '" fill="none" stroke="#8fb3c4" stroke-width=".8" vector-effect="non-scaling-stroke" opacity=".8"/>';
      s += '<path d="' + P.r1 + '" fill="none" stroke="#5f8fa8" stroke-width="1.4" vector-effect="non-scaling-stroke" opacity=".9"/>';
    }
    s += '<path d="' + P.grat + '" fill="none" stroke="#8b7f6d" stroke-width=".5" vector-effect="non-scaling-stroke" opacity=".22" stroke-dasharray="2 3"/>';

    if (MAP.mode === 'density') s += densityLayer(all);

    s += '</g></g>';

    // 点位与注记画在屏幕坐标层，缩放时尺寸恒定
    s += '<g id="mapPoints"></g>';
    s += '<g id="mapLabels"></g>';
    svg.innerHTML = s;

    var clusters = refreshPoints();
    drawLegend(clusters);
    drawScale();
    renderMapSide(clusters);
  }

  function densityLayer(pts) {
    var cell = 1.0, e = MAP.raster, m = {};
    var max = 0;
    pts.forEach(function (p) {
      var gx = Math.floor((p.x - e[0]) / cell), gy = Math.floor((p.y - e[1]) / cell);
      var k = gx + ',' + gy;
      if (!m[k]) m[k] = {};
      p.events.forEach(function (ev) { m[k][ev.id] = 1; });
    });
    Object.keys(m).forEach(function (k) { m[k] = Object.keys(m[k]).length; if (m[k] > max) max = m[k]; });
    var out = '';
    Object.keys(m).forEach(function (k) {
      var ab = k.split(','), gx = +ab[0], gy = +ab[1];
      var lon = e[0] + gx * cell, lat = e[1] + gy * cell;
      var p0 = proj(lon, lat + cell), p1 = proj(lon + cell, lat);
      var t = Math.pow(m[k] / max, 0.6);
      var r = Math.round(246 + (140 - 246) * t);
      var g2 = Math.round(232 + (58 - 232) * t);
      var b2 = Math.round(214 + (52 - 214) * t);
      out += '<rect x="' + p0[0].toFixed(1) + '" y="' + p0[1].toFixed(1) + '" width="' + (p1[0] - p0[0]).toFixed(1) +
        '" height="' + (p1[1] - p0[1]).toFixed(1) + '" fill="rgb(' + r + ',' + g2 + ',' + b2 + ')" opacity="' + (0.30 + 0.52 * t).toFixed(2) + '"/>';
    });
    return out;
  }

  /* 屏幕空间聚合：相邻 12 px 内的点位合并为一个标记，避免互相遮挡、无法点击 */
  function clusterScreen(pts) {
    var arr = pts.map(function (p) {
      var xy = toScreen(proj(p.x, p.y));
      return { x: xy[0], y: xy[1], names: p.names.slice(), m: p.m, p: p.p, events: p.events.slice(), src: [p] };
    }).sort(function (a, b) { return b.events.length - a.events.length; });
    var out = [];
    arr.forEach(function (c) {
      for (var i = 0; i < out.length; i++) {
        var o = out[i];
        if (Math.hypot(o.x - c.x, o.y - c.y) < 12) {
          o.events = o.events.concat(c.events);
          c.names.forEach(function (n) { if (o.names.indexOf(n) < 0) o.names.push(n); });
          o.src.push.apply(o.src, c.src);
          o.x = (o.x * (o.src.length - c.src.length) + c.x * c.src.length) / o.src.length;
          o.y = (o.y * (o.src.length - c.src.length) + c.y * c.src.length) / o.src.length;
          return;
        }
      }
      out.push(c);
    });
    // 一条多点事件可能在同一聚合里有多个点位，按事件去重
    out.forEach(function (o) { o.events = uniqEvents(o.events); });
    return out;
  }

  function uniqEvents(list) {
    var seen = {}, out = [];
    list.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = 1; out.push(e); } });
    return out;
  }

  function refreshPoints() {
    var raw = MAP._pts || [];
    MAP._clusters = clusterScreen(raw);
    drawPoints(MAP._clusters);
    drawLabels(MAP._clusters);
    return MAP._clusters;
  }

  function drawPoints(pts) {
    var g = $('#mapPoints'); if (!g) return;
    var s = '';
    if (MAP.mode === 'density') { g.innerHTML = ''; return; }
    pts.forEach(function (p, i) {
      var xy = [p.x, p.y];
      var n = p.events.length;
      var r = n >= 5 ? 9 : n >= 3 ? 7 : n >= 2 ? 5.5 : 4.5;
      var types = {};
      p.events.forEach(function (ev) { types[ev.type] = (types[ev.type] || 0) + 1; });
      var dom = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; })[0];
      var c = typeColor(dom);
      var isSel = MAP.sel && MAP.sel === p.names[0];
      s += '<g class="mpt" data-i="' + i + '" style="cursor:pointer">';
      s += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + (r + 3) + '" fill="transparent"/>';
      if (p.p === 'doubt') {
        s += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + r + '" fill="#fff" stroke="' + c + '" stroke-width="2" stroke-dasharray="3 2"/>';
      } else if (p.p === 'macro') {
        s += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + r + '" fill="#fff" fill-opacity=".6" stroke="' + c + '" stroke-width="1.6"/>';
      } else {
        s += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + r + '" fill="' + c + '" fill-opacity=".9" stroke="#fff" stroke-width="1.3"/>';
      }
      if (isSel) {
        s += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + (r + 5) + '" fill="none" stroke="#23201d" stroke-width="1.6"/>';
      }
      if (n >= 3 || (n >= 2 && MAP.k >= 1.3)) {
        s += '<text x="' + (xy[0] + r + 2).toFixed(1) + '" y="' + (xy[1] + 3.6).toFixed(1) + '" font-size="10" font-weight="600" fill="#3f3833" style="paint-order:stroke;stroke:#f7f4ef;stroke-width:3px">' + n + '</text>';
      }
      s += '</g>';
    });
    g.innerHTML = s;

    $$('#mapPoints .mpt').forEach(function (el2) {
      var p = pts[+el2.dataset.i];
      el2.addEventListener('mouseenter', function (ev) {
        var tip = $('#mapTip');
        tip.innerHTML = '<b>' + esc(p.names.join('／')) + '</b>　' + esc(p.m || '今地未考') +
          '<br>' + (GEO_PREC[p.p] || p.p) + ' · ' + p.events.length + ' 条事件';
        tip.classList.add('on');
      });
      el2.addEventListener('mousemove', function (ev) {
        var b2 = $('#mapStage').getBoundingClientRect();
        var tip = $('#mapTip');
        tip.style.left = (ev.clientX - b2.left) + 'px';
        tip.style.top = (ev.clientY - b2.top) + 'px';
      });
      el2.addEventListener('mouseleave', function () { $('#mapTip').classList.remove('on'); });
      el2.addEventListener('click', function (ev) {
        ev.stopPropagation();
        $('#mapTip').classList.remove('on');
        MAP.sel = p.names[0];
        drawPoints(pts); drawLabels(pts); renderMapSide(pts);
      });
    });
  }

  function drawLabels(pts) {
    var g = $('#mapLabels'); if (!g) return;
    var s = '', e = MAP.view, i;
    // 经纬网注记：贴着画布边缘
    for (var lon = Math.ceil(e[0] / 10) * 10; lon <= e[2]; lon += 10) {
      var x = toScreen(proj(lon, e[1]))[0];
      if (x > 52 && x < MAP.W - 320) s += '<text x="' + x.toFixed(1) + '" y="13" font-size="9.5" fill="#9b8f7d" text-anchor="middle">' + lon + '°E</text>';
    }
    for (var lat2 = 10; lat2 <= 70; lat2 += 10) {
      var y = toScreen([0, (MAP.view[3] - mercY(lat2)) * MAP.s])[1];
      if (y > 104 && y < MAP.H - 18) s += '<text x="6" y="' + (y - 4).toFixed(1) + '" font-size="9.5" fill="#9b8f7d">' + lat2 + '°N</text>';
    }
    // 地名注记：按事件数排序，矩形避让
    var boxes = pts.map(function (p) {
      var r = p.events.length >= 5 ? 9 : p.events.length >= 3 ? 7 : p.events.length >= 2 ? 5.5 : 4.5;
      return { x: p.x, y: p.y, r: r, n: p.events.length, name: p.names[0], p: p };
    });
    var rects = boxes.map(function (b) { return { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 }; });
    var minN = MAP.k >= 2.2 ? 1 : MAP.k >= 1.4 ? 2 : 4;
    var maxLabel = MAP.k >= 2 ? 30 : MAP.k >= 1.3 ? 20 : 12;
    boxes.filter(function (b) { return b.n >= minN; })
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, maxLabel)
      .forEach(function (b) {
        var tw = b.name.length * 11.5 + 8, th = 13;
        var cands = [
          [b.x - tw / 2, b.y - b.r - 15], [b.x - tw / 2, b.y + b.r + 5],
          [b.x + b.r + 5, b.y - th / 2], [b.x - tw - b.r - 5, b.y - th / 2],
          [b.x - tw / 2, b.y - b.r - 28], [b.x - tw / 2, b.y + b.r + 18]
        ];
        for (var ci = 0; ci < cands.length; ci++) {
          var r0 = { x: cands[ci][0] - 2, y: cands[ci][1] - 2, w: tw + 4, h: th + 4 };
          var hit = rects.some(function (o) {
            return !(r0.x + r0.w < o.x || r0.x > o.x + o.w || r0.y + r0.h < o.y || r0.y > o.y + o.h);
          });
          if (!hit) {
            rects.push(r0);
            s += '<text x="' + (r0.x + tw / 2).toFixed(1) + '" y="' + (r0.y + 10).toFixed(1) + '" font-size="10.5" fill="#332c26" text-anchor="middle" style="paint-order:stroke;stroke:#f7f4ef;stroke-width:3.4px">' + esc(b.name) + '</text>';
            break;
          }
        }
      });
    g.innerHTML = s;
  }

  function drawLegend(pts) {
    var box = $('#mapLegend'); if (!box) return;
    var h;
    if (MAP.mode === 'density') {
      h = '<span>事件密度</span><span class="ramp"><i style="background:rgb(246,232,214)"></i><i style="background:rgb(206,161,145)"></i>' +
        '<i style="background:rgb(173,110,99)"></i><i style="background:rgb(140,58,52)"></i></span>' +
        '<span class="muted">低 → 高（每 1° 方格内的事件数）</span>' +
        '<span class="sep"></span><span class="muted">共 ' + pts.length + ' 个地点</span>';
    } else {
      h = Object.keys(META.type).map(function (t) {
        return '<span><i style="background:' + typeColor(t) + '"></i>' + esc(t) + '</span>';
      }).join('');
      h += '<span class="sep"></span><span><i class="ring"></i>区域级／大范围</span><span><i class="dash"></i>存疑</span>';
      h += '<span class="sep"></span><span class="muted">共 ' + pts.length + ' 个地点</span>';
    }
    box.innerHTML = h;
  }

  function drawScale() {
    var box = $('#mapScale'); if (!box) return;
    var mC = (MAP.view[1] + MAP.view[3]) / 2;
    var midLat = (2 * Math.atan(Math.exp(mC * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
    var kmPerPx = 111.32 * Math.cos(midLat * Math.PI / 180) / (MAP.s * MAP.k);
    var target = 120; // px
    var km = kmPerPx * target;
    var nice = [50, 100, 200, 300, 500, 1000, 2000];
    var pick = nice.reduce(function (a, b) { return Math.abs(b - km) < Math.abs(a - km) ? b : a; }, nice[0]);
    var px = pick / kmPerPx;
    box.innerHTML = '<span class="bar" style="width:' + px.toFixed(0) + 'px"></span><span>' + pick + ' 公里</span>';
  }

  /* ---------------- 右侧详情 ---------------- */
  function renderMapSide(pts) {
    var side = $('#mapDetail');
    if (!side) return;
    var p = MAP.sel && pts.filter(function (x) { return x.names.indexOf(MAP.sel) >= 0; })[0];
    if (!p) {
      var top = pts.slice().sort(function (a, b) { return b.events.length - a.events.length; }).slice(0, 8);
      side.innerHTML = '<div class="md-empty"><div class="big">点击地图上的点位</div>' +
        '<p>右侧将显示该地点的今地对照、定位精度与全部关联事件；再点事件即进入事件详情。</p></div>' +
        '<div class="md-top"><div class="md-h">事件最多的地点</div>' +
        top.map(function (x) {
          return '<button class="md-topitem" data-top="' + esc(x.names[0]) + '"><b>' + esc(x.names[0]) + '</b>' +
            '<span>' + x.events.length + ' 条</span></button>';
        }).join('') + '</div>';
      $$('#mapDetail [data-top]').forEach(function (b) {
        b.onclick = function () {
          var t = pts.filter(function (x) { return x.names.indexOf(b.dataset.top) >= 0; })[0];
          if (t) { MAP.sel = t.names[0]; drawPoints(pts); drawLabels(pts); renderMapSide(pts); }
        };
      });
      return;
    }

    var evs = p.events.slice().sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
    var h = '<div class="md-head">' +
      '<div class="md-name">' + esc(p.names.join('／')) + '</div>' +
      '<div class="md-meta"><span>今地</span><b>' + esc(p.m || '未考') + '</b></div>' +
      '<div class="md-meta"><span>定位精度</span><b>' + (GEO_PREC[p.p] || p.p) + '</b></div>' +
      '<div class="md-meta"><span>关联事件</span><b>' + evs.length + ' 条</b></div>' +
      (p.p === 'macro' ? '<div class="md-warn">「大范围」为多地并列的示意中心，不代表某一城址。</div>' : '') +
      (p.p === 'doubt' ? '<div class="md-warn">该地点定位存疑，点位仅示意。</div>' : '') +
      '</div>';
    h += '<div class="md-list">' + evs.map(function (ev) {
      return '<button class="md-item" data-id="' + ev.id + '">' +
        '<div class="l1"><span class="dyn">' + esc(ev.dynasty) + '</span><span class="yr">' + esc(ev.year_text) + '</span>' +
        '<span class="tag" style="background:' + typeColor(ev.type) + '14;color:' + typeColor(ev.type) + ';border-color:' + typeColor(ev.type) + '33">' + esc(ev.type) + '</span></div>' +
        '<div class="l2">' + esc(firstSentence(ev.overview, 56)) + '</div>' +
        '<div class="l3">' + ev.n_records + ' 条史料 · ' + esc(ev.main_src) + '　<span class="go">查看详情 →</span></div>' +
        '</button>';
    }).join('') + '</div>';
    side.innerHTML = h;
    $$('#mapDetail .md-item').forEach(function (b) {
      b.onclick = function () { openEventPeek(b.dataset.id); };
    });
  }

  /* ---------------- 交互 ---------------- */
  function wireMap() {
    var stage = $('#mapStage'), svg = $('#mapSvg');
    var drag = null, moved = false;

    stage.addEventListener('mousedown', function (ev) {
      if (ev.target.closest && ev.target.closest('.mpt')) return;
      drag = { x: ev.clientX, y: ev.clientY, tx: MAP.tx, ty: MAP.ty };
      moved = false;
      svg.classList.add('drag');
    });
    window.addEventListener('mousemove', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      MAP.tx = drag.tx + dx; MAP.ty = drag.ty + dy;
      clampPan();
      var g = document.getElementById('mapWorld');
      if (g) g.setAttribute('transform', 'translate(' + MAP.tx + ',' + MAP.ty + ') scale(' + MAP.k + ')');
      refreshPoints();
    });
    window.addEventListener('mouseup', function () {
      if (!drag) return;
      drag = null; svg.classList.remove('drag');
    });

    stage.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    $('#mapZoomIn').onclick = function () { zoomAtCenter(1.4); };
    $('#mapZoomOut').onclick = function () { zoomAtCenter(1 / 1.4); };
    $('#mapReset').onclick = function () {
      MAP.k = 1; MAP.tx = 0; MAP.ty = 0; MAP.sel = null;
      renderMap();
    };

    var rt = null;
    var redraw = function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (state.view !== 'map') return;
        MAP.cache = null;
        renderMap();
      }, 120);
    };
    window.addEventListener('resize', redraw);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(redraw);
      ro.observe(stage);
    }
  }

  function zoomAtCenter(f) {
    var cx = MAP.W / 2, cy = MAP.H / 2;
    zoomAt(cx, cy, f, true);
  }

  function zoomAt(cx, cy, f, raw) {
    var k2 = Math.max(1, Math.min(6, MAP.k * f));
    var b = $('#mapStage').getBoundingClientRect();
    var px = raw ? cx : cx - b.left, py = raw ? cy : cy - b.top;
    MAP.tx = px - (px - MAP.tx) * (k2 / MAP.k);
    MAP.ty = py - (py - MAP.ty) * (k2 / MAP.k);
    MAP.k = k2;
    clampPan();
    var g = document.getElementById('mapWorld');
    if (g) g.setAttribute('transform', 'translate(' + MAP.tx + ',' + MAP.ty + ') scale(' + MAP.k + ')');
    refreshPoints(); drawScale();
  }

  /* 平移夹取：k=1 时底图恰好铺满画布，任何平移都不许露出画布外的空白 */
  function clampPan() {
    var R = MAP.raster, RM = MAP.rasterMerc;
    var EPS = 1.5;   // 亚像素舍入余量，宁可多盖一点也不露白
    var iw = (R[2] - R[0]) * MAP.s * MAP.k;
    var ih = (RM[1] - RM[0]) * MAP.s * MAP.k;
    var x0 = (R[0] - MAP.view[0]) * MAP.s * MAP.k + MAP.tx;
    var y0 = (MAP.view[3] - RM[1]) * MAP.s * MAP.k + MAP.ty;
    if (x0 > -EPS) MAP.tx -= (x0 + EPS);
    else if (x0 + iw < MAP.W + EPS) MAP.tx += MAP.W - (x0 + iw) + EPS;
    if (y0 > -EPS) MAP.ty -= (y0 + EPS);
    else if (y0 + ih < MAP.H + EPS) MAP.ty += MAP.H - (y0 + ih) + EPS;
  }

  /* ---------------- 地点索引 ---------------- */
  function placesAll() {
    var m = {}, idx = {};
    (DB.place_index || []).forEach(function (p) { idx[p.name] = p; });
    EVENTS.forEach(function (e) {
      var seen = {};
      placesOf(e).forEach(function (k) {
        if (seen[k]) return; seen[k] = 1;
        (m[k] = m[k] || []).push(e.id);
      });
    });
    return Object.keys(m).map(function (k) {
      return {
        name: k, count: m[k].length, events: m[k],
        level: (idx[k] || {}).level || '',
        region: (idx[k] || {}).region || '其他'
      };
    });
  }

  function placeBlob(p) {
    var ref = refOfPlace(p.name, p.events);
    var t = [p.name, p.level, p.region, ref.m || '', ref.note || ''];
    p.events.forEach(function (id) {
      var e = byId[id];
      if (e) t.push(e.dynasty, e.year_text, e.place, e.overview, e.main_src);
    });
    return t.join(' ').toLowerCase();
  }

  function renderPlaces() {
    var all = placesAll();
    var q = state.placeQ.toLowerCase();
    var list = all.filter(function (p) { return !q || placeBlob(p).indexOf(q) >= 0; });
    var nEv = {};
    list.forEach(function (p) { p.events.forEach(function (id) { nEv[id] = 1; }); });
    $('#placeCount').innerHTML = '共 <b>' + list.length + '</b> 处' +
      (list.length !== all.length ? '（全部 ' + all.length + ' 处）' : '') + '，关联 <b>' + Object.keys(nEv).length + '</b> 条事件';

    var head = '<div style="display:flex;align-items:baseline;gap:10px;margin:2px 0 16px">' +
      '<h3 class="sec-title" style="margin:0">地点索引</h3>' +
      '<span class="tiny muted">按区域分组，地点与事件非唯一对应</span></div>';

    var byRegion = {};
    list.forEach(function (p) { (byRegion[p.region || '其他'] = byRegion[p.region || '其他'] || []).push(p); });
    var order = ['河洛', '关中', '齐鲁', '河北', '河东', '江淮', '荆楚', '江南', '巴蜀', '陇右', '塞北', '岭南', '跨区域', '部族', '通语', '其他'];
    var html = '';
    order.forEach(function (rg) {
      if (!byRegion[rg]) return;
      var a2 = byRegion[rg].sort(function (a, b) { return b.count - a.count; });
      // 一条事件可分属多地点，区域合计按去重后的事件数计
      var uniq = {};
      a2.forEach(function (x) { x.events.forEach(function (id) { uniq[id] = 1; }); });
      var nUniq = Object.keys(uniq).length;
      html += '<div class="region-block"><div class="region-head"><b>' + esc(rg) + '</b>' +
        '<span>' + a2.length + ' 处 · ' + nUniq + ' 条事件</span></div>' +
        '<div class="idx-grid">' + a2.map(function (p) {
          var ref = refOfPlace(p.name, p.events);
          return '<button class="idx-card" data-name="' + esc(p.name) + '" title="今地：' + esc(ref.m || '未定位') +
            (ref.p ? '；定位精度：' + (GEO_PREC[ref.p] || '') : '') + '">' +
            '<div class="n">' + esc(p.name) + '</div>' +
            '<div class="m">' + esc(p.level || '未分类') + ' · ' + esc(ref.m || '未定位') + '</div>' +
            '<div class="c">' + p.count + ' 条事件</div></button>';
        }).join('') + '</div></div>';
    });
    if (!html) html = '<div class="empty" style="height:200px"><div class="big">没有匹配的地点</div><p>换个地名、今地或事件关键词试试。</p></div>';
    $('#placeBody').innerHTML = head + html;
    $$('#placeBody .idx-card').forEach(function (b) {
      b.onclick = function () { openPlacePeek(b.dataset.name); };
    });
  }

  function personsUnderFilter() {
    var arr = filtered();
    var m = {}, rc = {};
    arr.forEach(function (e) {
      var seen = [];
      e.records.forEach(function (r) {
        personsOfRec(r.person).forEach(function (p) {
          rc[p] = (rc[p] || 0) + 1;
          if (seen.indexOf(p) >= 0) return;
          seen.push(p);
          (m[p] = m[p] || []).push(e.id);
        });
      });
    });
    return Object.keys(m).map(function (n) {
      return { name: n, count: m[n].length, records: rc[n], events: m[n] };
    }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  function renderPersons() {
    var q = state.personQ;
    var base = personsUnderFilter();
    var list = base.filter(function (p) {
      if (!q) return true;
      var blob = p.name + ' ' + p.events.map(function (id) {
        return byId[id] ? byId[id].place + byId[id].year_text + byId[id].main_src : '';
      }).join(' ');
      return blob.indexOf(q) >= 0;
    });
    $('#personCount').innerHTML = '共 <b>' + list.length + '</b> 位（仅计正式事件）';
    var head = '<div style="display:flex;align-items:baseline;gap:10px;margin:2px 0 16px">' +
      '<h3 class="sec-title" style="margin:0">人物索引</h3>' +
      '<span class="tiny muted">点击人物查看其关联事件；志体「无（志体不系人）」等特殊值不入索引</span></div>';
    $('#personBody').innerHTML = head + (list.length ? '<div class="idx-grid">' + list.map(function (p) {
      return '<button class="idx-card" data-name="' + esc(p.name) + '">' +
        '<div class="n">' + esc(p.name) + '</div>' +
        '<div class="m">' + esc(p.events.slice(0, 3).map(function (id) { return byId[id] ? byId[id].year_text : ''; }).filter(Boolean).join('；')) + '</div>' +
        '<div class="c">' + p.count + ' 条事件 · ' + p.records + ' 条记载</div></button>';
    }).join('') + '</div>' : '<div class="empty" style="height:160px"><p>没有匹配的人物。</p></div>');
    $$('#personBody .idx-card').forEach(function (b) {
      b.onclick = function () { openPerson(b.dataset.name); };
    });
  }

  function openPerson(name) {
    var p = personsUnderFilter().find(function (x) { return x.name === name; });
    if (!p) return;
    var box = $('#personBody');
    $('#personCount').innerHTML = '人物：<b>' + esc(name) + '</b>　<button class="btn ghost" id="pBack">← 返回人物索引</button>';
    box.innerHTML = '<table class="tbl"><thead><tr><th style="width:76px">朝代</th><th style="width:180px">年代</th>' +
      '<th style="width:120px">地点</th><th style="width:90px">类型</th><th>概述</th></tr></thead><tbody>' +
      p.events.map(function (id) {
        var e = byId[id]; if (!e) return '';
        return '<tr data-id="' + id + '"><td>' + esc(e.dynasty) + '</td><td>' + esc(e.year_text) + '</td>' +
          '<td>' + esc(e.place) + '</td><td>' + esc(e.type) + '</td><td><div class="q">' + esc(firstSentence(e.overview, 70)) + '</div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#pBack').onclick = function () { renderPersons(); };
    $$('#personBody tr[data-id]').forEach(function (tr) {
      tr.onclick = function () { openEventPeek(tr.dataset.id); };
    });
  }

  /* ---------------- 排除材料 ---------------- */
  var EX_FAMILY = ['割股', '同形异义', '修辞', '典故', '骈文', '占辞', '讹言', '泛述', '族俗', '毁尸', '未遂', '人胆', '其他'];

  function exFamily(k) {
    for (var i = 0; i < EX_FAMILY.length - 1; i++) {
      if (k.indexOf(EX_FAMILY[i]) === 0) return EX_FAMILY[i];
    }
    return '其他';
  }

  function renderExcluded() {
    var box = $('#filters6');
    box.innerHTML = '<div class="f-row"><div class="search-box">' +
      '<input id="exQ" type="search" placeholder="输入关键词（命中词句、原文、史书、篇名、排除类别、排除原因），按回车或点「搜索」" value="' + esc(state.exQ) + '" autocomplete="off" />' +
      '<button class="clr" data-clr="q">×</button></div>' +
      '<button class="btn primary" data-act="search">搜索</button>' +
      '<button class="btn" data-act="clear">清空</button><span class="f-summary" id="exCount"></span></div>';
    var q = $('#exQ', box);
    var doSearch = function () { state.exQ = q.value.trim(); renderExcluded(); };
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    $('[data-act=search]', box).onclick = doSearch;
    $('[data-clr]', box).onclick = function () { state.exQ = ''; renderExcluded(); };
    $('[data-act=clear]', box).onclick = function () { state.exQ = ''; state.exGroup = ''; renderExcluded(); };

    var groups = {};
    EXCL.forEach(function (r) { (groups[r.excl_type] = groups[r.excl_type] || []).push(r); });
    var fam = {};
    Object.keys(groups).forEach(function (k) {
      var f = exFamily(k);
      (fam[f] = fam[f] || []).push(k);
    });
    if (!state.exGroup) state.exGroup = '__all__';

    var nav = '<button data-g="__all__" class="' + (state.exGroup === '__all__' ? 'on' : '') + '"><span>全部排除材料</span><span class="c">' + EXCL.length + '</span></button>';
    EX_FAMILY.forEach(function (f) {
      if (!fam[f] || !fam[f].length) return;
      nav += '<div class="grp">' + f + '</div>';
      fam[f].sort(function (a, b) { return groups[b].length - groups[a].length; }).forEach(function (k) {
        var hl = (k === '割股类') ? ' hl' : '';
        nav += '<button data-g="' + esc(k) + '" class="' + (state.exGroup === k ? 'on' : '') + hl + '"><span>' + esc(k.replace(/^[^·]*·/, '')) + '</span><span class="c">' + groups[k].length + '</span></button>';
      });
    });
    $('#exNav').innerHTML = nav;
    $$('#exNav button').forEach(function (b) {
      b.onclick = function () { state.exGroup = b.dataset.g; renderExcluded(); };
    });

    var arr = EXCL.filter(function (r) {
      if (state.exGroup !== '__all__' && r.excl_type !== state.exGroup) return false;
      if (!state.exQ) return true;
      var blob = [r.book, r.pian, r.person, r.quote, r.hit_preview, r.excl_type, r.explain, r.reason].join(' ');
      return blob.toLowerCase().indexOf(state.exQ.toLowerCase()) >= 0;
    });
    $('#exCount').innerHTML = '当前 <b>' + arr.length + '</b> 条 / 全部 ' + EXCL.length + ' 条' +
      '<span style="margin-left:10px;color:var(--ink-4)">均为非事件之记载条目</span>';

    $('#exList').innerHTML = arr.length ? arr.map(function (r) {
      return '<div class="mat-card">' +
        '<div class="mh"><span class="src">' + esc(r.book) + ' · ' + esc(r.pian) + '</span>' +
        '<span class="tag grey">' + esc(r.pian_class || '') + '</span>' +
        '<span class="tag">' + esc(r.excl_type) + '</span>' +
        (r.reclass ? '<span class="tag grey" title="' + esc(r.reclass) + '">复核改判</span>' : '') +
        '<span class="tag grey">' + esc(r.year_text || '年代不详') + '</span>' +
        '<span style="margin-left:auto">序号 ' + esc(r.seq) + '</span></div>' +
        '<div class="hit">命中原文：<code>' + esc(r.hit_preview || '') + '</code></div>' +
        '<div class="mb"><div class="quote" style="padding:0">' + quoteHTML(r, false) + '</div></div>' + simHTML(r) +
        '<div class="why"><b>排除原因：</b>' + esc(r.explain || '') +
        (r.reason ? '<br><span style="opacity:.85">判定记录：' + esc(r.reason) + '</span>' : '') + '</div>' +
        '<div class="rec-f"><span class="muted">' + esc(r.book) + ' · ' + esc(r.pian) + '</span>' +
        '<button class="btn ghost" data-full="' + esc(r.file_path) + '" style="margin-left:auto;padding:2px 10px;font-size:12px">查看整篇原文</button></div>' +
        '</div>';
    }).join('') : '<div class="empty" style="height:220px"><div class="big">没有匹配的材料</div><p>请调整关键词或切换左侧类别。</p></div>';
  }

  /* ---------------- 路由 ---------------- */
  function go(view, keep) {
    state.view = view;
    if (view !== 'events') {
      // 离开名录不清空筛选，保持联动
    }
    if (location.hash.indexOf('#/' + view) !== 0) {
      history.replaceState(null, '', '#/' + view + (state.sel && view === 'events' ? '/' + state.sel : ''));
    }
    renderNav();
    $$('.view').forEach(function (v) { v.classList.remove('on'); });
    var el2 = $('#view-' + view);
    if (el2) el2.classList.add('on');
    window.scrollTo(0, 0);
    if (view === 'overview') renderOverview();
    if (view === 'events') renderEvents();
    if (view === 'timeline') renderTimeline();
    if (view === 'map') { renderMap(); }
    if (view === 'places') renderPlaces();
    if (view === 'persons') renderPersons();
    if (view === 'excluded') renderExcluded();
    if (view === 'about') renderAbout();
  }

  function renderAbout() {
    if ($('#aboutBody').innerHTML.trim()) return;
    $('#aboutBody').innerHTML = window.ABOUT_HTML || '<p>资料说明加载中。</p>';
  }

  function readHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var v = parts[0] || 'overview';
    if (VIEWS.every(function (x) { return x.k !== v; })) v = 'overview';
    state.view = v;
    if (v === 'events' && parts[1] && byId[parts[1]]) state.sel = parts[1];
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    readHash();
    renderTop();
    renderNav();
    wireMap();
    go(state.view);
    window.addEventListener('hashchange', function () {
      var old = state.view;
      readHash();
      if (state.view !== old) go(state.view);
    });
    $('#auxExcluded').onclick = function () { go('excluded'); };
    $('#auxAbout').onclick = function () { go('about'); };
    $('#btnPrev').onclick = function () { step(-1); };
    $('#btnNext').onclick = function () { step(1); };
    $('#btnTop').onclick = function () { $('#detBody').scrollTop = 0; };
    $('#btnBackList').onclick = function () { $('#evSplit').classList.remove('detail-open'); };
    var pQ = $('#personQ');
    var doPersonSearch = function () { state.personQ = pQ.value.trim(); renderPersons(); };
    pQ.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doPersonSearch(); } });
    $('#personSearch').onclick = doPersonSearch;
    $('#personQClr').onclick = function () { state.personQ = ''; pQ.value = ''; renderPersons(); };

    var plQ = $('#placeQ');
    var doPlaceSearch = function () { state.placeQ = plQ.value.trim(); renderPlaces(); };
    plQ.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doPlaceSearch(); } });
    $('#placeSearch').onclick = doPlaceSearch;
    $('#placeQClr').onclick = function () { state.placeQ = ''; plQ.value = ''; renderPlaces(); };

    // 简体对照开关（仅影响显示，不改变数据）
    try {
      if (localStorage.getItem('rxs_sim') === '1') document.body.classList.add('sim-on');
    } catch (e) { }
    $('#simToggle').onclick = function () {
      var on = document.body.classList.toggle('sim-on');
      try { localStorage.setItem('rxs_sim', on ? '1' : '0'); } catch (e) { }
    };

    // 整篇原文：事件委托，卡片重绘后仍有效
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-full]');
      if (!b) return;
      e.preventDefault();
      var fp = b.getAttribute('data-full');
      var rec = null;
      var inEx = !!(b.closest && b.closest('#exList'));
      if (inEx) {
        rec = EXCL.filter(function (r) { return r.file_path === fp; })[0] || null;
      } else {
        var peekEv = (!b.closest('#detBody') && PEEK.kind === 'event' && byId[PEEK.id]) ? byId[PEEK.id] : null;
        var cur = peekEv || (state.sel && byId[state.sel]);
        if (cur) rec = cur.records.filter(function (r) { return r.file_path === fp; })[0] || null;
        if (!rec) rec = EXCL.filter(function (r) { return r.file_path === fp; })[0] || null;
      }
      if (rec) openReader(rec);
    });
    $('#readerClose').onclick = closeReader;
    $('#readerMask').onclick = closeReader;
    $('#readerLocate').onclick = locateHit;
    $('#peekClose').onclick = closePeek;
    $('#peekMask').onclick = closePeek;
    $('#peekGo').onclick = peekGo;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // 阅读器在上层，先关它；再关预览窗
      if (!$('#reader').hidden) { closeReader(); return; }
      if (!$('#peek').hidden) closePeek();
    });

    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (state.view === 'timeline') renderTimeline();
        if (state.view === 'map') renderMap();
      }, 180);
    });
  }

  function step(d) {
    var arr = filtered();
    var i = arr.findIndex(function (e) { return e.id === state.sel; });
    if (i < 0) { if (arr.length) selectEvent(arr[0].id); return; }
    var j = i + d;
    if (j < 0 || j >= arr.length) return;
    selectEvent(arr[j].id);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
