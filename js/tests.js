// Generates many rounds in every language and checks the invariants a quiz must have:
// exactly one correct option, no duplicate options, answers that match the data table.
import {
  AMINO_UNITS, GENETIC_UNITS, CODONS, GENETIC_CODE, STOP_CODONS, START_CODON,
  aaOfCodon, codonsOf, createGenerator, translate,
} from "./questions.js";
import { setLang, LANGS, t } from "./i18n.js";

const aas = await (await fetch("data/amino_acids.json")).json();
const out = document.getElementById("out");
const failures = [];
let checks = 0;
const kinds = new Set();

const check = (ok, message, q) => {
  checks += 1;
  if (!ok && failures.length < 25) failures.push(`${message}  [${q?.kind ?? ""} ${JSON.stringify(q?.big ?? q?.prompt ?? "")}]`);
};

function checkQuestion(q) {
  kinds.add(q.kind);
  check(Boolean(q.prompt) && !q.prompt.includes("{"), "prompt missing or has an unfilled placeholder", q);
  check(Boolean(q.explain) && !q.explain.includes("{"), "explanation missing or has an unfilled placeholder", q);
  // spaced repetition needs a key: a one-letter amino acid code, or a three-letter codon
  const keys = q.keys ?? q.aas;
  check(keys.length > 0 && keys.every(k => typeof k === "string" && k.length >= 1 && k.length <= 3), "question has no progress key", q);
  check((q.aas ?? []).every(l => aas.some(a => a.one === l)), "question refers to an unknown amino acid", q);

  if (q.type === "choice") {
    const ids = q.options.map(o => o.id), labels = q.options.map(o => o.label);
    check(q.options.length >= 2 && q.options.length <= 4, "unexpected number of options", q);
    check(new Set(ids).size === ids.length, "duplicate option ids", q);
    check(new Set(labels).size === labels.length, "duplicate option labels", q);
    check(labels.every(l => l && !String(l).includes("undefined") && !String(l).includes("{")), "bad option label", q);
    const right = q.options.filter(o => q.isCorrect(o.id));
    check(right.length === 1, `expected exactly 1 correct option, found ${right.length}`, q);
    check(right[0]?.label === q.correctLabel, "correctLabel does not match the correct option", q);
    if (q.smiles) check(aas.some(a => a.smiles === q.smiles), "structure is not from the data table", q);
  } else if (q.type === "type") {
    check(!q.single || q.correctLabel.length === 1, "a single-key question must have a one-letter answer", q);
    check(q.isCorrect(q.correctLabel), "the correct label is not accepted", q);
    check(!q.isCorrect("") && !q.isCorrect("zzzz"), "garbage accepted as correct", q);
  } else if (q.type === "match") {
    const lefts = q.pairs.map(p => p.left), rights = q.pairs.map(p => p.right);
    check(q.pairs.length >= 3, "too few pairs", q);
    check(new Set(lefts).size === lefts.length && new Set(rights).size === rights.length, "duplicate match entries", q);
  } else {
    check(false, `unknown question type ${q.type}`, q);
  }
}

// every amino acid is in exactly one unit-1 lesson
const unit1 = AMINO_UNITS[0].lessons.flatMap(l => [...l.aas]).sort().join("");
check(unit1 === aas.map(a => a.one).sort().join(""), "unit 1 lessons must cover the 20 amino acids exactly once");

// wrong options are chosen to be confusable: Gln must always come with Glu and Gly (same first letter and
// start of code), Pro with Phe; they are not random letters
setLang("en");
const lookalikes = { Q: ["E", "G"], P: ["F"], W: ["T", "Y"] };
for (const [target, expected] of Object.entries(lookalikes)) {
  const g = createGenerator({ aas, progress: { strength: () => 0, due: () => false } });
  const asked = Array.from({ length: 60 }, () => g.buildRound({ id: "x", plan: "codes", aas: target }, 10)).flat()
    .filter(q => q.type === "choice");
  check(asked.length > 0, `no choice questions generated for ${target}`);
  asked.forEach(q => check(expected.every(l => q.options.some(o => o.id === l)),
    `${target} should be offered together with ${expected.join(", ")}`, q));
}

// accents are optional when typing Czech / Slovak names
setLang("cs");
const gen = createGenerator({ aas, progress: { strength: () => 3, due: () => false } });
const typed = Array.from({ length: 300 }, () => gen.buildRound(AMINO_UNITS[0].lessons[0], 10)).flat().find(q => q.type === "type" && q.kind.endsWith(">name"));
if (typed) {
  const plain = typed.correctLabel.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  check(typed.isCorrect(plain), "accent-free, upper-case Czech name should be accepted", typed);
}

for (const lang of LANGS) {
  setLang(lang);
  for (let run = 0; run < 40; run++) {
    // vary the learner's progress so weighted picking is exercised
    const strengths = Object.fromEntries(aas.map(a => [a.one, Math.floor(Math.random() * 6)]));
    const progress = { strength: l => strengths[l], due: () => Math.random() < 0.3 };
    const generator = createGenerator({ aas, progress });
    for (const unit of AMINO_UNITS) for (const lesson of unit.lessons)
      generator.buildRound(lesson, 10).forEach(checkQuestion);
    const pool = aas.filter(() => Math.random() < 0.4).concat(aas.slice(0, 4));
    generator.buildRound({ id: "review", plan: "review", pool: [...new Set(pool)] }, 10).forEach(checkQuestion);
  }
}

// --- genetic code: the table itself must match NCBI table 1 ------------------------------------
setLang("en");
check(CODONS.length === 64, `the standard code has 64 codons, found ${CODONS.length}`);
check(new Set(CODONS).size === 64, "duplicate codons");
check(CODONS.every(c => /^[UCAG]{3}$/.test(c)), "codons must be three RNA bases");
check(new Set(Object.values(GENETIC_CODE)).size === 21, "there must be 20 amino acids and the stop symbol");
check([...STOP_CODONS].sort().join(",") === "UAA,UAG,UGA", `the stop codons are UAA, UAG and UGA, found ${STOP_CODONS.join(",")}`);
check(CODONS.filter(c => GENETIC_CODE[c] !== "*").length === 61, "61 codons code for amino acids");
check(GENETIC_CODE[START_CODON] === "M", "AUG is the start codon and codes for methionine");
for (const [one, n] of Object.entries({ M: 1, W: 1, L: 6, S: 6, R: 6, A: 4, G: 4, V: 4, T: 4, P: 4 }))
  check(codonsOf(one).length === n, `${one} should have ${n} codons, found ${codonsOf(one).length}`);
check(aaOfCodon("atg") === "M" && aaOfCodon("TGA") === "*", "DNA codons (T) must be accepted as well");

const tr1 = translate("AUGGCUUAAGGG");
check(tr1.protein === "MA" && tr1.stop === 6, "AUGGCUUAAGGG must translate to MA and stop at nucleotide 6");
check(translate("CAUGGCUUAA", 0).protein === "HGL" && translate("CAUGGCUUAA", 1).protein === "MA",
  "the same sequence in frame +1 and +2 must give different proteins");
check(translate("AUG").stop === null, "a sequence without a stop codon must report stop = null");

// --- genetic code: the quizzes follow the table and offer exactly one right answer -------------
// Every genetic lesson must teach a concept, and every answer must be derivable from the table.
const readsFromFirstAug = q => translate(q.big, q.big.indexOf(START_CODON));

const rightAnswer = {
  start: q => q.correctLabel === START_CODON,
  stop: q => STOP_CODONS.includes(q.correctLabel),
  // wobble: the two codons differ only in the third base and still code for the same amino acid
  wobble: q => q.isCorrect("silent") && q.keys.length === 2 && q.keys[0] !== q.keys[1] &&
    q.keys[0].slice(0, 2) === q.keys[1].slice(0, 2) && GENETIC_CODE[q.keys[0]] === GENETIC_CODE[q.keys[1]],
  // mutation: the class must follow from the two codons the question is about
  mutation: q => {
    if (q.keys.length !== 2) return q.isCorrect("frameshift");     // frameshift has no codon pair
    const [from, to] = q.keys.map(c => GENETIC_CODE[c]);
    if (from === to) return q.isCorrect("silent");
    return to === "*" ? q.isCorrect("nonsense") : q.isCorrect("missense");
  },
  // reading frame: the first translated amino acid is methionine, read from the first AUG
  frame: q => q.isCorrect("M") && readsFromFirstAug(q).protein[0] === "M",
  // ORF: the length must match an independent translation of the same sequence
  orf: q => {
    const { protein, stop } = readsFromFirstAug(q);
    return stop !== null && q.isCorrect(String(protein.length)) && protein[0] === "M";
  },
  // sequence scan: exactly one window really contains the codon, all windows are equally long
  scan: q => {
    const ids = q.options.map(o => o.id);
    const withStart = ids.filter(s => s.includes(START_CODON));
    return withStart.length === 1 && q.isCorrect(withStart[0]) && new Set(ids.map(s => s.length)).size === 1;
  },
  stopScan: q => {
    const ids = q.options.map(o => o.id);
    const withStop = ids.filter(s => STOP_CODONS.some(c => s.includes(c)));
    return withStop.length === 1 && q.isCorrect(withStop[0]) && new Set(ids.map(s => s.length)).size === 1;
  },
  // DNA/RNA trap: the right answer is RNA, and the DNA spelling of it is always offered as bait
  dnatrap: q => {
    const right = q.options.map(o => o.id).filter(o => q.isCorrect(o));
    return right.length === 1 && /^[UCAG]{3}$/.test(right[0]) && !right[0].includes("T") &&
      q.options.some(o => o.id === right[0].replace(/U/g, "T"));
  },
  // mini-translation: the peptide must be the real translation of the ORF that is shown
  mini: q => {
    const { protein, stop } = translate(String(q.big).replace(/\s/g, ""));
    const three = o => aas.find(a => a.one === o).three;
    if (q.type === "type")
      return stop !== null && protein.length === 3 && q.correctLabel === protein && q.isCorrect(protein);
    const right = q.options.filter(o => q.isCorrect(o.id));
    if (right.length !== 1 || stop === null || protein.length !== 3) return false;
    let at = 0;
    const inOrder = [...protein].every(o => {
      const i = right[0].label.indexOf(three(o), at);
      if (i < 0) return false;
      at = i + three(o).length;
      return true;
    });
    return inOrder && right[0].label.endsWith(t("aa_stop"));
  },
  // frameshift: the mutant is the original minus one base, and the answer is the real next codon
  shift: q => {
    const [seq, mutated] = String(q.big).split("→").map(s => s.trim());
    const at = [...seq].findIndex((b, i) => mutated[i] !== b);
    const oneDeleted = at >= 0 && mutated === seq.slice(0, at) + seq.slice(at + 1);
    const expected = mutated.slice(0, 3) === START_CODON ? mutated.slice(3, 6) : mutated.slice(0, 3);
    const right = q.options.filter(o => q.isCorrect(o.id));
    return oneDeleted && expected.length === 3 && right.length === 1 && right[0].id === expected;
  },
  // every option is one base away from the same codon; exactly one of them creates a stop
  premature: q => {
    const from = String(q.big).split(" ")[0];
    const ids = q.options.map(o => o.id);
    const singleBase = c => c.length === 3 && [...c].filter((b, i) => b !== from[i]).length === 1;
    const stops = ids.filter(c => GENETIC_CODE[c] === "*");
    return stops.length === 1 && q.isCorrect(stops[0]) && ids.every(singleBase);
  },
  // ... and exactly one of them leaves the amino acid unchanged
  silentChange: q => {
    const from = String(q.big).split(" ")[0];
    const ids = q.options.map(o => o.id);
    const singleBase = c => c.length === 3 && [...c].filter((b, i) => b !== from[i]).length === 1;
    const same = ids.filter(c => GENETIC_CODE[c] === GENETIC_CODE[from]);
    return same.length === 1 && q.isCorrect(same[0]) && ids.every(singleBase);
  },
};

// the formats a lesson asks for: `mix` (a weighted composition) or a plain `kinds` list
const lessonKinds = l => [...(l.kinds ?? []), ...Object.keys(l.mix ?? {})];
const geneticLessons = GENETIC_UNITS.flatMap(u => u.lessons);
const geneticKinds = new Set(geneticLessons.flatMap(lessonKinds));
check(geneticLessons.every(l => ["concept", "start_stop"].includes(l.plan)), "every genetic lesson must teach a concept");
check(geneticLessons.every(l => lessonKinds(l).length > 0), "every genetic lesson must name the question formats it asks");
check([...geneticKinds].every(k => rightAnswer[k]), "every lesson kind must have a correctness check",
  { kind: [...geneticKinds].find(k => !rightAnswer[k]) });
check(!geneticKinds.has("codon>aa") && !geneticKinds.has("aa>codon"),
  "the curriculum must not drill arbitrary codon memorisation");
// one format may not dominate a round, or "never twice in a row" could not be satisfied
for (const lesson of geneticLessons) {
  const mix = lesson.mix ?? {};
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  for (const [kind, w] of Object.entries(mix))
    check(w / total <= 0.5, `${lesson.id} gives ${kind} more than half of the round`);
}

for (const lang of LANGS) {
  setLang(lang);
  for (let run = 0; run < 12; run++) {
    const strengths = Object.fromEntries(CODONS.map(c => [c, Math.floor(Math.random() * 6)]));
    const generator = createGenerator({ aas, progress: { strength: c => strengths[c] ?? 0, due: () => Math.random() < 0.3 } });
    const ask = q => {
      checkQuestion(q);
      check(Boolean(rightAnswer[q.kind]), `unexpected genetic question kind ${q.kind}`, q);
      if (rightAnswer[q.kind]) check(rightAnswer[q.kind](q), "the answer does not match the genetic code", q);
      // the explanations are the teaching material: they must be a real sentence, not just the answer
      check(q.explain.length >= 60, "the explanation is too short to teach the concept", q);
      // codon options are RNA — except in the DNA/RNA trap, whose whole point is the DNA spelling
      if (["start", "stop", "shift", "premature", "silentChange"].includes(q.kind))
        check(q.options.every(o => /^[UCAG]{3}$/.test(o.id)), "a DNA codon slipped into an RNA quiz", q);
      if (q.kind === "dnatrap")
        check(q.options.every(o => /^[UCAGT]{3}$/.test(o.id)), "the DNA/RNA question must offer codons only", q);
      if (["scan", "stopScan"].includes(q.kind))
        check(q.options.every(o => /^[UCAG]{6,8}$/.test(o.id)), "a scan window must be plain RNA", q);
      if (q.big && ["frame", "orf", "mutation", "shift", "mini"].includes(q.kind))
        check(/^[UCAG→\s]+$/.test(q.big), "a sequence question must show RNA only", q);
    };
    for (const unit of GENETIC_UNITS) for (const lesson of unit.lessons)
      generator.buildRound(lesson, 10).forEach(ask);
    const pool = [...new Set(CODONS.filter(() => Math.random() < 0.3).concat(CODONS.slice(0, 4)))];
    generator.buildRound({ id: "review", plan: "codonreview", pool }, 10).forEach(ask);
  }
}
setLang("en");

// --- a small concept must be applied, not repeated -------------------------------------------
// Ten questions about "AUG" would be ten definitions without this: every round mixes formats,
// never asks the same format twice in a row, and keeps the promised composition.
const geneticGen = createGenerator({ aas, progress: { strength: () => 0, due: () => false } });
for (const lesson of geneticLessons) {
  const total = Object.values(lesson.mix ?? {}).reduce((a, b) => a + b, 0);
  for (let run = 0; run < 20; run++) {
    const round = geneticGen.buildRound(lesson, 10);
    check(round.length === 10, `${lesson.id} must ask 10 questions, got ${round.length}`);
    const repeat = round.find((q, i) => i > 0 && q.kind === round[i - 1].kind);
    check(!repeat, `${lesson.id}: two questions of the same format in a row`, repeat);
    for (const [kind, w] of Object.entries(lesson.mix ?? {})) {
      const expected = Math.round(10 * w / total);
      const got = round.filter(q => q.kind === kind).length;
      check(Math.abs(got - expected) <= 1, `${lesson.id}: expected about ${expected} × ${kind}, got ${got}`);
    }
  }
}

// the requirement in one assertion: the first lesson is a mix, not ten copies of "which codon starts?"
{
  const round = geneticGen.buildRound(GENETIC_UNITS[0].lessons[0], 10);
  const count = list => round.filter(q => list.includes(q.kind)).length;
  const definitions = count(["start"]);
  check(definitions >= 1 && definitions <= 2, `the start lesson should ask the definition 1-2 times, got ${definitions}`);
  check(count(["scan", "dnatrap"]) >= 3, `the start lesson should scan sequences at least 3 times, got ${count(["scan", "dnatrap"])}`);
  check(count(["mini", "shift"]) >= 3, `the start lesson should translate at least 3 times, got ${count(["mini", "shift"])}`);
  check(new Set(round.map(q => q.kind)).size >= 4, "a round of ten must use at least four formats");
}

const summary = `${failures.length ? "FAIL" : "PASS"}: ${checks} checks, ${kinds.size} question kinds (${[...kinds].sort().join(", ")})`;
out.textContent = [summary, ...failures].join("\n");
document.title = failures.length ? "FAIL" : "PASS";
