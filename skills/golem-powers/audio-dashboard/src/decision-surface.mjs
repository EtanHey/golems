/**
 * Skill-local decision/answer-box surface for audio dashboards.
 *
 * The round-trip is intentionally self-contained: radio picks and free text are
 * persisted to localStorage, and the Copy answers button exports paste-ready
 * markdown so answers are never trapped in browser storage.
 */

export const DECISION_MARK_OPEN = "<!-- DECISION-BOXES:BEGIN -->";
export const DECISION_MARK_CLOSE = "<!-- DECISION-BOXES:END -->";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function slugFromTitle(value) {
  const slug = String(value || "decisions")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "decisions";
}

function normalizeStorageKey(value, title) {
  const raw = value || `dbx:${slugFromTitle(title)}`;
  return String(raw).startsWith("dbx:") ? String(raw) : `dbx:${raw}`;
}

function markerRegex() {
  const open = DECISION_MARK_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const close = DECISION_MARK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${open}[\\s\\S]*?${close}\\s*`, "g");
}

export function assertDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new Error("decision-surface: decisions must be a non-empty array");
  }
  const seen = new Set();
  for (const [index, decision] of decisions.entries()) {
    if (!decision || typeof decision !== "object") {
      throw new Error(`decision-surface: decision ${index} must be an object`);
    }
    const id = String(decision.id || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
      throw new Error(`decision-surface: decision ${index} needs a slug-safe id`);
    }
    if (seen.has(id)) throw new Error(`decision-surface: duplicate decision id: ${id}`);
    seen.add(id);
    if (!String(decision.title || "").trim()) {
      throw new Error(`decision-surface: decision ${id} needs a title`);
    }
    if (!Array.isArray(decision.options)) {
      throw new Error(`decision-surface: decision ${id} needs an options array`);
    }
  }
}

export function answersMarkdown(decisions, store = {}, storageKey = "decisions") {
  assertDecisions(decisions);
  const keyLabel = String(storageKey || "decisions").replace(/^dbx:/, "");
  const lines = [`## Decision answers - ${keyLabel}`];
  for (const decision of decisions) {
    const id = String(decision.id);
    lines.push(`### ${decision.title}`);
    lines.push(`- picked: ${store[id] || "(no option picked)"}`);
    const free = store[`${id}-free`];
    if (free) lines.push(`- in your words: ${free}`);
  }
  return lines.join("\n");
}

export function renderDecisionSurface(decisions, opts = {}) {
  assertDecisions(decisions);
  const storageKey = normalizeStorageKey(opts.storageKey, opts.title);
  const title = opts.title || "Your answers";
  const lede = opts.lede || "Pick an option or write your own. Everything saves locally as you go.";
  const answerSink = opts.answerSink || "";

  const cards = decisions.map((decision) => {
    const id = String(decision.id);
    const options = decision.options.map((option) => `
        <label class="dbx-opt"><input type="radio" name="${escapeHtml(id)}" value="${escapeHtml(option)}"> <span>${escapeHtml(option)}</span></label>`).join("");
    const deadline = decision.deadline
      ? ` <span class="dbx-deadline">${escapeHtml(decision.deadline)}</span>`
      : "";
    return `
    <section class="dbx-card" data-decision="${escapeHtml(id)}" data-title="${escapeHtml(decision.title)}">
      <h3 class="dbx-title">${escapeHtml(decision.title)}${deadline}</h3>
      <p class="dbx-body">${escapeHtml(decision.body || "")}</p>
      <div class="dbx-opts">${options}</div>
      <textarea class="note-area dbx-free" data-note="${escapeHtml(id)}-free" data-title="${escapeHtml(decision.title)}" placeholder="Or write it in your own words..."></textarea>
    </section>`;
  }).join("");

  const sinkAttr = answerSink ? ` data-answer-sink="${escapeHtml(answerSink)}"` : "";

  return `${DECISION_MARK_OPEN}
<section id="decision-boxes" aria-label="Decisions"${sinkAttr} data-storage-key="${escapeHtml(storageKey)}">
  <style>
    #decision-boxes{max-width:820px;margin:48px auto 80px;padding:0 20px}
    #decision-boxes .dbx-head{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#5ab0ff;margin:0 0 4px}
    #decision-boxes .dbx-lede{color:#8aa0b8;margin:0 0 24px;font-size:15px}
    .dbx-card{background:#0a1420;border:1px solid #1c2c40;border-radius:8px;padding:20px 22px;margin:0 0 18px}
    .dbx-title{font-size:17px;margin:0 0 8px;color:#eaf2ff}
    .dbx-deadline{font-size:12px;color:#ffb454;border:1px solid #5a3a1a;border-radius:999px;padding:2px 9px;margin-left:6px;white-space:nowrap}
    .dbx-body{color:#b8c6d6;font-size:14px;line-height:1.55;margin:0 0 14px}
    .dbx-opts{display:flex;flex-direction:column;gap:9px;margin:0 0 12px}
    .dbx-opt{display:flex;align-items:flex-start;gap:9px;cursor:pointer;color:#dbe6f2;font-size:14px;padding:9px 11px;border:1px solid #1c2c40;border-radius:8px;background:#060d18}
    .dbx-opt:hover{border-color:#2e4a68}
    .dbx-opt.sel{border-color:#5ab0ff;box-shadow:0 0 0 2px rgba(90,176,255,.18)}
    .dbx-opt input{margin-top:2px;accent-color:#5ab0ff}
    .dbx-free{margin-top:2px}
    .dbx-actions{display:flex;gap:10px;align-items:center;margin:4px 0 2px}
    .dbx-btn{font-size:12px;font-weight:700;color:#dbe6f2;background:#0e2036;border:1px solid #2e4a68;border-radius:8px;padding:6px 13px;cursor:pointer}
    .dbx-btn:hover{border-color:#5ab0ff}
    .dbx-saved{font-size:12px;color:#3fae72;opacity:0;transition:opacity .2s}
    .dbx-saved.on{opacity:1}
  </style>
  <p class="dbx-head">${escapeHtml(title)} <span class="dbx-saved" id="dbx-saved" aria-live="polite">saved</span></p>
  <p class="dbx-lede">${escapeHtml(lede)}</p>
  ${cards}
  <div class="dbx-actions"><button type="button" class="dbx-btn" id="dbx-copy">Copy answers</button></div>
</section>
<script>
(function(){
  var box=document.getElementById("decision-boxes");
  if(!box) return;
  var KEY=box.getAttribute("data-storage-key")||"dbx:decisions";
  var saved=document.getElementById("dbx-saved");
  function flash(){ if(!saved)return; saved.classList.add("on"); clearTimeout(flash._t); flash._t=setTimeout(function(){saved.classList.remove("on");},900); }
  var store={};
  try{ store=JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){ store={}; }
  function persist(){ try{ localStorage.setItem(KEY, JSON.stringify(store)); flash(); }catch(e){} }
  function syncRadioGroup(name){
    box.querySelectorAll('input[type="radio"]').forEach(function(input){
      if(input.name===name){
        var label=input.closest(".dbx-opt");
        if(label) label.classList.toggle("sel", input.checked);
      }
    });
  }
  box.querySelectorAll('input[type="radio"]').forEach(function(radio){
    if(store[radio.name]===radio.value){ radio.checked=true; }
    syncRadioGroup(radio.name);
    radio.addEventListener("change",function(){
      store[radio.name]=radio.value;
      syncRadioGroup(radio.name);
      persist();
    });
  });
  box.querySelectorAll(".dbx-free").forEach(function(area){
    var id=area.getAttribute("data-note");
    if(store[id]) area.value=store[id];
    area.classList.toggle("has-text", !!area.value);
    area.addEventListener("input",function(){
      store[id]=area.value;
      area.classList.toggle("has-text", !!area.value);
      persist();
    });
  });
  function answersText(){
    var lines=["## Decision answers - "+KEY.replace(/^dbx:/,"")];
    box.querySelectorAll(".dbx-card").forEach(function(card){
      var name=card.getAttribute("data-decision");
      var title=card.getAttribute("data-title")||name;
      lines.push("### "+title.trim());
      lines.push("- picked: "+(store[name]||"(no option picked)"));
      var free=store[name+"-free"];
      if(free) lines.push("- in your words: "+free);
    });
    return lines.join("\\n");
  }
  function fallbackCopy(text, ok){
    try{
      var area=document.createElement("textarea");
      area.value=text;
      area.style.position="fixed";
      area.style.opacity="0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      if(ok) ok();
    }catch(e){}
  }
  function copyText(text, ok){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(ok, function(){ fallbackCopy(text, ok); });
    } else {
      fallbackCopy(text, ok);
    }
  }
  var copyButton=document.getElementById("dbx-copy");
  if(copyButton) copyButton.addEventListener("click",function(){
    copyText(answersText(),function(){
      copyButton.textContent="Copied";
      setTimeout(function(){ copyButton.textContent="Copy answers"; },1200);
    });
  });
  var sink=box.getAttribute("data-answer-sink");
  if(sink){
    var send=document.createElement("button");
    send.type="button";
    send.className="dbx-btn";
    send.textContent="Send to fleet";
    send.addEventListener("click",function(){
      fetch(sink,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:"decision-dashboard",key:KEY,answers:store,markdown:answersText()})})
        .then(function(){ send.textContent="Sent"; setTimeout(function(){ send.textContent="Send to fleet"; },1400); }, function(){ send.textContent="Send failed - use Copy"; });
    });
    var actions=box.querySelector(".dbx-actions");
    if(actions) actions.appendChild(send);
  }
})();
</script>
${DECISION_MARK_CLOSE}`;
}

export function injectDecisionSurfaceIntoHtml(html, decisions, opts = {}) {
  const block = renderDecisionSurface(decisions, opts);
  const withoutExisting = String(html).replace(markerRegex(), "");
  if (!/<\/body>/i.test(withoutExisting)) {
    throw new Error("decision-surface: no </body> in HTML - cannot inject");
  }
  const injected = withoutExisting.replace(/<\/body>/i, () => `${block}\n</body>`);
  const stats = {
    cards: (injected.match(/<section class="dbx-card"/g) || []).length,
    radios: (injected.match(/<input type="radio"/g) || []).length,
    copy: injected.includes('id="dbx-copy"'),
    decisions: decisions.length,
  };
  return { html: injected, stats };
}
