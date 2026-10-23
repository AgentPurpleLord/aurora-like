/**
 * TECH TREE OUTLINE - <field name>
 *
 * Copy this file, rename it (for example `sensors-techs.ts`) and fill it in.
 * It is notes, not code: nothing here is compiled. See README.md for the full
 * list of effects, stats and ladders I can wire up.
 *
 * Block shape (one per tech; blank lines between blocks):
 *
 *   [id] Name
 *     field:    construction | power | sensors | defence | energy | missiles | biology | logistics
 *     cost:     research points
 *     requires: id, id    (or: none)
 *     effect:   set <stat> <value> ; add <stat> <value> ; unlock installation <id>
 *               engine { power/HS n, fuel/power n, cost/HS n, crew/HS n }
 *               ladder <name> <value>
 *               note: anything else you want it to do
 *     text:     what the player reads
 *     future:   yes     (only if it has no effect in the game yet)
 */

// =====================================================================
// SECTION: <name of this branch, e.g. "Reactors">
// =====================================================================

// [example-tech-1] Example Tech I
//   field: power
//   cost: 2500
//   requires: none
//   effect: set researchRate 250
//   text: Each laboratory generates 250 research points per year.

// [example-tech-2] Example Tech II
//   field: power
//   cost: 6000
//   requires: example-tech-1
//   effect: set researchRate 300
//   text: Each laboratory generates 300 research points per year.

// =====================================================================
// SECTION: <next branch>
// =====================================================================

// [your-id-here] Your Tech Name
//   field:
//   cost:
//   requires:
//   effect:
//   text:
