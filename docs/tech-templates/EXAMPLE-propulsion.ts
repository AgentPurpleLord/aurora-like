/**
 * EXAMPLE ONLY - a few propulsion and power techs filled in to show the shape.
 * This is not a design proposal.
 */

// =====================================================================
// SECTION: Fusion engines
// =====================================================================

// [fusion-magnetic] Magnetic Confinement Fusion Drive
//   field: power
//   cost: 20000
//   requires: ne-adv-electric
//   effect: engine-family (see propusion-power-techs.ts)
//   text: Fusion thrust contained in magnetic bottles.

// [engine-power-150] Engine Power Modifier x1.5
//   field: power
//   cost: 6000
//   requires: engine-power-125
//   effect: ladder powerModifierCeiling 1.5
//   text: Raises the engine power modifier ceiling to 1.5.

// =====================================================================
// SECTION: Fuel and tankage
// =====================================================================

// [fuel-efficiency-2] Fuel Efficiency 0.8x
//   field: power
//   cost: 2000
//   requires: fuel-efficiency-1
//   effect: ladder fuelUse 0.8
//   text: Every engine burns 30% less fuel than the standard.

// [tank-efficiency-1] Fuel Tank Linings I
//   field: power
//   cost: 3500
//   requires: solid-motor
//   effect: ladder tankCapacity 1.25
//   text: Every fuel tank holds 25% more, on ships already built too.

// =====================================================================
// SECTION: Something the game cannot do yet
// =====================================================================

// [fusion-reactor-plant] Fusion Reactor Technology
//   field: power
//   cost: 15000
//   requires: pump-fed
//   effect: unlock installation fusion-reactor-plant ; note: each plant should raise colony industrial output by 10%
//   text: Compact fusion plant for colonies.
