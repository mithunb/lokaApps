/* One way of waiting, for every page of LOKA Atlas.

   Mithun's rule (16 Oct 2026): if someone is waiting on something to load, a
   graphic should be shown to reduce anxiety, or an explanation given. Before
   this, each wait had its own answer — a stripe here, a spinner there, a
   disabled button with no words, or nothing at all.

   The mark: three small Leaf dots that breathe in turn. Quiet, never red,
   never a spinner that reads as a fault. Next to it, plain words saying what
   is happening ("Saving…", "Opening…"), and "this can take a minute" where
   that is true.

   Timing: a wait is shown only once it has lasted DELAY (300 ms), so a save
   that lands at once does not flash; an action that is never instant (opening
   a page) asks for it immediately with delay 0.

   This file injects its own style once (like share.js does) so a page that
   loads it needs nothing else. index.html repeats the same rules inline, so
   the mark is in the atlas's first frame before any script runs; the check
   in test/waits-test.mjs holds the two copies equal. */
(function () {
  "use strict";
  var DELAY = 300;
  var CSS =
    '.wait-mark { display:inline-flex; align-items:center; gap:4px; vertical-align:middle; margin-right:.5em; }\n' +
    '.wait-mark i { display:block; width:6px; height:6px; border-radius:50%; background:var(--color-leaf,#2A6B41); opacity:.3;\n' +
    '  animation:wait-breathe 1.5s ease-in-out infinite; }\n' +
    '.wait-mark i:nth-child(2) { animation-delay:.22s; }\n' +
    '.wait-mark i:nth-child(3) { animation-delay:.44s; }\n' +
    'button .wait-mark i, .btn .wait-mark i, .share-btn .wait-mark i, .shr-btn .wait-mark i { background:currentColor; }\n' +
    '@keyframes wait-breathe { 0%, 70%, 100% { opacity:.3; transform:scale(.85); } 35% { opacity:1; transform:scale(1); } }\n' +
    '.wait-line { display:inline-flex; align-items:center; color:var(--color-text-secondary,#5A5751); }\n' +
    '@media (prefers-reduced-motion: reduce) { .wait-mark i { animation:none; opacity:.6; } }\n';

  function injectStyle() {
    if (document.getElementById("wait-style")) return;
    var s = document.createElement("style");
    s.id = "wait-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var MARK = '<span class="wait-mark" aria-hidden="true"><i></i><i></i><i></i></span>';
  /* The mark and the words as one piece of markup, for code that builds its
     own HTML. */
  function html(text) { return MARK + '<span>' + esc(text) + '</span>'; }

  /* Start a wait on an element. Returns a function that ends it.

     A button is disabled at once (a second press must not send twice) and,
     after the delay, its label becomes the mark and the words; ending it
     puts the label back and enables it again, unless opts.keepDisabled.
     Any other element gets the mark and the words written into it after
     the delay; ending it clears them — but only if they are still what is
     there, so a message written in the meantime is never wiped. */
  function start(el, text, opts) {
    opts = opts || {};
    if (!el) return function () {};
    injectStyle();
    var delay = opts.delay == null ? DELAY : opts.delay;
    var isButton = el.tagName === "BUTTON" || el.tagName === "A" || el.type === "submit";
    var before = { html: el.innerHTML, disabled: el.disabled, busy: el.getAttribute("aria-busy") };
    var shown = false, done = false;
    if (isButton) el.disabled = true;
    el.setAttribute("aria-busy", "true");
    function show() {
      if (done) return;
      shown = true;
      el.innerHTML = html(text);
      if (!isButton) el.classList.add("wait-line");
    }
    var t = delay ? setTimeout(show, delay) : (show(), null);
    return function stop() {
      if (done) return;
      done = true;
      if (t) clearTimeout(t);
      if (before.busy == null) el.removeAttribute("aria-busy"); else el.setAttribute("aria-busy", before.busy);
      if (isButton) {
        if (shown) el.innerHTML = before.html;
        if (!opts.keepDisabled) el.disabled = before.disabled;
      } else if (shown && el.innerHTML === html(text)) {
        el.innerHTML = "";
        el.classList.remove("wait-line");
      }
    };
  }

  injectStyle();
  window.LokaWait = { start: start, html: html, mark: MARK, css: CSS, DELAY: DELAY };
})();
