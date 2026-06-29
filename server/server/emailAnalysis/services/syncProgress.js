/**@Sync progress tracker
 *
 * A tiny in-memory singleton the mail-sync paths update so the UI can show a
 * live "syncing…" progress bar. Single connected account is the common case,
 * so one global state is sufficient (the latest sync wins).
 *
 * Phases: idle → starting → fetching → saving → (prioritizing) → done | error
 */
function base() {
  return {
    active: false,
    email: null,
    phase: "idle",
    processed: 0,
    total: 0,
    saved: 0,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    error: null,
  };
}

let s = base();

function begin(email) {
  s = { ...base(), active: true, email, phase: "starting", startedAt: Date.now(), updatedAt: Date.now() };
}

function phase(p) {
  s.phase = p;
  s.updatedAt = Date.now();
}

/** Declare how many messages this run will process (switches to "saving"). */
function total(n) {
  s.total = n;
  s.phase = "saving";
  s.updatedAt = Date.now();
}

/** One message handled; pass 1 when it was newly saved. */
function tick(savedInc = 0) {
  s.processed += 1;
  s.saved += savedInc;
  s.updatedAt = Date.now();
}

function done() {
  s.active = false;
  s.phase = "done";
  s.finishedAt = Date.now();
  s.updatedAt = Date.now();
}

function fail(message) {
  s.active = false;
  s.phase = "error";
  s.error = String(message || "Sync failed");
  s.finishedAt = Date.now();
  s.updatedAt = Date.now();
}

function get() {
  let percent = 0;
  if (s.total > 0) percent = Math.min(100, Math.round((s.processed / s.total) * 100));
  else if (s.phase === "done") percent = 100;
  else if (s.active) percent = 5; // indeterminate-ish before total is known
  return { ...s, percent };
}

export default { begin, phase, total, tick, done, fail, get };
