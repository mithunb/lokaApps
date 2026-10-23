/* "Where am I" — one button on the map of an event guide (Event mode).

   Mithun (23 Oct 2026): "have a way to show the current location and
   orientation of the user with a 'where am I' button."

   Tap it: the browser asks once to share the location; a blue dot appears
   where you are, a pale ring shows how sure the phone is, and a soft beam
   shows the way the phone is facing (when the phone can tell; a laptop
   cannot, and then the dot shows alone). The map moves to you — unless you
   are far from this atlas's area, when it stays put and says how far. Tap
   again to come back to the dot; tap while the map is already on you to
   switch it off.

   Nothing about where you are leaves the phone: the position is read by the
   browser and drawn on the map, never sent to LOKA.

   Facing: iPhones give a compass heading (webkitCompassHeading) once asked,
   and the asking has to happen inside the tap; Android gives
   "deviceorientationabsolute" (alpha counts the other way round). Either is
   turned by the screen's own rotation. While walking, the direction of
   travel from the GPS stands in when there is no compass.

   The wait while the phone finds you shows the breathing dots (wait.js). */
(function (root) {
  "use strict";

  var FAR_MIN_M = 20000;   // never "far" within this, however small the atlas
  var CSS =
    ".loka-locate button{display:flex;align-items:center;justify-content:center}\n" +
    ".loka-locate svg{width:18px;height:18px;display:block}\n" +
    ".loka-locate[data-state=on] button{color:#1A73E8}\n" +
    ".loka-locate[data-state=finding] svg{opacity:.35}\n" +
    ".loka-locate .wait-mark{position:absolute;margin:0;gap:2px}\n" +
    ".loka-locate .wait-mark i{width:4px;height:4px;background:#1A73E8}\n" +
    ".loka-locate-say{position:absolute;right:calc(100% + 8px);bottom:0;width:max-content;max-width:min(240px,62vw);" +
      "background:var(--color-surface,#fff);color:var(--color-text-primary,#24211D);font-size:13px;line-height:1.35;" +
      "padding:8px 10px;border-radius:var(--radius-sm,6px);box-shadow:0 1px 6px rgba(36,33,29,.22);pointer-events:auto}\n" +
    ".loka-me{width:0;height:0;position:relative;pointer-events:none}\n" +
    ".loka-me>*{position:absolute;left:0;top:0;transform:translate(-50%,-50%)}\n" +
    ".loka-me-acc{border-radius:50%;background:rgba(26,115,232,.13);border:1px solid rgba(26,115,232,.35)}\n" +
    ".loka-me-cone{width:84px;height:84px;transform:translate(-50%,-100%);transform-origin:50% 100%;" +
      "background:radial-gradient(circle at 50% 100%,rgba(26,115,232,.7),rgba(26,115,232,.12) 72%,rgba(26,115,232,0) 100%);" +
      "clip-path:polygon(50% 100%,18% 0,82% 0);display:none}\n" +
    ".loka-me[data-facing] .loka-me-cone{display:block}\n" +
    ".loka-me-dot{width:16px;height:16px;border-radius:50%;background:#1A73E8;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}\n";

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21 3 3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>';

  function metres(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function farWords(m) {
    var km = m / 1000;
    return km < 100 ? "about " + Math.round(km) + " km" : "about " + (Math.round(km / 10) * 10).toLocaleString("en-IN") + " km";
  }
  // how far a place may be and still count as near this atlas: inside the
  // first view widened by its own size on every side, and never under 20 km
  function nearTest(bounds) {
    if (!bounds) return function () { return { near: true, m: 0 }; };
    var sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
    var mid = [(sw.lng + ne.lng) / 2, (sw.lat + ne.lat) / 2];
    var reach = Math.max(FAR_MIN_M, 1.5 * metres([sw.lng, sw.lat], [ne.lng, ne.lat]));
    return function (pt) { var m = metres(mid, pt); return { near: m <= reach, m: m }; };
  }

  function injectStyle() {
    if (document.getElementById("loka-locate-style")) return;
    var s = document.createElement("style");
    s.id = "loka-locate-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // opts.padding: a function giving the map's covered edges (a phone's sheet),
// so "the middle of the map" is the middle of what can be seen
function LocateControl(opts) { this.opts = opts || {}; }
  LocateControl.prototype.onAdd = function (map) {
    injectStyle();
    var self = this;
    this.map = map;
    this.state = "off";
    this.at = null;            // [lng, lat]
    this.acc = 0;              // metres
    this.heading = null;       // degrees from north, when known
    this.watch = null;
    this.near = function () { return { near: true, m: 0 }; };
    map.once("idle", function () { self.near = nearTest(map.getBounds()); });

    var box = this.box = document.createElement("div");
    box.className = "maplibregl-ctrl maplibregl-ctrl-group loka-locate";
    box.setAttribute("data-state", "off");
    var b = this.btn = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", "Where am I");
    b.title = "Where am I";
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = ICON;
    b.addEventListener("click", function () { self.tap(); });
    box.appendChild(b);

    this.onZoom = function () { self.sizeRing(); };
    map.on("zoom", this.onZoom);
    return box;
  };
  LocateControl.prototype.onRemove = function () {
    this.stop();
    this.map.off("zoom", this.onZoom);
    if (this.box.parentNode) this.box.parentNode.removeChild(this.box);
  };

  LocateControl.prototype.setState = function (s) {
    this.state = s;
    this.box.setAttribute("data-state", s);
    this.btn.setAttribute("aria-pressed", String(s === "on"));
    var w = this.box.querySelector(".wait-mark");
    if (s === "finding") {
      if (!w && root.LokaWait) {
        var tmp = document.createElement("span");
        tmp.innerHTML = root.LokaWait.html("");
        var mark = tmp.querySelector(".wait-mark");
        if (mark) this.btn.appendChild(mark);
      }
      this.btn.setAttribute("aria-label", "Finding where you are");
    } else {
      if (w && w.parentNode) w.parentNode.removeChild(w);
      this.btn.setAttribute("aria-label", s === "on" ? "Where am I — showing; tap to centre on you" : "Where am I");
    }
  };

  // a short note beside the button, gone after a while or on the next tap
  LocateControl.prototype.say = function (words) {
    var self = this;
    this.hush();
    var p = document.createElement("div");
    p.className = "loka-locate-say";
    p.setAttribute("role", "status");
    p.textContent = words;
    p.addEventListener("click", function () { self.hush(); });
    this.box.style.position = "relative";
    this.box.appendChild(p);
    this.sayTimer = setTimeout(function () { self.hush(); }, 7000);
  };
  LocateControl.prototype.hush = function () {
    clearTimeout(this.sayTimer);
    var p = this.box.querySelector(".loka-locate-say");
    if (p && p.parentNode) p.parentNode.removeChild(p);
  };

  LocateControl.prototype.tap = function () {
    this.hush();
    if (this.state === "finding") return;
    if (this.state === "on" && this.at) {
      var px = this.map.project(this.at), c = this.map.project(this.map.getCenter());
      if (Math.abs(px.x - c.x) < 30 && Math.abs(px.y - c.y) < 30) { this.stop(); return; }
      this.goTo(true);
      return;
    }
    if (!navigator.geolocation || root.isSecureContext === false) {
      this.say("This browser can’t share your location.");
      return;
    }
    this.askFacing();   // inside the tap: iPhones only ask from here
    this.start();
  };

  LocateControl.prototype.start = function () {
    var self = this;
    this.setState("finding");
    this.first = true;
    this.watch = navigator.geolocation.watchPosition(function (pos) { self.got(pos); }, function (err) { self.failed(err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };
  LocateControl.prototype.stop = function () {
    if (this.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    this.stopFacing();
    if (this.marker) { this.marker.remove(); this.marker = null; }
    this.at = null;
    this.heading = null;
    this.setState("off");
  };

  LocateControl.prototype.got = function (pos) {
    var c = pos.coords;
    this.at = [c.longitude, c.latitude];
    this.acc = c.accuracy || 0;
    // walking with no compass: the way you are going stands in for the way you face
    if (!this.compass && c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.6) this.face(c.heading);
    this.draw();
    if (this.first) {
      this.first = false;
      this.setState("on");
      this.goTo(false);
    }
  };
  LocateControl.prototype.failed = function (err) {
    var wasFinding = this.state === "finding";
    if (err && err.code === 1) {
      this.stop();
      this.say("Location is switched off for this site. Allow it in your browser’s settings to see where you are.");
    } else if (wasFinding) {
      this.stop();
      this.say("Couldn’t find where you are just now. Try again in a moment.");
    }
    // a hiccup once the dot is showing: keep the last place and keep watching
  };

  LocateControl.prototype.goTo = function (again) {
    var t = this.near(this.at);
    if (!t.near) {
      this.say("You’re " + farWords(t.m) + " from this map’s area, so the map stays where it is.");
      return;
    }
    var z = Math.max(this.map.getZoom(), Math.min(16, this.map.getMaxZoom()));
    var reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var pad = typeof this.opts.padding === "function" ? this.opts.padding() : undefined;
    this.map.easeTo({ center: this.at, zoom: z, padding: pad, duration: reduced ? 0 : (again ? 400 : 700) });
  };

  LocateControl.prototype.draw = function () {
    if (!this.at) return;
    if (!this.marker) {
      var e = this.me = document.createElement("div");
      e.className = "loka-me";
      e.innerHTML = '<div class="loka-me-acc"></div><div class="loka-me-cone"></div><div class="loka-me-dot"></div>';
      e.setAttribute("aria-hidden", "true");
      this.marker = new root.maplibregl.Marker({ element: e, rotationAlignment: "map", pitchAlignment: "viewport" })
        .setLngLat(this.at).addTo(this.map);
    } else this.marker.setLngLat(this.at);
    this.sizeRing();
    if (this.heading != null) this.marker.setRotation(this.heading);
  };
  // the ring is the phone's own "within so many metres", drawn to the map's scale
  LocateControl.prototype.sizeRing = function () {
    if (!this.me || !this.at) return;
    var mpp = 40075016.686 * Math.cos(this.at[1] * Math.PI / 180) / (512 * Math.pow(2, this.map.getZoom()));
    var d = Math.max(0, Math.min(2000, 2 * this.acc / mpp));
    var ring = this.me.firstChild;
    ring.style.width = ring.style.height = Math.round(d) + "px";
    ring.style.display = d < 22 ? "none" : "block";
  };

  /* ---- which way the phone faces ---- */
  LocateControl.prototype.face = function (deg) {
    if (deg == null || isNaN(deg)) return;
    this.heading = ((deg % 360) + 360) % 360;
    if (this.me) this.me.setAttribute("data-facing", "");
    var self = this;
    if (this.faceFrame) return;
    this.faceFrame = (root.requestAnimationFrame || setTimeout)(function () {
      self.faceFrame = null;
      if (self.marker && self.heading != null) self.marker.setRotation(self.heading);
    });
  };
  LocateControl.prototype.askFacing = function () {
    var self = this;
    var DO = root.DeviceOrientationEvent;
    if (!DO || this.onOrient) return;
    var screenTurn = function () {
      var o = root.screen && root.screen.orientation;
      return (o && typeof o.angle === "number") ? o.angle : (root.orientation || 0);
    };
    this.onOrient = function (e) {
      var h = null;
      if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === "number") h = 360 - e.alpha;
      if (h == null) return;
      self.compass = true;
      self.face(h + screenTurn());
    };
    var listen = function () {
      var ev = ("ondeviceorientationabsolute" in root) ? "deviceorientationabsolute" : "deviceorientation";
      self.orientEvent = ev;
      root.addEventListener(ev, self.onOrient);
    };
    if (typeof DO.requestPermission === "function") {
      DO.requestPermission().then(function (r) { if (r === "granted") listen(); }).catch(function () {});
    } else listen();
  };
  LocateControl.prototype.stopFacing = function () {
    if (this.onOrient && this.orientEvent) root.removeEventListener(this.orientEvent, this.onOrient);
    this.onOrient = null;
    this.compass = false;
  };

  root.LokaLocate = { Control: LocateControl, nearTest: nearTest, metres: metres, farWords: farWords };
})(typeof window !== "undefined" ? window : globalThis);
