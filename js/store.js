// Progress, XP and settings, kept in the browser's local storage (no account, no server).
const KEY = "biocore.aminoacids.v2";
const DAY = 86400000;
export const MAX_STRENGTH = 5;
// a learned amino acid (strength s) comes back for review after this many days
const REVIEW_AFTER_DAYS = [0, 1, 2, 4, 8, 16];
const XP_PER_LEVEL = 200;

const fresh = () => ({
  xp: 0, streak: 0, lastDay: null, dayXp: {}, goal: 50,
  lang: "en", theme: "dark",
  aa: {},        // one-letter code -> { s: strength 0-5, t: time last answered }
  lessons: {},   // lesson id -> { stars }
});

let state = fresh();

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === "object") state = { ...fresh(), ...saved };
  } catch (e) { /* storage unavailable or corrupt: start fresh */ }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* keep working without saving */ }
}

export const get = () => state;
export function set(key, value) { state[key] = value; save(); }

export function reset() {
  state = { ...fresh(), lang: state.lang, theme: state.theme };
  save();
}

// --- amino acid strength and spaced repetition ----------------------------------------------
export const strength = letter => state.aa[letter]?.s ?? 0;
export const seen = letter => Boolean(state.aa[letter]?.t);

export function isDue(letter) {
  const e = state.aa[letter];
  return Boolean(e?.t) && Date.now() - e.t >= REVIEW_AFTER_DAYS[e.s] * DAY;
}

export function recordAnswer(letters, correct) {
  for (const letter of new Set(letters)) {
    const s = strength(letter);
    state.aa[letter] = { s: correct ? Math.min(MAX_STRENGTH, s + 1) : Math.max(0, s - 1), t: Date.now() };
  }
  save();
}

// --- XP, level, streak ------------------------------------------------------------------------
export const level = () => 1 + Math.floor(state.xp / XP_PER_LEVEL);
export const levelProgress = () => (state.xp % XP_PER_LEVEL) / XP_PER_LEVEL;
export const todayXp = () => state.dayXp[dayKey()] ?? 0;

export function currentStreak() {
  const yesterday = dayKey(new Date(Date.now() - DAY));
  return state.lastDay === dayKey() || state.lastDay === yesterday ? state.streak : 0;
}

export function addXp(amount) {
  state.xp += amount;
  state.dayXp[dayKey()] = todayXp() + amount;
  const today = dayKey();
  if (state.lastDay !== today) {
    state.streak = currentStreak() + 1;
    state.lastDay = today;
  }
  save();
}

// --- lessons ----------------------------------------------------------------------------------
export const lessonDone = id => Boolean(state.lessons[id]);
export const lessonStars = id => state.lessons[id]?.stars ?? 0;
export function completeLesson(id, stars) {
  state.lessons[id] = { stars: Math.max(stars, lessonStars(id)) };
  save();
}
