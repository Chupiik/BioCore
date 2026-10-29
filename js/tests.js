// Generates many rounds in every language and checks the invariants a quiz must have:
// exactly one correct option, no duplicate options, answers that match the data table.
import { UNITS, createGenerator } from "./questions.js";
import { setLang, LANGS } from "./i18n.js";

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
  check(q.aas.length > 0 && q.aas.every(l => aas.some(a => a.one === l)), "question refers to an unknown amino acid", q);

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
const unit1 = UNITS[0].lessons.flatMap(l => [...l.aas]).sort().join("");
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
const typed = Array.from({ length: 300 }, () => gen.buildRound(UNITS[0].lessons[0], 10)).flat().find(q => q.type === "type" && q.kind.endsWith(">name"));
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
    for (const unit of UNITS) for (const lesson of unit.lessons)
      generator.buildRound(lesson, 10).forEach(checkQuestion);
    const pool = aas.filter(() => Math.random() < 0.4).concat(aas.slice(0, 4));
    generator.buildRound({ id: "review", plan: "review", pool: [...new Set(pool)] }, 10).forEach(checkQuestion);
  }
}

const summary = `${failures.length ? "FAIL" : "PASS"}: ${checks} checks, ${kinds.size} question kinds (${[...kinds].sort().join(", ")})`;
out.textContent = [summary, ...failures].join("\n");
document.title = failures.length ? "FAIL" : "PASS";
