/* LOKA Atlas — Event mode: a festival guide drawn from an atlas's own places.
 *
 * An atlas switches it on with a `mode` in manifest.local.json (the file a
 * rebuild leaves alone), written by deploy/apply-event-mode.mjs:
 *
 *   mode: {
 *     name: "event",
 *     layer: "<the layer holding the venues>",
 *     around: "around.geojson",            // nearby places from OpenStreetMap
 *     days: ["2026-10-29", ...],            // the festival's days, in order
 *     timeZone: "Asia/Kolkata",             // whose "today" picks the day tab
 *     aroundRadiusM: 400,
 *     tagColumn: "categories",              // the places' own category words
 *     categories: [ { id, label, tags?: [...], osm?: [...] }, ... ]  // four, fixed
 *   }
 *
 * With no mode, or any other name, nothing here runs and the atlas is exactly
 * what it was. Nothing here knows which festival it is drawing: every word on
 * the screen comes from the mode or from the places.
 *
 * What it changes, and only this: the way a visitor moves around the map. The
 * questions (keys) and the layer list give way to four chips (Venues, Eat &
 * Drink, See & Do, Essentials), a list of venues, a programme on each venue's
 * card, and "What's around here". Search, the cards' photographs, share, the
 * phone's sheet, the menu, the theme and the credits stay atlas.js's own.
 *
 * The first half is plain logic with no page in it, so the build script and
 * the checks use the very same rules the viewer does (programme reading, which
 * category a place is in, distances). The second half draws the guide and is
 * handed what it needs by atlas.js (see `viewer`). */
(function (root, make) {
  var made = make();
  if (typeof module === "object" && module.exports) module.exports = made;
  else root.LokaEventMode = made;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function isOn(manifest) {
    var m = manifest && manifest.mode;
    return !!(m && typeof m === "object" && m.name === "event");
  }

  function isoParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  // "Thu 29"
  function dayLabel(iso) {
    var p = isoParts(iso);
    if (!p) return String(iso || "");
    return WEEKDAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()] + " " + p.d;
  }
  // today's date where the festival is, as YYYY-MM-DD
  function todayIn(timeZone, now) {
    var d = now || new Date();
    try {
      var parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      var get = function (t) { return (parts.filter(function (p) { return p.type === t; })[0] || {}).value; };
      return get("year") + "-" + get("month") + "-" + get("day");
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  /* ---- reading a venue's programme ----
     The programme is written as plain text on each venue, in blocks:

       THU 29 OCT
         09:30–11:00 Opening Ceremony: Keynote & Roadmap Launch
         11:30–13:00 From Climate Plans to City Action · Friedrich-Ebert-Stiftung (FES)
       ALL THREE DAYS
         Exhibition on Wetlands · Biopod+Co.

     A day heading names a weekday, a date and a month; "ALL THREE DAYS",
     "ALL DAYS" or "EVERY DAY" is a block of things that run throughout and
     have no time. Inside a block each line is one session: a time, a title,
     and after the last " · " who is running it. Lines outside any block (the
     festival's name, "Festival venue · 16 sessions", where to register) are
     the frame and are not sessions.

     A line inside a block that does not read as a session, a heading whose
     date is not one of the festival's days, or a count in the frame that
     disagrees with the sessions found, and the programme is NOT trusted: the
     card then shows the whole text as it was written (programme_text), so
     nothing is ever lost to a reading that went wrong. */
  var DAY_HEAD = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?$/i;
  var ALL_HEAD = /^(all\s+(?:\w+\s+)?days|every\s+day|daily|throughout)$/i;
  var TIMED = /^(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})\s+(.+)$/;
  var START_ONLY = /^(\d{1,2})[:.](\d{2})\s+(?![–—-])(.+)$/;
  var DECLARED = /(?:^|[^\d])(\d+)\s+sessions?\b/i;

  function two(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function splitTitle(s) {
    s = String(s || "").trim();
    var i = s.lastIndexOf(" · ");
    if (i > 0) return { title: s.slice(0, i).trim(), organiser: s.slice(i + 3).trim() };
    return { title: s, organiser: "" };
  }
  function dayHead(line, days) {
    var m = DAY_HEAD.exec(line);
    if (m) {
      var d = +m[2], mo = MONTHS.indexOf(m[3].toLowerCase()) + 1;
      var hit = (days || []).filter(function (iso) { var p = isoParts(iso); return p && p.d === d && p.mo === mo; })[0];
      return hit || null;   // a heading, but not one of the festival's days
    }
    if (ALL_HEAD.test(line)) return "all";
    return undefined;       // not a heading at all
  }
  function parseSession(line, day) {
    var m = TIMED.exec(line);
    if (m) {
      var t = splitTitle(m[5]);
      return { day: day, start: two(m[1]) + ":" + m[2], end: two(m[3]) + ":" + m[4], title: t.title, organiser: t.organiser };
    }
    if (day !== "all") {
      var s = START_ONLY.exec(line);
      if (s) { var t2 = splitTitle(s[3]); return { day: day, start: two(s[1]) + ":" + s[2], end: "", title: t2.title, organiser: t2.organiser }; }
      return null;
    }
    if (/^\d/.test(line)) return null;
    var t3 = splitTitle(line);
    return t3.title ? { day: "all", start: "", end: "", title: t3.title, organiser: t3.organiser } : null;
  }
  function parseProgramme(text, days) {
    var out = { sessions: [], unparsed: [], declared: null, ok: true };
    if (!text) return out;
    var day = null;
    String(text).replace(/\r/g, "").split("\n").forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var indented = /^\s/.test(raw);
      var head = dayHead(line, days);
      if (head !== undefined) {
        if (head === null) out.unparsed.push(line);
        day = head;
        return;
      }
      if (day && (indented || TIMED.test(line))) {
        var s = parseSession(line, day);
        if (s) out.sessions.push(s); else out.unparsed.push(line);
        return;
      }
      if (indented && day === null && out.sessions.length) { out.unparsed.push(line); return; }
      // a frame line: it ends whatever block was open
      day = null;
      var c = DECLARED.exec(line);
      if (c && out.declared == null) out.declared = +c[1];
    });
    out.ok = !out.unparsed.length && (out.declared == null || out.declared === out.sessions.length);
    return out;
  }

  /* ---- which of the four a place is in ---- */
  function words(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
    return String(v).replace(/^[{\[]|[}\]]$/g, "").split(/[;,|]/)
      .map(function (s) { return s.replace(/^["'\s]+|["'\s]+$/g, "").toLowerCase(); }).filter(Boolean);
  }
  function isVenue(props) { return !!props && (props.venue === true || props.venue === "true"); }
  // a place of the atlas's own: Venues, or the first category its own words fall in
  function placeCategory(props, mode) {
    if (!props) return null;
    // a place whose programme was moved onto another (a data fix) is not in the guide
    if (props.merged_into) return null;
    if (isVenue(props)) return "venues";
    var w = words(props[(mode && mode.tagColumn) || "categories"]);
    var cats = (mode && mode.categories) || [];
    for (var i = 0; i < cats.length; i++) {
      var tags = (cats[i].tags || []).map(function (t) { return String(t).toLowerCase(); });
      if (tags.some(function (t) { return w.indexOf(t) >= 0; })) return cats[i].id;
    }
    return null;
  }
  // an OpenStreetMap place's category, from its kind ("cafe", "bus_stop")
  function osmCategory(kind, mode) {
    var cats = (mode && mode.categories) || [];
    for (var i = 0; i < cats.length; i++) if ((cats[i].osm || []).indexOf(kind) >= 0) return cats[i].id;
    return null;
  }
  var KIND_WORDS = {
    restaurant: "Restaurant", cafe: "Café", fast_food: "Fast food", bar: "Bar", pub: "Pub",
    toilets: "Public toilets", pharmacy: "Pharmacy", atm: "Cash machine (ATM)",
    bus_stop: "Bus stop", taxi: "Taxi stand",
    park: "Park", garden: "Garden", viewpoint: "Viewpoint", beach: "Beach", attraction: "Sight",
    monument: "Monument", memorial: "Memorial", place_of_worship: "Place of worship",
    museum: "Museum", gallery: "Gallery", marketplace: "Market",
  };
  function kindWord(kind) { return KIND_WORDS[kind] || String(kind || "").replace(/_/g, " "); }
  // a nearby place's own word: "Church" or "Temple" when the build knew, else its kind's
  function wordOf(props) { return (props && props.word) || kindWord(props && props.kind); }
  // the word under a row's name, unless the name already says it ("Public toilets")
  function rowWord(props, name) {
    var w = wordOf(props);
    return String(name || "").toLowerCase().indexOf(w.toLowerCase()) === 0 ? "" : w;
  }

  /* A category's sub-groups (See & Do: Parks & views · Landmarks · Museums &
     galleries · Markets — Fable's call, Mithun's yes, 23 Oct 2026), shown as
     headings in its list. An OpenStreetMap place goes by its kind; a place
     the event team tagged goes by the words of its name only (a description
     says where a place is — "on the Campal promenade" — as often as what it
     is); what matches nothing goes to the group marked "other". */
  function groupOf(props, cat, osm) {
    var gs = (cat && cat.groups) || [];
    if (!gs.length || !props) return null;
    var i;
    if (osm) {
      for (i = 0; i < gs.length; i++) if ((gs[i].kinds || []).indexOf(props.kind) >= 0) return gs[i];
    } else {
      var texts = [props.loka_name || props.name || ""];
      for (var t = 0; t < texts.length; t++) {
        var low = String(texts[t]).toLowerCase();
        for (i = 0; i < gs.length; i++) {
          if ((gs[i].words || []).some(function (w) { return new RegExp("\\b" + String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(low); })) return gs[i];
        }
      }
    }
    return gs.filter(function (g) { return g.other; })[0] || gs[gs.length - 1];
  }

  // metres between two [lng, lat] points, on the ground (as the crow flies)
  function metres(a, b) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function distanceWords(m) {
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " m";
    return (Math.round(m / 100) / 10) + " km";
  }

  function sessionsOf(props) {
    var s = props && props.sessions;
    if (typeof s === "string") { try { s = JSON.parse(s); } catch (e) { s = null; } }
    return Array.isArray(s) ? s : [];
  }
  function byStart(a, b) { return String(a.start || "").localeCompare(String(b.start || "")); }
  // venues in list order: the most sessions first, then by name
  function venueOrder(feats, nameOf) {
    return feats.slice().sort(function (a, b) {
      var d = sessionsOf(b.properties).length - sessionsOf(a.properties).length;
      return d || String(nameOf(a)).localeCompare(String(nameOf(b)));
    });
  }

  /* ---- a venue's programme, as card HTML ----
     Day tabs (one per festival day) and "All days", which holds the whole
     programme. A thing that runs every day sits at the foot of each day too.
     The tab that opens: today's, during the festival, when the venue has
     something today; otherwise the next day it has something, else its first. */
  function sessionLi(s, esc) {
    var when = s.start ? s.start + (s.end ? "–" + s.end : "") : "All day";
    return '<li class="ev-s"><span class="ev-t">' + esc(when) + '</span><span class="ev-w"><span class="ev-title">' +
      esc(s.title) + "</span>" + (s.organiser ? '<span class="ev-org">' + esc(s.organiser) + "</span>" : "") + "</span></li>";
  }
  function openingTab(ss, days, today) {
    var has = function (d) { return ss.some(function (s) { return s.day === d || s.day === "all"; }); };
    var during = days.indexOf(today) >= 0;
    if (during) {
      for (var i = days.indexOf(today); i < days.length; i++) if (has(days[i])) return days[i];
    }
    for (var j = 0; j < days.length; j++) if (has(days[j])) return days[j];
    return "all";
  }
  function programmeHTML(props, mode, today, esc) {
    if (props && props.programme_text) {
      return '<div class="ev-prog"><div class="ev-prog-h">Programme</div><p class="ev-prog-text">' + esc(props.programme_text) + "</p></div>";
    }
    var ss = sessionsOf(props);
    if (!ss.length) return "";
    var days = (mode && mode.days) || [];
    var every = ss.filter(function (s) { return s.day === "all"; });
    var pick = openingTab(ss, days, today);
    var tabs = days.map(function (d) {
      return '<button type="button" class="ev-tab" role="tab" data-ev-tab="' + esc(d) + '" aria-selected="' + (d === pick) + '">' + esc(dayLabel(d)) + "</button>";
    }).join("") + '<button type="button" class="ev-tab" role="tab" data-ev-tab="all" aria-selected="' + (pick === "all") + '">All days</button>';
    var panels = days.map(function (d) {
      var mine = ss.filter(function (s) { return s.day === d; }).sort(byStart);
      var body = mine.length || every.length
        ? '<ol class="ev-list-s">' + mine.concat(every).map(function (s) { return sessionLi(s, esc); }).join("") + "</ol>"
        : '<p class="ev-none">Nothing at this venue on ' + esc(dayLabel(d)) + ".</p>";
      return '<div class="ev-panel" data-ev-day="' + esc(d) + '"' + (d === pick ? "" : " hidden") + ">" + body + "</div>";
    }).join("");
    var all = "";
    if (every.length) all += '<div class="ev-day-h">Every day</div><ol class="ev-list-s">' + every.map(function (s) { return sessionLi(s, esc); }).join("") + "</ol>";
    days.forEach(function (d) {
      var mine = ss.filter(function (s) { return s.day === d; }).sort(byStart);
      if (!mine.length) return;
      all += '<div class="ev-day-h">' + esc(dayLabel(d)) + '</div><ol class="ev-list-s">' + mine.map(function (s) { return sessionLi(s, esc); }).join("") + "</ol>";
    });
    panels += '<div class="ev-panel" data-ev-day="all"' + (pick === "all" ? "" : " hidden") + ">" + all + "</div>";
    return '<div class="ev-prog"><div class="ev-prog-h">Programme</div><div class="ev-tabs" role="tablist">' + tabs + "</div>" + panels + "</div>";
  }

  function countWord(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ==================================================================
     THE VIEWER — the guide on the page.

     atlas.js hands over what it owns (`api`) and calls back at five points:
     layers() as the manifest arrives, pinEl() for each pin, cardHTML() for
     each card, buildPanel() when the panel is drawn, and ready() once the
     places are in. Everything else it draws stays atlas.js's.
  ================================================================== */
  var COLORS = { eat: "#B5541B", see: "#2F6F8F", utils: "#4E4A44" };
  // a button's icon, from the shared icon kit (iconkit.js); none when it is not loaded
  function iconSvg(name) {
    var kit = typeof window !== "undefined" && window.LokaIcons && window.LokaIcons.ICONS;
    return (name && kit && kit[name]) ? '<span class="ev-ic" aria-hidden="true">' + kit[name] + "</span>" : "";
  }
  var ICON = { eat: "utensils", see: "palette", utils: null };
  var CSS =
    ".ev-chips{display:flex;gap:6px;padding:8px 10px;flex:0 0 auto;flex-wrap:wrap;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--color-divider,#e5e0d6)}\n" +
    ".ev-chips::-webkit-scrollbar{display:none}\n" +
    ".ev-chip{flex:0 0 auto;font:inherit;font-size:var(--t-control,14px);font-weight:600;line-height:1;padding:9px 12px;min-height:36px;border:1px solid var(--color-border,#d9d3c7);" +
      "background:var(--color-surface,#fff);color:var(--color-text-primary,#24211D);border-radius:var(--radius-md,8px);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}\n" +
    ".ev-chip i{width:9px;height:9px;border-radius:50%;background:var(--ev-c);display:block}\n" +
    ".ev-chip[aria-pressed=true]{background:var(--color-leaf,#2A6B41);border-color:var(--color-leaf,#2A6B41);color:#fff}\n" +
    ".ev-ic{display:inline-flex;width:16px;height:16px;flex:0 0 auto}.ev-ic svg{width:100%;height:100%}\n" +
    /* the second row: a category's sub-groups, one at a time, "All" first */
    ".ev-subchips{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 8px}\n" +
    ".ev-subchips[hidden]{display:none}.ev-subchips::-webkit-scrollbar{display:none}\n" +
    ".ev-sub{flex:0 0 auto;font:inherit;font-size:13px;font-weight:600;line-height:1;padding:7px 10px;min-height:32px;border:1px solid var(--color-border,#d9d3c7);" +
      "background:var(--color-surface,#fff);color:var(--color-text-primary,#24211D);border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}\n" +
    ".ev-sub .ev-ic{width:14px;height:14px}\n" +
    ".ev-sub[aria-pressed=true]{background:var(--color-text-primary,#24211D);border-color:var(--color-text-primary,#24211D);color:#fff}\n" +
    ".ev-sub:focus-visible{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}\n" +
    ".atlas-panel.collapsed .ev-subchips{display:none}\n" +
    ".ev-chip[aria-pressed=true] i{box-shadow:0 0 0 1.5px #fff}\n" +
    ".ev-chip:focus-visible,.ev-row:focus-visible,.ev-tab:focus-visible,.ev-around-link:focus-visible,.ev-back:focus-visible{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}\n" +
    ".atlas-panel.collapsed .ev-chips{display:none}\n" +
    /* a phone: one row of chips right above the sheet, across the map's
       width; the credit pill and the zoom buttons step up to make room */
    "@media (max-width:720px){.atlas-stage>.ev-chips{position:absolute;left:8px;right:8px;bottom:calc(var(--sheet-h,0px) + 8px);z-index:6;border:0;padding:0;background:none;flex-wrap:nowrap;gap:5px;transition:bottom .28s cubic-bezier(.22,1,.36,1)}" +
      ".atlas-stage>.ev-chips{display:grid;grid-template-columns:repeat(var(--ev-n,4),minmax(0,1fr))}" +
      /* a phone: icon over word, four equal buttons across */
      ".atlas-stage>.ev-chips .ev-chip{box-shadow:0 1px 4px rgba(36,33,29,.18);padding:6px 2px 5px;font-size:12px;min-height:50px;flex-direction:column;justify-content:center;gap:3px;white-space:nowrap}" +
      ".atlas-stage>.ev-chips .ev-chip .ev-ic{width:19px;height:19px}" +
      ".atlas-stage>.ev-chips .ev-chip i{display:none}" +
      ".atlas-stage>.ev-subchips{position:absolute;left:0;right:0;bottom:calc(var(--sheet-h,0px) + 66px);z-index:6;padding:0 8px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;transition:bottom .28s cubic-bezier(.22,1,.36,1)}" +
      ".atlas-stage>.ev-subchips .ev-sub{box-shadow:0 1px 4px rgba(36,33,29,.18)}" +
      ".atlas-stage.ev-on .map-attrib,.atlas-stage.ev-on .maplibregl-ctrl-bottom-right{transform:translateY(-60px)}" +
      ".atlas-stage.ev-on.ev-sub-on .map-attrib,.atlas-stage.ev-on.ev-sub-on .maplibregl-ctrl-bottom-right{transform:translateY(-100px)}" +
      ".atlas-stage>#atlas-panel[data-h=full]~.ev-chips,.atlas-stage>#atlas-panel[data-h=full]~.ev-subchips{display:none}" +
      ".atlas-stage.ev-on:has(>#atlas-panel[data-h=full]) .map-attrib,.atlas-stage.ev-on:has(>#atlas-panel[data-h=full]) .maplibregl-ctrl-bottom-right{transform:none!important}}\n" +
    ".ev-wrap{padding:.2rem 0 .6rem}\n" +
    ".ev-sh{font-size:var(--t-meta,13px);font-weight:700;color:var(--color-text-secondary,#5A5751);margin:.85rem 0 .2rem}\n" +
    ".ev-h{font-size:var(--t-label,12px);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted,#6E6A63);margin:.9rem 0 .35rem}\n" +
    ".ev-row{display:flex;align-items:flex-start;gap:.6rem;width:100%;text-align:left;font:inherit;background:none;border:0;border-bottom:1px solid var(--color-divider,#ece7dc);padding:.6rem .1rem;cursor:pointer;color:inherit}\n" +
    ".ev-row:hover{background:var(--color-surface-alt,rgba(0,0,0,.03))}\n" +
    ".ev-no{flex:0 0 auto;min-width:24px;height:24px;border-radius:50%;background:var(--color-leaf,#2A6B41);color:#fff;font-weight:700;font-size:12px;display:inline-flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}\n" +
    ".ev-dot{flex:0 0 auto;width:12px;height:12px;border-radius:50%;margin:5px 6px 0;background:var(--ev-c)}\n" +
    ".ev-rw{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}\n" +
    ".ev-rn{font-weight:600;color:var(--color-text-primary,#24211D);line-height:1.3}\n" +
    ".ev-rm{font-size:var(--t-meta,13px);color:var(--color-text-secondary,#5A5751);line-height:1.35}\n" +
    ".ev-rm b{color:var(--color-text-primary,#24211D);font-weight:600}\n" +
    ".ev-hint{font-size:var(--t-meta,13px);color:var(--color-text-secondary,#5A5751);margin:.8rem 0}\n" +
    ".ev-back{font:inherit;font-size:var(--t-meta,13px);font-weight:600;color:var(--color-leaf,#2A6B41);background:none;border:0;padding:.5rem 0;cursor:pointer;min-height:36px}\n" +
    ".ev-card .ev-addr{margin:.5rem 0 0;font-size:var(--t-meta,13px);color:var(--color-text-secondary,#5A5751);line-height:1.4}\n" +
    ".ev-card .ev-near{margin:.5rem 0 0;font-size:var(--t-ui,14px);color:var(--color-text-primary,#24211D)}\n" +
    ".ev-card .ev-photo-credit{margin:.25rem 0 0;font-size:11px;color:var(--color-text-muted,#6E6A63);line-height:1.35}\n" +
    ".ev-card .ev-photo-credit a{color:inherit}\n" +
    ".ev-card .ev-osm{margin:.6rem 0 0;font-size:var(--t-meta,12px);color:var(--color-text-muted,#6E6A63)}\n" +
    ".ev-card .ev-osm a{color:inherit}\n" +
    ".ev-prog{margin-top:.8rem}\n" +
    ".ev-prog-h{font-size:var(--t-label,12px);font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted,#6E6A63);margin-bottom:.4rem}\n" +
    ".ev-prog-text{white-space:pre-line;font-size:var(--t-meta,13px);line-height:1.45;margin:0}\n" +
    ".ev-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:.4rem}\n" +
    ".ev-tab{font:inherit;font-size:var(--t-meta,13px);font-weight:600;padding:7px 10px;min-height:34px;border:1px solid var(--color-border,#d9d3c7);background:var(--color-surface,#fff);color:var(--color-text-primary,#24211D);border-radius:var(--radius-md,8px);cursor:pointer}\n" +
    ".ev-tab[aria-selected=true]{background:var(--color-leaf,#2A6B41);border-color:var(--color-leaf,#2A6B41);color:#fff}\n" +
    ".ev-list-s{list-style:none;margin:0;padding:0}\n" +
    ".ev-s{display:flex;gap:.6rem;padding:.45rem 0;border-bottom:1px solid var(--color-divider,#ece7dc);font-size:var(--t-meta,13px);line-height:1.35}\n" +
    ".ev-s:last-child{border-bottom:0}\n" +
    ".ev-t{flex:0 0 5.6rem;font-variant-numeric:tabular-nums;font-weight:600;color:var(--color-text-primary,#24211D)}\n" +
    ".ev-w{display:flex;flex-direction:column;gap:2px;min-width:0}\n" +
    ".ev-title{color:var(--color-text-primary,#24211D)}\n" +
    ".ev-org{color:var(--color-text-secondary,#5A5751)}\n" +
    ".ev-day-h{font-weight:700;font-size:var(--t-meta,13px);margin:.6rem 0 .1rem;color:var(--color-text-primary,#24211D)}\n" +
    ".ev-none{font-size:var(--t-meta,13px);color:var(--color-text-secondary,#5A5751);margin:.3rem 0}\n" +
    ".ev-around-link{margin-top:.8rem;font:inherit;font-size:var(--t-control,14px);font-weight:600;color:#fff;background:var(--color-leaf,#2A6B41);border:0;border-radius:var(--radius-md,8px);padding:10px 14px;min-height:40px;cursor:pointer}\n" +
    ".atlas-pin.ev-venue .pin-heart b{display:block;color:#fff;font:700 11px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}\n";

  function injectStyle(doc) {
    if (!doc || doc.getElementById("ev-style")) return;
    var s = doc.createElement("style");
    s.id = "ev-style";
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function viewer(mode, api) {
    var esc = api.esc, el = api.el;
    var R = mode.aroundRadiusM || 400;
    var CATS = (mode.categories || []).filter(function (c) { return c && c.id; });
    var catById = {}; CATS.forEach(function (c) { catById[c.id] = c; });
    var on = {}; CATS.forEach(function (c) { on[c.id] = c.id === "venues"; });
    var byCat = {};             // category id -> [layer, ...]
    var srcLayer = null;
    var state = { around: null, ready: false, chips: null, subs: null, list: null, sub: null };
    var titleProp = "name";

    function catLabel(id) { return (catById[id] && catById[id].label) || id; }
    function catColor(id) { return id === "venues" ? "var(--color-leaf,#2A6B41)" : (COLORS[id] || "#4E4A44"); }

    /* The manifest's layers, with the venues' layer replaced by one layer
       per category (so each chip is the ordinary on/off of its layers, and
       search, cards and pin names work on them as on any other), and the
       nearby places from OpenStreetMap as two more. */
    function layers(list) {
      srcLayer = list.filter(function (L) { return L.id === mode.layer; })[0] ||
        list.filter(function (L) { return L.userLayer && L.type === "marker"; })[0] || null;
      if (!srcLayer) return null;
      titleProp = (srcLayer.popup && srcLayer.popup.title) || (srcLayer.label_text && srcLayer.label_text.property) || "name";
      var nameTxt = srcLayer.label_text || { property: titleProp };
      function mk(id, cat, file, hash, keep, extra) {
        var L = {
          id: id, type: "marker", source: file, group: "event", label: catLabel(cat),
          default: !!on[cat], _visible: !!on[cat], popup: { title: file === srcLayer.source ? titleProp : "name", fields: [] },
          label_text: { property: file === srcLayer.source ? nameTxt.property : "name", maxChars: 26, size: 11 },
          rowsFrom: function (gj) {
            var feats = ((gj && gj.features) || []).filter(keep);
            if (cat === "venues") {
              feats = venueOrder(feats, function (f) { return f.properties[titleProp]; });
              feats.forEach(function (f, i) { f._evNo = i + 1; });
            }
            return { type: "FeatureCollection", features: feats };
          },
          _ev: { cat: cat, osm: file !== srcLayer.source },
        };
        if (hash) L.contentHash = hash;
        for (var k in extra || {}) L[k] = extra[k];
        (byCat[cat] = byCat[cat] || []).push(L);
        return L;
      }
      var own = function (cat) { return function (f) { return placeCategory(f.properties, mode) === cat; }; };
      var near = function (cat) { return function (f) { return f.properties && f.properties.category === cat; }; };
      var osmCredit = [{ name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright",
        note: "Places to eat and drink and everyday services near the venues", license: "ODbL" }];
      var made = [];
      CATS.forEach(function (c) {
        var tagged = c.id === "venues" || (c.tags && c.tags.length);
        if (tagged) made.push(mk("ev-" + c.id, c.id, srcLayer.source, srcLayer.contentHash, own(c.id),
          c.id === "venues" ? { addedBy: srcLayer.addedBy, label_text: { property: nameTxt.property, maxChars: 26, size: 12 } } : null));
        if (c.osm && c.osm.length && mode.around) made.push(mk("ev-" + c.id + "-osm", c.id, mode.around, null, near(c.id), { credits: osmCredit, osmPlaces: true }));
      });
      var out = [];
      list.forEach(function (L) { if (L === srcLayer) out = out.concat(made); else out.push(L); });
      return out;
    }

    function venues() {
      var d = api.data("ev-venues");
      return (d && d.features) || [];
    }
    function nameOf(L, f) { return String((f.properties || {})[L && L._ev && L._ev.osm ? "name" : titleProp] || "").trim(); }
    function nearestVenue(pt) {
      var best = null, bestM = Infinity;
      venues().forEach(function (v) {
        var m = metres(pt, v.geometry.coordinates);
        if (m < bestM) { bestM = m; best = v; }
      });
      return best ? { f: best, m: bestM } : null;
    }

    function pinEl(L, f) {
      if (!L || !L._ev) return null;
      var cat = L._ev.cat;
      if (cat === "venues") {
        var pin = api.locPinEl("var(--color-leaf,#2A6B41)", null);
        pin.classList.add("ev-venue");
        var heart = pin.querySelector(".pin-heart");
        if (heart) heart.innerHTML = "<b>" + esc(f._evNo || "") + "</b>";
        return pin;
      }
      return api.locPinEl(COLORS[cat] || "#4E4A44", ICON[cat] || null);
    }

    /* The tag's own photographs, or a picture put right by hand (a place fix's
       photo_file, kept beside the atlas's data) with its credit underneath. */
    function photoHTML(props) {
      if (!props.photo_file || !api.dataUrl) return api.shotsHTML(api.linksIn(props.photo_urls || props.photo_1_url || props.image_urls));
      var h = api.shotsHTML([api.dataUrl(String(props.photo_file))]);
      var credit = api.cellShown(props.photo_credit);
      if (credit) {
        var link = String(props.photo_credit_link || "");
        h += '<p class="ev-photo-credit">Photo: ' + (/^https:\/\//.test(link)
          ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(credit) + "</a>"
          : esc(credit)) + "</p>";
      }
      return h;
    }

    function cardHTML(L, props, f) {
      if (!L || !L._ev) return null;
      var cat = L._ev.cat;
      var name = nameOf(L, f || { properties: props });
      var h = '<div class="pop ev-card">';
      if (cat === "venues") {
        var n = sessionsOf(props).length;
        h += '<div class="pop-sub">Venue ' + esc(f && f._evNo || "") + (n ? " · " + esc(countWord(n, "session", "sessions")) : "") + "</div>";
        h += '<div class="pop-title">' + esc(name) + "</div>";
        h += photoHTML(props);
        if (props.address) h += '<p class="ev-addr">' + esc(api.cellShown(props.address)) + "</p>";
        h += programmeHTML(props, mode, todayIn(mode.timeZone), esc);
        h += '<button type="button" class="ev-around-link" data-ev-around="' + esc(f && f._evNo || "") + '">What’s around here</button>';
        return h + "</div>";
      }
      var word = L._ev.osm ? wordOf(props) : (api.cellShown(props[mode.tagColumn || "categories"]).replace(/\s*[;,]\s*/g, " · ") || catLabel(cat));
      h += '<div class="pop-sub">' + esc(word) + "</div>";
      h += '<div class="pop-title">' + esc(name) + "</div>";
      if (!L._ev.osm) {
        h += photoHTML(props);
        if (props.description) h += '<p class="pop-caption">' + esc(api.cellShown(props.description)) + "</p>";
      }
      var pt = f && f.geometry && f.geometry.coordinates;
      var nv = pt ? nearestVenue(pt) : null;
      if (nv) h += '<p class="ev-near">' + esc(distanceWords(nv.m)) + " from " + esc(nameOf(byCat.venues[0], nv.f)) + " (venue " + esc(nv.f._evNo) + ")</p>";
      if (L._ev.osm) h += '<p class="ev-osm">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</p>';
      return h + "</div>";
    }

    /* ---- the chips and the list ----
       One chip at a time (Mithun, 23 Oct 2026: "do not [allow] multiple
       button selection"): a chip shows its own places and puts the others
       away. Around a venue, that venue's pin stays as the place the list is
       measured from. */
    function choose(id) {
      CATS.forEach(function (c) { on[c.id] = c.id === id; });
      state.sub = null;
      applySub();
      showChosen();
      syncChips();
      buildSubs();
    }
    /* ---- the second row: the chosen category's sub-groups ----
       One at a time, "All" first; a group with no places gets no button.
       Choosing one keeps only its pins on the map and its rows in the list. */
    function groupsWithPlaces(c) {
      return ((c && c.groups) || []).filter(function (g) {
        return entriesOf(c.id).some(function (x) { return groupOf(x.e.f.properties, c, !!x.L._ev.osm) === g; });
      });
    }
    function applySub() {
      CATS.forEach(function (c) {
        entriesOf(c.id).forEach(function (x) {
          x.e.subOff = !!(state.sub && on[c.id] && groupOf(x.e.f.properties, c, !!x.L._ev.osm) !== state.sub);
        });
      });
    }
    function buildSubs() {
      var bar = state.subs; if (!bar) return;
      var c = chosenCat();
      var gs = state.ready ? groupsWithPlaces(c) : [];
      var stage = document.querySelector(".atlas-stage");
      bar.innerHTML = "";
      bar.hidden = gs.length < 2;
      if (stage) stage.classList.toggle("ev-sub-on", !bar.hidden);
      if (bar.hidden) return;
      bar.setAttribute("aria-label", "Which " + c.label);
      [{ label: "All", all: true }].concat(gs).forEach(function (g) {
        var b = el("button", "ev-sub");
        b.type = "button";
        b.setAttribute("aria-pressed", String(g.all ? !state.sub : state.sub === g));
        b.innerHTML = iconSvg(g.icon) + esc(g.label);
        b.addEventListener("click", function () {
          state.sub = g.all ? null : g;
          applySub();
          showChosen();
          buildSubs();
          renderList();
          if (state.around) frameAround();
          else if (state.sub) frameShown();
        });
        bar.appendChild(b);
      });
    }
    // the map comes to what the chosen sub-group shows
    function frameShown() {
      var c = chosenCat(), pts = [];
      entriesOf(c.id).forEach(function (x) { if (!x.e.away && !x.e.subOff) pts.push(x.e.f.geometry.coordinates); });
      if (pts.length) api.fitPoints(pts);
    }
    function showChosen() {
      CATS.forEach(function (c) {
        var show = !!on[c.id] || (c.id === "venues" && !!state.around);
        (byCat[c.id] || []).forEach(function (L) { api.setLayerVisible(L, show); });
      });
    }
    // around a venue: frame it with what the chosen chip shows near it
    function frameAround() {
      var v = state.around; if (!v || !state.ready) return;
      var pts = [v.geometry.coordinates];
      CATS.forEach(function (c) {
        if (!on[c.id] || c.id === "venues") return;
        entriesOf(c.id).forEach(function (x) { if (!x.e.away && !x.e.subOff) pts.push(x.e.f.geometry.coordinates); });
      });
      api.fitPoints(pts);
    }
    function syncChips() {
      if (!state.chips) return;
      Array.prototype.forEach.call(state.chips.querySelectorAll(".ev-chip"), function (b) {
        b.setAttribute("aria-pressed", String(!!on[b.getAttribute("data-cat")]));
      });
    }
    function buildChips() {
      var bar = el("div", "ev-chips");
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "What to show on the map");
      CATS.forEach(function (c) {
        var b = el("button", "ev-chip");
        b.type = "button";
        b.setAttribute("data-cat", c.id);
        b.style.setProperty("--ev-c", catColor(c.id));
        b.innerHTML = (c.icon ? iconSvg(c.icon) : "<i aria-hidden=\"true\"></i>") + "<span>" + esc(c.label) + "</span>";
        b.addEventListener("click", function () {
          // Venues while looking around one venue: back to all of them
          if (c.id === "venues" && state.around) { clearAround(); return; }
          if (on[c.id]) return;
          choose(c.id);
          renderList();
          frameAround();
        });
        bar.appendChild(b);
      });
      bar.style.setProperty("--ev-n", String(CATS.length));
      state.chips = bar;
      var subs = el("div", "ev-subchips");
      subs.setAttribute("role", "group");
      subs.hidden = true;
      state.subs = subs;
      syncChips();
      return bar;
    }
    // phones: the chips float above the sheet; wide screens: they head the panel
    function placeChips() {
      var bar = state.chips; if (!bar) return;
      var panel = document.getElementById("atlas-panel");
      var stage = document.querySelector(".atlas-stage");
      if (stage) stage.classList.add("ev-on");
      var subs = state.subs;
      if (api.onPhone()) {
        if (stage && bar.parentNode !== stage) stage.appendChild(bar);
        if (stage && subs && subs.parentNode !== stage) stage.appendChild(subs);
      } else if (panel) {
        var body = panel.querySelector(".sheet-body");
        if (bar.parentNode !== panel) panel.insertBefore(bar, body || null);
        if (subs && subs.parentNode !== panel) panel.insertBefore(subs, body || null);
      }
    }
    var placeWired = false;

    function buildPanel(panel) {
      injectStyle(document);
      Array.prototype.forEach.call(document.querySelectorAll(".ev-chips,.ev-subchips"), function (old) {
        if (old.parentNode) old.parentNode.removeChild(old);
      });
      buildChips();
      placeChips();
      if (!placeWired) {
        placeWired = true;
        window.matchMedia("(max-width: 720px)").addEventListener("change", placeChips);
      }
      var sec = el("section", "ctl-group ev-group");
      sec.setAttribute("data-group", "event");
      sec.setAttribute("data-group-label", catLabel("venues"));
      var list = el("div", "ev-wrap");
      list.setAttribute("aria-live", "polite");
      sec.appendChild(list);
      panel.appendChild(sec);
      state.list = list;
      renderList();
      // the words the panel and the card wear: this is a guide, not a layer list
      var head = document.querySelector("#atlas-panel .sheet-who strong");
      if (head) head.textContent = catLabel("venues");
      var back = document.getElementById("sheet-card-back");
      if (back && back.lastChild && back.lastChild.nodeType === 3) back.lastChild.nodeValue = catLabel("venues");
      if (back) back.setAttribute("aria-label", "Back to the " + catLabel("venues").toLowerCase());
    }

    function rowFor(L, f, meta, lead) {
      var b = el("button", "ev-row");
      b.type = "button";
      b.innerHTML = lead + '<span class="ev-rw"><span class="ev-rn">' + esc(nameOf(L, f)) + '</span><span class="ev-rm">' + meta + "</span></span>";
      b.addEventListener("click", function () { api.openPlace(L, f); });
      return b;
    }
    function venueMeta(f) {
      var ss = sessionsOf(f.properties);
      var meta = esc(ss.length ? countWord(ss.length, "session", "sessions") : (f.properties.programme_text ? "Programme on the card" : "No sessions listed"));
      var today = todayIn(mode.timeZone);
      if ((mode.days || []).indexOf(today) >= 0) {
        var t = ss.filter(function (s) { return s.day === today && s.start; }).sort(byStart)[0];
        if (t) meta += " · Today from <b>" + esc(t.start) + "</b>";
        else if (ss.some(function (s) { return s.day === "all"; })) meta += " · Open today";
      }
      return meta;
    }
    function entriesOf(cat) {
      var out = [];
      (byCat[cat] || []).forEach(function (L) {
        (api.markers(L.id) || []).forEach(function (e) { out.push({ L: L, e: e }); });
      });
      return out;
    }
    function waitLine(words) {
      var p = el("p", "ev-hint");
      p.innerHTML = window.LokaWait ? window.LokaWait.html(words) : esc(words);
      return p;
    }
    // the sheet's head names the chip that is on, and how many it shows
    function chosenCat() { return CATS.filter(function (c) { return on[c.id]; })[0] || CATS[0]; }
    function sheetHead() {
      var c = chosenCat();
      if (!state.ready) return { label: catLabel(c.id), small: "" };
      if (c.id === "venues") return { label: catLabel("venues"), small: countWord(venues().length, "venue", "venues") };
      var n = entriesOf(c.id).filter(function (x) { return !x.e.away; }).length;
      if (state.sub) n = entriesOf(c.id).filter(function (x) { return !x.e.away && !x.e.subOff; }).length;
      return { label: catLabel(c.id) + (state.sub ? " · " + state.sub.label : ""), small: state.around ? "Around " + nameOf(byCat.venues[0], state.around) : countWord(n, "place", "places") };
    }
    function syncHead() {
      var sh = sheetHead();
      var head = document.querySelector("#atlas-panel .sheet-who strong");
      if (head) head.textContent = sh.label;
      var who = document.getElementById("sheet-layer");
      if (who) { who.innerHTML = ""; who.appendChild(el("span", "sheet-layer-name", esc(sh.small || sh.label))); }
    }
    /* rows under their sub-group's heading, groups in the order the mode
       lists them, each keeping the rows' own order; a group with nothing in
       it gets no heading. A category without groups: the rows as they are. */
    function inGroups(rows, draw) {
      var cat = rows.length && rows[0].c;
      var gs = (cat && cat.groups) || [];
      if (!gs.length) { rows.forEach(draw); return; }
      gs.forEach(function (g) {
        if (state.sub && state.sub !== g) return;
        var mine = rows.filter(function (r) { return groupOf(r.x.e.f.properties, r.c, !!r.x.L._ev.osm) === g; });
        if (!mine.length) return;
        state.list.appendChild(el("div", "ev-sh", esc(g.label) + " · " + mine.length));
        mine.forEach(draw);
      });
    }
    function renderList() {
      syncHead();
      var box = state.list; if (!box) return;
      box.innerHTML = "";
      if (!state.ready) { box.appendChild(waitLine("Loading the venues…")); return; }
      var others = CATS.filter(function (c) { return c.id !== "venues"; });
      if (state.around) {
        var v = state.around;
        var back = el("button", "ev-back", "‹ All venues");
        back.type = "button";
        back.addEventListener("click", function () { clearAround(); });
        box.appendChild(back);
        box.appendChild(el("div", "ev-h", "Around " + esc(nameOf(byCat.venues[0], v)) + " · within " + R + " m"));
        var rows = [];
        others.forEach(function (c) {
          if (!on[c.id]) return;
          entriesOf(c.id).forEach(function (x) {
            if (x.e.away) return;
            rows.push({ x: x, c: c, m: metres(v.geometry.coordinates, x.e.f.geometry.coordinates) });
          });
        });
        rows.sort(function (a, b) { return a.m - b.m; });
        if (!rows.length) box.appendChild(el("p", "ev-hint", "Nothing listed within " + R + " m of this venue."));
        inGroups(rows, function (r) {
          // a team place under a heading needs no word: the heading says it
          var word = r.x.L._ev.osm ? rowWord(r.x.e.f.properties, nameOf(r.x.L, r.x.e.f)) : (r.c.groups && r.c.groups.length ? "" : r.c.label);
          box.appendChild(rowFor(r.x.L, r.x.e.f, (word ? esc(word) + " · " : "") + "<b>" + esc(distanceWords(r.m)) + "</b>",
            '<span class="ev-dot" style="--ev-c:' + catColor(r.c.id) + '" aria-hidden="true"></span>'));
        });
        return;
      }
      var any = false;
      if (on.venues) {
        any = true;
        var vs = venues();
        box.appendChild(el("div", "ev-h", esc(countWord(vs.length, "venue", "venues"))));
        vs.forEach(function (f) {
          box.appendChild(rowFor(byCat.venues[0], f, venueMeta(f), '<span class="ev-no" aria-hidden="true">' + esc(f._evNo) + "</span>"));
        });
      }
      others.forEach(function (c) {
        if (!on[c.id]) return;
        any = true;
        var xs = entriesOf(c.id).map(function (x) {
          var nv = nearestVenue(x.e.f.geometry.coordinates);
          return { x: x, nv: nv };
        }).sort(function (a, b) { return (a.nv ? a.nv.m : 0) - (b.nv ? b.nv.m : 0); });
        // with a sub-group chosen, its own heading carries the count
        if (!state.sub) box.appendChild(el("div", "ev-h", esc(c.label) + " · " + xs.length));
        if (!xs.length) box.appendChild(el("p", "ev-hint", "None listed."));
        inGroups(xs.map(function (r) { r.c = c; return r; }), function (r) {
          var word = r.x.L._ev.osm ? rowWord(r.x.e.f.properties, nameOf(r.x.L, r.x.e.f)) : "";
          var meta = (word ? esc(word) + " · " : "") + (r.nv ? esc(distanceWords(r.nv.m)) + " from " + esc(nameOf(byCat.venues[0], r.nv.f)) : "");
          box.appendChild(rowFor(r.x.L, r.x.e.f, meta, '<span class="ev-dot" style="--ev-c:' + catColor(c.id) + '" aria-hidden="true"></span>'));
        });
      });
      if (!any) box.appendChild(el("p", "ev-hint", "Choose what to show with the buttons above."));
    }

    /* ---- "What's around here" ---- */
    function around(no) {
      var v = venues().filter(function (f) { return String(f._evNo) === String(no); })[0];
      if (!v) return;
      state.around = v;
      var first = null;
      CATS.forEach(function (c) {
        if (c.id === "venues") return;
        // within the radius; and where the category has a number per venue
        // (Eat & Drink: 8), only that many of its OpenStreetMap places, nearest first
        var near = [];
        (byCat[c.id] || []).forEach(function (L) {
          (api.markers(L.id) || []).forEach(function (e) {
            var m = metres(v.geometry.coordinates, e.f.geometry.coordinates);
            e.away = m > R;
            if (!e.away && L._ev.osm) near.push({ e: e, m: m });
          });
        });
        if (c.perVenue) near.sort(function (a, b) { return a.m - b.m; }).slice(c.perVenue).forEach(function (x) { x.e.away = true; });
        // the first chip with something near it opens: Eat & Drink, as a rule
        if (!first && entriesOf(c.id).some(function (x) { return !x.e.away; })) first = c.id;
      });
      // which chip opens is a setting (mode.aroundOpens: Eat & Drink, Mithun's
      // yes 23 Oct 2026), not the order of the chips; else the first with
      // something near
      var want = mode.aroundOpens && catById[mode.aroundOpens] ? mode.aroundOpens : null;
      choose(want || first || CATS.filter(function (c) { return c.id !== "venues"; }).map(function (c) { return c.id; })[0]);
      // a phone's card gives the sheet back to the list it came from
      if (api.onPhone()) { api.closeCard(); api.setSheet("half"); }
      renderList();
      frameAround();
    }
    function clearAround() {
      state.around = null;
      CATS.forEach(function (c) {
        (byCat[c.id] || []).forEach(function (L) {
          (api.markers(L.id) || []).forEach(function (e) { e.away = false; });
        });
      });
      choose("venues");
      renderList();
    }

    // the card's own controls, wired once for every card there will be
    if (!viewer._wired && typeof document !== "undefined") {
      viewer._wired = true;
      document.addEventListener("click", function (e) {
        var t = e.target && e.target.closest && e.target.closest("[data-ev-tab],[data-ev-around]");
        if (!t || !viewer._current) return;
        if (t.hasAttribute("data-ev-tab")) {
          e.stopPropagation();
          var prog = t.closest(".ev-prog"); if (!prog) return;
          var want = t.getAttribute("data-ev-tab");
          Array.prototype.forEach.call(prog.querySelectorAll("[data-ev-tab]"), function (b) { b.setAttribute("aria-selected", String(b === t)); });
          Array.prototype.forEach.call(prog.querySelectorAll("[data-ev-day]"), function (p) { p.hidden = p.getAttribute("data-ev-day") !== want; });
          return;
        }
        e.stopPropagation();
        // the calm mark while the map gathers what is near (wait.js)
        var said = t.innerHTML;
        if (window.LokaWait) t.innerHTML = window.LokaWait.html("Finding places nearby…");
        setTimeout(function () {
          viewer._current.around(t.getAttribute("data-ev-around"));
          // the card stays open on a wide screen: its button says what it does again
          setTimeout(function () { t.innerHTML = said; }, 400);
        }, 0);
      });
    }

    var me = {
      layers: layers,
      pinEl: pinEl,
      cardHTML: cardHTML,
      buildPanel: buildPanel,
      ready: function () { state.ready = true; buildSubs(); renderList(); },
      framed: function () { return ["ev-venues"]; },
      sheetHead: sheetHead,
      around: around,
      clearAround: clearAround,
      state: state,
    };
    viewer._current = me;
    return me;
  }

  return {
    isOn: isOn,
    parseProgramme: parseProgramme,
    placeCategory: placeCategory,
    osmCategory: osmCategory,
    isVenue: isVenue,
    sessionsOf: sessionsOf,
    venueOrder: venueOrder,
    programmeHTML: programmeHTML,
    openingTab: openingTab,
    dayLabel: dayLabel,
    todayIn: todayIn,
    metres: metres,
    distanceWords: distanceWords,
    kindWord: kindWord,
    wordOf: wordOf,
    groupOf: groupOf,
    KIND_WORDS: KIND_WORDS,
    viewer: viewer,
  };
});
