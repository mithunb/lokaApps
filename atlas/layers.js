/* LOKA Atlas — the standalone data workbench page.
   All the wizard's work lives in databench.js, which the setup wizard mounts
   too; this page only supplies the chrome it owns: the 4-chip stepper and the
   page title. Everything else (upload, sign-in, the atlas picker, the manage
   list, Check & fix → Place on map → Preview & add) comes from the module. */
(function () {
  "use strict";

  var root = document.getElementById("bench-mount");
  if (!root || !window.LokaDataBench) return;

  var TRACK_LABEL = { tabular: "Check & fix", spatial: "Geometry check" };

  var bench = window.LokaDataBench.mount(root, {
    mode: "standalone",
    api: "./api/",
    // the page's stepper mirrors the module's progress; spatial uploads place
    // themselves, so their matching step drops out of the rail
    onStep: function (n, spatial) {
      [1, 2, 3, 4].forEach(function (i) {
        var chip = document.querySelector('#stepper [data-step="' + i + '"]');
        if (!chip) return;
        chip.classList.toggle("now", i === n);
        chip.classList.toggle("done", i < n);
      });
      var chip2 = document.querySelector('#stepper [data-step="2"]');
      var chip3 = document.querySelector('#stepper [data-step="3"]');
      if (chip2) chip2.textContent = spatial ? TRACK_LABEL.spatial : TRACK_LABEL.tabular;
      if (chip3) chip3.hidden = !!spatial;
    },
  });

  window.__bench = bench;   // debug hook, same spirit as the viewer's __map
})();
