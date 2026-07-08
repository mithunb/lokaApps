/* LOKA Atlas share panel — one component used by the setup wizard's publish step
   and the viewer's Share button. Everything is client-side: the QR code comes from
   the vendored qrcode-generator lib (vendor/qrcode.js), nothing leaves the browser.

   window.AtlasShare.open({ url, title, private: bool, viewKey?: string })
   window.AtlasShare.panel(opts) -> HTMLElement (embed inline instead of a dialog)
*/
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
  };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function copyBtn(text, label) {
    var b = el("button", "shr-btn", ICONS.copy + "<span>" + esc(label || "Copy") + "</span>");
    b.type = "button";
    b.onclick = function () {
      navigator.clipboard.writeText(text).then(function () {
        b.innerHTML = ICONS.check + "<span>Copied</span>";
        setTimeout(function () { b.innerHTML = ICONS.copy + "<span>" + esc(label || "Copy") + "</span>"; }, 1600);
      });
    };
    return b;
  }

  function qrCanvas(url, sizePx) {
    if (typeof qrcode !== "function") return null;
    var qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var scale = Math.max(2, Math.floor(sizePx / (n + quiet * 2)));
    var size = (n + quiet * 2) * scale;
    var cv = document.createElement("canvas");
    cv.width = cv.height = size;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#2B2723";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    return cv;
  }

  function panel(opts) {
    var url = opts.url;
    var title = opts.title || "LOKA Atlas";
    var isPrivate = !!opts.private;
    var root = el("div", "shr");

    // link row
    var linkRow = el("div", "shr-row");
    var input = el("input", "shr-link");
    input.type = "text"; input.readOnly = true; input.value = url;
    input.onfocus = function () { input.select(); };
    linkRow.appendChild(input);
    linkRow.appendChild(copyBtn(url, "Copy link"));
    root.appendChild(linkRow);

    if (isPrivate) {
      root.appendChild(el("p", "shr-note",
        "This atlas is <b>private</b> — the link includes its view key. Anyone who has the full link can see the map, so share it only with people who should."));
    } else {
      // share intents (never for private maps)
      var intents = el("div", "shr-row shr-intents");
      var msg = encodeURIComponent(title + " — " + url);
      var wa = el("a", "shr-btn", ICONS.whatsapp + "<span>WhatsApp</span>");
      wa.href = "https://wa.me/?text=" + msg; wa.target = "_blank"; wa.rel = "noopener";
      var tx = el("a", "shr-btn", ICONS.x + "<span>Post</span>");
      tx.href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(url);
      tx.target = "_blank"; tx.rel = "noopener";
      var em = el("a", "shr-btn", ICONS.mail + "<span>Email</span>");
      em.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + msg;
      intents.appendChild(wa); intents.appendChild(tx); intents.appendChild(em);
      if (navigator.share) {
        var nb = el("button", "shr-btn", ICONS.share + "<span>Share…</span>");
        nb.type = "button";
        nb.onclick = function () { navigator.share({ title: title, url: url }).catch(function () {}); };
        intents.appendChild(nb);
      }
      root.appendChild(intents);
    }

    // QR
    var cv = qrCanvas(url, 180);
    if (cv) {
      var qrBox = el("div", "shr-qr");
      qrBox.appendChild(cv);
      var qrCol = el("div", "shr-qr-col");
      qrCol.appendChild(el("b", null, "QR code"));
      qrCol.appendChild(el("span", null, "For posters, flyers and field sheets — scans straight to the atlas."));
      var dl = el("a", "shr-btn", ICONS.download + "<span>Download PNG</span>");
      dl.href = cv.toDataURL("image/png");
      dl.download = (opts.slug || "atlas") + "-qr.png";
      qrCol.appendChild(dl);
      qrBox.appendChild(qrCol);
      root.appendChild(qrBox);
    }

    // embed snippet (public only)
    if (!isPrivate) {
      var snippet = '<iframe src="' + url + '" width="100%" height="620" style="border:1px solid #d7d4cc;border-radius:6px" title="' + title.replace(/"/g, "&quot;") + '" loading="lazy"></iframe>';
      var embed = el("div", "shr-embed");
      embed.appendChild(el("b", null, "Embed on your website"));
      var pre = el("textarea", "shr-code");
      pre.readOnly = true; pre.rows = 3; pre.value = snippet;
      pre.onfocus = function () { pre.select(); };
      embed.appendChild(pre);
      embed.appendChild(copyBtn(snippet, "Copy embed code"));
      root.appendChild(embed);
    }

    return root;
  }

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var css = [
      ".shr{display:flex;flex-direction:column;gap:.9rem;font-size:.9rem}",
      ".shr-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}",
      ".shr-link{flex:1 1 14rem;font:inherit;font-size:.85rem;padding:.5rem .6rem;border:1px solid rgba(43,39,35,.16);border-radius:4px;background:#fff;color:#2B2723;min-width:0}",
      ".shr-btn{display:inline-flex;align-items:center;gap:.4rem;font:inherit;font-size:.85rem;font-weight:600;padding:.5rem .8rem;border:1px solid rgba(43,39,35,.16);border-radius:4px;background:#F2F0EB;color:#2B2723;cursor:pointer;text-decoration:none}",
      ".shr-btn:hover{border-color:#40573D;color:#2F4230;text-decoration:none}",
      ".shr-btn svg{width:15px;height:15px}",
      ".shr-note{margin:0;color:#5C544A}",
      ".shr-qr{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}",
      ".shr-qr canvas{border:1px solid rgba(43,39,35,.16);border-radius:4px;width:132px;height:132px;image-rendering:pixelated}",
      ".shr-qr-col{display:flex;flex-direction:column;gap:.35rem;max-width:20rem}",
      ".shr-qr-col span{color:#5C544A;font-size:.85rem}",
      ".shr-embed{display:flex;flex-direction:column;gap:.4rem;align-items:flex-start}",
      ".shr-code{width:100%;font:12px/1.45 ui-monospace,Menlo,monospace;padding:.5rem .6rem;border:1px solid rgba(43,39,35,.16);border-radius:4px;background:#fff;color:#2B2723;resize:vertical;box-sizing:border-box}",
      ".shr-dialog{border:1px solid rgba(43,39,35,.2);border-radius:6px;padding:1.25rem 1.35rem;max-width:30rem;width:calc(100vw - 2.5rem);background:#F2F0EB;color:#2B2723;font-family:'DM Sans',system-ui,sans-serif}",
      ".shr-dialog::backdrop{background:rgba(43,39,35,.35)}",
      ".shr-dialog h3{margin:0 0 .9rem;font-family:Figtree,sans-serif;font-size:1.05rem}",
      ".shr-dialog .shr-close{position:absolute;top:.6rem;right:.6rem;border:none;background:none;font-size:1.2rem;cursor:pointer;color:#6B655B;padding:.2rem .45rem}",
    ].join("\n");
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  function open(opts) {
    injectStyle();
    var dlg = document.createElement("dialog");
    dlg.className = "shr-dialog";
    var close = el("button", "shr-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.onclick = function () { dlg.close(); };
    dlg.appendChild(close);
    dlg.appendChild(el("h3", null, "Share this atlas"));
    dlg.appendChild(panel(opts));
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  window.AtlasShare = { open: open, panel: function (o) { injectStyle(); return panel(o); } };
})();
