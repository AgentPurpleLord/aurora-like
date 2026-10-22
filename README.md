# aurora-like

A prototype 4X strategy game in the spirit of Aurora 4X: the dawn of the
trans-Newtonian age, starting in Sol and expanding outward.

Six milestones are in: the **system map**, which models Sol to scale from real
orbital elements; the **economy, research and officer corps** that turn it into
a game you can play forward; the **command interface** built to answer Aurora's
oldest complaint - that the game shows you every number and tells you nothing;
the **automation ladder**, which stops the tenth colony being nine times the
work of the first; **ships**, which turn the research tree's engine branch into
something that flies; and **terraforming**, which turns a world's atmosphere
into something you can argue with. It runs on a phone.

A campaign opens on **Earth alone**. One colony, one surveyed world,
trans-Newtonian theory and nothing else: no Lunar base, no Martian outpost, no
engine, no ship. Everything beyond Earth has to be surveyed, settled and
supplied.

![the opening position](docs/start.png)

![empire dashboard](docs/dashboard.png)

## Running it

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build into dist/
npm run check     # model sanity checks (orbits, economy, people, planning)
```

`npm run ui` runs the browser checks against a running dev server, on a desktop
viewport and an emulated phone. Playwright is deliberately not a dependency of
the project, so install it first:

```sh
npm install --no-save playwright && npx playwright install chromium
npm run dev &
npm run ui
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

## The interface

Aurora's economy UI is criticised for four things, and each has an answer here.

**Navigation tax** - finding the right window, tab and dropdown for every
action. The **Empire dashboard** is the landing view: one sortable table
covering every colony's population, staffing, industry, mining, research and
wealth, so the state of the empire is one screen rather than one screen per
colony. Clicking a row drills into that colony.

**No synthesis** - the game never tells you what is wrong, so you go looking.
The **attention rail** is derived from state every time it renders: stalled
build queues, deposits within five years of exhaustion, idle laboratories,
projects whose scientist retired, colonies over their supported population,
treasury deficits. Each item states the problem in a line and carries the
action that fixes it - clicking takes you to exactly where it is resolved.
Items can be dismissed for two years; nothing is stored, so a resolved problem
simply stops being raised. It folds to a 44px counter strip, which is its
default on the map.

**No consequence preview** - you commit to a queue and find out years later.
Adding to a build queue now previews it first: total build points, completion
date, what is already queued ahead, and per mineral what it consumes against
what you hold - *"Duranium 12,000 t of 47.5k held, cover 24.4 yr -> 18.2 yr"*.
An order the colony cannot pay for is flagged before it is placed.

![commit-time preview](docs/preview.png)

**No empire-level view of scarcity** - the **mineral ledger** gives, for all
eleven minerals at once, the stockpile, what is mined, what is committed, the
net, how many years of cover that leaves, and how much is still in the ground
at colonies that can reach it. Running out of Duranium is now something you
see coming rather than discover.

At thirty days a second it is easy to skip five years, so the dashboard also
carries a **since you last looked** strip - population, treasury, technologies
and construction since your last visit - and the event log marks where you had
read up to.

## Terraforming

![a terraforming programme](docs/terraforming.png)

A body's atmosphere is a set of partial pressures, and **everything about the
environment is derived from it**: total pressure, what the air is made of,
whether it can be breathed, how warm the surface is, and what a colony there
costs. That is what makes terraforming a mechanic rather than a number ticking
down - you change the gases, and the consequences follow.

- **Temperature** comes from greenhouse warming, which saturates: the hundredth
  atmosphere of a gas does far less than the first. Observed temperatures are
  the anchor, so an untouched world reads exactly as it does in the almanac and
  only changes to its air move it.
- **Breathable** means oxygen between 0.1 and 0.3 atmospheres, total pressure
  under four, and nothing toxic above its safe level. Carbon dioxide, methane,
  ammonia and sulphur dioxide are poisons; nitrous oxide is the greenhouse gas
  you can actually live with, which is what makes it the terraformer's tool.
- **Gravity sets a ceiling.** A world only holds the air its gravity allows -
  four atmospheres per gravity - so the Moon cannot be given an Earth-like sky,
  though it can be given a breathable one.

A programme is a gas and a direction. The colony's processors add or remove it,
and the panel forecasts the consequence using the same arithmetic the
production cycle runs: *"Surface temperature reaches 253 K in 17.8 years"*.
The forecast and the simulation agree to within a degree.

Processors need people to run them, so the first thing a hostile world needs is
somewhere for them to live. Warming Mars with nitrous oxide and then raising
its oxygen to a breathable level is a project of decades, and it ends with a
colony cost of zero.

![a hostile atmosphere](docs/atmosphere.png)

Venus shows the other end of it: 92 atmospheres of carbon dioxide, poisonous
and 737 K. Stripping it is the work of millennia, and the interface says so
rather than pretending otherwise.

## Ships

![the class designer](docs/designer.png)

**Classes come from the designers above.** Every figure about a ship is
derived from its components, so nothing is stored twice and researching a
better fuel efficiency improves every ship already flying. At the start of a
campaign no engine has been researched, so nothing can be built; Nuclear
Thermal Engine Technology is the first thing that puts a hull in space.

Speed is engine power per hull space, as in Aurora: a 5,700-ton freighter on
two nuclear thermal engines makes 1,053 km/s and carries 100,000 tons.
Shipyards decide how large a hull a colony can lay down - 5,000 tons each -
and hulls are built through the same queue, preview and mineral accounting as
everything else.

![fleets and orders](docs/fleets.png)

**Fleets carry out orders.** Move, load and unload installations, minerals or
colonists, refuel, survey. Movement is integrated against simulated time every
frame rather than on the production cycle, so a fleet crosses the map smoothly,
burns fuel by the hour, and arrives when it actually arrives - chasing a body
that is itself in orbit. A fleet with dry tanks stops where it is and says so.

![a fleet under way](docs/fleet-map.png)

On the map a fleet is a chevron pointing along its course, with a dashed line
to its destination. Click to select it, right-click a body to send it there.

**Survey means something.** Only the worlds already settled start surveyed;
everywhere else, deposits are unknown until a ship with geological sensors has
been there. A governor will not propose mining ground nobody has looked at.

**Naval officers finally have commands.** A fleet commander's engineering
rating stretches its fuel.

**Civilian shipping can be switched off.** The stand-in that moves
installations and colonists without ships is now optional: turn it off from the
Empire view and finished installations are crated up where they were built,
waiting for a freighter you designed to come and collect them.

## Automation

![templates, rules and proposals](docs/automation.png)

Four rungs, each only as trustworthy as the one below it.

**Bulk actions.** Tick colonies on the dashboard and apply a development
package to all of them at once, with the total cost shown before you commit.

**Templates.** A named package - *Mining Outpost* is infrastructure, thirty
automated mines and two mass drivers - applied to any world in one action,
built at a colony that has industry and shipped to the one that does not.
Infrastructure is the item that cannot be a fixed number, because how much a
world needs depends on its colony cost, so a template item can ask for *enough
infrastructure for one million colonists* and be sized on apply. Items the
empire has not researched are dropped rather than silently queued. Any build
queue can be saved as a new template.

**Standing orders.** Rules that top a colony up without being asked: keep 25
automated mines here, or keep supported population 40% ahead of actual
population - the chore that otherwise needs doing by hand on every growing
colony. They are evaluated once per production cycle, count what is already
built *and* already queued, and only ever top up to the target, so a rule
cannot run away. Work they queue is badged `auto`.

**Governor proposals.** A governor with a policy does not act - they file a
proposal into the attention rail, carrying the exact order they would place:
*"Callisto: work the deposits. 380,146 tons remain in the ground and only 30
automated mines are working them. [Queue 10 Automated Mine at Earth]"*. One tap
accepts it, one dismisses it. Automation that queues things behind your back is
what players distrust; automation that drafts the order and waits is what they
use. A satisfied policy stops proposing.

![governor proposals in the rail](docs/proposals.png)

## On a phone

![mobile dashboard](docs/mobile-dashboard.png)
![attention sheet](docs/mobile-rail.png)

The same build, laid out for a 412px screen rather than a second cut-down app.

- View tabs move to a real bottom row - not a fixed footer, which disappears
  under the browser's own chrome the moment the URL bar collapses.
- The attention rail becomes a sheet, summoned from a floating counter and
  folded again as soon as you follow an item to its fix.
- Tables drop their least important columns instead of wrapping into mush; the
  colony list keeps name, population, industry and next completion.
- The clock and speed controls become one sticky, horizontally scrollable row.
- The map takes touch properly: one finger pans, two fingers pinch to zoom, and
  the system list stays as a strip because tapping a three-pixel moon is not
  selection.

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

![the research view](docs/research.png)

Research is organised around four questions, asked in order: *what is
happening, what can I start, what does it do, and what is stopping me?*

- **What is happening.** A summary strip (output, laboratories working,
  scientists free, technologies ready) and the projects under way sit at the
  top, so the state of research is visible without clicking anything. A
  project that has stalled says so on its card.
- **What can I start.** The default tab is **Ready now**: every technology
  whose prerequisites are done, grouped by field. You do not have to know the
  tree to find a next step.
- **What does it do.** Select a technology and the side panel says, in plain
  words, what it unlocks ("Ion Drive engines in the component designer"), what
  it improves ("Mine output becomes 12 t/year per mine"), and what it opens
  next. Techs whose effects belong to systems not built yet are marked
  *future* rather than pretending to do something.
- **What is stopping me.** A locked technology names the prerequisite to
  research first and links straight to it. If nothing is free to do the work,
  it says whether the missing thing is a scientist or a laboratory.

![a branch of the tree](docs/research-tree.png)

Each field is a board of columns by tier, so the shape of a branch is
visible. Selecting a technology outlines what it needs in amber and what it
opens in blue. Starting one is a single click: the panel proposes the best free
scientist (a specialist in the field first), the colony with the most free
laboratories, and as many labs as that scientist can direct, with a finishing
estimate. Everything can still be changed.

A scientist can direct only as many laboratories as their administration
rating allows, so a brilliant researcher with poor administration is a
specialist, not a department head - and the panel tells you when that is the
limit. On a phone the tiers stack and selecting a technology scrolls its
details into view.

## Ship design

![the component designer](docs/component-designer.png)

Ships are not picked from a catalogue. As in Aurora, **you design the
components, then assemble them into classes**.

**Component designer.** Choose a kind and its parameters, and every figure is
recomputed as you edit. An engine has a type (set by what you have researched),
a size, and a **power modifier**: push it above 1.0 for thrust at a steep fuel
premium (fuel per unit of power rises with the square of the modifier), or
below 1.0 to buy range. Fuel tanks, crew quarters, cargo holds, cryogenic
berths and survey sensors are designed by size; a survey sensor's size sets how
many days a survey takes. Names follow the parameters until you type your own.

Engine types, sensor types and the modifier ceiling come from the technology
tree, so researching Nuclear Pulse really does add a new engine to design.
A component already built into a class is **superseded, not rewritten**: save a
new one and mark the old one obsolete, so ships already flying are never
altered by an edit.

![the ship designer](docs/ship-designer.png)

**Ship designer.** Assemble a class from your saved components and watch the
derived figures: tonnage and hull spaces, speed, engine power, fuel, burn,
endurance, range, crew against berths, cargo, colonists, survey rate, build
cost and minerals, and the slipway it needs against the largest yard you have.
Common mistakes are caught as you make them - no engine, no fuel, too few
berths, a hull too big for any slipway - and the commonest, crew, has a
one-click fix. Classes can be duplicated, superseded, and built from the Fleets
view. *Add standard set* and *Add standard classes* give you a working Hauler,
Pioneer and Surveyor in one step.

Surveying is now a timed activity: it takes survey points, so a ship with a
bigger sensor finishes sooner, and a progress bar shows on the fleet.

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
| `E` `M` `C` `F` `D` `R` `O` | Empire / Map / Colonies / Fleets / Design / Research / Officers |
| Drag | Pan the map |
| Scroll | Zoom at the cursor |
| Click | Select a body |
| Double-click | Zoom to a body, framing its satellite system |
| `Space` | Pause / resume |
| `1`-`7` | Time rate |
| `G` | Follow the selected body |
| Right-click | Send the selected fleet to that body |
| `Esc` | Clear the selection |

The **View** buttons jump to preset framings (Earth, Inner, Belt, Jovian,
Saturnian, Outer, Kuiper); **Show** toggles orbits, labels, belt objects and
the AU grid.

## Layout

```
src/
  sim/        orbit.ts        Keplerian mechanics, the frame, and the solver
              issues.ts       derives the attention list from state
              clock.ts        simulation time, rates and the civil calendar
              system.ts       body tree, per-tick positions, derived figures
              minerals.ts     deposit generation
              rng.ts          seeded randomness
              economy/        installations, the production cycle, the ledger,
                              order previews, templates, standing orders
              governors.ts    policies, and the proposals they file
              research/graph.ts  tiers, unlocks and recommendations for the tree
              ships/          component designs, class design, fleets, movement
              research/       the eight fields and the technology tree
              people/         officer generation, promotion, retirement
  data/       bodies.ts       the Sol dataset: elements and physical data
  render/     camera.ts       pan/zoom over the ecliptic plane
              map.ts          canvas renderer
  state/      game.ts         the clock, the loop, the opening position
              empire.ts       colonies, officers, research, treasury, log
              colony.ts       a colony and its build queue
  ui/         app.ts          input, the frame loop, view switching
              triageRail.ts   the persistent attention rail
              views/          empire, colony, fleet, design, research, officer views
              bodyTree.ts, detailPanel.ts, timeControls.ts, widgets.ts
tools/        sanity.ts       the checks behind `npm run check`
              ui-test.mjs     the browser checks behind `npm run ui`
              bench.ts        the scale benchmark behind `npm run bench`
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
- The ledger's totals agree with the colonies they are summed from, order
  previews cost and schedule correctly against what is already queued, and
  every attention item points at something that exists.
- Attention items appear and disappear with the condition that caused them: a
  stalled queue is reported at critical severity, idle industry stops being
  reported once work is queued, and a dismissal lapses on schedule.
- Templates size infrastructure to the target world and drop what is not
  researched; standing orders deliver their target and then stop, counting what
  is already on its way; a governor proposes only with a policy and a governor,
  and stops once the policy is satisfied.
- Component designs: engine power is size x type x modifier, fuel per
  power-hour falls with the square of the modifier, an overdriven modifier is
  clamped until its technology is researched, parameters carry no float noise,
  a component built into a class refuses to be rewritten, and standard classes
  use standard parts even after custom ones exist.
- Surveying takes the time its sensor size says (a 4 HS sensor: five days),
  not an instant.
- A class's tonnage, speed, capacity and crew match the components it is made
  of; a hull larger than the slipways never starts; fuel burn matches the
  design's hourly rate; cargo and colonists are carried, not created; a dry
  tank strands a fleet where it stands.
- The campaign starts with one colony, one surveyed world and one technology.
- Atmospheres read correctly through the gas model: Earth is one bar and
  breathable, Mars is not, Venus is poisonous as well as hot. A gas with no
  greenhouse effect does not warm a world and warming saturates rather than
  running away. Ten years of terraforming adds exactly ten years of gas,
  removal stops at nothing, a world stops filling at the ceiling its gravity
  allows - and a world reaches the temperature the forecast predicted, on the
  year it predicted it.

## Performance

4X games die at scale, so there is a benchmark rather than an opinion:

```sh
npm run bench            # default: 1,000 fleets / 5,000 ships
node node_modules/.cache/bench.mjs 10000   # 10,000 fleets / 50,000 ships
```

With 48 colonies, 5,000 ships and 1,555 belt objects, on one core:

| Measurement | Cost |
| --- | --- |
| Bodies and belt objects, per frame | 0.84 ms |
| All fleets, per frame | 0.38 ms |
| One five-day production cycle | 0.68 ms |
| Empire mineral ledger | 0.35 ms |
| Attention list | 0.91 ms |
| Kepler solves | ~3.6-4.2 million/second |

That is **1.2 ms of a 16.7 ms frame** - 7% of the budget at sixty frames a
second. At ten times the navy (50,000 ships) it is 6.2 ms, still inside budget.
A whole year of game time at the fastest speed costs about 50 ms of production
cycles.

The one real bottleneck found so far was not the language: derived ship
figures were being recomputed for every ship on every frame. Caching them
against a revision counter took fleet movement from 4.27 ms to 0.38 ms - 11x -
without touching an algorithm. The lesson generalises: at this scale the cost
is recomputation and allocation, not arithmetic speed.

So the recommendation is **not** to rewrite in C++ or Rust yet. What keeps that
option open is that the simulation layer is pure and knows nothing about the
DOM, so a hot kernel can be moved to WebAssembly later without touching the
interface. The things that would change the answer are per-entity combat
resolution at sub-second increments across tens of thousands of entities,
real N-body physics instead of Keplerian elements, or simulating many empires
server-side. Even then the answer is to extract that kernel, not to rewrite the
game.

## Not built yet

Ground forces; armour, shields and weapons in the component designer (they need
combat); sensors, surveying and
combat and armour; jump points and other star systems; sector administration;
ship maintenance and crew grade. Terraforming cannot yet be done from orbit by
a ship, only by installations on the ground. Ordnance
factories, maintenance facilities, tracking stations and spaceports can be
built but do nothing yet, and mineral and colonist transport is handled by the
civilian-shipping stand-in described above rather than by freighters you build.
