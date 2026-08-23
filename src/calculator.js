// All limits and arms below come from the KR-030-600 Topaz POH
// (IUL-KR-030-600-iS, 2025-04-08) for SP-ZARB, serial 30-15-06.
// Nothing here is derived from design mockups.

// Arms from the wing leading edge (mm) - POH Ch. 6 §6.4
export const ARM_CREW = 370
export const ARM_FUEL = 175
export const ARM_BAGGAGE = 1050

// CG limits in flight (mm from wing leading edge) - POH Ch. 2 §2.5
export const CG_FWD = 242
export const CG_AFT = 304

// Weight limits - POH Ch. 2 §2.4 and §2.1
export const MTOW = 600
export const MIN_PILOT = 70
export const MAX_CREW = 200
export const MAX_BAGGAGE = 10
export const FUEL_CAPACITY_L = 95

// Factory weighing protocol, SP-ZARB, 2025-03-28
export const EMPTY_WEIGHT = 352.7
export const EMPTY_CG = 239

// Low-fuel warning threshold - POH Ch. 2 §2.11.2 (red lamp at 5 L)
export const FUEL_RESERVE_L = 5

// Rotax 912 iS cruise consumption per the manufacturer. The POH chapters we
// hold do not state a burn rate, so this is a planning default the pilot is
// expected to confirm against their own engine and power setting - it is not
// a certified limit.
export const DEFAULT_BURN_LPH = 8

export const FUEL_TYPES = [
  { label: 'Avgas 100LL', short: 'AVGAS', grade: '100LL', density: 0.72 },
  { label: 'Mogas RON 95', short: 'MOGAS', grade: 'RON 95', density: 0.74 },
]

// ---------------------------------------------------------------------------
// Units
//
// Every limit in the POH is certified in kg / litres / mm, so all arithmetic
// below runs in metric and imperial exists only at the display boundary.
// Converting before a limit comparison would let rounding decide a GO/NO GO.
// ---------------------------------------------------------------------------

export const UNIT_SYSTEMS = {
  metric: {
    id: 'metric', label: 'Metric',
    weight: 'kg', volume: 'L', length: 'mm', rate: 'L/h',
    w: 1, v: 1, l: 1,
  },
  imperial: {
    id: 'imperial', label: 'Imperial',
    weight: 'lb', volume: 'gal', length: 'in', rate: 'gal/h',
    w: 2.20462262,      // kg  -> lb
    v: 0.264172052,     // L   -> US gallon
    l: 0.0393700787,    // mm  -> inch
  },
}

/** Metric value -> display units. */
export const toDisplay = (v, factor) => (Number.isFinite(v) ? v * factor : v)
/** Display units -> metric, for storage and all limit checks. */
export const toMetric = (v, factor) => (Number.isFinite(v) ? v / factor : v)

/** Fuel density expressed in the active system (kg/L or lb/gal). */
export function densityIn(system, density) {
  return system.id === 'metric' ? density : (density * system.w) / system.v
}

/**
 * Loaded CG position, mm aft of the wing leading edge.
 * POH Ch. 6 §6.4:
 *   X = (G·S + 370·Wz + 175·WPal + 1050·WBag) / (G + Wz + WPal + WBag)
 */
export function calculateCG(G, S, Wz, WPal, WBag) {
  const total = G + Wz + WPal + WBag
  if (!G || !S || !Wz || total === 0) return NaN
  return (G * S + ARM_CREW * Wz + ARM_FUEL * WPal + ARM_BAGGAGE * WBag) / total
}

const num = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// Comparison tolerances.
//
// Displayed values are rounded (10.00 kg shows as 22.05 lb), so converting
// between systems can land a value a few thousandths past a limit. Without a
// tolerance, merely pressing the units button could flip a legal load to
// NO GO. These are ~10 grams / 10 microns / 10 millilitres - orders of
// magnitude finer than any scale used to weigh an aircraft, so they absorb
// display rounding without ever masking a real overload.
const EPS_KG = 0.01
const EPS_MM = 0.01
const EPS_L = 0.01

/**
 * Full preflight evaluation: masses, CG, per-limit checks, overall status.
 *
 * Status is the worst of the individual checks:
 *   NO_GO - a certified limit is exceeded
 *   WARN  - legal, but worth a second look before departure
 *   GO    - every hard limit passes
 */
export function evaluateLoad(input = {}) {
  const G = num(input.emptyWeight)
  const S = num(input.emptyCG)
  const pilot = num(input.pilot)
  const copilot = num(input.copilot)
  const fuelL = num(input.fuelL)
  const baggage = num(input.baggage)

  const fuelType = FUEL_TYPES[input.fuelTypeIdx ?? 0] ?? FUEL_TYPES[0]
  const fuelMass = fuelL * fuelType.density
  const crew = pilot + copilot
  const totalWeight = G + crew + fuelMass + baggage

  const cg = calculateCG(G, S, crew, fuelMass, baggage)
  const hasCG = Number.isFinite(cg)

  const weightRemaining = MTOW - totalWeight
  const cgInside = hasCG && cg >= CG_FWD - EPS_MM && cg <= CG_AFT + EPS_MM

  // Clearance to the nearer CG limit, as a share of envelope width.
  // Reported only when inside; outside the envelope a "margin" is meaningless.
  const envelopeWidth = CG_AFT - CG_FWD
  const marginPct = cgInside
    ? (Math.min(cg - CG_FWD, CG_AFT - cg) / envelopeWidth) * 100
    : NaN

  const required = [
    ['emptyWeight', G], ['emptyCG', S], ['pilot', pilot], ['fuelL', fuelL],
  ]
  const filled = required.filter(([, v]) => v > 0).length

  const checks = []

  checks.push({
    id: 'required',
    label: 'Required fields',
    detail: `${filled} of ${required.length} values entered`,
    status: filled === required.length ? 'go' : 'pending',
  })

  checks.push({
    id: 'mtow',
    label: 'Max takeoff weight',
    detail: totalWeight > MTOW + EPS_KG
      ? `${(totalWeight - MTOW).toFixed(1)} kg over ${MTOW} kg limit`
      : `${weightRemaining.toFixed(1)} kg remaining`,
    status: totalWeight > MTOW + EPS_KG ? 'no-go' : 'go',
  })

  checks.push({
    id: 'cg',
    label: 'CG envelope',
    detail: !hasCG
      ? 'Enter loading to compute'
      : cg < CG_FWD ? `${(CG_FWD - cg).toFixed(1)} mm forward of ${CG_FWD} mm limit`
      : cg > CG_AFT ? `${(cg - CG_AFT).toFixed(1)} mm aft of ${CG_AFT} mm limit`
      : `Within ${CG_FWD}–${CG_AFT} mm limits`,
    status: !hasCG ? 'no-go' : cgInside ? 'go' : 'no-go',
  })

  checks.push({
    id: 'crew',
    label: 'Crew weight',
    detail: pilot > 0 && pilot < MIN_PILOT - EPS_KG
      ? `Pilot below ${MIN_PILOT} kg minimum`
      : crew > MAX_CREW + EPS_KG ? `Crew over ${MAX_CREW} kg maximum`
      : `${crew.toFixed(1)} kg (min pilot ${MIN_PILOT}, max ${MAX_CREW})`,
    status: (pilot > 0 && pilot < MIN_PILOT - EPS_KG) || crew > MAX_CREW + EPS_KG ? 'no-go' : 'go',
  })

  checks.push({
    id: 'baggage',
    label: 'Baggage station',
    detail: baggage > MAX_BAGGAGE + EPS_KG
      ? `${baggage.toFixed(1)} kg over ${MAX_BAGGAGE} kg limit`
      : `${baggage.toFixed(1)} of ${MAX_BAGGAGE} kg (2×5 kg, soft items)`,
    status: baggage > MAX_BAGGAGE + EPS_KG ? 'no-go' : 'go',
  })

  // 5 L is the POH low-fuel warning threshold (Ch. 2 §2.11.2).
  checks.push({
    id: 'fuel',
    label: 'Fuel quantity',
    detail: fuelL > FUEL_CAPACITY_L + EPS_L
      ? `${fuelL.toFixed(0)} L over ${FUEL_CAPACITY_L} L usable`
      : fuelL > 0 && fuelL <= 5 ? 'At or below 5 L reserve - check mission fuel'
      : `${fuelL.toFixed(0)} of ${FUEL_CAPACITY_L} L usable`,
    status: fuelL > FUEL_CAPACITY_L + EPS_L ? 'no-go'
      : fuelL > 0 && fuelL <= 5 ? 'warn'
      : 'go',
  })

  // Burning fuel moves the CG aft, so a load that is legal at takeoff can
  // leave the envelope in flight. Flagged as a caution rather than NO GO
  // because it depends on a pilot-supplied burn rate, not a certified figure.
  if (input.burnRateLph > 0 && fuelL > 0) {
    const burn = projectBurn(input, input.burnRateLph)
    checks.push({
      id: 'inflight',
      label: 'CG through fuel burn',
      detail: burn.staysInside
        ? 'Stays inside envelope down to dry tanks'
        : `Leaves envelope after ${burn.exitAtH.toFixed(1)} h at ${input.burnRateLph} L/h`,
      status: burn.staysInside ? 'go' : 'warn',
    })
  }

  // A blank form is "not yet evaluated", not a failure. Showing NO GO before
  // anything is entered would cry wolf and teach pilots to ignore the
  // indicator, so incomplete input gets its own neutral state.
  const complete = filled === required.length
  const status = !complete ? 'PENDING'
    : checks.some(c => c.status === 'no-go') ? 'NO_GO'
    : checks.some(c => c.status === 'warn') ? 'WARN'
    : 'GO'

  return {
    fuelType, fuelMass, crew, totalWeight, cg, hasCG, complete,
    weightRemaining, marginPct, cgInside, checks, status,
  }
}

/**
 * Project weight and CG forward as fuel burns off.
 *
 * Fuel sits at 175 mm, forward of the crew at 370 mm, so burning it moves the
 * CG AFT. A load that is inside the envelope at takeoff can therefore drift
 * past the 304 mm aft limit in flight - which is the whole point of running
 * this projection rather than only checking the takeoff case.
 *
 * @returns {{rows: Array, enduranceH: number, toReserveH: number,
 *            exitAtH: number|null, staysInside: boolean}}
 */
export function projectBurn(input = {}, burnRateLph = DEFAULT_BURN_LPH) {
  const G = num(input.emptyWeight)
  const S = num(input.emptyCG)
  const crew = num(input.pilot) + num(input.copilot)
  const baggage = num(input.baggage)
  const startL = num(input.fuelL)
  const density = (FUEL_TYPES[input.fuelTypeIdx ?? 0] ?? FUEL_TYPES[0]).density
  const rate = num(burnRateLph)

  const at = litres => {
    const mass = litres * density
    const weight = G + crew + mass + baggage
    const cg = calculateCG(G, S, crew, mass, baggage)
    return {
      fuelL: litres,
      fuelMass: mass,
      totalWeight: weight,
      cg,
      inside: Number.isFinite(cg) && cg >= CG_FWD - EPS_MM && cg <= CG_AFT + EPS_MM,
    }
  }

  const enduranceH = rate > 0 ? startL / rate : 0
  const toReserveH = rate > 0 ? Math.max(0, (startL - FUEL_RESERVE_L) / rate) : 0

  if (!G || !S || !crew || startL <= 0 || rate <= 0) {
    return { rows: [], enduranceH: 0, toReserveH: 0, exitAtH: null, staysInside: true, dry: at(0) }
  }

  // Hourly rows, plus a final row at fuel exhaustion.
  const rows = []
  for (let h = 0; h < enduranceH; h += 1) {
    rows.push({ hours: h, ...at(Math.max(0, startL - rate * h)) })
  }
  rows.push({ hours: enduranceH, ...at(0) })

  // Because CG moves monotonically with fuel burned, a fine scan finds the
  // crossing point without needing to solve the equation analytically.
  let exitAtH = null
  const step = enduranceH / 400
  for (let h = 0; h <= enduranceH; h += step) {
    if (!at(Math.max(0, startL - rate * h)).inside) { exitAtH = h; break }
  }

  return {
    rows,
    enduranceH,
    toReserveH,
    exitAtH,
    staysInside: exitAtH === null,
    dry: at(0),
  }
}
