/*!
 * ambient-glass.js — an ambient glow around any video, iframe, canvas or element,
 * made by the browser itself: nothing is read, copied or played twice.
 *
 * How it works (see README.md):
 *   1. A "frosted glass" box (CSS backdrop-filter) is laid OVER the target and a margin around it.
 *      The browser blurs whatever is under the glass — the target's pixels included — on the GPU, every frame.
 *   2. A mask cuts a hole the exact shape of the target, so the target itself shows untouched,
 *      and fades the glass out smoothly towards its own edge.
 *   3. A second, larger glass blurs the first one's light again (it spreads further);
 *      an optional third one brightens the light past the four corners (blur finds less picture there).
 *
 * No script runs per frame. JavaScript only places the glass and draws the mask when the size changes.
 *
 * MIT License — see LICENSE.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AmbientGlass = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    // each glass layer: how far it reaches past the target (px) and the CSS filter applied to what is under it
    layers: [
      { pad: 220, filter: "blur(40px) saturate(1.3) brightness(1.45)" },   // near light: little blur, colours stay apart
      { pad: 480, filter: "blur(110px) brightness(1.25)" }                // far light: blurs the near light again
    ],
    // brightens the light beyond the four corners; brightness b with contrast 0.45 / (0.5 - 0.05 b)
    // keeps a near-black page (about 5 %) as dark as it was. null = no corner layer
    corners: { filter: "brightness(1.5) contrast(1.06)" },
    // narrow screens: these settings replace the ones above (null = the same everywhere)
    small: {
      maxWidth: 700,
      layers: [{ pad: 54, filter: "blur(16px) saturate(1.3) brightness(1.4)" }],
      corners: { filter: "brightness(1.4) contrast(1.05)" }
    },
    radius: "auto",               // the hole's corner radius in px, or "auto" = the target's own border-radius
    fade: { inset: 0.55, soft: 0.18 },   // the light is half gone at (1 - inset) of pad; soft = blur of the fade
    zIndex: 1,                    // put your own controls above this
    container: null,              // where the glass goes (default: the target's parent)
    className: "ag-glass"
  };

  var styleAdded = false;
  function addStyle() {
    if (styleAdded || typeof document === "undefined") return;
    styleAdded = true;
    var s = document.createElement("style");
    s.textContent =
      ".ag-glass{position:absolute;pointer-events:none;box-sizing:border-box;" +
      "-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}" +
      ".ag-glass.ag-off{display:none}" +
      "@media (prefers-reduced-transparency: reduce){.ag-glass{display:none}}" +
      ":fullscreen .ag-glass{display:none}";
    document.head.appendChild(s);
  }

  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b || {}) if (b[k] !== undefined) o[k] = b[k];
    return o;
  }

  /* The mask: white = glass shows, black = hidden. A blurred rounded box (the fade) minus the target (the hole).
     corners = true: only the four quarter-planes beyond the target's corners, softened, times the same fade. */
  function maskURL(W, H, pad, hole, rad, fade, corners) {
    var x0 = pad, y0 = pad, x1 = W - pad, y1 = H - pad, r = Math.max(0, Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2));
    var path = "M" + (x0 + r) + "," + y0 + "H" + (x1 - r) + "A" + r + "," + r + " 0 0 1 " + x1 + "," + (y0 + r) +
      "V" + (y1 - r) + "A" + r + "," + r + " 0 0 1 " + (x1 - r) + "," + y1 + "H" + (x0 + r) +
      "A" + r + "," + r + " 0 0 1 " + x0 + "," + (y1 - r) + "V" + (y0 + r) + "A" + r + "," + r + " 0 0 1 " + (x0 + r) + "," + y0 + "Z";
    var m = Math.round(pad * fade.inset), sd = Math.max(2, pad * fade.soft);
    var box = '<rect x="' + m + '" y="' + m + '" width="' + (W - 2 * m) + '" height="' + (H - 2 * m) +
      '" rx="' + Math.max(0, Math.round(pad - m + r)) + '" fill="#fff" filter="url(#f)"/>';
    var body = box;
    if (corners) {
      var q = Math.round(pad * 0.15);
      var quads = [[0, 0, x0 + q, y0 + q], [x1 - q, 0, W, y0 + q], [x1 - q, y1 - q, W, H], [0, y1 - q, x0 + q, H]]
        .map(function (a) { return '<rect x="' + a[0] + '" y="' + a[1] + '" width="' + (a[2] - a[0]) + '" height="' + (a[3] - a[1]) + '" fill="#fff"/>'; })
        .join("");
      body = '<mask id="c" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '">' + box + "</mask>" +
        '<g mask="url(#c)"><g filter="url(#q)">' + quads + "</g></g>";
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '"><defs>' +
      '<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + sd + '"/></filter>' +
      '<filter id="q" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' + Math.round(pad * 0.3) + '"/></filter>' +
      '<mask id="h" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H +
      '" fill="#fff"/><path d="' + path + '" fill="#000"/></mask></defs><g mask="url(#h)">' + body + "</g></svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function attach(target, options) {
    if (!target || !target.getBoundingClientRect) throw new Error("AmbientGlass.attach: a DOM element is needed");
    addStyle();
    var o = merge(DEFAULTS, options);
    o.fade = merge(DEFAULTS.fade, options && options.fade);
    var box = o.container || target.parentElement;
    var madeRelative = false;
    if (getComputedStyle(box).position === "static") { box.style.position = "relative"; madeRelative = true; }

    var glass = [], enabled = true, raf = 0;

    function current() {
      var small = o.small && window.innerWidth <= o.small.maxWidth;
      return {
        layers: small && o.small.layers ? o.small.layers : o.layers,
        corners: small && o.small.corners !== undefined ? o.small.corners : o.corners
      };
    }

    function make(n) {          // as many glass boxes as the settings need, in paint order (later = reads the earlier)
      while (glass.length < n) {
        var g = document.createElement("div");
        g.className = o.className;
        g.setAttribute("aria-hidden", "true");
        g.style.zIndex = String(o.zIndex);
        box.appendChild(g);
        glass.push(g);
      }
      while (glass.length > n) glass.pop().remove();
    }

    function fit() {
      raf = 0;
      var cfg = current(), list = cfg.layers.slice();
      if (cfg.corners) list.push({ pad: cfg.layers[0].pad, filter: cfg.corners.filter, corners: true });
      make(list.length);
      var r = target.getBoundingClientRect(), c = box.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var x = r.left - c.left - box.clientLeft + box.scrollLeft, y = r.top - c.top - box.clientTop + box.scrollTop;
      var rad = o.radius === "auto" ? parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0 : +o.radius || 0;
      list.forEach(function (L, i) {
        var g = glass[i], pad = Math.round(L.pad);
        // whole pixels: half a pixel would lay the glass over the target's edge
        var W = Math.round(r.width) + 2 * pad, H = Math.round(r.height) + 2 * pad;
        g.style.left = Math.round(x) - pad + "px";
        g.style.top = Math.round(y) - pad + "px";
        g.style.width = W + "px";
        g.style.height = H + "px";
        g.style.backdropFilter = g.style.webkitBackdropFilter = L.filter;
        g.style.maskImage = g.style.webkitMaskImage = maskURL(W, H, pad, null, rad, o.fade, !!L.corners);
        g.classList.toggle("ag-off", !enabled);
      });
    }

    function schedule() { if (!raf) raf = requestAnimationFrame(fit); }

    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro) { ro.observe(target); ro.observe(box); }
    window.addEventListener("resize", schedule);
    fit();

    return {
      element: target,
      get layers() { return glass.slice(); },
      update: fit,
      enable: function (on) { enabled = on !== false; glass.forEach(function (g) { g.classList.toggle("ag-off", !enabled); }); if (enabled) fit(); },
      set: function (next) { o = merge(o, next); if (next && next.fade) o.fade = merge(o.fade, next.fade); fit(); },
      destroy: function () {
        if (ro) ro.disconnect();
        window.removeEventListener("resize", schedule);
        if (raf) cancelAnimationFrame(raf);
        glass.forEach(function (g) { g.remove(); });
        glass = [];
        if (madeRelative) box.style.position = "";
      }
    };
  }

  return { attach: attach, defaults: DEFAULTS, maskURL: maskURL };
});
