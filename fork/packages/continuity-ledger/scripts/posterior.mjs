/* global process, console */ // run with plain node inside the container, not by the package host
// Continuity Ledger posterior for the narration matrix (spec section 3). Read-only.
//   docker exec marinara node /path/posterior.mjs [labels.json] [floor] [ceiling]
// Reads every chat's ledger log and each logged reply's message, then estimates by Gibbs sampling:
//   leak rate with the block shown (on) vs not shown (off), Beta(1,1) priors;
//   the Gemma judge's sensitivity and specificity, Beta priors, learned from replies with a human label.
// Human labels: a reply with a personal note or a hand edit counts as a leak only if labels.json says so;
// labels.json = {"<messageId>": true|false} from Ben's spot checks. Unlabelled replies use the judge alone.
// Prints P(on < off) and the pOn to store next: P clipped to [floor, ceiling]. The 0.2/0.8 defaults are placeholders
// until Ben sets them.
import fs from "fs";

const [labelsPath, floorArg = "0.2", ceilingArg = "0.8"] = process.argv.slice(2);
const labels = labelsPath ? JSON.parse(fs.readFileSync(labelsPath, "utf8")) : {};
const T = process.env.LEDGER_TABLES ?? "/app/data/storage/tables/"; // override for tests
const rows = (t) =>
  fs
    .readdirSync(T + t)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => [JSON.parse(fs.readFileSync(T + t + "/" + f))].flat());

const docs = rows("capability_documents").filter(
  (d) => d.packageId === "continuity-ledger" && d.kind === "continuity-ledger",
);
const obs = []; // {arm, judge: 0|1, human: 0|1|null}
for (const doc of docs) {
  const ledger = typeof doc.data === "string" ? JSON.parse(doc.data) : doc.data;
  for (const row of ledger.log ?? []) {
    const human = row.m in labels ? (labels[row.m] ? 1 : 0) : null;
    obs.push({ arm: row.arm, judge: row.contradicted?.length ? 1 : 0, human });
  }
}

// Gibbs sampler. Latent z = leaked. Conjugate Beta updates for each rate.
let seed = 12345;
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const gamma = (k) => {
  // Marsaglia-Tsang, k >= 1 (all shapes here are >= 1)
  const d = k - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      const u1 = rand() || 1e-12,
        u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    if (Math.log(rand() || 1e-12) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
};
const beta = (a, b) => {
  const x = gamma(a);
  return x / (x + gamma(b));
};

let rate = { on: 0.2, off: 0.2 },
  sens = 0.8,
  spec = 0.9;
const draws = [];
for (let it = 0; it < 6000; it += 1) {
  const z = obs.map((o) => {
    if (o.human !== null) return o.human;
    const p = rate[o.arm];
    const yes = o.judge ? p * sens : p * (1 - sens);
    const no = o.judge ? (1 - p) * (1 - spec) : (1 - p) * spec;
    return rand() < yes / (yes + no) ? 1 : 0;
  });
  for (const arm of ["on", "off"]) {
    const n = obs.filter((o) => o.arm === arm).length;
    const k = obs.reduce((s, o, i) => s + (o.arm === arm ? z[i] : 0), 0);
    rate[arm] = beta(1 + k, 1 + n - k);
  }
  // Judge accuracy, weakly informed by the 11-22 probes (Beta(4,1) and Beta(9,1)).
  const tp = obs.reduce((s, o, i) => s + (z[i] && o.judge ? 1 : 0), 0),
    pos = z.reduce((s, v) => s + v, 0);
  const tn = obs.reduce((s, o, i) => s + (!z[i] && !o.judge ? 1 : 0), 0),
    neg = z.length - pos;
  sens = beta(4 + tp, 1 + pos - tp);
  spec = beta(9 + tn, 1 + neg - tn);
  if (it >= 1000) draws.push({ ...rate, sens, spec });
}
const mean = (key) => draws.reduce((s, d) => s + d[key], 0) / draws.length;
const better = draws.filter((d) => d.on < d.off).length / draws.length;
const clip = Math.min(Number(ceilingArg), Math.max(Number(floorArg), better));
console.log(
  JSON.stringify(
    {
      replies: obs.length,
      on: obs.filter((o) => o.arm === "on").length,
      off: obs.filter((o) => o.arm === "off").length,
      humanLabelled: obs.filter((o) => o.human !== null).length,
      leakRateOn: +mean("on").toFixed(3),
      leakRateOff: +mean("off").toFixed(3),
      judgeSensitivity: +mean("sens").toFixed(2),
      judgeSpecificity: +mean("spec").toFixed(2),
      pBlockHelps: +better.toFixed(3),
      nextPOn: +clip.toFixed(2),
    },
    null,
    1,
  ),
);
