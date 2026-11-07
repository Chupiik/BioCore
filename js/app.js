import * as store from "./store.js";
import { t, setLang, getLang, LANGS, nameOf } from "./i18n.js";
import {
  AMINO_UNITS, GENETIC_UNITS, BASES, CHEM, CODONS, GENETIC_CODE, START_CODON,
  codonsOf, createGenerator, prettyFormula, translate,
} from "./questions.js";
import { drawStructure } from "./structure.js";

const app = document.getElementById("app");
const XP_CORRECT = 10;
const XP_RETRY = 4;
const ROUND_SIZE = 10;
const NODE_OFFSETS = [0, 36, 60, 36, 0, -36, -60, -36];

let aas = [];
let byOne = {};             // one-letter code -> amino acid record (filled by init)
let view = "home";          // home | lesson | result | wheel | translate
let session = null;
let ui = null;              // handlers of the question on screen (used by the keyboard)

// --- tiny DOM helper -------------------------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const ICONS = {
  flame: '<path fill="currentColor" d="M12 2c.8 3.2-1 4.8-2.4 6.6C8.2 10.4 8 12.3 9.4 14c-1.5-.3-2.6-1.6-2.7-3.2C4.9 12.6 4 14.7 5 17.4A7 7 0 0 0 19 16c0-3.6-2.6-5.6-3.8-7.8-.9 1-1.3 1.5-1.9 2.1.4-3-.5-5.6-1.3-8.3z"/>',
  bolt: '<path fill="currentColor" d="M13 2 4.5 13.5H11L10 22l9-12h-6.5z"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>',
  lock: '<path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z"/>',
  star: '<path fill="currentColor" d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.4 6.7-6.1-3.4-6.1 3.4 1.4-6.7-5-4.7 6.8-.8z"/>',
  sun: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 4V2m0 20v-2M4 12H2m20 0h-2M6 6 4.6 4.6M19.4 19.4 18 18M6 18l-1.4 1.4M19.4 4.6 18 6"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  moon: '<path fill="currentColor" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  back: '<path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M15 4.5 7.5 12l7.5 7.5"/>',
  wheel: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="4.5" r="2.2" fill="currentColor"/><circle cx="19.5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="19.5" r="2.2" fill="currentColor"/><circle cx="4.5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  dna: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 3c0 6 8 6 8 12s-8 6-8 6M16 3c0 6-8 6-8 12s8 6 8 6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9.3 7.5h5.4M9.3 12h5.4M9.3 16.5h5.4"/>',
};
function icon(name, size = 18) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

// --- helpers ---------------------------------------------------------------------------------------
const makeGen = () => createGenerator({
  aas,
  progress: { strength: l => store.strength(l), due: l => store.isDue(l) },
});
const tileOrder = () => [...aas].sort((a, b) => CHEM.indexOf(a.imgt_chemical) - CHEM.indexOf(b.imgt_chemical) || a.one.localeCompare(b.one));

// --- modules -----------------------------------------------------------------------------------------
const activeModule = () => store.getModule();
const isGenetic = () => activeModule() === "genetic";
const unitsOf = () => (isGenetic() ? GENETIC_UNITS : AMINO_UNITS);

function switchModule(id) {
  if (activeModule() === id) return;
  store.setModule(id);
  session = null; ui = null; view = "home";
  render();
}

const unlocked = (unit, i) => i === 0 || store.lessonDone(unit.lessons[i - 1].id);
function nextLesson() {
  const units = unitsOf();
  for (const unit of units) for (let i = 0; i < unit.lessons.length; i++)
    if (!store.lessonDone(unit.lessons[i].id) && unlocked(unit, i)) return unit.lessons[i];
  return units[0].lessons[0];
}

// Spaced repetition keys: the one-letter amino acid code, or the three-letter codon in the other module.
function reviewPool() {
  if (isGenetic()) {
    const due = CODONS.filter(c => store.isDue(c));
    const pool = due.slice();
    if (pool.length < 4) {
      const weakest = CODONS.filter(c => store.seen(c) && !pool.includes(c))
        .sort((a, b) => store.strength(a) - store.strength(b));
      pool.push(...weakest.slice(0, 4 - pool.length));
    }
    return { pool, due: due.length, any: CODONS.some(c => store.seen(c)) };
  }
  const due = aas.filter(a => store.isDue(a.one));
  const pool = due.slice();
  if (pool.length < 4) {
    const weakest = aas.filter(a => store.seen(a.one) && !pool.includes(a))
      .sort((a, b) => store.strength(a.one) - store.strength(b.one));
    pool.push(...weakest.slice(0, 4 - pool.length));
  }
  return { pool, due: due.length, any: aas.some(a => store.seen(a.one)) };
}
const pips = s => h("span", { class: "pips" }, [1, 2, 3, 4, 5].map(i => h("i", { class: i <= s ? "on" : "" })));

function applyTheme() { document.documentElement.dataset.theme = store.get().theme; }

// --- shared pieces -----------------------------------------------------------------------------------
function chip(iconName, value, text) {
  return h("span", { class: `chip ${iconName}` }, icon(iconName, 16), h("b", {}, String(value)), text ? h("span", { class: "muted" }, text) : null);
}

function langSwitch() {
  return h("div", { class: "seg", role: "group", "aria-label": "Language" },
    LANGS.map(l => h("button", {
      class: l === getLang() ? "on" : "", onclick: () => { setLang(l); store.set("lang", l); render(); },
    }, l === "cs" ? "CZ" : l.toUpperCase())));
}

function themeButton() {
  return h("button", {
    class: "icon-btn", "aria-label": "Theme",
    onclick: () => { store.set("theme", store.get().theme === "dark" ? "light" : "dark"); applyTheme(); render(); },
  }, icon(store.get().theme === "dark" ? "sun" : "moon", 20));
}

function moduleSwitch() {
  return h("div", { class: "seg mods", role: "tablist", "aria-label": t("modules") },
    [["amino", "mod_amino"], ["genetic", "mod_genetic"]].map(([id, key]) => h("button", {
      class: activeModule() === id ? "on" : "", role: "tab", "aria-selected": activeModule() === id ? "true" : "false",
      onclick: () => switchModule(id),
    }, t(key))));
}

function header() {
  return h("header", { class: "top" },
    h("div", { class: "brand" }, h("span", { class: "logo" }, "B"), h("div", {}, h("b", {}, "BioCore"), h("span", { class: "muted" }, t("tagline")))),
    h("div", { class: "chips" },
      chip("flame", store.currentStreak(), t("days")), chip("bolt", store.get().xp, t("xp")),
      h("span", { class: "chip" }, `${t("level")} ${store.level()}`)),
    h("div", { class: "tools" }, moduleSwitch(), langSwitch(), themeButton()));
}

function backHome() { view = "home"; render(); }

// header for the standalone tool views (codon wheel, translate & mutate)
function toolHeader(titleKey, subtitleKey) {
  return h("header", { class: "top" },
    h("div", { class: "toolbar" },
      h("button", { class: "icon-btn", "aria-label": t("back"), onclick: backHome }, icon("back", 20)),
      h("div", {}, h("b", {}, t(titleKey)), h("span", { class: "muted" }, t(subtitleKey)))),
    h("div", { class: "tools" }, langSwitch(), themeButton()));
}

// --- home ----------------------------------------------------------------------------------------------
function goalCard() {
  const goal = store.get().goal, today = store.todayXp();
  const frac = Math.min(1, today / goal), C = 2 * Math.PI * 34;
  const ring = h("div", { class: "ring" });
  ring.innerHTML = `<svg viewBox="0 0 80 80" width="84" height="84"><circle cx="40" cy="40" r="34" class="track"/>
    <circle cx="40" cy="40" r="34" class="fill" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 40 40)"/></svg>`;
  ring.append(h("b", {}, `${Math.min(today, goal)}`));
  const { pool, due, any } = reviewPool();
  const lesson = nextLesson();
  return h("section", { class: "card goal" },
    ring,
    h("div", { class: "goal-text" },
      h("h2", {}, today >= goal ? t("goalDone") : t("goal")),
      h("p", { class: "muted" }, `${today} / ${goal} ${t("xp")}`)),
    h("div", { class: "goal-actions" },
      h("button", { class: "btn primary", onclick: () => startSession(lesson) }, `${t("cont")} · ${t(lesson.title)}`),
      h("button", { class: "btn", disabled: !any, onclick: () => startSession({ id: "review", title: "review", plan: isGenetic() ? "codonreview" : "review", pool }) },
        any ? (due ? `${t("review")} · ${due}` : t("review")) : t("reviewNone"))));
}

function collection() {
  const tiles = tileOrder().map(a => {
    const s = store.strength(a.one);
    return h("button", {
      class: `tile${s === 0 ? " dim" : ""}`, style: `--c: var(--c-${a.imgt_chemical})`, onclick: () => openCard(a),
      "aria-label": `${nameOf(a)} (${a.three}, ${a.one})`,
    }, store.isDue(a.one) ? h("i", { class: "due" }) : null, h("span", { class: "tl-one" }, a.one), h("span", { class: "tl-three" }, a.three), pips(s));
  });
  const legend = CHEM.map(c => h("span", { class: "key", style: `--c: var(--c-${c})` }, h("i"), t("chem_" + c)));
  return h("section", { class: "block" },
    h("h2", {}, t("collection")), h("p", { class: "muted" }, t("collectionHint")),
    h("div", { class: "tiles" }, tiles), h("div", { class: "legend" }, legend));
}

function lessonNode(unit, lesson, i) {
  const open = unlocked(unit, i), done = store.lessonDone(lesson.id), stars = store.lessonStars(lesson.id);
  const isNext = !done && open && nextLesson().id === lesson.id;
  return h("button", {
    class: `node ${done ? "done" : open ? "open" : "locked"}${isNext ? " next" : ""}`, style: `--off:${NODE_OFFSETS[i % NODE_OFFSETS.length]}px`,
    disabled: !open, title: open ? t(lesson.title) : t("locked"), onclick: () => startSession(lesson),
  }, h("span", { class: "circle" }, done ? icon("check", 26) : open ? String(i + 1) : icon("lock", 22)),
  h("span", { class: "nlabel" }, t(lesson.title)),
  done ? h("span", { class: "stars" }, [1, 2, 3].map(n => h("span", { class: n <= stars ? "on" : "" }, icon("star", 13)))) : null);
}

function path() {
  return h("section", { class: "block" }, h("h2", {}, t("path")),
    unitsOf().map((unit, n) => {
      const doneCount = unit.lessons.filter(l => store.lessonDone(l.id)).length;
      return h("div", { class: "unit" },
        h("div", { class: "unit-head" }, h("span", { class: "unit-n" }, String(n + 1)),
          h("div", {}, h("b", {}, t(unit.id)), h("p", { class: "muted" }, t(unit.id + "d"))),
          h("span", { class: "unit-count" }, `${doneCount}/${unit.lessons.length}`)),
        h("div", { class: "nodes" }, unit.lessons.map((l, i) => lessonNode(unit, l, i))));
    }));
}

// entry points to the interactive tools of the genetic code module
function toolsBlock() {
  const card = (iconName, titleKey, descKey, onClick) => h("button", { class: "toolcard", onclick: onClick },
    h("span", { class: "toolcard-icon" }, icon(iconName, 22)),
    h("div", {}, h("b", {}, t(titleKey)), h("span", { class: "muted" }, t(descKey))));
  return h("section", { class: "block" }, h("h2", {}, t("tools")),
    h("div", { class: "toolcards" },
      card("wheel", "tool_wheel", "tool_wheel_d", openWheel),
      card("dna", "tool_translate", "tool_translate_d", openTranslate)));
}

function renderHome() {
  window.scrollTo(0, 0);
  app.replaceChildren(h("div", { class: "page" }, header(), goalCard(),
    isGenetic() ? toolsBlock() : collection(), path(),
    h("footer", { class: "foot" }, h("p", { class: "muted" }, t(isGenetic() ? "sourcesGenetic" : "sources")),
      h("button", { class: "link", onclick: () => { if (confirm(t("resetConfirm"))) { store.reset(); render(); } } }, t("reset")))));
}

// --- amino acid card ---------------------------------------------------------------------------------------
function openCard(a) {
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onEsc); };
  const onEsc = e => { if (e.key === "Escape") close(); };
  const row = (k, v) => h("div", { class: "kv" }, h("span", { class: "muted" }, t(k)), h("b", {}, v));
  const pka = a.side_chain_pka;
  const host = h("div", { class: "structure-host" });
  const others = ["en", "cs", "sk"].filter(l => l !== getLang()).map(l => (l === "en" ? a.name : l === "cs" ? a.name_cs : a.name_sk));
  const overlay = h("div", { class: "overlay", onclick: e => { if (e.target === overlay) close(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true", style: `--c: var(--c-${a.imgt_chemical})` },
      h("button", { class: "icon-btn close", "aria-label": t("close"), onclick: close }, icon("x", 20)),
      h("div", { class: "sheet-head" }, h("span", { class: "badge" }, a.one),
        h("div", {}, h("h2", {}, nameOf(a)), h("p", { class: "muted" }, `${a.three} · ${others.join(" · ")}`))),
      host,
      h("div", { class: "kvs" },
        row("cardFormula", prettyFormula(a.formula)), row("cardMass", `${a.mass.toFixed(2)} g/mol`),
        row("cardKd", String(a.kyte_doolittle).replace("-", "−")), row("cardChem", t("chem_" + a.imgt_chemical)),
        row("cardHydro", t("hydro_" + a.imgt_hydropathy)), row("cardCharge", t("charge_" + a.imgt_charge)),
        row("cardPka", pka ? String(pka.value) : t("cardNone")), row("cardNutrition", t("nutrition_" + a.nutrition))),
      h("div", { class: "kv" }, h("span", { class: "muted" }, t("cardStrength")), pips(store.strength(a.one))),
      h("a", { class: "pubchem", href: `https://pubchem.ncbi.nlm.nih.gov/compound/${a.pubchem_cid}`, target: "_blank", rel: "noopener" }, "PubChem CID " + a.pubchem_cid)));
  document.addEventListener("keydown", onEsc);
  document.body.append(overlay);
  drawStructure(host, a.smiles);
}

// --- lesson ----------------------------------------------------------------------------------------------------
function startSession(lesson) {
  const questions = makeGen().buildRound(lesson, ROUND_SIZE);
  session = { lesson, queue: questions, total: questions.length, done: 0, firstTotal: 0, firstCorrect: 0, xp: 0 };
  view = "lesson";
  render();
}

function quit() {
  if (!confirm(t("quitConfirm"))) return;
  session = null; ui = null; view = "home"; render();
}

function recordResult(q, correct, wrongIds = new Set()) {
  // q.keys are the spaced-repetition keys: one-letter codes for amino acids, codons in the genetic module
  const keys = q.keys ?? q.aas;
  if (!q.retry) {
    session.firstTotal += 1;
    if (correct) session.firstCorrect += 1;
    if (q.type === "match") keys.forEach(id => store.recordAnswer([id], !wrongIds.has(id)));
    else store.recordAnswer(keys, correct);
  }
  if (correct) {
    const gain = q.retry ? XP_RETRY : XP_CORRECT;
    session.xp += gain;
    store.addXp(gain);
  }
}

function renderLesson() {
  window.scrollTo(0, 0);
  const q = session.queue[0];
  const state = { selected: null, locked: false, mode: "check" };
  const footer = h("footer", { class: "lfoot" });
  const checkBtn = h("button", { class: "btn primary big", disabled: true, onclick: () => submit() }, t("check"));
  footer.append(checkBtn);
  let body, options = [], input = null;

  function showFeedback(correct) {
    state.locked = true; state.mode = "feedback";
    footer.className = "lfoot " + (correct ? "good" : "bad");
    // The explanation is the point of the exercise, so it is always shown — right or wrong — before
    // the user may continue. Multi-sentence texts wrap inside the footer (`.fb-text`, see style.css).
    footer.replaceChildren(
      h("div", { class: "fb", role: "status", "aria-live": "polite" },
        h("div", { class: "fb-title" }, icon(correct ? "check" : "x", 22), correct ? t("correct") : t("wrong")),
        !correct && q.correctLabel ? h("div", { class: "fb-answer" }, t("answerIs", { a: q.correctLabel })) : null,
        q.explain
          ? h("div", { class: "fb-explain" },
            h("b", { class: "fb-why" }, t("why")),
            h("span", { class: "fb-text" }, q.explain))
          : null),
      h("button", { class: `btn big ${correct ? "primary" : "danger"}`, onclick: advance }, t("next")));
    const next = footer.querySelector("button");
    if (next) next.focus();
  }

  function advance() {
    session.queue.shift();
    if (q.__correct) session.done += 1;
    else session.queue.push({ ...q, retry: true, __correct: undefined });
    if (!session.queue.length) return finishLesson();
    render();
  }

  function submit() {
    if (state.locked) return;
    let correct;
    if (q.type === "choice") {
      correct = q.isCorrect(state.selected);
      options.forEach(b => {
        if (b.dataset.id === state.selected) b.classList.add(correct ? "good" : "bad");
        else if (!correct && q.isCorrect(b.dataset.id)) b.classList.add("good");
        b.disabled = true;
      });
    } else {
      correct = q.isCorrect(input.value);
      input.classList.add(correct ? "good" : "bad");
      input.disabled = true;
    }
    q.__correct = correct;
    recordResult(q, correct);
    showFeedback(correct);
  }

  const heading = h("div", { class: "q-head" },
    h("p", { class: "q-prompt" }, q.prompt),
    q.big ? h("div", { class: `q-big ${q.bigStyle ?? "word"}` }, q.big) : null);
  const structureHost = q.smiles ? h("div", { class: "structure-host q-structure" }) : null;

  if (q.type === "choice") {
    options = q.options.map((o, i) => h("button", {
      class: `opt ${q.optStyle ?? "word"}`, "data-id": o.id,
      onclick: () => {
        if (state.locked) return;
        state.selected = o.id;
        options.forEach(b => b.classList.toggle("sel", b === options[i]));
        checkBtn.disabled = false;
      },
    }, h("span", { class: "key-hint" }, String(i + 1)), o.label));
    body = h("div", { class: `opts n${options.length}${q.wide ? " wide" : ""}` }, options);
  } else if (q.type === "type") {
    // one-letter answers: press a key and it is checked at once (the pad is for touch screens)
    input = h("input", {
      type: "text", class: q.single ? "answer single" : "answer", placeholder: q.single ? "?" : t("typeHere"),
      autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false",
      maxlength: q.single ? "1" : null, inputmode: q.single ? "none" : null,
      oninput: () => {
        if (!q.single) { checkBtn.disabled = !input.value.trim(); return; }
        if (/^[A-Za-z]$/.test(input.value)) submit();
        else input.value = "";
      },
    });
    const pad = q.single ? h("div", { class: "pad" }, [...aas].sort((a, b) => a.one.localeCompare(b.one)).map(a =>
      h("button", { class: "padkey", onclick: () => { if (!state.locked) { input.value = a.one; submit(); } } }, a.one))) : null;
    body = h("div", { class: "typebox" }, input, pad);
    if (q.single) footer.replaceChildren(h("span", { class: "muted hint" }, t("pressKey")));
  } else {
    body = buildMatch();
    footer.replaceChildren();               // a match round has no Check button; it ends when all pairs are joined
  }

  function buildMatch() {
    const wrong = new Set(), matched = new Set();
    let left = null;
    const rights = [...q.pairs].sort(() => Math.random() - 0.5);
    const mk = (side, pair) => h("button", { class: "opt match", "data-id": pair.id, onclick: e => click(side, pair, e.currentTarget) }, side === "l" ? pair.left : pair.right);
    const lefts = q.pairs.map(p => mk("l", p)), rbtn = rights.map(p => mk("r", p));
    function click(side, pair, el) {
      if (state.locked || matched.has(pair.id)) return;
      if (side === "l") {
        lefts.forEach(b => b.classList.remove("sel"));
        left = pair; el.classList.add("sel");
        return;
      }
      if (!left) return;
      if (left.id === pair.id) {
        matched.add(pair.id);
        [...lefts, ...rbtn].filter(b => b.dataset.id === pair.id).forEach(b => { b.classList.remove("sel"); b.classList.add("good"); b.disabled = true; });
        left = null;
        if (matched.size === q.pairs.length) {
          q.__correct = wrong.size === 0;
          recordResult(q, q.__correct, wrong);
          showFeedback(q.__correct);
        }
      } else {
        wrong.add(left.id);
        el.classList.add("bad");
        setTimeout(() => el.classList.remove("bad"), 450);
      }
    }
    return h("div", { class: "matchgrid" }, h("div", {}, lefts), h("div", {}, rbtn));
  }

  const screen = h("div", { class: "lesson" },
    h("div", { class: "ltop" },
      h("button", { class: "icon-btn", "aria-label": t("quit"), onclick: quit }, icon("x", 22)),
      h("div", { class: "bar" }, h("i", { style: `width:${100 * session.done / session.total}%` }))),
    h("main", { class: "lmain" }, heading, structureHost, body),
    footer);
  app.replaceChildren(screen);
  if (structureHost) drawStructure(structureHost, q.smiles);
  if (input) input.focus();

  ui = {
    enter() {
      if (state.mode === "feedback") advance();
      else if (!checkBtn.disabled && q.type !== "match") submit();
    },
    digit(n) {
      if (q.type === "choice" && !state.locked && options[n - 1]) options[n - 1].click();
    },
  };
}

function finishLesson() {
  const accuracy = session.firstTotal ? session.firstCorrect / session.firstTotal : 1;
  const stars = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1;
  const bonus = 20 + (accuracy === 1 ? 10 : 0);
  store.addXp(bonus);
  session.xp += bonus;
  if (!["review", "codonreview"].includes(session.lesson.plan)) store.completeLesson(session.lesson.id, stars);
  session.result = { accuracy, stars };
  view = "result";
  ui = null;
  render();
}

function renderResult() {
  window.scrollTo(0, 0);
  const { accuracy, stars } = session.result;
  const lesson = session.lesson;
  app.replaceChildren(h("div", { class: "result" },
    h("div", { class: "trophy" }, [1, 2, 3].map(n => h("span", { class: n <= stars ? "on" : "" }, icon("star", 54)))),
    h("h1", {}, t("complete")),
    h("div", { class: "result-stats" },
      h("div", {}, h("b", {}, `${Math.round(accuracy * 100)}%`), h("span", { class: "muted" }, t("accuracy"))),
      h("div", {}, h("b", {}, `+${session.xp}`), h("span", { class: "muted" }, t("xpEarned"))),
      h("div", {}, h("b", {}, String(store.currentStreak())), h("span", { class: "muted" }, t("days")))),
    h("div", { class: "result-actions" },
      h("button", { class: "btn primary big", onclick: () => { session = null; view = "home"; render(); } }, t("toPath")),
      h("button", { class: "btn big", onclick: () => startSession(lesson) }, t("again")))));
}

// --- genetic code: codon wheel ---------------------------------------------------------------------
const wheel = { bases: ["A", "U", "G"], aa: null };   // picked bases (1st, 2nd, 3rd) and an amino acid to list
const RING_RADII = [0.4, 0.3, 0.19];

function openWheel() { view = "wheel"; render(); }

function renderWheel() {
  const codon = wheel.bases.join("");
  const one = GENETIC_CODE[codon];
  const stop = one === "*";
  const name = stop ? t("aa_stop") : nameOf(byOne[one]);
  const picked = wheel.aa ? codonsOf(wheel.aa) : [];

  const ring = (radius, index) => [
    h("div", { class: "band", style: `width:calc(var(--u) * ${2 * radius + 0.13});height:calc(var(--u) * ${2 * radius + 0.13})` }),
    ...BASES.map((b, i) => h("button", {
      class: `base${wheel.bases[index] === b ? " on" : ""}`, style: `--i:${i};--r:${radius}`,
      "aria-label": `${t("codon")} ${index + 1}: ${b}`,
      onclick: () => { wheel.bases[index] = b; wheel.aa = null; render(); },
    }, b)),
  ];

  app.replaceChildren(h("div", { class: "page" },
    toolHeader("tool_wheel", "wheel_hint"),
    h("section", { class: "block" },
      h("div", { class: "readout" },
        h("span", { class: "rd-codon" }, codon),
        h("span", { class: "rd-arrow" }, "→"),
        h("div", { class: "rd-aa" },
          h("b", { class: stop ? "stop" : "" }, name),
          h("span", { class: "muted" }, stop ? "*" : one)),
        codon === START_CODON ? h("span", { class: "tag" }, t("wheel_start")) : null),
      h("div", { class: "wheel" },
        RING_RADII.flatMap((r, i) => ring(r, i)),
        h("div", { class: "wheel-center" }, h("b", { class: stop ? "stop" : "" }, stop ? "*" : one))),
      h("p", { class: "muted center" }, t("wheel_hint")),
      h("div", { class: "aapick" }, Object.keys(byOne).sort().map(o => h("button", {
        class: `aa-chip${wheel.aa === o ? " on" : ""}`, title: nameOf(byOne[o]),
        onclick: () => { wheel.aa = wheel.aa === o ? null : o; render(); },
      }, o))),
      wheel.aa ? h("div", { class: "codonlist" },
        h("p", { class: "muted" }, `${nameOf(byOne[wheel.aa])} · ${t("wheel_ncodons", { n: picked.length })}`),
        h("div", { class: "codonchips" }, picked.map(c => h("button", {
          class: `codonchip${codon === c ? " on" : ""}`,
          onclick: () => { wheel.bases = c.split(""); render(); },
        }, c)))) : h("p", { class: "muted center" }, t("wheel_pick")))));
}

// --- genetic code: translate & mutate (real TP53 mRNA from Ensembl) ---------------------------------
// ENST00000269305 = the main TP53 transcript (MANE Select). The Ensembl CDN sometimes answers without
// a CORS header, so the US mirror is tried as well before giving up. Ensembl returns DNA (T), we show mRNA (U).
const TP53_CDNA_URLS = [
  "https://rest.ensembl.org/sequence/id/ENST00000269305?type=cdna;content-type=text/plain",
  "https://useast.ensembl.org/sequence/id/ENST00000269305?type=cdna;content-type=text/plain",
];
const TR_WINDOW = 240;                 // nucleotides shown per reading frame
let transcript = null;                 // { status, seq, original, firstStart, orfLen, start, frame, win, deleted, lost }

async function fetchCdna() {
  let lastError;
  for (const url of TP53_CDNA_URLS) {
    try {
      const res = await fetch(url, { headers: { "Content-Type": "text/plain" } });
      if (!res.ok) throw new Error(String(res.status));
      const dna = (await res.text()).replace(/\s+/g, "").toUpperCase();
      if (!/^[ACGTU]+$/.test(dna)) throw new Error("unexpected sequence");
      return dna;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function openTranslate() {
  view = "translate";
  if (!transcript || transcript.status === "error") loadTranscript();
  else render();
}

async function loadTranscript() {
  transcript = { status: "loading" };
  if (view === "translate") render();
  try {
    const seq = (await fetchCdna()).replace(/T/g, "U");
    const firstStart = seq.indexOf(START_CODON);
    const orf = firstStart < 0 ? null : translate(seq.slice(firstStart));
    transcript = {
      status: "ready", seq, original: seq, firstStart,
      orfLen: orf && orf.stop != null ? orf.stop : null,    // AUG -> stop distance of the real ORF
      start: null, frame: null, win: 0, deleted: 0, lost: false,
    };
  } catch (e) {
    transcript = { status: "error" };
  }
  if (view === "translate") render();
}

// protein and absolute stop index of the ORF that starts at `start`
function orfAt(seq, start) {
  if (start == null) return null;
  const res = translate(seq.slice(start));
  return { protein: res.protein, stop: res.stop == null ? null : start + res.stop };
}

function lockFrame(index) {
  if (transcript.seq.slice(index, index + 3) !== START_CODON) return;
  transcript.start = index;
  transcript.frame = index % 3;
  transcript.win = Math.max(0, index - 30);
  transcript.lost = false;
  render();
}

function deleteNt(index) {
  const tr = transcript;
  if (tr.status !== "ready" || index < 0 || index >= tr.seq.length) return;
  tr.seq = tr.seq.slice(0, index) + tr.seq.slice(index + 1);
  tr.deleted += 1;
  if (tr.start != null) {
    if (index < tr.start) {
      tr.start -= 1;                                        // everything before the AUG shifts by one
      tr.frame = tr.start % 3;                              // ...so the AUG now sits in another reading frame
    }
    if (tr.seq.slice(tr.start, tr.start + 3) !== START_CODON) {
      tr.start = null; tr.frame = null; tr.lost = true;     // the start codon itself was hit
    } else {
      // a frameshift usually stops soon: move the window so the new premature stop is visible
      const orf = orfAt(tr.seq, tr.start);
      if (orf && orf.stop != null && tr.orfLen != null && (orf.stop - tr.start) < tr.orfLen)
        tr.win = Math.max(0, Math.min(Math.max(0, tr.seq.length - TR_WINDOW), orf.stop - Math.round(TR_WINDOW * .6)));
    }
  }
  render();
}

function resetTranscript() {
  const tr = transcript;
  tr.seq = tr.original; tr.deleted = 0;
  tr.start = null; tr.frame = null; tr.win = 0; tr.lost = false;
  render();
}

// one tier of the 3-frame visualizer: codons of frame `f` inside the visible window
function tier(tr, f, orf, premature) {
  const locked = tr.frame === f;
  const end = Math.min(tr.seq.length, tr.win + TR_WINDOW);
  const first = tr.win + ((((f - tr.win) % 3) + 3) % 3);     // first codon of this frame inside the window
  const cells = [];
  // `i` must be declared in the loop head: every codon captures its own value for the click handlers
  for (let i = first; i + 3 <= end; i += 3) {
    const codon = tr.seq.slice(i, i + 3);
    const one = GENETIC_CODE[codon];
    const start = codon === START_CODON;
    const stop = one === "*";
    const pre = locked && orf && orf.stop === i && (i - tr.start) < tr.orfLen;
    cells.push(h("span", { class: `codon${start ? " start" : ""}${stop ? " stop" : ""}${pre ? " premature" : ""}` },
      h("span", { class: "nts" }, [0, 1, 2].map(j => h("button", {
        class: "nt", title: start ? t("tr_lock") : t("tr_hint"),
        onclick: () => (start ? lockFrame(i) : deleteNt(i + j)),
      }, tr.seq[i + j]))),
      h("span", { class: "aa" }, stop ? "*" : one)));
    if (pre) cells.push(h("span", { class: "prem-tag" }, t("tr_premature")));
  }
  return h("div", { class: `tier${locked ? " on" : ""}` },
    h("div", { class: "tier-head" },
      h("b", {}, t("tr_frame", { n: f + 1 })),
      locked ? h("span", { class: "state" }, icon("lock", 13), t("tr_locked")) : null),
    h("div", { class: "seq-row" }, cells.length ? cells : h("span", { class: "muted" }, "…")));
}

function renderTranslate() {
  const tr = transcript;
  if (!tr || tr.status === "loading")
    return app.replaceChildren(h("div", { class: "page" }, toolHeader("tool_translate", "tr_summary"),
      h("p", { class: "muted" }, t("tr_loading"))));
  if (tr.status === "error")
    return app.replaceChildren(h("div", { class: "page" }, toolHeader("tool_translate", "tr_summary"),
      h("section", { class: "block" }, h("p", {}, t("tr_error")),
        h("button", { class: "btn primary", onclick: loadTranscript }, t("tr_retry")))));

  const orf = orfAt(tr.seq, tr.start);
  const premature = Boolean(orf && orf.stop != null && tr.orfLen && (orf.stop - tr.start) < tr.orfLen);
  const maxWin = Math.max(0, tr.seq.length - TR_WINDOW);
  const shift = d => { tr.win = Math.min(maxWin, Math.max(0, tr.win + d)); render(); };

  const meta = h("div", { class: "chips" },
    h("span", { class: "chip" }, h("b", {}, String(tr.seq.length)), h("span", { class: "muted" }, "nt")),
    h("span", { class: "chip" }, h("b", {}, String(tr.deleted)), h("span", { class: "muted" }, t("tr_deleted"))),
    h("span", { class: "chip" }, tr.frame == null ? t("tr_unlocked") : t("tr_locked")),
    premature ? h("span", { class: "chip bad" }, t("tr_premature")) : null);

  const nav = h("div", { class: "tr-nav" },
    h("button", { class: "btn", disabled: tr.win <= 0, onclick: () => shift(-TR_WINDOW) }, `◀ ${t("tr_prev")}`),
    h("span", { class: "muted" }, t("tr_window", { from: tr.win + 1, to: Math.min(tr.seq.length, tr.win + TR_WINDOW), len: tr.seq.length })),
    h("button", { class: "btn", disabled: tr.win >= maxWin, onclick: () => shift(TR_WINDOW) }, `${t("tr_next")} ▶`));

  const actions = h("div", { class: "tr-actions" },
    h("button", { class: "btn", disabled: tr.deleted === 0, onclick: resetTranscript }, t("tr_reset")),
    tr.start != null
      ? h("button", { class: "btn", onclick: () => { tr.start = null; tr.frame = null; render(); } }, t("tr_unlock"))
      : h("button", { class: "btn", disabled: tr.firstStart < 0, onclick: () => lockFrame(tr.seq.indexOf(START_CODON)) }, t("tr_jump")));

  const protein = orf ? h("div", { class: "protein" },
    h("div", { class: "prot-head" }, h("b", {}, t("tr_aa")), h("span", { class: "muted" }, t("tr_len", { n: orf.protein.length }))),
    h("div", { class: "prot-seq" }, orf.protein)) : null;

  app.replaceChildren(h("div", { class: "page" },
    toolHeader("tool_translate", "tr_summary"),
    h("section", { class: "block" },
      meta,
      h("p", { class: "muted" }, tr.lost ? t("tr_lost") : t("tr_hint")),
      h("div", { class: "tiers" }, [0, 1, 2].map(f => tier(tr, f, orf, premature))),
      nav, actions, protein)));
}

// --- main -----------------------------------------------------------------------------------------------------
function render() {
  if (view === "lesson" && session) renderLesson();
  else if (view === "result" && session) renderResult();
  else if (view === "wheel") renderWheel();
  else if (view === "translate") renderTranslate();
  else renderHome();
}

function onKey(e) {
  if (view === "wheel" || view === "translate") { if (e.key === "Escape") backHome(); return; }
  if (view !== "lesson" || !ui || e.metaKey || e.ctrlKey) return;
  if (e.key === "Enter") { e.preventDefault(); ui.enter(); }
  else if (/^[1-9]$/.test(e.key) && e.target.tagName !== "INPUT") ui.digit(Number(e.key));
}

async function init() {
  store.load();
  setLang(store.get().lang);
  applyTheme();
  try {
    const res = await fetch("data/amino_acids.json");
    if (!res.ok) throw new Error(res.status);
    aas = await res.json();
    byOne = Object.fromEntries(aas.map(a => [a.one, a]));
  } catch (e) {
    app.textContent = t("dataError");
    return;
  }
  document.addEventListener("keydown", onKey);
  render();
}

init();
