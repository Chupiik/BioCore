// Lesson definitions and the question generator.
// Every question is built at run time from the amino acid table (data/amino_acids.json); nothing is
// written by hand, and each question carries its own correctness check (isCorrect) so a test can
// confirm that exactly one answer is right.
import { t, nameOf } from "./i18n.js";
import { MAX_STRENGTH } from "./store.js";

export const CHEM = ["aliphatic", "aromatic", "sulfur", "hydroxyl", "basic", "acidic", "amide"];
export const HYDRO = ["hydrophobic", "neutral", "hydrophilic"];
export const CHARGE = ["positive", "negative", "uncharged"];

const SCHEMES = {
  chem: { field: "imgt_chemical", classes: CHEM, prefix: "chem_", prompt: "qAaToChem" },
  hydro: { field: "imgt_hydropathy", classes: HYDRO, prefix: "hydro_", prompt: "qAaToHydro" },
  charge: { field: "imgt_charge", classes: CHARGE, prefix: "charge_", prompt: "qAaToCharge" },
};

const PH_CHOICES = [2, 5, 7.4, 11, 13];

export const UNITS = [
  { id: "u1", lessons: [
    { id: "u1-aliph", title: "l_aliph", plan: "codes", aas: "GAVLIP" },
    { id: "u1-arhy", title: "l_arhy", plan: "codes", aas: "FWYST" },
    { id: "u1-suam", title: "l_suam", plan: "codes", aas: "CMNQ" },
    { id: "u1-baac", title: "l_baac", plan: "codes", aas: "RHKDE" },
  ] },
  { id: "u2", lessons: [
    { id: "u2-3", title: "l_seq3", plan: "seq", len: 3 },
    { id: "u2-5", title: "l_seq5", plan: "seq", len: 5 },
    { id: "u2-8", title: "l_seq8", plan: "seq", len: 8 },
  ] },
  { id: "u3", lessons: [
    { id: "u3-charge", title: "l_charge", plan: "props", kinds: ["aa>charge", "charge>aa"], match: "charge" },
    { id: "u3-chem", title: "l_chem", plan: "props", kinds: ["aa>chem", "chem>aa"], match: "chem" },
    { id: "u3-hydro", title: "l_hydro", plan: "props", kinds: ["aa>hydro", "hydro>aa", "kd"], match: "hydro" },
    { id: "u3-mixed", title: "l_mixed", plan: "props", kinds: ["aa>charge", "charge>aa", "aa>chem", "chem>aa", "aa>hydro", "hydro>aa", "kd"], match: "chem" },
  ] },
  { id: "u4", lessons: [
    { id: "u4-mass", title: "l_mass", plan: "chem", kinds: ["heavier", "extreme", "formula", "count"] },
    { id: "u4-ph", title: "l_ph", plan: "chem", kinds: ["ph"] },
    { id: "u4-struct", title: "l_struct", plan: "chem", kinds: ["struct"] },
  ] },
];

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const lettersOnly = s => s.replace(/[^A-Za-z]/g, "");
const fmt = v => String(v).replace("-", "−");
const SUB = "₀₁₂₃₄₅₆₇₈₉";
export const prettyFormula = f => f.replace(/\d/g, d => SUB[d]);
const parseFormula = f => Object.fromEntries([...f.matchAll(/([A-Z][a-z]?)(\d*)/g)].map(m => [m[1], Number(m[2] || 1)]));

/**
 * @param aas       the 20 amino acid records
 * @param progress  { strength(letter), due(letter) } to favour weak and due amino acids
 * @param rng       random source in [0, 1) (replaceable for tests)
 */
export function createGenerator({ aas, progress, rng = Math.random }) {
  const byOne = Object.fromEntries(aas.map(a => [a.one, a]));
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const sample = (arr, n) => shuffle(arr).slice(0, n);
  const label = (a, field) => (field === "name" ? nameOf(a) : a[field]);

  function weightedPick(pool, avoid = []) {
    const candidates = pool.filter(a => !avoid.includes(a.one));
    const list = candidates.length ? candidates : pool;
    const weights = list.map(a => (MAX_STRENGTH - progress.strength(a.one)) + 1 + (progress.due(a.one) ? 3 : 0));
    let r = rng() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  // How easily two amino acids are confused: same first letter of the name (Gln/Glu/Gly, Thr/Trp/Tyr,
  // Ala/Arg/Asn/Asp), same start of the three-letter code, same chemical class, same hydropathy class.
  const similarity = (a, b) =>
    (a.name[0] === b.name[0] ? 2 : 0) + (a.three.slice(0, 2) === b.three.slice(0, 2) ? 1 : 0) +
    (a.imgt_chemical === b.imgt_chemical ? 1 : 0) + (a.imgt_hydropathy === b.imgt_hydropathy ? 0.5 : 0);

  // wrong options that are easy to confuse with the target (the random part is below 1, so the
  // clearly most similar candidates always win)
  function distractors(target, n, allowed = () => true) {
    return aas.filter(a => a !== target && allowed(a))
      .map(a => ({ a, score: similarity(target, a) + rng() }))
      .sort((x, y) => y.score - x.score)
      .slice(0, n)
      .map(x => x.a);
  }

  const codesLine = a => `${nameOf(a)} · ${a.three} · ${a.one}`;
  const propsLine = a =>
    `${nameOf(a)} · ${t("chem_" + a.imgt_chemical)} · ${t("hydro_" + a.imgt_hydropathy)} · KD ${fmt(a.kyte_doolittle)}`;

  // --- unit 1: codes and names ---------------------------------------------------------------
  function codesChoice(target, from, to) {
    const options = shuffle([target, ...distractors(target, 3)]);
    return {
      type: "choice", kind: `${from}>${to}`, prompt: t("qGive", { to: t("field_" + to) }),
      big: label(target, from), bigStyle: from === "name" ? "word" : "code", optStyle: to === "name" ? "word" : "code",
      options: options.map(a => ({ id: a.one, label: label(a, to) })),
      isCorrect: id => id === target.one, correctLabel: label(target, to),
      aas: [target.one], explain: codesLine(target),
    };
  }

  function codesType(target, from, to) {
    const expected = to === "name" ? [...new Set([nameOf(target), target.name])] : [label(target, to)];
    return {
      type: "type", kind: `type:${from}>${to}`, prompt: t("qType", { to: t("field_" + to) }),
      big: label(target, from), bigStyle: from === "name" ? "word" : "code", single: to === "one",
      isCorrect: text => expected.some(e => norm(e) === norm(text)), correctLabel: expected[0],
      aas: [target.one], explain: codesLine(target),
    };
  }

  function codesMatch(targets, from, to) {
    return {
      type: "match", kind: `match:${from}>${to}`, prompt: t("qMatch"),
      pairs: targets.map(a => ({ id: a.one, left: label(a, from), right: label(a, to) })),
      aas: targets.map(a => a.one), explain: targets.map(codesLine).join("\n"),
    };
  }

  const DIRECTIONS = [["one", "name"], ["name", "one"], ["three", "name"], ["name", "three"], ["one", "three"], ["three", "one"]];

  function codesQuestion(pool, i, recent) {
    const target = weightedPick(pool, recent.slice(-2));
    recent.push(target.one);
    const [from, to] = pick(DIRECTIONS);
    // the better you know it, the more often you must produce the answer yourself
    const typeChance = [0.15, 0.45, 0.7, 0.9, 0.9, 0.9][progress.strength(target.one)];
    const typed = i >= 1 && rng() < typeChance;
    return typed ? codesType(target, from, to) : codesChoice(target, from, to);
  }

  // a seed amino acid plus the ones most easily confused with it, so a match round is not trivial
  function matchTargets(pool, n) {
    const seed = weightedPick(pool);
    const rest = pool.filter(a => a !== seed)
      .map(a => ({ a, score: similarity(seed, a) + rng() }))
      .sort((x, y) => y.score - x.score)
      .slice(0, n - 1)
      .map(x => x.a);
    return shuffle([seed, ...rest]);
  }

  // --- unit 2: reading sequences ---------------------------------------------------------------
  const three = l => byOne[l].three;

  function randomPeptide(len) {
    let letters;
    do letters = Array.from({ length: len }, () => pick(aas).one);
    while (new Set(letters).size < Math.min(len, 2));
    return letters;
  }

  const peptideExplain = letters => letters.map(l => `${l} = ${three(l)} (${nameOf(byOne[l])})`).join("\n");

  function seqToThree(len) {
    const letters = randomPeptide(len);
    const expected = letters.map(three).join("").toLowerCase();
    return {
      type: "type", kind: "seq>three", prompt: t("qSeqToThree"), big: letters.join(" "), bigStyle: "seq",
      isCorrect: text => lettersOnly(text).toLowerCase() === expected, correctLabel: letters.map(three).join("–"),
      aas: letters, explain: peptideExplain(letters),
    };
  }

  function threeToSeq(len) {
    const letters = randomPeptide(len);
    const expected = letters.join("");
    return {
      type: "type", kind: "three>seq", prompt: t("qThreeToSeq"), big: letters.map(three).join("–"), bigStyle: "seq",
      isCorrect: text => lettersOnly(text).toUpperCase() === expected, correctLabel: expected,
      aas: letters, explain: peptideExplain(letters),
    };
  }

  function mutate(letters) {
    const out = letters.slice();
    if (rng() < 0.5) {                       // swap two different residues
      for (let tries = 0; tries < 20; tries++) {
        const i = Math.floor(rng() * out.length), j = Math.floor(rng() * out.length);
        if (out[i] !== out[j]) { [out[i], out[j]] = [out[j], out[i]]; return out; }
      }
    }
    const i = Math.floor(rng() * out.length);   // replace one residue, preferably with a look-alike
    const replacement = pick(distractors(byOne[out[i]], 3));
    out[i] = replacement.one;
    return out;
  }

  function seqChoice(len) {
    const letters = randomPeptide(len);
    const toThree = rng() < 0.5;                 // one-letter string shown -> pick the three-letter chain, or reverse
    const show = ls => (toThree ? ls.join(" ") : ls.map(three).join("–"));
    const answerOf = ls => (toThree ? ls.map(three).join("–") : ls.join(" "));
    const labels = new Set([answerOf(letters)]);
    for (let tries = 0; labels.size < 4 && tries < 100; tries++) labels.add(answerOf(mutate(letters)));
    const correct = answerOf(letters);
    return {
      type: "choice", kind: "seq-choice", prompt: t("qSeqChoice"), big: show(letters), bigStyle: "seq", optStyle: "seq",
      options: shuffle([...labels]).map(l => ({ id: l, label: l })),
      isCorrect: id => id === correct, correctLabel: correct, aas: letters, explain: peptideExplain(letters),
    };
  }

  // --- unit 3: properties ----------------------------------------------------------------------
  function aaToClass(target, scheme) {
    const s = SCHEMES[scheme], correct = target[s.field];
    const classes = s.classes.length <= 4
      ? s.classes
      : shuffle([correct, ...sample(s.classes.filter(c => c !== correct), 3)]);
    return {
      type: "choice", kind: `aa>${scheme}`, prompt: t(s.prompt), big: nameOf(target), bigStyle: "word", optStyle: "word",
      options: classes.map(c => ({ id: c, label: t(s.prefix + c) })),
      isCorrect: id => id === correct, correctLabel: t(s.prefix + correct), aas: [target.one],
      explain: propsLine(target) + (scheme === "charge" && target.one === "H" ? "\n" + t("eHis") : ""),
    };
  }

  function classToAa(target, scheme) {
    const s = SCHEMES[scheme], cls = target[s.field];
    const options = shuffle([target, ...distractors(target, 3, a => a[s.field] !== cls)]);
    return {
      type: "choice", kind: `${scheme}>aa`, prompt: t("qClassToAa"), big: t(s.prefix + cls), bigStyle: "word", optStyle: "word",
      options: options.map(a => ({ id: a.one, label: nameOf(a) })),
      isCorrect: id => byOne[id][s.field] === cls, correctLabel: nameOf(target), aas: [target.one], explain: propsLine(target),
    };
  }

  function compareKd(pool) {
    const a = weightedPick(pool);
    const b = pick(aas.filter(x => Math.abs(x.kyte_doolittle - a.kyte_doolittle) >= 1.5));
    const higher = a.kyte_doolittle > b.kyte_doolittle ? a : b;
    return {
      type: "choice", kind: "kd", prompt: t("qCompareKd"), big: null, optStyle: "word",
      options: shuffle([a, b]).map(x => ({ id: x.one, label: nameOf(x) })),
      isCorrect: id => byOne[id].kyte_doolittle === higher.kyte_doolittle, correctLabel: nameOf(higher),
      aas: [a.one, b.one], explain: `${nameOf(a)} ${fmt(a.kyte_doolittle)} · ${nameOf(b)} ${fmt(b.kyte_doolittle)} (Kyte–Doolittle)`,
    };
  }

  function matchClass(pool, scheme) {
    const s = SCHEMES[scheme];
    const targets = [];
    for (const a of shuffle(pool)) {
      if (targets.length === 4) break;
      if (!targets.some(x => x[s.field] === a[s.field])) targets.push(a);   // one amino acid per class
    }
    return {
      type: "match", kind: `match:aa>${scheme}`, prompt: t("qMatch"),
      pairs: targets.map(a => ({ id: a.one, left: nameOf(a), right: t(s.prefix + a[s.field]) })),
      aas: targets.map(a => a.one), explain: targets.map(propsLine).join("\n"),
    };
  }

  // --- unit 4: chemistry -----------------------------------------------------------------------
  function heavier(pool) {
    const a = weightedPick(pool);
    const b = pick(aas.filter(x => Math.abs(x.mass - a.mass) >= 5));
    const top = a.mass > b.mass ? a : b;
    return {
      type: "choice", kind: "heavier", prompt: t("qHeavier"), big: null, optStyle: "word",
      options: shuffle([a, b]).map(x => ({ id: x.one, label: nameOf(x) })),
      isCorrect: id => byOne[id].mass === top.mass, correctLabel: nameOf(top), aas: [a.one, b.one],
      explain: `${nameOf(a)} ${a.mass.toFixed(2)} · ${nameOf(b)} ${b.mass.toFixed(2)} g/mol (PubChem)`,
    };
  }

  function extreme(pool) {
    const first = weightedPick(pool);
    let group;
    for (let tries = 0; tries < 500; tries++) {
      group = [first, ...sample(aas.filter(a => a !== first), 3)];
      const masses = group.map(a => a.mass).sort((x, y) => x - y);
      if (masses.every((m, i) => i === 0 || m - masses[i - 1] >= 3)) break;
    }
    const heaviest = rng() < 0.5;
    const answer = group.reduce((best, a) => ((heaviest ? a.mass > best.mass : a.mass < best.mass) ? a : best));
    return {
      type: "choice", kind: "extreme", prompt: t(heaviest ? "qHeaviest" : "qLightest"), big: null, optStyle: "word",
      options: shuffle(group).map(x => ({ id: x.one, label: nameOf(x) })),
      isCorrect: id => id === answer.one, correctLabel: nameOf(answer), aas: group.map(a => a.one),
      explain: group.slice().sort((x, y) => x.mass - y.mass).map(a => `${nameOf(a)} ${a.mass.toFixed(2)}`).join(" < ") + " g/mol",
    };
  }

  function formulaToAa(pool) {
    const counts = {};
    for (const a of aas) counts[a.formula] = (counts[a.formula] ?? 0) + 1;
    const unique = pool.filter(a => counts[a.formula] === 1);
    const target = weightedPick(unique.length ? unique : aas.filter(a => counts[a.formula] === 1));
    const options = shuffle([target, ...distractors(target, 3)]);
    return {
      type: "choice", kind: "formula", prompt: t("qFormula"), big: prettyFormula(target.formula), bigStyle: "code", optStyle: "word",
      options: options.map(a => ({ id: a.one, label: nameOf(a) })),
      isCorrect: id => byOne[id].formula === target.formula, correctLabel: nameOf(target), aas: [target.one],
      explain: `${nameOf(target)} · ${prettyFormula(target.formula)} · ${target.mass.toFixed(2)} g/mol`,
    };
  }

  function countAtoms(pool) {
    const target = weightedPick(pool);
    const counts = parseFormula(target.formula);
    const el = pick(Object.keys(counts));
    const correct = counts[el];
    const others = [-2, -1, 1, 2, 3].map(d => correct + d).filter(n => n >= 1);
    const numbers = [correct, ...sample(others, 3)].sort((x, y) => x - y);
    return {
      type: "choice", kind: "count", prompt: t("qCount", { el }), big: nameOf(target), bigStyle: "word", optStyle: "code",
      options: numbers.map(n => ({ id: String(n), label: String(n) })),
      isCorrect: id => Number(id) === correct, correctLabel: String(correct), aas: [target.one],
      explain: `${nameOf(target)} · ${prettyFormula(target.formula)}`,
    };
  }

  const chargeAtPh = (a, ph) => {
    const p = a.side_chain_pka;
    if (!p) return "neutral";
    if (p.group === "positive") return ph < p.value ? "positive" : "neutral";
    return ph > p.value ? "negative" : "neutral";
  };

  function phCharge(pool) {
    const ionisable = pool.filter(a => a.side_chain_pka);
    const target = ionisable.length && rng() < 0.7 ? weightedPick(ionisable) : weightedPick(pool);
    const p = target.side_chain_pka;
    const phs = PH_CHOICES.filter(ph => !p || Math.abs(ph - p.value) >= 0.9);   // stay clear of the pKa
    const ph = pick(phs);
    const answer = chargeAtPh(target, ph);
    let explain = t("ePhNone", { name: nameOf(target) });
    if (p) {
      const protonated = p.group === "positive" ? ph < p.value : ph <= p.value;
      explain = t("ePh", {
        name: nameOf(target), pka: p.value, ph, state: t(protonated ? "protonated" : "deprotonated"), charge: t("ph_" + answer).toLowerCase(),
      });
    }
    return {
      type: "choice", kind: "ph", prompt: t("qPh", { ph }), big: nameOf(target), bigStyle: "word", optStyle: "word",
      options: ["positive", "neutral", "negative"].map(c => ({ id: c, label: t("ph_" + c) })),
      isCorrect: id => id === answer, correctLabel: t("ph_" + answer), aas: [target.one], explain,
    };
  }

  function structure(pool) {
    const target = weightedPick(pool);
    const options = shuffle([target, ...distractors(target, 3)]);
    return {
      type: "choice", kind: "struct", prompt: t("qStruct"), big: null, smiles: target.smiles, optStyle: "word",
      options: options.map(a => ({ id: a.one, label: nameOf(a) })),
      isCorrect: id => id === target.one, correctLabel: nameOf(target), aas: [target.one], explain: propsLine(target),
    };
  }

  // --- rounds ----------------------------------------------------------------------------------
  const PROPS = {
    "aa>charge": pool => aaToClass(weightedPick(pool), "charge"),
    "charge>aa": pool => classToAa(weightedPick(pool), "charge"),
    "aa>chem": pool => aaToClass(weightedPick(pool), "chem"),
    "chem>aa": pool => classToAa(weightedPick(pool), "chem"),
    "aa>hydro": pool => aaToClass(weightedPick(pool), "hydro"),
    "hydro>aa": pool => classToAa(weightedPick(pool), "hydro"),
    kd: compareKd,
  };
  const CHEMISTRY = { heavier, extreme, formula: formulaToAa, count: countAtoms, ph: phCharge, struct: structure };

  function buildRound(lesson, n = 10) {
    const pool = lesson.pool ?? (lesson.aas ? [...lesson.aas].map(l => byOne[l]) : aas);
    const questions = [];
    const recent = [];
    for (let i = 0; i < n; i++) {
      if (lesson.plan === "codes" || lesson.plan === "review") {
        if (lesson.plan === "review" && i % 3 === 2) {
          const kind = pick(Object.keys(PROPS));
          questions.push(PROPS[kind](pool));
        } else if (i === 4 && pool.length >= 4) {
          const [from, to] = pick([["name", "one"], ["name", "three"], ["one", "three"]]);
          questions.push(codesMatch(matchTargets(pool, 4), from, to));
        } else {
          questions.push(codesQuestion(pool, i, recent));
        }
      } else if (lesson.plan === "seq") {
        const makers = i < 3 ? [seqChoice] : [seqToThree, threeToSeq, seqChoice];
        questions.push(pick(makers)(lesson.len));
      } else if (lesson.plan === "props") {
        questions.push(i === 4 && lesson.match ? matchClass(pool, lesson.match) : PROPS[pick(lesson.kinds)](pool));
      } else if (lesson.plan === "chem") {
        questions.push(CHEMISTRY[pick(lesson.kinds)](pool));
      }
    }
    return questions;
  }

  return { buildRound, byOne };
}
