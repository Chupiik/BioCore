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

// --- the standard genetic code (NCBI table 1) -------------------------------------------------
// All 64 RNA codons -> one-letter amino acid code; "*" marks the three stop codons.
export const GENETIC_CODE = {
  UUU: "F", UUC: "F", UUA: "L", UUG: "L",
  UCU: "S", UCC: "S", UCA: "S", UCG: "S",
  UAU: "Y", UAC: "Y", UAA: "*", UAG: "*",
  UGU: "C", UGC: "C", UGA: "*", UGG: "W",
  CUU: "L", CUC: "L", CUA: "L", CUG: "L",
  CCU: "P", CCC: "P", CCA: "P", CCG: "P",
  CAU: "H", CAC: "H", CAA: "Q", CAG: "Q",
  CGU: "R", CGC: "R", CGA: "R", CGG: "R",
  AUU: "I", AUC: "I", AUA: "I", AUG: "M",
  ACU: "T", ACC: "T", ACA: "T", ACG: "T",
  AAU: "N", AAC: "N", AAA: "K", AAG: "K",
  AGU: "S", AGC: "S", AGA: "R", AGG: "R",
  GUU: "V", GUC: "V", GUA: "V", GUG: "V",
  GCU: "A", GCC: "A", GCA: "A", GCG: "A",
  GAU: "D", GAC: "D", GAA: "E", GAG: "E",
  GGU: "G", GGC: "G", GGA: "G", GGG: "G",
};
export const CODONS = Object.keys(GENETIC_CODE);            // the 64 codons, in table order
export const BASES = ["U", "C", "A", "G"];
export const STOP_CODONS = CODONS.filter(c => GENETIC_CODE[c] === "*");   // UAA, UAG, UGA
export const START_CODON = "AUG";

/** Amino acid for a codon; accepts DNA (T) or RNA (U), any case. Returns null for anything else. */
export const aaOfCodon = codon => GENETIC_CODE[String(codon).toUpperCase().replace(/T/g, "U")] ?? null;
/** All codons of one amino acid (one-letter code), in table order. */
export const codonsOf = one => CODONS.filter(c => GENETIC_CODE[c] === one);

/**
 * Translate RNA in one reading frame. `offset` is the index of the first nucleotide of a codon
 * (0 = frame +1, 1 = frame +2, 2 = frame +3). Stops at the first stop codon, like a ribosome.
 * @returns {{ protein: string, stop: number|null }} protein without the stop, stop = index of the stop codon
 */
export function translate(rna, offset = 0) {
  const seq = String(rna).toUpperCase().replace(/T/g, "U");
  let protein = "";
  for (let i = offset; i + 3 <= seq.length; i += 3) {
    const aa = GENETIC_CODE[seq.slice(i, i + 3)];
    if (aa === undefined) return { protein, stop: null };   // not RNA (e.g. an N in the sequence)
    if (aa === "*") return { protein, stop: i };
    protein += aa;
  }
  return { protein, stop: null };
}

export const AMINO_UNITS = [
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

// The genetic code curriculum. It deliberately does *not* drill the 61 sense codons: knowing
// "GCU = Ala" by heart is neither how anyone reads sequence data nor how the code is examined.
// Lessons teach the concepts instead, and only the start codon and the three stops are memorised.
//
// A small concept such as "AUG" cannot fill ten questions on its own, so every lesson declares a
// `mix`: how many of the ten questions come from which generator. A definition is asked once or
// twice, and the rest of the round *applies* it — scanning sequences for the codon, translating a
// short ORF, trapping DNA/RNA confusion, shifting a reading frame. `mixKinds` turns this into a
// concrete list of kinds, ordered so that no two questions in a row are of the same format.
// Every key of `mix` must exist in GENETIC (tests.js checks that), and no weight may exceed half
// the round, otherwise "no two in a row" would be unsatisfiable.
export const GENETIC_UNITS = [
  { id: "g1", lessons: [
    { id: "g1-start", title: "g_l_start", plan: "start_stop", mix: { start: 2, scan: 3, dnatrap: 1, mini: 3, shift: 1 } },
    { id: "g1-stop", title: "g_l_stop", plan: "start_stop", mix: { stop: 2, stopScan: 2, mini: 4, premature: 2 } },
    { id: "g1-both", title: "g_l_both", plan: "start_stop",
      mix: { start: 1, stop: 1, scan: 2, stopScan: 1, dnatrap: 1, mini: 2, shift: 1, premature: 1 } },
  ] },
  { id: "g2", lessons: [
    { id: "g2-wobble", title: "g_l_wobble", plan: "concept", mix: { wobble: 5, silentChange: 5 } },
    { id: "g2-mutation", title: "g_l_mutation", plan: "concept", mix: { mutation: 4, premature: 3, shift: 3 } },
    { id: "g2-mixed", title: "g_l_mutwobble", plan: "concept", mix: { wobble: 3, silentChange: 2, mutation: 3, premature: 2 } },
  ] },
  { id: "g3", lessons: [
    { id: "g3-frame", title: "g_l_frame", plan: "concept", mix: { frame: 5, shift: 5 } },
    { id: "g3-orf", title: "g_l_orf", plan: "concept", mix: { orf: 5, mini: 5 } },
    { id: "g3-all", title: "g_l_concepts", plan: "concept",
      mix: { start: 1, stop: 1, scan: 1, dnatrap: 1, mini: 1, shift: 1, wobble: 1, mutation: 1, frame: 1, orf: 1 } },
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

  // --- genetic code: concepts, not 64 memorised codons --------------------------------------
  // The quiz never asks you to recall an arbitrary codon: memorising 61 sense codons is neither how
  // anyone reads sequence data nor how the code is examined. Only AUG and the three stops are asked
  // directly; every other codon appears inside a concept question (wobble, mutation, reading frame).
  // The spaced-repetition key stays the codon itself, as in the amino module it is the one-letter code.
  // A review round passes the codons that are due; a concept lesson uses the whole table.
  const codonPoolOf = lesson => (lesson.pool?.length ? lesson.pool : lesson.codons ?? CODONS);

  function weightedCodon(pool) {
    const weights = pool.map(c => (MAX_STRENGTH - progress.strength(c)) + 1 + (progress.due(c) ? 3 : 0));
    let r = rng() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  const codonName = codon => (GENETIC_CODE[codon] === "*" ? t("aa_stop") : nameOf(byOne[GENETIC_CODE[codon]]));

  // the nine codons that differ from `codon` by exactly one base, with the position that changed
  function neighbours(codon) {
    const out = [];
    for (let i = 0; i < 3; i++) for (const b of BASES) {
      if (b !== codon[i]) out.push({ codon: codon.slice(0, i) + b + codon.slice(i + 1), pos: i });
    }
    return out;
  }

  // codons that differ from `codon` in the third base only and still code for the same amino acid
  function wobblePartners(codon) {
    const one = GENETIC_CODE[codon];
    if (!one || one === "*") return [];
    return BASES.filter(b => b !== codon[2]).map(b => codon.slice(0, 2) + b).filter(c => GENETIC_CODE[c] === one);
  }

  // a codon that becomes a stop codon after a single base change (UAC -> UAA, CAA -> UAA, UGG -> UGA ...)
  const isNonsenseSource = codon =>
    GENETIC_CODE[codon] !== "*" && neighbours(codon).some(n => GENETIC_CODE[n.codon] === "*");

  // single-base neighbours of `codon` that code for a *different* amino acid
  const missenseTargets = codon => neighbours(codon).filter(n => {
    const one = GENETIC_CODE[n.codon];
    return Boolean(one) && one !== "*" && one !== GENETIC_CODE[codon];
  });

  // sense codons other than AUG, used to build example reading frames
  const SENSE = CODONS.filter(c => GENETIC_CODE[c] !== "*" && c !== START_CODON);
  const MUTATION_TYPES = ["silent", "missense", "nonsense", "frameshift"];

  // a codon from the pool that satisfies `ok`; the whole table is the fallback, for a review round
  // whose pool happens to hold no suitable codon
  const pickCodon = (pool, ok) => {
    const inPool = pool.filter(ok);
    return weightedCodon(inPool.length ? inPool : CODONS.filter(ok));
  };

  // a short 5' leader that contains no start codon, so the AUG in the sequence really is the first one
  function leader(n) {
    let s = "";
    while (s.length < n) {
      const b = pick(BASES);
      if (!(s + b).includes(START_CODON)) s += b;
    }
    return s;
  }

  // --- wobble: the third base is often degenerate -------------------------------------------
  function wobble(pool) {
    const from = pickCodon(pool, c => wobblePartners(c).length > 0);
    const to = pick(wobblePartners(from));
    const one = GENETIC_CODE[from];
    return {
      type: "choice", kind: "wobble", prompt: t("qWobble", { from, to }),
      big: `${from} → ${to}`, bigStyle: "code", optStyle: "word", wide: true,
      options: shuffle(MUTATION_TYPES).map(id => ({ id, label: t("wob_" + id) })),
      isCorrect: id => id === "silent", correctLabel: t("wob_silent"),
      aas: [one], keys: [from, to],
      explain: t("eWobble", { from, to, name: nameOf(byOne[one]), one }),
    };
  }

  // --- mutation types: silent, missense, nonsense, frameshift -------------------------------
  function mutation(pool) {
    const kind = pick(MUTATION_TYPES);
    const common = {
      type: "choice", kind: "mutation", optStyle: "word",
      options: shuffle(MUTATION_TYPES).map(id => ({ id, label: t("mut_" + id) })),
      isCorrect: id => id === kind, correctLabel: t("mut_" + kind),
    };

    if (kind === "frameshift") {
      // one base deleted from a short ORF: the start codon survives, everything after it shifts
      const seq = [START_CODON, pick(SENSE), pick(SENSE)].join("");
      const cut = 3 + Math.floor(rng() * 3);            // the deleted base is never inside the AUG
      return {
        ...common, prompt: t("qFrameshift"), big: `${seq} → ${seq.slice(0, cut) + seq.slice(cut + 1)}`, bigStyle: "seq",
        aas: ["M"], keys: [START_CODON], explain: t("eMutFrameshift"),
      };
    }

    let from, to;
    if (kind === "silent") {
      from = pickCodon(pool, c => wobblePartners(c).length > 0);
      to = pick(wobblePartners(from));
    } else if (kind === "nonsense") {
      from = pickCodon(pool, isNonsenseSource);
      to = pick(neighbours(from).filter(n => GENETIC_CODE[n.codon] === "*")).codon;
    } else {
      from = pickCodon(pool, c => GENETIC_CODE[c] !== "*" && missenseTargets(c).length > 0);
      to = pick(missenseTargets(from)).codon;
    }
    const params = { from, to, name: codonName(from), one: GENETIC_CODE[from], toAa: codonName(to) };
    return {
      ...common,
      // the amino acid names would give the silent case away ("leucine → leucine"), so that one asks
      // about the codons only and the learner has to look them up
      prompt: kind === "silent" ? t("qMutationCode") : t("qMutation", { fromAa: codonName(from), toAa: codonName(to) }),
      big: `${from} → ${to}`, bigStyle: "code",
      aas: kind === "missense" ? [GENETIC_CODE[from], GENETIC_CODE[to]] : [GENETIC_CODE[from]],
      keys: [from, to],
      explain: t(kind === "silent" ? "eMutSilent" : kind === "nonsense" ? "eMutNonsense" : "eMutMissense", params),
    };
  }


  // --- the only two things worth memorising: AUG and the three stops -------------------------
  function startCodon() {
    // every wrong option differs from AUG by a single base, the classic near misses
    const others = sample(neighbours(START_CODON).map(n => n.codon), 3);
    return {
      type: "choice", kind: "start", prompt: t("qStartCodon"), big: null, optStyle: "code",
      options: shuffle([START_CODON, ...others]).map(c => ({ id: c, label: c })),
      isCorrect: id => id === START_CODON, correctLabel: START_CODON,
      aas: ["M"], keys: [START_CODON], explain: t("eStart"),
    };
  }

  function stopCodon() {
    const correct = pick(STOP_CODONS);
    const others = sample(neighbours(correct).map(n => n.codon).filter(c => !STOP_CODONS.includes(c)), 3);
    return {
      type: "choice", kind: "stop", prompt: t("qStopCodon"), big: null, optStyle: "code",
      options: shuffle([correct, ...others]).map(c => ({ id: c, label: c })),
      isCorrect: id => STOP_CODONS.includes(id), correctLabel: correct,
      aas: [], keys: [correct], explain: t("eStop", { codon: correct }),
    };
  }

  // --- reading frames: the ribosome looks for the first AUG ---------------------------------
  function readingFrame() {
    const lead = leader(1 + Math.floor(rng() * 3));     // 1-3 bases of 5' UTR before the start codon
    const seq = lead + START_CODON + Array.from({ length: 2 + Math.floor(rng() * 2) }, () => pick(SENSE)).join("");
    // the strongest distractor is what reading from the very first base would give
    const wrong = [];
    const naive = translate(seq, 0).protein[0];
    if (naive && naive !== "M") wrong.push(naive);
    wrong.push(...sample(Object.keys(byOne).filter(o => o !== "M" && !wrong.includes(o)), 3 - wrong.length));
    const label = o => (o === "*" ? t("aa_stop") : nameOf(byOne[o]));
    return {
      type: "choice", kind: "frame", prompt: t("qFrame"), big: seq, bigStyle: "seq", optStyle: "word",
      options: shuffle(["M", ...wrong]).map(o => ({ id: o, label: label(o) })),
      isCorrect: id => id === "M", correctLabel: label("M"),
      aas: ["M"], keys: [START_CODON],
      explain: t("eFrame", { pos: lead.length + 1 }),
    };
  }

  function orfLength() {
    const lead = leader(1 + Math.floor(rng() * 3));
    const stop = pick(STOP_CODONS);
    const seq = lead + START_CODON + Array.from({ length: 1 + Math.floor(rng() * 4) }, () => pick(SENSE)).join("") + stop;
    const { protein } = translate(seq, lead.length);
    const n = protein.length;                            // AUG counts, the stop codon does not
    const values = [n, n - 1, n + 1, n + 2].filter(v => v > 0).slice(0, 4);
    return {
      type: "choice", kind: "orf", prompt: t("qOrf"), big: seq, bigStyle: "seq", optStyle: "word",
      options: shuffle(values).map(v => ({ id: String(v), label: String(v) })),
      isCorrect: id => Number(id) === n, correctLabel: String(n),
      aas: ["M"], keys: [START_CODON],
      explain: t("eOrf", { stop, n, protein }),
    };
  }

  // --- application: read a sequence instead of reciting a table --------------------------------
  // A window of exactly `len` bases with `codon` sitting at `off`. It is built base by base so that
  // no other copy of a codon from `keep` can appear: a second AUG would make "find the start"
  // ambiguous, and a second stop would do the same for "find the stop".
  const countOf = (s, c) => s.split(c).length - 1;

  function windowWith(codon, len, off, keep) {
    for (let attempt = 0; attempt < 80; attempt++) {
      let s = "";
      while (s.length < len) {
        if (s.length === off) { s += codon; continue; }
        const b = pick(BASES);
        if (!keep.some(k => (s + b).endsWith(k))) s += b;
      }
      if (keep.every(k => countOf(s, k) === (k === codon ? 1 : 0))) return s;
    }
    return codon + "G".repeat(Math.max(0, len - 3));       // unreachable, but always a valid window
  }

  // "Which of these sequences contains a start codon?" — the answer is found by eye, not recalled
  function findStartCodon() {
    const len = 6 + Math.floor(rng() * 3);                 // 6-8 bases: short enough to scan
    const off = Math.floor(rng() * (len - 2));
    const right = windowWith(START_CODON, len, off, [START_CODON]);
    // the decoys are windows of the same length where the AUG is broken by a single base
    // (AAG, AUA, UUG…), so they look almost identical at a glance
    const decoys = new Set();
    for (const near of shuffle(neighbours(START_CODON).map(n => n.codon))) {
      if (decoys.size === 3) break;
      decoys.add(windowWith(near, len, off, [START_CODON, near]));
    }
    return {
      type: "choice", kind: "scan",
      prompt: rng() < 0.5 ? t("qScanStart") : t("qScanStart2"),
      big: null, optStyle: "code", wide: true,
      options: shuffle([right, ...decoys]).map(s => ({ id: s, label: s })),
      isCorrect: id => id.includes(START_CODON), correctLabel: right,
      aas: ["M"], keys: [START_CODON],
      explain: t("eScan"),
    };
  }

  // the same exercise for the other end of the gene: which fragment actually contains a stop?
  function findStopCodon() {
    const stop = pick(STOP_CODONS);
    const len = 6 + Math.floor(rng() * 3);
    const off = Math.floor(rng() * (len - 2));
    const right = windowWith(stop, len, off, STOP_CODONS);
    const decoys = new Set();
    for (const near of shuffle(neighbours(stop).map(n => n.codon).filter(c => !STOP_CODONS.includes(c)))) {
      if (decoys.size === 3) break;
      decoys.add(windowWith(near, len, off, [...STOP_CODONS, near]));
    }
    return {
      type: "choice", kind: "stopScan", prompt: t("qScanStop"), big: null, optStyle: "code", wide: true,
      options: shuffle([right, ...decoys]).map(s => ({ id: s, label: s })),
      isCorrect: id => STOP_CODONS.some(c => id.includes(c)), correctLabel: right,
      aas: [], keys: [stop],
      explain: t("eScanStop"),
    };
  }

  // --- DNA vs RNA: the gene says ATG, the mRNA says AUG ---------------------------------------
  function dnaRnaTrap() {
    const stopForm = rng() < 0.34;
    const rna = stopForm ? pick(STOP_CODONS) : START_CODON;
    const dna = rna.replace(/U/g, "T");
    // the DNA spelling is always on offer; the other two options are RNA near misses of the codon
    const near = neighbours(rna).map(n => n.codon).filter(c => !STOP_CODONS.includes(c) && c !== START_CODON);
    const options = shuffle([rna, dna, ...sample(near, 2)]).map(c => ({ id: c, label: c }));
    const one = GENETIC_CODE[rna];
    return {
      type: "choice", kind: "dnatrap", prompt: t(stopForm ? "qDnaRnaStop" : "qDnaRnaStart"),
      big: null, optStyle: "code",
      options, isCorrect: id => id === rna, correctLabel: rna,
      aas: one === "M" ? ["M"] : [], keys: [rna],
      explain: t("eDnaRna", { dna, rna }),
    };
  }

  // --- mini-translation: read a three-codon ORF into a peptide --------------------------------
  function miniTranslation() {
    const codons = [START_CODON, pick(SENSE), pick(SENSE), pick(STOP_CODONS)];
    const { protein } = translate(codons.join(""));
    const three = o => byOne[o].three;
    const withStop = p => [...p].map(three).concat(t("aa_stop")).join("–");
    const chain = codons.map(c => `${c} → ${GENETIC_CODE[c] === "*" ? t("aa_stop") : three(GENETIC_CODE[c])}`).join(", ");
    const explain = t("eMini", { chain, peptide: withStop(protein), protein });
    const keys = [START_CODON, codons[3]];
    // typing the peptide from the codons is the harder version of the same skill
    if (rng() < 0.35)
      return {
        type: "type", kind: "mini", prompt: t("qMiniType"), big: codons.join(" "), bigStyle: "seq",
        isCorrect: v => String(v).toUpperCase().replace(/[^A-Z]/g, "") === protein,
        correctLabel: protein, aas: [...protein], keys, explain,
      };
    // the distractors are the classic misreadings: the stop counted as an amino acid or forgotten,
    // the last residue dropped, the residues swapped, or one residue replaced by another
    const wrong = new Set([
      [...protein].map(three).join("–"),
      withStop(protein.slice(0, -1)),
      withStop(protein[0] + protein[2] + protein[1]),
    ]);
    for (const o of shuffle(Object.keys(byOne))) {
      if (wrong.size >= 5) break;
      if (o !== protein[1]) wrong.add(withStop(protein[0] + o + protein.slice(2)));
    }
    const right = withStop(protein);
    wrong.delete(right);
    return {
      type: "choice", kind: "mini", prompt: t("qMini"), big: codons.join(" "), bigStyle: "seq",
      optStyle: "word", wide: true,
      options: shuffle([right, ...[...wrong].slice(0, 3)]).map(l => ({ id: l, label: l })),
      isCorrect: id => id === right, correctLabel: right,
      aas: [...protein], keys, explain,
    };
  }

  // --- frameshift: delete one base and read the codons again ----------------------------------
  function frameShift() {
    // two cases, both computed on the real sequence: the deletion destroys the start codon, or it
    // lands after it and shifts every following codon
    const inStart = rng() < 0.5;
    let seq = "", mutated = "", oldCodon = "", newCodon = "";
    for (let guard = 0; guard < 60 && !mutated; guard++) {
      seq = [START_CODON, pick(SENSE), pick(SENSE)].join("");
      const at = inStart ? pick([0, 1, 2]) : 3 + Math.floor(rng() * 3);
      const m = seq.slice(0, at) + seq.slice(at + 1);
      const from = inStart ? 0 : 3, before = seq.slice(from, from + 3), after = m.slice(from, from + 3);
      if (before !== after && !(inStart && m.includes(START_CODON))) {
        mutated = m; oldCodon = before; newCodon = after;
      }
    }
    if (!mutated) {                                        // deleting the first base always works
      mutated = seq.slice(1); oldCodon = START_CODON; newCodon = mutated.slice(0, 3);
    }
    // the codon before the deletion is the best distractor: it is what you get if you ignore it
    const others = new Set([oldCodon]);
    for (const near of shuffle(neighbours(newCodon).map(n => n.codon))) {
      if (others.size === 3) break;
      if (near !== newCodon) others.add(near);
    }
    return {
      type: "choice", kind: "shift", prompt: t(inStart ? "qShiftFirst" : "qShiftSecond"),
      big: `${seq} → ${mutated}`, bigStyle: "seq", optStyle: "code",
      options: shuffle([newCodon, ...others]).map(c => ({ id: c, label: c })),
      isCorrect: id => id === newCodon, correctLabel: newCodon,
      aas: ["M"], keys: [START_CODON, oldCodon],
      explain: t(inStart ? "eShiftFirst" : "eShiftSecond", { new: newCodon, old: oldCodon }),
    };
  }

  // --- which of these changes is the dangerous one? (nonsense) ---------------------------------
  function prematureStop(pool) {
    const from = pickCodon(pool, isNonsenseSource);
    const stop = pick(neighbours(from).filter(n => GENETIC_CODE[n.codon] === "*")).codon;
    const others = new Set();
    for (const near of shuffle(neighbours(from).map(n => n.codon))) {
      if (others.size === 3) break;
      if (GENETIC_CODE[near] !== "*" && near !== stop) others.add(near);
    }
    const label = c => `${from} → ${c}`;
    return {
      type: "choice", kind: "premature", prompt: t("qPremature"),
      big: `${from} (${codonName(from)})`, bigStyle: "word", optStyle: "code", wide: true,
      options: shuffle([stop, ...others]).map(c => ({ id: c, label: label(c) })),
      isCorrect: id => GENETIC_CODE[id] === "*", correctLabel: label(stop),
      aas: [GENETIC_CODE[from]], keys: [from, stop],
      explain: t("ePremature", { from, name: codonName(from), stop }),
    };
  }

  // --- which of these changes is the harmless one? (wobble seen from the other side) -----------
  function silentChoice(pool) {
    const from = pickCodon(pool, c => wobblePartners(c).length > 0);
    const quiet = pick(wobblePartners(from));
    const others = new Set();
    for (const near of shuffle(missenseTargets(from).map(n => n.codon))) {
      if (others.size === 3) break;
      if (near !== quiet) others.add(near);
    }
    const one = GENETIC_CODE[from], label = c => `${from} → ${c}`;
    return {
      type: "choice", kind: "silentChange", prompt: t("qSilentChange"),
      big: `${from} (${codonName(from)})`, bigStyle: "word", optStyle: "code", wide: true,
      options: shuffle([quiet, ...others]).map(c => ({ id: c, label: label(c) })),
      isCorrect: id => GENETIC_CODE[id] === one, correctLabel: label(quiet),
      aas: [one], keys: [from, quiet],
      explain: t("eSilentChange", { from, to: quiet, name: codonName(from), one }),
    };
  }

  // every generator a lesson can ask for; the keys are referenced by `mix` in GENETIC_UNITS
  const GENETIC = {
    start: startCodon, stop: stopCodon, scan: findStartCodon, stopScan: findStopCodon,
    dnatrap: dnaRnaTrap, mini: miniTranslation, shift: frameShift,
    premature: prematureStop, silentChange: silentChoice,
    wobble, mutation, frame: readingFrame, orf: orfLength,
  };

  // --- round assembly: a small concept is applied from several angles -------------------------
  // `mix` is proportional ("3 of 10 questions scan a sequence"), so it is turned into quotas first.
  function mixQuotas(mix, n) {
    const ids = Object.keys(mix);
    const total = ids.reduce((s, k) => s + mix[k], 0);
    const quota = Object.fromEntries(ids.map(k => [k, Math.max(1, Math.round(n * mix[k] / total))]));
    const byWeight = [...ids].sort((a, b) => mix[b] - mix[a]);
    let sum = ids.reduce((s, k) => s + quota[k], 0);
    for (let i = 0; sum !== n; i = (i + 1) % byWeight.length) {
      const k = byWeight[i];
      if (sum < n) { quota[k] += 1; sum += 1; }
      else if (quota[k] > 1) { quota[k] -= 1; sum -= 1; }
    }
    // no format may own more than half of the round, or "never twice in a row" would be impossible
    const cap = Math.ceil(n / 2);
    for (const k of byWeight) {
      while (quota[k] > cap) {
        const room = byWeight.find(o => o !== k && quota[o] < cap);
        if (!room) break;
        quota[k] -= 1; quota[room] += 1;
      }
    }
    return quota;
  }

  // the greedy that makes the order possible: take the format with the most questions left, never
  // the one just asked (a quota capped at half the round always allows this)
  function orderKinds(quota, n) {
    const left = { ...quota };
    const order = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      let open = Object.keys(left).filter(k => left[k] > 0 && k !== prev);
      if (!open.length) open = Object.keys(left).filter(k => left[k] > 0);
      const most = Math.max(...open.map(k => left[k]));
      prev = pick(open.filter(k => left[k] === most));
      left[prev] -= 1;
      order.push(prev);
    }
    return order;
  }

  const GENETIC_ALL = Object.keys(GENETIC);
  const GENETIC_PLANS = new Set(["concept", "start_stop", "codonreview"]);

  function buildGeneticRound(lesson, n) {
    const pool = codonPoolOf(lesson);
    let order;
    if (lesson.mix) {
      order = orderKinds(mixQuotas(lesson.mix, n), n);
    } else {
      // a review round has no mix: cycle through the requested formats, never twice in a row
      const kinds = lesson.kinds ?? GENETIC_ALL;
      order = [];
      let last = null;
      for (let i = 0; i < n; i++) {
        const choices = last && kinds.length > 1 ? kinds.filter(k => k !== last) : kinds;
        last = pick(choices);
        order.push(last);
      }
    }
    return order.map(kind => GENETIC[kind](pool, lesson));
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
    if (GENETIC_PLANS.has(lesson.plan)) return buildGeneticRound(lesson, n);
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
