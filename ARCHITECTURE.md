# Topaz W&B Calculator — Architecture Overview

## What it does
Weight & Centre of Gravity calculator for the **KR-030-600 Topaz SP-ZARB** (serial 30-15-06).  
Implements the POH Chapter 6 §6.4 formula to check whether a planned loading keeps the aircraft within its certified CG envelope.

---

## Tech stack

| Layer | Technology |
|---|---|
| UI framework | React 18 |
| Styling | Tailwind CSS v4 |
| Build tool | Vite 6 |
| PWA / offline | vite-plugin-pwa + Workbox service worker |
| Testing | Vitest + React Testing Library (46 tests) |
| Deployment | GitHub Actions → seedbox (rsync over SSH) |

---

## File structure

```
janskiairplane/
├── public/
│   ├── icon.svg            # Source SVG app icon
│   ├── icon-180.png        # Apple touch icon (iOS home screen)
│   ├── icon-192.png        # PWA manifest icon
│   └── icon-512.png        # PWA manifest icon (large)
│
├── scripts/
│   └── generate-icons.mjs  # Generates PNG icons from SVG using sharp
│
├── src/
│   ├── calculator.js       # Pure calculation logic (no React)
│   ├── App.jsx             # Main UI component
│   ├── App.test.jsx        # Unit + integration tests (46 tests)
│   ├── main.jsx            # React entry point
│   ├── index.css           # Tailwind import
│   └── test-setup.js       # jest-dom matchers setup
│
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI: test → build → deploy to seedbox on push to main
│
├── index.html              # HTML shell with iOS PWA meta tags
├── vite.config.js          # Vite + Tailwind + PWA + Vitest config
└── package.json
```

---

## Core calculation — `src/calculator.js`

All physics lives here, isolated from React so it can be unit-tested directly.

### POH formula (Chapter 6 §6.4)

```
X = (G·S + 370·Wz + 175·WPal + 1050·WBag) / (G + Wz + WPal + WBag)
```

| Symbol | Meaning | Arm from wing leading edge |
|---|---|---|
| G | Empty weight (kg) | S (measured per aircraft) |
| Wz | Crew weight (kg) | 370 mm |
| WPal | Fuel weight (kg) | 175 mm |
| WBag | Baggage weight (kg) | 1050 mm |

### Limits (POH Chapter 2)

| Limit | Value |
|---|---|
| CG forward | 242 mm |
| CG aft | 304 mm |
| Max takeoff weight | 600 kg |
| Min pilot weight | 70 kg |
| Max crew weight | 200 kg |
| Max baggage | 10 kg (2 × 5 kg) |
| Max usable fuel | 95 L |
| Low-fuel reserve warning | 5 L |

---

## UI — `src/App.jsx`

Operational data-grid layout from the client design handoff: dark header,
sharp corners, 1 px borders with 6 px hard offset shadows.

1. **Header** — brand, registration, metric/imperial toggle, live status panel
2. **Preflight values** — pilot, copilot, fuel + type, baggage, derived fuel mass;
   empty weight and CG behind a disclosure (changed only after a re-weigh)
3. **Envelope clearance** — total weight, CG, margin, and the weight-vs-CG chart
4. **GO / NO GO** — per-limit checklist
5. **Fuel burn & CG drift** — endurance, CG at dry tanks, hour-by-hour table
6. **Live mass model** — full-width blue band with the headline figures

### The envelope chart

A real weight-vs-CG-arm plot. The POH gives one CG range that does not vary
with weight, so the approved region is a **rectangle** spanning 242–304 mm from
empty weight up to the 600 kg MTOW line — not the polygon in the design mockup,
which described a different, heavier aircraft.

A dashed track runs from the takeoff load point to dry tanks, showing where the
CG travels as fuel burns.

### Status states

`PENDING` → `GO` / `WARN` / `NO_GO`. Incomplete input is `PENDING`, never
`NO_GO`: an indicator that reads failure before anything is entered trains
users to ignore it.

---

## Units

Metric is the source of truth. Every POH limit is certified in kg / L / mm, so
**all arithmetic and every limit comparison runs in metric**; imperial exists
only at the display boundary.

Field values are held in the currently displayed units so typing never
round-trips through a conversion, and are converted to metric when handed to
the calculator.

Because displayed values are rounded, a round-trip can land a value a few
thousandths past a limit — enough that pressing the units button alone could
flip a legal load to NO GO. Comparison tolerances of ~10 g / 10 µm / 10 mL
absorb that; they are far below any scale used to weigh an aircraft, and
regression tests pin the boundary cases.

---

## Fuel burn

Fuel sits at 175 mm, forward of the crew at 370 mm, so burning it moves the CG
**aft**. A load legal at takeoff can approach the 304 mm aft limit in flight,
which is why the projection exists rather than only checking the takeoff case.

`projectBurn()` returns hourly rows down to dry tanks, endurance to dry and to
the 5 L reserve, and the time at which the CG leaves the envelope if it does.
An excursion is reported as `WARN`, not `NO_GO`, because it depends on a
pilot-supplied burn rate rather than a certified figure.

The 8 L/h default is the manufacturer's cruise figure for the Rotax 912 iS. The
POH chapters held here state no consumption figure, so it is a planning value
the pilot confirms — not a limit.

---

## PWA & offline

- **Service worker** (Workbox, auto-generated by vite-plugin-pwa) caches all assets on first load
- App works fully offline after first visit — no server needed in the air
- **Requires HTTPS.** Service workers are unavailable on plain HTTP, so on the
  current `http://` origin offline does not work; verified via `isSecureContext`
- **iOS install**: Safari → Share → Add to Home Screen
- **Android install**: Chrome address bar install prompt

---

## Deployment

Every push to `main` triggers the GitHub Actions workflow:

```
push to main
  → npm ci
  → npm test             (46 tests — deploy is blocked if any fail)
  → npm run build        (outputs to /dist)
  → rsync /dist over SSH to the seedbox
```

| | |
|---|---|
| Live URL | http://narvi.whatbox.ca:8790/ |
| Server path | `/home/jackbr4/apps/janskiairplane/dist/` |
| Auth | SSH key in the `SEEDBOX_DEPLOY_KEY` repo secret |

Because the seedbox serves the app at the **root** of that host, `base` in
`vite.config.js` is `/`. If the deploy target ever moves to a subpath
(e.g. GitHub Pages at `/janskiairplane/`), `base`, the manifest `start_url`,
and the `apple-touch-icon` href in `index.html` must all change together —
otherwise every asset 404s.

---

## Aircraft data sources

| Data | Source |
|---|---|
| CG formula & arms | POH IUL-KR-030-600-iS, Chapter 6 §6.4 (2025-04-08) |
| CG limits 242–304 mm | POH Chapter 2 §2.5 |
| Weight limits | POH Chapter 2 §2.4 |
| Empty weight 352.7 kg, CG 239 mm | Factory weighing protocol, SP-ZARB serial 30-15-06 (2025-03-28) |
