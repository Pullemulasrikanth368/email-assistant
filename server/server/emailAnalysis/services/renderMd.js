/**
 * Render a brief (engine output) into a self-contained, wireframe-styled
 * Markdown (.md) document. Raw HTML + an inline <style> block make it render
 * as the dashboard (screen 02 + triage + risk detail) in any Markdown/MDX
 * renderer that allows HTML. No external CSS/JS required.
 */

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// score -> severity colour (matches the wireframe + UI)
function scoreVar(score) {
  if (score >= 16) return "var(--crit)";
  if (score >= 10) return "var(--high)";
  if (score >= 5) return "var(--med)";
  return "var(--low)";
}

const TREND_LABEL = { New: "new", Escalating: "escalating", Cooling: "cooling", Stable: "stable" };

const STYLE = `<style>
:root{--ink:#14181f;--ink2:#2a3340;--paper:#f4f5f3;--panel:#fff;--line:#d9dcd6;--muted:#687180;--accent:#1f6f6b;--accent-soft:#e4efed;--crit:#b3261e;--high:#c4631a;--med:#c9a227;--low:#4f7a3f;--crit-bg:#fbe9e7;--high-bg:#fbeee2;--med-bg:#faf6e2;--low-bg:#ecf3e8;--mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;--sans:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.cc{background:var(--paper);font-family:var(--sans);color:var(--ink);padding:24px;border:1px solid #c3c5bf;border-radius:8px;line-height:1.5}
.cc .topbar{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:14px}
.cc .eyebrow{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.cc h1{font-size:21px;font-weight:700;margin:3px 0 0}
.cc .badge{font-family:var(--mono);font-size:11px;padding:3px 9px;border-radius:3px}
.cc .badge.live{background:var(--low-bg);color:var(--low);border:1px solid var(--low)}
.cc .badge.sample{background:var(--med-bg);color:var(--med);border:1px solid var(--med)}
.cc .narr{border-left:4px solid var(--accent);background:var(--accent-soft);padding:14px 16px;margin:18px 0}
.cc .narr p{font-size:15px;line-height:1.6;margin:0}
.cc .grid2{display:grid;grid-template-columns:1.5fr 1fr;gap:18px}
.cc .panel{background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:16px;margin-bottom:16px}
.cc .panel.amber{border-color:var(--high);background:var(--high-bg)}
.cc .ph{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink2);margin-bottom:12px;display:flex;gap:8px}
.cc .ph .n{margin-left:auto;font-family:var(--mono);color:var(--muted)}
.cc .dec{border:1px solid var(--line);border-left:4px solid var(--crit);border-radius:3px;padding:11px 13px;margin-bottom:10px}
.cc .dec .t{font-weight:650;font-size:14.5px}.cc .dec .w{color:var(--muted);font-size:13px;margin:3px 0 6px}.cc .dec .due{font-family:var(--mono);font-size:12px;color:var(--crit)}
.cc .risk{display:grid;grid-template-columns:46px 1fr;gap:12px;padding:11px 0;border-top:1px solid var(--line)}
.cc .risk:first-child{border-top:none}
.cc .score{font-family:var(--mono);font-weight:700;font-size:18px;color:#fff;text-align:center;border-radius:3px;padding:9px 0;line-height:1;height:fit-content}
.cc .score small{display:block;font-size:9px;font-weight:500;opacity:.85;margin-top:3px}
.cc .s{font-size:14px;font-weight:550;line-height:1.35}
.cc .rrow{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.cc .chip{font-family:var(--mono);font-size:11px;padding:2px 8px;border:1px solid var(--line);border-radius:3px;color:var(--ink2);background:var(--paper)}
.cc .chip.clock{background:#fff4e6;border-color:var(--high);color:var(--high)}
.cc .chip.esc{background:var(--crit-bg);border-color:var(--crit);color:var(--crit)}
.cc .chip.new{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.cc .mit{font-size:12.5px;color:var(--muted)}.cc .mit b{color:var(--ink2)}
.cc .matrix{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;max-width:260px}
.cc .cell{aspect-ratio:1;border-radius:2px;display:flex;align-items:center;justify-content:center;color:#fff;font-family:var(--mono);font-size:10px}
.cc .coll{border:1px solid var(--high);background:#fff;border-radius:3px;padding:11px;margin-bottom:10px}
.cc .coll .ct{font-family:var(--mono);font-size:11px;text-transform:uppercase;color:var(--high)}
.cc .coll .cs{font-weight:600;font-size:13.5px;margin:4px 0}.cc .coll .cg{font-size:12.5px;color:var(--ink2)}.cc .coll .cg b{color:var(--accent)}
.cc .todo{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line);font-size:14px}
.cc .todo:first-child{border-top:none}
.cc .box{width:16px;height:16px;border:1.5px solid var(--accent);border-radius:3px;flex:none}
.cc .todo .d{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--crit)}
.cc .tier{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:13px 0 5px}
.cc .trow{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:13px}
.cc .dotm{width:8px;height:8px;border-radius:50%;margin-top:5px;flex:none}
.cc .reason{color:var(--muted)}
.cc .stat{background:var(--paper);border-radius:5px;padding:12px;display:inline-block;min-width:120px;margin:0 8px 8px 0}
.cc .stat .l{font-size:12px;color:var(--muted);text-transform:uppercase}.cc .stat .v{font-family:var(--mono);font-size:20px;font-weight:700}
</style>`;

function renderDecisions(list = []) {
  if (!list.length) return "";
  const rows = list.map((d) =>
    `<div class="dec"><div class="t">${esc(d.title)}</div>${d.why ? `<div class="w">${esc(d.why)}</div>` : ""}${d.deadline ? `<span class="due">DUE: ${esc(d.deadline)}</span>` : ""}</div>`
  ).join("");
  return `<div class="panel"><div class="ph">Decisions needed today<span class="n">${list.length}</span></div>${rows}</div>`;
}

function renderRadar(risks = []) {
  if (!risks.length) return "";
  const rows = risks.map((r) => {
    const chips = [
      r.category ? `<span class="chip">${esc(r.category)}</span>` : "",
      r.clock ? `<span class="chip clock">${esc(r.clock)}</span>` : "",
      r.trend ? `<span class="chip ${r.trend === "Escalating" ? "esc" : r.trend === "New" ? "new" : ""}">${esc(TREND_LABEL[r.trend] || r.trend)}</span>` : "",
    ].join("");
    return `<div class="risk"><div class="score" style="background:${scoreVar(r.riskScore)}">${r.riskScore}<small>${r.likelihood}×${r.impact}</small></div><div><div class="s">${esc(r.summary)}</div><div class="rrow">${chips}</div>${r.mitigation ? `<div class="mit"><b>Mitigate:</b> ${esc(r.mitigation)}</div>` : ""}</div></div>`;
  }).join("");
  return `<div class="panel"><div class="ph">Risk radar<span class="n">${risks.length}</span></div>${rows}</div>`;
}

function renderMatrix(risks = []) {
  if (!risks.length) return "";
  let cells = "";
  for (let impact = 5; impact >= 1; impact -= 1) {
    for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
      const score = impact * likelihood;
      const here = risks.filter((r) => Number(r.likelihood) === likelihood && Number(r.impact) === impact);
      const op = here.length ? 1 : 0.32;
      cells += `<div class="cell" style="background:${scoreVar(score)};opacity:${op}">${here.length > 1 ? here.length : ""}</div>`;
    }
  }
  return `<div class="panel"><div class="ph">Risk matrix</div><div class="matrix">${cells}</div></div>`;
}

function renderCollisions(list = []) {
  if (!list.length) return "";
  const rows = list.map((c) =>
    `<div class="coll"><div class="ct">${esc(c.type)}</div><div class="cs">${esc(c.summary)}${c.when ? ` · ${esc(c.when)}` : ""}</div>${c.suggestion ? `<div class="cg"><b>Suggested:</b> ${esc(c.suggestion)}</div>` : ""}</div>`
  ).join("");
  return `<div class="panel amber"><div class="ph" style="color:var(--high)">Schedule collisions<span class="n">${list.length}</span></div>${rows}</div>`;
}

function renderTodo(list = []) {
  if (!list.length) return "";
  const rows = list.map((t) =>
    `<div class="todo"><span class="box"></span><span>${esc(t.task)}</span>${t.deadline ? `<span class="d">${esc(t.deadline)}</span>` : ""}</div>`
  ).join("");
  return `<div class="panel"><div class="ph">Your to-do<span class="n">${list.length}</span></div>${rows}</div>`;
}

function renderTriage(triage = []) {
  if (!triage.length) return "";
  const tier = (name, color) => {
    const items = triage.filter((t) => t.tier === name);
    if (!items.length) return "";
    const rows = items.map((t) =>
      `<div class="trow"><span class="dotm" style="background:${color}"></span><span class="reason">${esc(t.reason)} <span style="color:var(--muted)">[${esc(t.sourceId || "")}]</span></span></div>`
    ).join("");
    return `<div class="tier" style="color:${color}">${name} · ${items.length}</div>${rows}`;
  };
  return `<div class="panel"><div class="ph">Inbox triage<span class="n">${triage.length}</span></div>${tier("Critical", "var(--crit)")}${tier("Important", "var(--high)")}${tier("Low", "var(--muted)")}</div>`;
}

function renderRiskDetail(risks = []) {
  if (!risks.length) return "";
  const blocks = risks.map((r) =>
    `<div class="panel"><div style="display:flex;gap:14px;align-items:center"><div class="score" style="background:${scoreVar(r.riskScore)};width:60px;font-size:22px">${r.riskScore}<small>${r.likelihood}×${r.impact}</small></div><div><div class="s" style="font-size:15px">${esc(r.summary)}</div><div class="reason">${esc(r.category || "")}${r.affectedArea ? ` · ${esc(r.affectedArea)}` : ""}</div></div></div>` +
    `<div style="margin-top:10px"><span class="stat"><span class="l">Likelihood</span><div class="v">${r.likelihood} / 5</div></span><span class="stat"><span class="l">Impact</span><div class="v">${r.impact} / 5</div></span><span class="stat"><span class="l">Clock</span><div class="v" style="font-size:14px">${esc(r.clock || "—")}</div></span><span class="stat"><span class="l">Trend</span><div class="v" style="font-size:14px">${esc(r.trend || "—")}</div></span></div>` +
    `${r.mitigation ? `<div class="mit" style="margin-top:8px"><b>Mitigation:</b> ${esc(r.mitigation)}</div>` : ""}` +
    `${r.sourceId ? `<div class="reason" style="margin-top:6px">Linked email: ${esc(r.sourceId)}</div>` : ""}</div>`
  ).join("");
  return `<div class="ph" style="margin-top:8px">Risk detail</div>${blocks}`;
}

/**
 * @param {Object} report - stored report (email, periodLabel, source, brief, ...)
 * @returns {string} markdown document
 */
export function renderBriefMarkdown(report) {
  const brief = report?.brief || {};
  const risks = [...(brief.risks || [])].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const label = report?.periodLabel || "";
  const source = report?.source === "live" ? "live" : "sample";
  const generatedAt = report?.generatedAt ? new Date(report.generatedAt).toISOString() : "";

  const frontmatter = `---\ntitle: "Operations Brief — ${label}"\ngeneratedAt: "${generatedAt}"\nsource: "${source}"\n---\n\n`;

  const body = `<div class="cc">
<div class="topbar"><div><div class="eyebrow">Operations command center</div><h1>Morning brief — ${esc(label)}</h1></div><div><span class="badge ${source}">${source === "live" ? "LIVE AI" : "SAMPLE"}</span></div></div>
${brief.narrative ? `<div class="narr"><p>${esc(brief.narrative)}</p></div>` : ""}
<div class="grid2">
<div>${renderDecisions(brief.decisionQueue)}${renderRadar(risks)}</div>
<div>${renderMatrix(risks)}${renderCollisions(brief.collisions)}${renderTodo(brief.todoList)}</div>
</div>
${renderTriage(brief.triage)}
${renderRiskDetail(risks)}
</div>`;

  return `${frontmatter}${STYLE}\n${body}\n`;
}

export default { renderBriefMarkdown };
