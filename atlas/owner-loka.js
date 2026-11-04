/* LOKA Atlas — "Kept up to date from LOKA": one row in Settings.
 *
 * Loaded by owner-look.js (never by a visitor's page), which hands over what it
 * holds — api, errMsg, esc, slug — through mount(ctx) and calls settings(scrim)
 * as Settings opens. Connected: a line saying which LOKA space, when it was
 * last updated, and "Update now"; while it runs, a calm wait line asked after
 * every 3 seconds; after, what came in in plain words. Not connected, for an
 * owner: first "Link your LOKA account" (a code to their LOKA email, typed
 * here), then "Linked as …" and a box for a space id or a pasted space link;
 * a space LOKA says is not theirs gets a plain sentence and "Request access".
 * The operator connects any space; an editor sees nothing until it is connected.
 * The routes are in api/apps/atlas.js (/instances/:slug/loka-sync, /auth/loka). */
(function () {
  "use strict";

  var api, errMsg, esc, SLUG, timer = null;
  var WAIT = "Bringing in places from LOKA…";

  function url() { return "instances/" + encodeURIComponent(SLUG) + "/loka-sync"; }
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "a while ago";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " minutes ago";
    if (s < 172800) return Math.round(s / 3600) + " hours ago";
    return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function count(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // what the last update did, in words a person would say
  function said(u) {
    if (!u) return "";
    if (u.error) return u.error;
    if (u.emptied) return "LOKA’s space has no places now, so all " + u.removed + " were taken out.";
    var parts = [];
    if (u.added) parts.push(count(u.added, "new", "new"));
    if (u.changed) parts.push(count(u.changed, "changed", "changed"));
    if (u.removed) parts.push(count(u.removed, "taken out", "taken out"));
    var line = parts.length ? parts.join(", ") : "Nothing had changed";
    return line + (u.skipped ? " · " + count(u.skipped, "place", "places") + " left out for having no position" : "");
  }

  function waitLine(text) { return window.LokaWait ? window.LokaWait.html(text) : esc(text); }
  // "updated 5 minutes ago", or what is true when the last go did not work or there has been none
  function when(u) {
    if (!u) return "not updated yet";
    return (u.error ? "last tried " : "updated ") + ago(u.at);
  }
  // where a request to connect a space stands, for the person who asked
  function asked(r) {
    if (!r) return "";
    var space = r.spaceName || "that space";
    if (r.state === "pending") return "You asked for access to " + space + ". It is waiting for a yes from LOKA Atlas; you can connect it once that comes.";
    if (r.state === "approved") return "Access to " + space + " was approved. Connect it above.";
    return "Your request for " + space + " was declined.";
  }

  /* The owner's own LOKA account: the box for the email and the code, or the
     line saying it is linked. The operator gets it too, for their own account. */
  function linkHtml(s) {
    if (s.link) {
      return '<div class="own-fld"><span>Linked to LOKA as ' + esc(s.link.lokaEmail) +
        ' <span class="own-note">a member of ' + count(s.link.spaces, "space", "spaces") + "</span>" +
        ' · <button class="own-linkish" type="button" id="own-loka-unlink">Unlink</button></span></div>';
    }
    return '<div class="own-fld"><span>Link your LOKA account <span class="own-note">a code goes to the email you sign in to LOKA with; then you can connect a space of yours</span></span>' +
      '<div class="own-inv-add"><input type="email" id="own-loka-email" aria-label="The email you sign in to LOKA with" value="' + esc(s.email || "") + '" autocomplete="email" />' +
      '<button class="share-btn" type="button" id="own-loka-send">Send code</button></div>' +
      '<div class="own-inv-add" id="own-loka-codebox" hidden><input type="text" id="own-loka-code" aria-label="The code from the email" placeholder="Code from the email" inputmode="numeric" autocomplete="one-time-code" />' +
      '<button class="share-btn" type="button" id="own-loka-confirm">Confirm</button></div></div>';
  }

  function draw(host, s) {
    clearTimeout(timer);
    if (!s || (!s.connected && !s.canConnect && !s.canLink)) { host.innerHTML = ""; return; }
    var h = "";
    if (!s.connected) {
      if (s.canLink) h += linkHtml(s);
      if (s.canConnect) {
        h += '<div class="own-fld"><span>Connect to a LOKA space <span class="own-note">its places come into this atlas and stay up to date when you press Update now</span></span>' +
          '<div class="own-inv-add"><input type="text" id="own-loka-id" aria-label="LOKA space id or link" placeholder="Space id or link" autocomplete="off" />' +
          '<input type="text" id="own-loka-name" aria-label="Name of the space" placeholder="Name (optional)" autocomplete="off" />' +
          '<button class="share-btn" type="button" id="own-loka-go">Connect</button></div>' +
          (s.request ? '<p class="own-note">' + esc(asked(s.request)) + "</p>" : "") + "</div>";
      }
      // a space chosen while building that could not be connected: why, until one is
      h += '<p class="own-note" role="status" id="own-loka-say">' + (s.note ? esc(s.note) : "") + "</p>";
    } else {
      h = '<div class="own-fld"><span>Kept up to date from LOKA · ' + esc(s.spaceName) + ' · ' + esc(when(s.lastUpdate)) + "</span>" +
        '<div class="own-row"><button class="share-btn" type="button" id="own-loka-now"' + (s.running ? " disabled" : "") + ">Update now</button>" +
        (s.canStop ? '<button class="own-linkish" type="button" id="own-loka-off">Stop updating</button>' : "") + "</div>" +
        '<p class="own-note" role="status" id="own-loka-say">' +
          (s.running ? waitLine(WAIT) : esc(said(s.lastUpdate))) + "</p></div>";
    }
    host.innerHTML = h + '<span class="own-err" id="own-loka-err" role="alert"></span>';
    var err = host.querySelector("#own-loka-err");
    var go = host.querySelector("#own-loka-go"), now = host.querySelector("#own-loka-now"), off = host.querySelector("#own-loka-off");
    var send = host.querySelector("#own-loka-send"), confirm = host.querySelector("#own-loka-confirm"), unlink = host.querySelector("#own-loka-unlink");
    var say = host.querySelector("#own-loka-say");
    // the button waits, with a calm line, until the answer comes
    function busy(btn, text) { btn.disabled = true; err.textContent = ""; say.innerHTML = waitLine(text); }
    function fail(btn) { return function (e) { btn.disabled = false; say.textContent = ""; err.textContent = errMsg(e); }; }
    function spaceBody() { return { spaceId: host.querySelector("#own-loka-id").value.trim(), spaceName: host.querySelector("#own-loka-name").value.trim() }; }
    if (send) send.onclick = function () {
      var email = host.querySelector("#own-loka-email").value.trim();
      busy(send, "Sending a code…");
      api("auth/loka/send-code", { method: "POST", body: { email: email } }).then(function (r) {
        send.disabled = false;
        say.textContent = r.said + " Type it here.";
        host.querySelector("#own-loka-codebox").hidden = false;
        host.querySelector("#own-loka-code").focus();
      }).catch(fail(send));
    };
    if (confirm) confirm.onclick = function () {
      busy(confirm, "Checking the code with LOKA…");
      api("auth/loka/confirm", { method: "POST", body: { email: host.querySelector("#own-loka-email").value.trim(), code: host.querySelector("#own-loka-code").value.trim() } })
        .then(function () { refresh(host); }).catch(fail(confirm));
    };
    if (unlink) unlink.onclick = function () {
      busy(unlink, "Unlinking…");
      api("auth/loka", { method: "DELETE" }).then(function () { refresh(host); }).catch(fail(unlink));
    };
    if (go) go.onclick = function () {
      busy(go, "Checking the space…");
      api(url(), { method: "POST", body: spaceBody() }).then(function () { refresh(host); }).catch(function (e) {
        if (!e || !e.canRequest) return fail(go)(e);
        // not theirs, as far as LOKA knows: the sentence, and the way to ask
        go.disabled = false;
        say.innerHTML = esc(errMsg(e)) + ' <button class="own-linkish" type="button" id="own-loka-ask">Request access</button>';
        var ask = host.querySelector("#own-loka-ask");
        ask.onclick = function () {
          busy(ask, "Asking…");
          api(url() + "/request", { method: "POST", body: spaceBody() }).then(function () { refresh(host); }).catch(fail(ask));
        };
      });
    };
    if (now) now.onclick = function () {
      busy(now, WAIT);
      api(url() + "/update", { method: "POST" }).then(function () { refresh(host); }).catch(fail(now));
    };
    if (off) off.onclick = function () {
      busy(off, "Stopping…");
      api(url(), { method: "DELETE" }).then(function () { refresh(host); }).catch(fail(off));
    };
    if (s.running) timer = setTimeout(function () { refresh(host); }, 3000);
  }
  function refresh(host) {
    if (!host.isConnected) return;
    api(url()).then(function (s) { draw(host, s); }).catch(function () { host.innerHTML = ""; });
  }

  function settings(scrim) {
    var anchor = scrim.querySelector("#own-look");
    if (!anchor) return;
    var host = scrim.querySelector("#own-loka");
    if (!host) { host = document.createElement("div"); host.id = "own-loka"; anchor.parentNode.insertBefore(host, anchor.nextSibling); }
    refresh(host);
  }
  function mount(ctx) { api = ctx.api; errMsg = ctx.errMsg; esc = ctx.esc; SLUG = ctx.slug; return { settings: settings }; }
  window.LokaOwnerLoka = { mount: mount };
})();
