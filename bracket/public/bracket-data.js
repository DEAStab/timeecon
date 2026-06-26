/* =====================================================================
   Wayne Manor World Cup Bracket — bracket data + structure
   ---------------------------------------------------------------------
   The bracket is a binary tree: 32 teams -> 16 -> 8 -> 4 -> 2 -> champion.
   Team *positions* are fixed (index 0..31). A pick stores the winning
   team's id (its R32 starting index), so picks stay stable even if the
   Commissioner renames a team later.

   COMMISSIONER: you do NOT need to edit this file. Once the real draw is
   set, open the app, tap the crest (⚙ Commissioner) and type in the 32
   real teams. They save to the cloud and everyone sees them. The list
   below is just the default the app ships with.
   ===================================================================== */

/* Default 32 teams, in bracket order (top -> bottom of each half).
   teams[0] vs teams[1] is Round-of-32 match 1, teams[2] vs teams[3] is
   match 2, and so on. Matches 1-8 are the LEFT half of the bracket and
   matches 9-16 are the RIGHT half; the two halves meet in the Final. */
const DEFAULT_TEAMS = [
  // ---- LEFT HALF (Round-of-32 matches 1-8) ----
  { name: "Argentina",     flag: "🇦🇷" }, { name: "Saudi Arabia",   flag: "🇸🇦" }, // M1
  { name: "Germany",       flag: "🇩🇪" }, { name: "South Korea",    flag: "🇰🇷" }, // M2
  { name: "Brazil",        flag: "🇧🇷" }, { name: "Japan",          flag: "🇯🇵" }, // M3
  { name: "Netherlands",   flag: "🇳🇱" }, { name: "Morocco",        flag: "🇲🇦" }, // M4
  { name: "Mexico",        flag: "🇲🇽" }, { name: "Egypt",          flag: "🇪🇬" }, // M5
  { name: "Croatia",       flag: "🇭🇷" }, { name: "Ecuador",        flag: "🇪🇨" }, // M6
  { name: "Spain",         flag: "🇪🇸" }, { name: "Uruguay",        flag: "🇺🇾" }, // M7
  { name: "Belgium",       flag: "🇧🇪" }, { name: "Senegal",        flag: "🇸🇳" }, // M8
  // ---- RIGHT HALF (Round-of-32 matches 9-16) ----
  { name: "France",        flag: "🇫🇷" }, { name: "Norway",         flag: "🇳🇴" }, // M9
  { name: "England",       flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" }, { name: "Australia",      flag: "🇦🇺" }, // M10
  { name: "Portugal",      flag: "🇵🇹" }, { name: "Ghana",          flag: "🇬🇭" }, // M11
  { name: "USA",           flag: "🇺🇸" }, { name: "Bosnia & Herz.", flag: "🇧🇦" }, // M12
  { name: "Switzerland",   flag: "🇨🇭" }, { name: "Colombia",       flag: "🇨🇴" }, // M13
  { name: "Italy",         flag: "🇮🇹" }, { name: "Nigeria",        flag: "🇳🇬" }, // M14
  { name: "Canada",        flag: "🇨🇦" }, { name: "Ivory Coast",    flag: "🇨🇮" }, // M15
  { name: "Denmark",       flag: "🇩🇰" }, { name: "Serbia",         flag: "🇷🇸" }, // M16
];

/* Round definitions, broad -> narrow. */
const ROUNDS = [
  { id: "r32",   name: "Round of 32",   short: "R32",   matches: 16 },
  { id: "r16",   name: "Round of 16",   short: "R16",   matches: 8 },
  { id: "qf",    name: "Quarter-finals", short: "QF",   matches: 4 },
  { id: "sf",    name: "Semi-finals",   short: "SF",    matches: 2 },
  { id: "final", name: "Final",         short: "Final", matches: 1 },
];

/* Build the full match tree once. Each match knows where its two
   competitors come from: either a fixed team index (R32) or the winner
   of two earlier matches. `side` drives the two-sided layout. */
function buildMatches() {
  const matches = [];
  const byRound = {};

  ROUNDS.forEach((round, rIdx) => {
    byRound[round.id] = [];
    for (let i = 1; i <= round.matches; i++) {
      const id = `${round.id}-${i}`;
      let m;
      if (round.id === "r32") {
        m = {
          id, round: round.id, roundIdx: rIdx, idx: i,
          teamA: (i - 1) * 2,        // fixed team index
          teamB: (i - 1) * 2 + 1,
          feedA: null, feedB: null,
        };
      } else {
        const prev = ROUNDS[rIdx - 1].id;
        m = {
          id, round: round.id, roundIdx: rIdx, idx: i,
          teamA: null, teamB: null,
          feedA: `${prev}-${i * 2 - 1}`, // winner of these earlier matches
          feedB: `${prev}-${i * 2}`,
        };
      }
      // Which half of the bracket? Final sits in the center.
      if (round.id === "final") m.side = "final";
      else m.side = i <= round.matches / 2 ? "left" : "right";
      matches.push(m);
      byRound[round.id].push(m);
    }
  });

  return { matches, byRound, index: Object.fromEntries(matches.map(m => [m.id, m])) };
}

const TREE = buildMatches();
const FINAL_ID = "final-1";

/* Resolve the team currently occupying a slot of a match, given picks.
   Returns a team index (0..31) or null if undecided. */
function slotTeam(match, slot, picks) {
  if (match.round === "r32") return slot === "A" ? match.teamA : match.teamB;
  const feeder = slot === "A" ? match.feedA : match.feedB;
  const p = picks[feeder];
  return (p === 0 || p) ? p : null;
}

/* Remove any downstream picks that no longer make sense after an upstream
   change. One top-down pass is enough because rounds resolve in order. */
function sanitizePicks(picks) {
  const out = { ...picks };
  for (const round of ROUNDS) {
    if (round.id === "r32") continue;
    for (const m of TREE.byRound[round.id]) {
      const a = slotTeam(m, "A", out);
      const b = slotTeam(m, "B", out);
      const cur = out[m.id];
      const valid = (cur === a && a !== null) || (cur === b && b !== null);
      if ((cur === 0 || cur) && !valid) delete out[m.id];
    }
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_TEAMS, ROUNDS, TREE, FINAL_ID, slotTeam, sanitizePicks, buildMatches };
}
