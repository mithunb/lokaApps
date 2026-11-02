/* LOKA Atlas — turning any picture into the logo the server will take.
 *
 * The server keeps one rule: a PNG under 200 KB. People have JPGs from their
 * website, SVGs from a designer, photos of a letterhead — so the browser
 * redraws whatever they pick as a PNG no bigger than 512 × 512 (proportions
 * and see-through parts kept), and shrinks it again until it fits. Nobody is
 * ever asked about formats or sizes.
 *
 * One file on purpose. This lived inside the setup wizard; release 2 of the
 * onboarding (October 2026) moved the logo to the atlas's own Settings, and a
 * second copy there would have drifted from the first — the check that holds
 * the browser and the server to the same 200 KB reads THIS file. Loaded as a
 * plain script (window.LokaLogoTools) by owner.js; anything else that wants a
 * logo loads it the same way.
 */
(function () {
  "use strict";

  var LOGO_MAX = 512, LOGO_BYTES = 200 * 1024, LOGO_MIN = 48;
  var LOGO_UNREADABLE = "That file isn’t an image we can read — try a PNG or JPG.";

  // how big to draw it: fit inside max × max, keep proportions. A drawing (SVG)
  // has no real size, so it is drawn as large as allowed; a photo is never blown up.
  function logoSize(w, h, max, grow) {
    w = Number(w) || 0; h = Number(h) || 0;
    if (w <= 0 || h <= 0) return { w: max, h: max };
    var k = Math.min(max / w, max / h);
    if (!grow) k = Math.min(1, k);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  function dataUrlBytes(u) {
    var b64 = String(u).split(",")[1] || "";
    return Math.floor(b64.length * 3 / 4) - (/==$/.test(b64) ? 2 : /=$/.test(b64) ? 1 : 0);
  }
  function isSvgFile(f) { return f.type === "image/svg+xml" || /\.svg$/i.test(f.name || ""); }
  function looksLikeImage(f) {
    return /^image\/(png|jpeg|pjpeg|webp|svg\+xml)$/.test(f.type || "") ||
      /\.(png|jpe?g|webp|svg)$/i.test(f.name || "");
  }

  // An SVG often says only "viewBox", and then browsers disagree about its size
  // (some draw nothing at all). Give it a real width and height before drawing.
  function svgWithSize(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml");
    var el = doc.documentElement;
    if (!el || el.nodeName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
    var vb = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    var w = parseFloat(el.getAttribute("width")), h = parseFloat(el.getAttribute("height"));
    if (/%/.test(el.getAttribute("width") || "")) w = NaN;
    if (/%/.test(el.getAttribute("height") || "")) h = NaN;
    if (!(w > 0 && h > 0) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
    if (!(w > 0 && h > 0)) { w = LOGO_MAX; h = LOGO_MAX; }
    var sz = logoSize(w, h, LOGO_MAX, true);
    if (!el.getAttribute("viewBox")) el.setAttribute("viewBox", "0 0 " + w + " " + h);
    el.setAttribute("width", sz.w); el.setAttribute("height", sz.h);
    return { text: new XMLSerializer().serializeToString(doc), w: sz.w, h: sz.h };
  }

  /* The rows and columns at the edges that are fully see-through, so a wide
     wordmark sits flush beside the name instead of floating in its own
     margin. Returns the box of what is drawn, or null when nothing is. */
  function drawnBox(g, w, h) {
    var d;
    try { d = g.getImageData(0, 0, w, h).data; } catch (e) { return null; }   // a tainted canvas cannot be read
    var top = h, left = w, right = -1, bottom = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (right < 0) return null;
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  /* How light what is drawn is, from the pixels: the mean luminance of every
     pixel that is not see-through, 0 (black) to 1 (white), and whether anything
     is drawn at all. A white-on-transparent logo (a partner's mark made for a
     dark band) is invisible on a light tile; the owner's sheet shows such a
     logo on a dark tile, and offers nothing for an empty picture. */
  function pixelTone(d, w, h) {
    var n = 0, sum = 0;
    for (var i = 0; i < w * h; i++) {
      var a = d[i * 4 + 3];
      if (a <= 8) continue;
      n++;
      sum += (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    return { drawn: n, meanLum: n ? sum / n : 0, light: n > 0 && sum / n > 0.72, empty: n < 4 };
  }
  // the tone of a picture given as a data URL → cb(null, { drawn, meanLum, light, empty })
  function logoTone(dataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var w = Math.max(1, Math.min(256, img.naturalWidth || 1)), h = Math.max(1, Math.min(256, img.naturalHeight || 1));
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      var d; try { d = g.getImageData(0, 0, w, h).data; } catch (e) { return cb(LOGO_UNREADABLE); }
      cb(null, pixelTone(d, w, h));
    };
    img.onerror = function () { cb(LOGO_UNREADABLE); };
    img.src = dataUrl;
  }

  function drawLogo(img, w, h) {
    var size = logoSize(w, h, LOGO_MAX, false);
    // first, the picture at its size, to find and trim its empty edges
    var first = document.createElement("canvas");
    first.width = size.w; first.height = size.h;
    var fg = first.getContext("2d");
    fg.drawImage(img, 0, 0, size.w, size.h);
    var box = drawnBox(fg, size.w, size.h);
    var src = img, sx = 0, sy = 0, sw = w, sh = h;
    if (box && (box.w < size.w || box.h < size.h) && box.w >= 1 && box.h >= 1) {
      src = first; sx = box.x; sy = box.y; sw = box.w; sh = box.h;
      size = logoSize(box.w, box.h, LOGO_MAX, false);
    }
    for (var tries = 0; tries < 12; tries++) {
      var c = document.createElement("canvas");
      c.width = size.w; c.height = size.h;
      var g = c.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(src, sx, sy, sw, sh, 0, 0, size.w, size.h);   // a clear canvas keeps see-through parts
      var url = c.toDataURL("image/png");
      if (!/^data:image\/png;base64,/.test(url)) return null;
      if (dataUrlBytes(url) <= LOGO_BYTES) return url;
      if (Math.max(size.w, size.h) <= LOGO_MIN) return null;
      size = { w: Math.max(1, Math.round(size.w * 0.8)), h: Math.max(1, Math.round(size.h * 0.8)) };
    }
    return null;
  }

  // file → cb(err) or cb(null, pngDataUrl). The error is a sentence for the screen.
  function logoFromFile(file, cb) {
    if (!file) return;
    if (!looksLikeImage(file)) return cb(LOGO_UNREADABLE);
    if (file.size > 25 * 1024 * 1024) return cb("That image is too big to use. Try a smaller copy of your logo.");
    function fromUrl(src, w, h, done) {
      var img = new Image();
      img.onload = function () {
        var out = null, err = null;
        try { out = drawLogo(img, w || img.naturalWidth, h || img.naturalHeight); }
        catch (e) { err = LOGO_UNREADABLE; }
        done();
        if (err) return cb(err);
        if (!out) return cb("That logo has too much detail to fit. Try a simpler or smaller version.");
        cb(null, out);
      };
      img.onerror = function () { done(); cb(LOGO_UNREADABLE); };
      img.src = src;
    }
    if (isSvgFile(file)) {
      var rd = new FileReader();
      rd.onload = function () {
        var fixed = null;
        try { fixed = svgWithSize(String(rd.result || "")); } catch (e) { fixed = null; }
        if (!fixed) return cb(LOGO_UNREADABLE);
        var u = URL.createObjectURL(new Blob([fixed.text], { type: "image/svg+xml" }));
        fromUrl(u, fixed.w, fixed.h, function () { URL.revokeObjectURL(u); });
      };
      rd.onerror = function () { cb(LOGO_UNREADABLE); };
      rd.readAsText(file);
    } else {
      var u = URL.createObjectURL(file);
      fromUrl(u, 0, 0, function () { URL.revokeObjectURL(u); });
    }
  }

  /* A picture that arrived as its own bytes (a logo the server found on the
     owner's website) goes through exactly the same redraw as a file the
     owner picked: it is drawn to a canvas, which is also how a hostile image
     is defanged — an SVG is rasterised, never put into the page. */
  function logoFromDataUrl(dataUrl, cb) {
    var m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
    if (!m) return cb(LOGO_UNREADABLE);
    var type = m[1].toLowerCase(), bytes;
    try { bytes = Uint8Array.from(atob(m[2]), function (ch) { return ch.charCodeAt(0); }); } catch (e) { return cb(LOGO_UNREADABLE); }
    var file = new File([bytes], "logo." + (type === "image/svg+xml" ? "svg" : type === "image/x-icon" ? "ico" : type.split("/")[1]), { type: type === "image/x-icon" ? "image/png" : type });
    if (type === "image/x-icon") {   // the browser can draw an .ico; looksLikeImage only knows the usual four
      var img = new Image();
      img.onload = function () {
        var out = null; try { out = drawLogo(img, img.naturalWidth, img.naturalHeight); } catch (e) { out = null; }
        cb(out ? null : LOGO_UNREADABLE, out || undefined);
      };
      img.onerror = function () { cb(LOGO_UNREADABLE); };
      img.src = dataUrl;
      return;
    }
    logoFromFile(file, cb);
  }

  window.LokaLogoTools = {
    LOGO_MAX: LOGO_MAX, LOGO_BYTES: LOGO_BYTES, LOGO_MIN: LOGO_MIN, UNREADABLE: LOGO_UNREADABLE,
    ACCEPT: "image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg",
    logoSize: logoSize, dataUrlBytes: dataUrlBytes, svgWithSize: svgWithSize, drawnBox: drawnBox, pixelTone: pixelTone, logoTone: logoTone,
    drawLogo: drawLogo, logoFromFile: logoFromFile, logoFromDataUrl: logoFromDataUrl, looksLikeImage: looksLikeImage,
  };
})();
