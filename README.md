# aurora-like

A prototype 4X strategy game in the spirit of Aurora 4X: the dawn of the
trans-Newtonian age, starting in Sol and expanding outward.

Two milestones are in: the **system map**, which models Sol to scale from real
orbital elements, and the **economy, research and officer corps** that turn it
into a game you can actually play forward.

![system map](docs/system-map.png)

## Running it

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build into dist/
npm run check     # model sanity checks (orbits, economy, people)
```

## The system map

A full model of Sol, to scale. 53 bodies: the Sun, eight planets, five dwarf
planets, 30 moons, the larger asteroids and two comets, plus ~1500 background
objects filling the main belt, both Jupiter Trojan camps and the classical
Kuiper belt.

Positions come from Keplerian elements, not from an artist's impression:

- Planetary elements are JPL's J2000 mean elements, converted from
  (mean longitude, longitude of perihelion) to (mean anomaly, argument of
  perihelion).
- Satellite elements are referred to their primary's equator and folded into
  the ecliptic frame, so the Uranian system really does orbit on its side and
  Triton really does run retrograde.
- Kepler's equation is solved with a bracketed Newton iteration, which holds
  up at Halley's eccentricity of 0.967 where plain Newton-Raphson diverges.

Distances are honest. There is no fudge factor: the map is a single continuous
zoom from 75 AU down to about 15,000 km, and bodies are drawn at their true
radius once they are larger than a few pixels. Moons sit at their real distance
from their primary, so the Jovian system opens up as you zoom into Jupiter
rather than being a separate screen.

Time runs at continuous rates from one minute per second up to thirty days per
second, plus discrete jumps (+5s through +30d) in the style of Aurora's turn
increments. The campaign opens on 1 January 2025.

## The economy

![economy](docs/economy.png)

Production runs in five-day cycles. Everything is quoted per year and scaled by
the length of the cycle, so a 5-day step and a 30-day jump give identical
results.

- **Mining.** Mines and automated mines extract every mineral present on a
  body at a rate set by each deposit's accessibility. Deposits deplete and run
  out; the Economy view shows how many years each has left at the current rate.
- **Industry.** Construction factories produce build points. The build queue
  draws build points and minerals together - a half-built factory has consumed
  half its minerals - and an order that cannot draw what it needs stalls and
  says so rather than quietly conjuring material.
- **Logistics.** Mass drivers throw minerals from the outer colonies to the
  capital. Anything built at one colony can be shipped to another on
  completion, and colonists move from the capital to colonies with spare
  infrastructure. Both stand in for freighters and colony ships, which need
  ship design; without them the expansion loop would be closed.
- **Population.** Growth is logistic against what the world can support: its
  surface area for a garden world, its infrastructure divided by colony cost
  everywhere else. Colony cost falls with terraforming and with genome
  research, so a world's ceiling is something you can raise.
- **Wealth.** Taxation scales with population; construction, research and
  installation upkeep draw it down. A treasury in deficit halves industrial
  output until it recovers.
- **Employment.** Manned installations need workers. A colony that builds more
  than its population can staff runs everything at a reduced rate.

## Research

![research](docs/research.png)

55 technologies across the eight Aurora research fields. A tech becomes
available once its prerequisites are researched, and its effects are
declarative - the empire's working figures are always recomputed from the set
of researched techs, so there is no incremental state to drift.

A project needs three things: a tech, a scientist, and laboratories on a
colony. A scientist can only direct as many labs as their administration rating
allows, so a brilliant researcher with poor administration is a specialist, not
a department head. Techs marked *future system* are real research targets whose
effects arrive with ship design, surveying and combat.

## People

![officers](docs/officers.png)

Scientists, administrators, naval officers and ground officers, each with a
name, an age, a service record, a rank and a set of skills. Officers enter
service over time (faster with military academies), are promoted on time in
rank nudged by their best skill, and retire from about 58 onward.

- **Scientists** lead research projects. Their research bonus multiplies the
  project's output and their administration rating caps its size.
- **Administrators** govern colonies, applying production, mining, wealth and
  population-growth bonuses to the world they are posted to.
- **Naval and ground officers** are tracked and promoted, but have nothing to
  command until ships and ground forces exist.

## Controls

| Input | Action |
| --- | --- |
| `M` `E` `R` `O` | System Map / Economy / Research / Officers |
| Drag | Pan the map |
| Scroll | Zoom at the cursor |
| Click | Select a body |
| Double-click | Zoom to a body, framing its satellite system |
| `Space` | Pause / resume |
| `1`-`7` | Time rate |
| `F` | Follow the selected body |
| `Esc` | Clear the selection |

The **View** buttons jump to preset framings (Earth, Inner, Belt, Jovian,
Saturnian, Outer, Kuiper); **Show** toggles orbits, labels, belt objects and
the AU grid.

## Layout

```
src/
  sim/        orbit.ts        Keplerian mechanics, the frame, and the solver
              clock.ts        simulation time, rates and the civil calendar
              system.ts       body tree, per-tick positions, derived figures
              minerals.ts     deposit generation
              rng.ts          seeded randomness
              economy/        installations and the production cycle
              research/       the eight fields and the technology tree
              people/         officer generation, promotion, retirement
  data/       bodies.ts       the Sol dataset: elements and physical data
  render/     camera.ts       pan/zoom over the ecliptic plane
              map.ts          canvas renderer
  state/      game.ts         the clock, the loop, the opening position
              empire.ts       colonies, officers, research, treasury, log
              colony.ts       a colony and its build queue
  ui/         app.ts          input, the frame loop, view switching
              views/          economy, research and officer views
              bodyTree.ts, detailPanel.ts, timeControls.ts, widgets.ts
tools/        sanity.ts       the checks behind `npm run check`
```

The simulation layer knows nothing about the DOM, and the data layer knows
nothing about the simulation.

## Verification

`npm run check` runs the model against published values and its own
invariants - among them:

- Earth sits 0.9833 AU from Sol at heliocentric longitude 100.4 degrees on
  1 January 2025; Luna stays between perigee and apogee; every orbit stays
  inside its own periapsis and apoapsis over a century of simulated time.
- Minerals are conserved: over a year with nothing queued, the sum of every
  deposit, every stockpile and every litre of refined fuel is unchanged to
  within a rounding error.
- Population is conserved across migration: over one cycle the total may only
  change by the natural growth of each colony.
- Installations built for another colony arrive there and do not stay behind.
- Over a 37-year campaign the officer corps turns over, nobody outlives 85,
  and every posting still points at a colony or project that exists.

## Not built yet

Ships, fleet movement and ship design; ground forces; sensors, surveying and
combat; jump points and other star systems; sector administration. Ordnance
factories, maintenance facilities, tracking stations and spaceports can be
built but do nothing yet, and mineral and colonist transport is handled by the
civilian-shipping stand-in described above rather than by freighters you build.
