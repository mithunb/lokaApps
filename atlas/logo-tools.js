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

  function drawLogo(img, w, h) {
    var size = logoSize(w, h, LOGO_MAX, false);
    for (var tries = 0; tries < 12; tries++) {
      var c = document.createElement("canvas");
      c.width = size.w; c.height = size.h;
      var g = c.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, size.w, size.h);        // a clear canvas keeps see-through parts
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

  window.LokaLogoTools = {
    LOGO_MAX: LOGO_MAX, LOGO_BYTES: LOGO_BYTES, LOGO_MIN: LOGO_MIN, UNREADABLE: LOGO_UNREADABLE,
    ACCEPT: "image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg",
    logoSize: logoSize, dataUrlBytes: dataUrlBytes, svgWithSize: svgWithSize,
    drawLogo: drawLogo, logoFromFile: logoFromFile, looksLikeImage: looksLikeImage,
  };
})();
