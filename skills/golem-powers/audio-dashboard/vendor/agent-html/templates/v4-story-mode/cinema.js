// AIDEV-NOTE: ⛔ DO NOT re-vendor this file from agent-html until agent-html carries
// the 2-bug cinema state fix (cold-load cue bleed + incomplete reset). This vendored
// copy has that fix (golems PR #619 / commit bc823f8a, 2026-07-15); the upstream source
// agent-html/host/templates/v4-story-mode/cinema.js has DRIFTED and does NOT yet contain
// it. A re-vendor WILL silently regress both state bugs.
// HARD RULE: ANY re-vendor of this template MUST re-run the 59 audio-dashboard evals
//   (bun test skills/golem-powers/audio-dashboard/evals/) and stay 59/59 before merge.
// Recovery copy of the fix: docs.local/audio-dashboard-cinema-fix/ (cinema.js.patch +
//   cinema-interactions.test.mjs) and the merged commit bc823f8a. Context: the weave
//   dashboard-QA report + PR #619. Upstreaming to agent-html is deferred to that repo's
//   flush audit (orc-routed). Do not silently overwrite this file.
/* ============================================================================
   V4 BREAK-THE-MOLD — "Story-Mode Cinema" renderer.
   Pure presentation layer. Consumes the shared golem:active / golem:cue events
   emitted by the PROVEN GolemPlaylist base (engine + line/word teleprompter run
   untouched underneath). Drives the engine only through its public API:
   window.GolemPlaylist = { play, pause, stop, jumpTo, setRate }. Reinvents nothing.
   ============================================================================ */
(function () {
  var cinema = document.getElementById("cinema");
  if (!cinema) return;

  // respect reduced-motion for all the continuous scroll/animation we drive
  var RM = false;
  try {
    RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}
  var SB = RM ? "auto" : "smooth";

  // ---- parse the same #tpdata the base teleprompter uses (for prev/next context) ----
  var TP = {};
  try {
    TP = JSON.parse(document.getElementById("tpdata").textContent);
  } catch (e) {}

  // ---- discover the scene list straight from the live DOM (no baked data) ----
  var playerEls = Array.prototype.slice
    .call(document.querySelectorAll(".aud[data-tp]"))
    .filter(function (el) {
      return !!el.querySelector("audio");
    });

  function domainOf(sec) {
    if (!sec) return "overview";
    var chip = sec.querySelector(".dom-chip");
    if (!chip) return "overview";
    var m = (chip.className || "").match(/dom-([a-z0-9-]+)/g);
    if (m) {
      for (var i = 0; i < m.length; i++) {
        if (m[i] !== "dom-chip") return m[i].slice(4);
      }
    }
    return "overview";
  }
  function parseDur(s) {
    var p = String(s || "")
      .trim()
      .split(":");
    if (p.length === 2) {
      var v = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      return isFinite(v) ? v : 0;
    }
    return 0;
  }

  var scenes = playerEls.map(function (el, i) {
    var sec = el.closest(".sec");
    var titleEl = sec && sec.querySelector(".sec-title");
    var domEl = sec && sec.querySelector(".dom-chip");
    var durEl = el.querySelector(".who-dur");
    return {
      i: i,
      key: el.getAttribute("data-tp"),
      audio: el.querySelector("audio"),
      title: titleEl
        ? titleEl.textContent.trim()
        : el.getAttribute("data-tp") || "",
      domain: domainOf(sec),
      domainLabel: domEl ? domEl.textContent.trim() : "",
      durLabel: durEl ? durEl.textContent.trim() : "",
      durSec: parseDur(durEl ? durEl.textContent : ""),
    };
  });
  var N = scenes.length;
  var keyToIndex = {};
  scenes.forEach(function (s) {
    keyToIndex[s.key] = s.i;
  });

  // ---- element handles ----
  var $ = function (id) {
    return document.getElementById(id);
  };
  var elBackdrop = $("cx-backdrop"),
    elKicker = $("cx-kicker"),
    elSceneN = $("cx-scene-n"),
    elSceneTotal = $("cx-scene-total"),
    elDomainChip = $("cx-domain-chip"),
    elDomainBig = $("cx-domain-big"),
    elRuntime = $("cx-runtime"),
    elTitle = $("cx-title"),
    elTele = $("cx-tele"),
    elIdle = $("cx-idle"),
    elProgFill = $("cx-prog-fill"),
    elProg = $("cx-prog"),
    elRail = $("cx-rail"),
    btnPrev = $("cx-prev"),
    btnPlay = $("cx-play"),
    btnNext = $("cx-next"),
    btnStop = $("cx-stop"),
    selSpeed = $("cx-speed"),
    btnExit = $("cx-exit"),
    btnResume = $("cx-resume");

  function setVar(domain) {
    cinema.style.setProperty("--c", "var(--c-" + domain + ", var(--gold))");
    cinema.setAttribute("data-domain", domain);
  }

  // ---- chapter timeline: group scenes into their domain runs ----
  var groups = [];
  scenes.forEach(function (s) {
    var g = groups[groups.length - 1];
    if (!g || g.domain !== s.domain) {
      g = {
        domain: s.domain,
        label: s.domainLabel || s.domain,
        start: s.i,
        count: 0,
        scenes: [],
      };
      groups.push(g);
    }
    g.count++;
    g.scenes.push(s);
  });

  // ---- build one synced strip: each band owns the node cluster below it ----
  var nodes = new Array(N);
  var bands = [];
  if (elRail) {
    elRail.className += " cx-strip";
    elRail.setAttribute("aria-label", "Scene groups and scene navigation");
    groups.forEach(function (g, gi) {
      var groupEl = document.createElement("div");
      groupEl.className = "cx-group";
      groupEl.style.setProperty(
        "--nc",
        "var(--c-" + g.domain + ", var(--gold))",
      );

      var b = document.createElement("button");
      b.type = "button";
      b.className = "cx-band";
      b.title =
        gi +
        1 +
        ". " +
        g.label +
        " — " +
        g.count +
        " scene" +
        (g.count > 1 ? "s" : "");
      var lbl = document.createElement("span");
      lbl.className = "cx-band-lbl";
      lbl.textContent = g.label;
      b.appendChild(lbl);
      b.addEventListener("click", function () {
        if (window.GolemPlaylist && window.GolemPlaylist.jumpTo)
          window.GolemPlaylist.jumpTo(g.start);
      });
      groupEl.appendChild(b);
      bands.push(b);

      var row = document.createElement("div");
      row.className = "cx-grp-nodes";
      g.scenes.forEach(function (s) {
        var n = document.createElement("button");
        n.type = "button";
        n.className = "cx-node";
        n.style.setProperty("--nc", "var(--c-" + s.domain + ", var(--gold))");
        n.title = s.i + 1 + ". " + s.title;
        var fill = document.createElement("span");
        fill.className = "nodefill";
        n.appendChild(fill);
        var tip = document.createElement("span");
        tip.className = "tip";
        tip.textContent = s.i + 1 + " · " + s.title;
        n.appendChild(tip);
        n.addEventListener("click", function () {
          if (window.GolemPlaylist && window.GolemPlaylist.jumpTo)
            window.GolemPlaylist.jumpTo(s.i);
        });
        row.appendChild(n);
        nodes[s.i] = { node: n, fill: fill };
      });
      groupEl.appendChild(row);
      elRail.appendChild(groupEl);
    });
  }

  if (elSceneTotal) elSceneTotal.textContent = N;
  var totalSec = scenes.reduce(function (a, s) {
    return a + s.durSec;
  }, 0);
  if (elRuntime) {
    var mins = Math.round(totalSec / 60);
    elRuntime.textContent = (mins > 0 ? mins + " min · " : "") + N + " scenes";
  }

  var activeIdx = -1;
  var playing = false;

  function setSceneHeader(i) {
    if (i < 0 || i >= N) return null;
    var s = scenes[i];
    setVar(s.domain);
    if (elSceneN) elSceneN.textContent = i + 1;
    if (elDomainChip) elDomainChip.textContent = s.domainLabel || s.domain;
    if (elDomainBig) elDomainBig.textContent = s.domainLabel || s.domain;
    if (elTitle) elTitle.textContent = s.title;
    return s;
  }

  // ---- scene change (driven by golem:active) ----
  function setScene(i) {
    if (i < 0 || i >= N) return;
    activeIdx = i;
    var s = setSceneHeader(i);
    // rail: mark done/active + auto-center
    nodes.forEach(function (nd, j) {
      nd.node.classList.toggle("active", j === i);
      nd.node.classList.toggle("done", j < i);
      if (j !== i) nd.fill.style.height = "0%";
    });
    // chapter bands: light the domain run this scene belongs to
    bands.forEach(function (b, bi) {
      b.classList.toggle(
        "active",
        i >= groups[bi].start && i < groups[bi].start + groups[bi].count,
      );
    });
    var an = nodes[i] && nodes[i].node;
    if (an && elRail && elRail.scrollTo) {
      var rr = elRail.getBoundingClientRect();
      var ar = an.getBoundingClientRect();
      var left =
        elRail.scrollLeft +
        ar.left +
        ar.width / 2 -
        (rr.left + elRail.clientWidth / 2);
      elRail.scrollTo({ left: left, behavior: SB });
    } else if (an && an.scrollIntoView) {
      an.scrollIntoView({ inline: "center", block: "nearest", behavior: SB });
    }
    // build this scene's karaoke paragraph immediately (shows even before first word event)
    if (elIdle) elIdle.style.display = "none";
    buildParagraph(s.key);
  }

  // ---- KARAOKE TELEPROMPTER (driven by golem:cue) ----------------------------
  // These clips ship ONE paragraph-cue per scene (line-level whisper timing). So the
  // cinematic teleprompter is a flowing karaoke paragraph: the whole narration shows,
  // the active word lights up + the view auto-scrolls to keep it centered, spoken words
  // read brighter than upcoming ones. Word boundaries are ESTIMATED (even split) — the
  // on-screen disclosure says so; we never fake whisper word timing.
  var curKey = null; // paragraph currently built
  var wordMap = []; // wordMap[cueIndex][wordIndex] -> span
  var flatWords = []; // ordered [{span, ci, wi}] for read/upcoming styling
  var lastFlat = -1;

  function buildParagraph(key) {
    if (!elTele || key === curKey) return;
    curKey = key;
    wordMap = [];
    flatWords = [];
    lastFlat = -1;
    elTele.innerHTML = "";
    var d = key ? TP[key] : null;
    var cues = d && d.cues ? d.cues : null;
    var para = document.createElement("div");
    para.className = "cx-para";
    if (!cues || !cues.length) {
      elTele.appendChild(para);
      return;
    }
    cues.forEach(function (c, ci) {
      wordMap[ci] = [];
      if (c.words && c.words.length) {
        // REAL per-word timing: one span per real word, carrying its [start,end].
        c.words.forEach(function (w, wi) {
          if (wi > 0) para.appendChild(document.createTextNode(" "));
          var sp = document.createElement("span");
          sp.className = "cx-w";
          sp.textContent = w.word;
          sp.setAttribute("data-ws", w.start);
          sp.setAttribute("data-we", w.end);
          (function (cci, wwi) {
            sp.addEventListener("click", function (e) {
              e.stopPropagation();
              seekToWord(key, cci, wwi);
            });
          })(ci, wi);
          para.appendChild(sp);
          wordMap[ci][wi] = sp;
          flatWords.push({ span: sp, ci: ci, wi: wi });
        });
      } else {
        var parts = String(c.text || "").split(/(\s+)/);
        var wi = -1;
        parts.forEach(function (tok) {
          if (/^\s+$/.test(tok)) {
            para.appendChild(document.createTextNode(tok));
            return;
          }
          if (!tok) return;
          wi += 1;
          var sp = document.createElement("span");
          sp.className = "cx-w";
          sp.textContent = tok;
          // click a word → seek the clip to that word's (estimated) time and play
          (function (cci, wwi) {
            sp.addEventListener("click", function (e) {
              e.stopPropagation();
              seekToWord(key, cci, wwi);
            });
          })(ci, wi);
          para.appendChild(sp);
          wordMap[ci][wi] = sp;
          flatWords.push({ span: sp, ci: ci, wi: wi });
        });
      }
      if (ci < cues.length - 1) para.appendChild(document.createTextNode(" "));
    });
    // top/bottom spacer so EVERY word — including the first and last — can scroll to
    // the vertical center of the window (otherwise early words stick under the title).
    var pad = Math.max(40, Math.round((elTele.clientHeight || 320) * 0.42));
    para.style.paddingTop = pad + "px";
    para.style.paddingBottom = pad + "px";
    elTele.appendChild(para);
    elTele.scrollTop = 0;
  }

  // seek the clip for `key` to the time of word (ci, wi); start it if needed.
  // Uses REAL word start (cue.words[wi].start) when present, else even-split estimate.
  function seekToWord(key, ci, wi) {
    var d = TP[key];
    if (!d || !d.cues || !d.cues[ci]) return;
    var idx = keyToIndex[key];
    if (idx == null) return;
    var a = scenes[idx] && scenes[idx].audio;
    if (!a) return;
    var cue = d.cues[ci];
    var tNarr;
    if (cue.words && cue.words[wi] && isFinite(cue.words[wi].start)) {
      tNarr = cue.words[wi].start; // REAL whisper-aligned word start
    } else {
      var wc = (wordMap[ci] && wordMap[ci].length) || 1;
      var frac = wc > 1 ? wi / wc : 0;
      var span1 = cue.end > cue.start ? cue.end : cue.start + 0.001;
      tNarr = cue.start + frac * (span1 - cue.start);
    }
    function doSeek() {
      /* REAL per-word timing: tNarr is a real audio second, so seek directly
         (scale = 1). Media time is playback-rate-invariant; any residual scale !=1
         drifts. Keep duration/total only for the estimated fallback. */
      var scale =
        cue.words && cue.words.length
          ? 1
          : isFinite(a.duration) && a.duration > 0 && d.total > 0
            ? a.duration / d.total
            : 1;
      try {
        a.currentTime = tNarr * scale;
      } catch (e) {}
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function () {});
      highlight(ci, wi);
    }
    var g = GP();
    if (activeIdx !== idx && g && g.jumpTo) g.jumpTo(idx); // make it the active clip
    if (isFinite(a.duration) && a.duration > 0) doSeek();
    else {
      a.addEventListener("loadedmetadata", doSeek, { once: true });
      var pr = a.play(); // force-load a preload=none clip so duration resolves
      if (pr && pr.catch) pr.catch(function () {});
    }
  }

  function highlight(ci, wi) {
    if (!flatWords.length) return;
    var target = wordMap[ci] && (wi >= 0 ? wordMap[ci][wi] : wordMap[ci][0]);
    if (!target) return;
    var fi = -1;
    for (var k = 0; k < flatWords.length; k++) {
      if (flatWords[k].span === target) {
        fi = k;
        break;
      }
    }
    if (fi < 0 || fi === lastFlat) return;
    var prev = lastFlat;
    lastFlat = fi;
    for (var j = 0; j < flatWords.length; j++) {
      var cls = j < fi ? "cx-w read" : j === fi ? "cx-w on" : "cx-w";
      if (flatWords[j].span.className !== cls)
        flatWords[j].span.className = cls;
    }
    // a11y: mark only the active word as current (aria-live is off on the container to
    // avoid re-announcing the whole paragraph on every word).
    if (prev >= 0 && flatWords[prev])
      flatWords[prev].span.removeAttribute("aria-current");
    target.setAttribute("aria-current", "true");
    // auto-scroll: keep the active word vertically centered. Use rect math (offsetTop
    // resolves against #cinema, not this scroll container, so it can't be used directly).
    var tr = target.getBoundingClientRect();
    var cr = elTele.getBoundingClientRect();
    var delta = tr.top - cr.top - (elTele.clientHeight / 2 - tr.height / 2);
    elTele.scrollTo({ top: elTele.scrollTop + delta, behavior: SB });
  }

  function renderCue(detail) {
    if (!elTele) return;
    var ci = detail.cueIndex;
    if (ci == null || ci < 0) return; // pause / clear — keep the last frame on screen
    if (elIdle) elIdle.style.display = "none";
    buildParagraph(detail.key);
    highlight(ci, typeof detail.wordIndex === "number" ? detail.wordIndex : -1);
  }

  // ---- transport state ----
  function setPlayingState(on) {
    playing = on;
    if (btnPlay) {
      btnPlay.classList.toggle("playing", on);
      btnPlay.innerHTML = on ? "⏸ Pause" : "▶ Play All";
      btnPlay.setAttribute(
        "aria-label",
        on ? "Pause" : "Play all scenes one by one",
      );
    }
    if (btnStop) btnStop.disabled = !on && activeIdx < 0;
  }
  function resetIdle() {
    activeIdx = -1;
    playing = false;
    nodes.forEach(function (nd) {
      nd.node.classList.remove("active", "done");
      nd.fill.style.height = "0%";
    });
    bands.forEach(function (b) {
      b.classList.remove("active");
    });
    if (elProgFill) elProgFill.style.width = "0%";
    setPlayingState(false);
    if (btnStop) btnStop.disabled = true;
    curKey = null;
    lastFlat = -1;
    if (elTele && elIdle) {
      elTele.innerHTML = "";
      elTele.appendChild(elIdle);
      elIdle.style.display = "";
    }
    if (N > 0) setSceneHeader(0);
    else if (elSceneN) elSceneN.textContent = "1";
  }

  // ---- progress rAF (read-only on the active audio; never touches the engine) ----
  function progressTick() {
    if (playing && activeIdx >= 0) {
      var a = scenes[activeIdx].audio;
      if (a && isFinite(a.duration) && a.duration > 0) {
        var pct = Math.max(
          0,
          Math.min(100, (a.currentTime / a.duration) * 100),
        );
        if (elProgFill) elProgFill.style.width = pct + "%";
        if (nodes[activeIdx]) nodes[activeIdx].fill.style.height = pct + "%";
      }
    }
    requestAnimationFrame(progressTick);
  }
  requestAnimationFrame(progressTick);

  // ---- consume the shared event contract ----
  document.addEventListener("golem:active", function (ev) {
    var d = ev.detail || {};
    if (d.state === "stopped") {
      resetIdle();
      return;
    }
    if (typeof d.index === "number" && d.index >= 0) setScene(d.index);
    setPlayingState(d.state !== "paused");
  });
  document.addEventListener("golem:cue", function (ev) {
    var d = ev.detail || {};
    // Every embedded audio can emit metadata/seek cues, including during cold load.
    // Only the active scene is allowed to paint the shared cinema teleprompter.
    // Otherwise the last audio whose metadata resolves can overwrite scene 1 while
    // the header and rail still truthfully identify scene 1.
    if (activeIdx < 0 || !scenes[activeIdx] || d.key !== scenes[activeIdx].key)
      return;
    renderCue(d);
  });

  // ---- wire the cinema transport to the engine's public API ----
  function GP() {
    return window.GolemPlaylist;
  }
  if (btnPlay)
    btnPlay.addEventListener("click", function () {
      var g = GP();
      if (!g) return;
      if (playing) g.pause();
      else g.play();
    });
  if (btnStop)
    btnStop.addEventListener("click", function () {
      var g = GP();
      if (g) g.stop();
    });
  if (btnPrev)
    btnPrev.addEventListener("click", function () {
      var g = GP();
      if (!g) return;
      g.jumpTo(activeIdx <= 0 ? 0 : activeIdx - 1);
    });
  if (btnNext)
    btnNext.addEventListener("click", function () {
      var g = GP();
      if (!g) return;
      g.jumpTo(activeIdx < 0 ? 0 : Math.min(N - 1, activeIdx + 1));
    });
  if (selSpeed)
    selSpeed.addEventListener("change", function () {
      var g = GP();
      if (g && g.setRate) g.setRate(parseFloat(selSpeed.value));
    });

  // ---- scrub the timeline: click anywhere on the progress bar to seek the scene ----
  if (elProg)
    elProg.addEventListener("click", function (e) {
      if (activeIdx < 0) return;
      var a = scenes[activeIdx].audio;
      if (!a || !isFinite(a.duration) || a.duration <= 0) return;
      var rect = elProg.getBoundingClientRect();
      var frac = (e.clientX - rect.left) / rect.width;
      frac = Math.max(0, Math.min(1, frac));
      try {
        a.currentTime = frac * a.duration;
      } catch (err) {}
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function () {});
    });

  // ---- classic-list escape hatch (proves the original surface is intact + live) ----
  if (btnExit)
    btnExit.addEventListener("click", function () {
      document.body.classList.remove("cinema-on");
    });
  if (btnResume)
    btnResume.addEventListener("click", function () {
      document.body.classList.add("cinema-on");
    });

  // ---- keyboard cinema controls ----
  document.addEventListener("keydown", function (e) {
    if (!document.body.classList.contains("cinema-on")) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    var g = GP();
    if (!g) return;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (playing) g.pause();
      else g.play();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      g.jumpTo(activeIdx < 0 ? 0 : Math.min(N - 1, activeIdx + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      g.jumpTo(activeIdx <= 0 ? 0 : activeIdx - 1);
    }
  });

  // ---- classic-list parity: add prev/next to the original transport bar too ----
  (function addClassicPrevNext() {
    var bar = document.getElementById("golem-playall-bar");
    if (!bar || document.getElementById("cl-prev")) return;
    function mk(id, label, aria, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.className = "pa-btn";
      b.textContent = label;
      b.setAttribute("aria-label", aria);
      b.addEventListener("click", fn);
      return b;
    }
    var prev = mk("cl-prev", "⏮ Prev", "Previous scene", function () {
      var g = GP();
      if (g) g.jumpTo(activeIdx <= 0 ? 0 : activeIdx - 1);
    });
    var next = mk("cl-next", "⏭ Next", "Next scene", function () {
      var g = GP();
      if (g) g.jumpTo(activeIdx < 0 ? 0 : Math.min(N - 1, activeIdx + 1));
    });
    var stop = document.getElementById("pa-stop");
    if (stop && stop.parentNode === bar) {
      bar.insertBefore(prev, stop.nextSibling);
      bar.insertBefore(next, prev.nextSibling);
    } else {
      bar.appendChild(prev);
      bar.appendChild(next);
    }
  })();

  // ---- re-center the active word on resize (window/orientation changes) ----
  var _rt = null;
  window.addEventListener("resize", function () {
    clearTimeout(_rt);
    _rt = setTimeout(function () {
      if (curKey) {
        var pad = Math.max(40, Math.round((elTele.clientHeight || 320) * 0.42));
        var para = elTele.querySelector(".cx-para");
        if (para) {
          para.style.paddingTop = pad + "px";
          para.style.paddingBottom = pad + "px";
        }
        if (lastFlat >= 0 && flatWords[lastFlat]) {
          var t = flatWords[lastFlat];
          var fi = lastFlat;
          lastFlat = -1;
          highlight(t.ci, t.wi); // force re-center
        }
      }
    }, 180);
  });

  // ---- boot ----
  document.body.classList.add("cinema-on");
  setVar(scenes.length ? scenes[0].domain : "overview");
  resetIdle();
  if (selSpeed && GP() && GP().getRate) {
    try {
      selSpeed.value = String(GP().getRate());
    } catch (e) {}
  }
  if (window.__golemDashboardReady) window.__golemDashboardReady("cinema-boot");
})();
