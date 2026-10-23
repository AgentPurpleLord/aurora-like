/**Engine technology
 * Six engine families: Chemical Rockets | Electric Drives | Nuclear Thermal | Nuclear Electric | Fusion | Antimatter
 * 
 * Research points increase exponentially with each tier (doubling each time). 
 * The base research point cost for Tier 1 is stipulated below.
 * 
 * -- Chemical Rockets --
 * High thrust, poor fuel economy, low power-system requirements.
 * Baseline Density: 1.0
 * Fuel Efficiency: 1.0x
 * Tier 1: Solid Motor | 2000 RP
 * Tier 2: Pressure-fed Liquid
 * Tier 3: Pump-fed Liquid
 * Tier 4: Staged combustion
 * Tier 5: Full-flow staged combustion
 * 
 * -- Electric Drives --
 * Excellent fuel economy, low thrust, requires external power.
 * Baseline Density: 0.5
 * Fuel Efficiency: 3.0-10.0x
 * Tier 1: Resistojet | 2000 RP
 * Tier 2: Arcjet | 4000 RP
 * Tier 3: Hall Thruster | 8000 RP
 * Tier 4: Gridded Ion | 16000 RP
 * Tier 5: Advanced Plasma Drive | 32000 RP
 * 
 * -- Nuclear Thermal --
 * High thrust, better fuel economy, heavy reactor, requires shielding.
 * Baseline Density: 2.0
 * Fuel Efficiency: 1.8-3.0x
 * Tier 1: Solid Core Fission | 2000 RP
 * Tier 2: High Temperature Core | 4000 RP
 * Tier 3: Advanced Gas Core | 8000 RP
 * Tier 4: Liquid Core | 16000 RP
 * 
 * -- Nuclear Electric --
 * Moderate system power density, excellent fuel economy, requires shielding.
 * Baseline Density: 1.5
 * Fuel Efficiency: 5-15x
 * Tier 1: Fission Reactor | 2000 RP
 * Tier 2: Advanced Fission Reactor | 4000 RP
 * Tier 3: Megawatt Fission Reactor | 8000 RP
 * Tier 4: Advanced Electric Drive | 16000 RP
 * 
 * -- Fusion (Only unlocks after Nuclear Electric) --
 * High thrust, demanding heat and reactor engineering.
 * Baseline Density: 4.0
 * Fuel Efficiency: 10-30x 
 * Tier 1: Magnetic Confinement Fusion | 16000 RP
 * Tier 2: Inertial Confinement Fusion | 32000 RP
 * Tier 3: Fusion-Fission Hybrid | 64000 RP
 * Tier 4: Magnetic Target Fusion | 128000 RP
 * Tier 5: Direct Fusion Drive | 256000 RP
 * 
 * -- Antimatter (only unlocks after Fusion) --
 * Endgame technology, extereme energy density, difficult fuel production and storage.
 * Baseline Density: 8.0
 * fuel Efficiency: 20-50x
 * Tier 1: Antimatter Catalyst | 256000 RP
 * Tier 2: Antimatter Ignition | 512000 RP
 * Tier 3: Hybrid Antimatter Drive | 1024000 RP
 * Tier 4: Pure Antimatter Drive | 2048000 RP
 * 
 * 
 * == SECONDARY ENGINE BRANCHES ==
 * 
 * -- Engine Size --
 * Minimum size of 1 'hull space'
 * Maximum size of 400 'hull space'
 * Tier 1: 40 | 2000 RP
 * Tier 2: 60 | 4000 RP
 * Tier 3: 100 | 8000 RP
 * Tier 4: 160 | 16000 RP
 * Tier 5: 250 | 32000 RP
 * Tier 6: 400 | 64000 RP
 * 
 * -- Maximum Engine Power Modifier --
 * Tier 1: 1.25x | 2000 RP
 * Tier 2: 1.5x | 4000 RP
 * Tier 3: 1.75x | 8000 RP
 * Tier 4: 2.0x | 16000 RP
 * Tier 5: 2.5x | 32000 RP
 * Tier 6: 3.0x | 64000 RP
 * 
 * -- Miniaturization --
 * Tier 1: 0.4x | 1000 RP
 * Tier 2: 0.3x | 2000 RP
 * Tier 3: 0.25x | 4000 RP
 * Tier 4: 0.2x | 8000 RP
 * Tier 5: 0.15x | 16000 RP
 * Tier 6: 0.1x | 32000 RP
 * 
 * -- Fuel Efficiency --
 * Tier 1: 0.9x | 1000 RP
 * Tier 2: 0.8x | 2000 RP
 * Tier 3: 0.7x | 4000 RP
 * Tier 4: 0.6x | 8000 RP
 * Tier 5: 0.5x | 16000 RP
 * Tier 6: 0.4x | 32000 RP
 * Tier 7: 0.3x | 64000 RP
 * Tier 8: 0.25x | 128000 RP
 * Tier 9: 0.2x | 256000 RP
 * Tier 10: 0.15x | 512000 RP
 * Tier 11: 0.125x | 1024000 RP
 * Tier 12: 0.1x | 2048000 RP
 * 
 * */ 

/**
    * == Power system technology ==
    * Four power system families: Chemical | Nuclear | Fusion | Antimatter
    * They are unlocked sequentially, with the player stepping through each family in order.
    * 
    * Research points increase exponentially with each tier (doubling each time).
    * 
    * -- Chemical --
    * Tier 1: Solid Fuel Cell | 600 RP | Power Output: 2
    * Tier 2: Liquid Fuel Cell | 1200 RP | Power Output: 2.5
    * Tier 3: Advanced Fuel Cell | 2400 RP | Power Output: 3.2
    * Tier 4: High Efficiency Fuel Cell | 4800 RP | Power Output: 4.0
    * 
    * -- Nuclear --
    * Tier 1: Fission Reactor | 9600 RP | Power Output: 5
    * Tier 2: Advanced Fission Reactor | 19200 RP | Power Output: 6.4
    * Tier 3: Megawatt Fission Reactor | 38400 RP | Power Output: 8.0
    * Tier 4: Advanced Electric Drive | 76800 RP | Power Output: 12.8
    * 
    * -- Fusion --
    * Tier 1: Magnetic Confinement Fusion | 153600 RP | Power Output: 16
    * Tier 2: Inertial Confinement Fusion | 307200 RP | Power Output: 20
    * Tier 3: Fusion-Fission Hybrid | 614400 RP | Power Output: 25
    * Tier 4: Magnetic Target Fusion | 1228800 RP | Power Output: 32
    * 
    * -- Antimatter --
    * Tier 1: Antimatter Catalyst | 2457600 RP | Power Output: 40
    * 
* */