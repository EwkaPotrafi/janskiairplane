export const ARM_CREW = 370
export const ARM_FUEL = 175
export const ARM_BAGGAGE = 1050
export const CG_FWD = 242
export const CG_AFT = 304
export const MTOW = 600
export const MIN_PILOT = 70
export const MAX_CREW = 200
export const MAX_BAGGAGE = 10
export const FUEL_CAPACITY_L = 95

export const FUEL_TYPES = [
  { label: 'Avgas 100LL', density: 0.72 },
  { label: 'Mogas RON 95', density: 0.74 },
]

/**
 * Calculate loaded CG position (mm from wing leading edge).
 * Formula from POH Chapter 6 §6.4.
 *
 * @param {number} G  - empty weight (kg)
 * @param {number} S  - empty CG (mm from wing leading edge)
 * @param {number} Wz - crew weight (kg)
 * @param {number} WPal - fuel weight (kg)
 * @param {number} WBag - baggage weight (kg)
 * @returns {number} loaded CG (mm) or NaN if inputs invalid
 */
export function calculateCG(G, S, Wz, WPal, WBag) {
  const total = G + Wz + WPal + WBag
  if (!G || !S || !Wz || total === 0) return NaN
  return (G * S + ARM_CREW * Wz + ARM_FUEL * WPal + ARM_BAGGAGE * WBag) / total
}

export function validateLoading({ G, S, Wpilot, Wcopilot, fuelL, fuelDensity, WBag }) {
  const Wz = Wpilot + Wcopilot
  const WPal = fuelL * fuelDensity
  const total = G + Wz + WPal + WBag
  const cg = calculateCG(G, S, Wz, WPal, WBag)
  return {
    cg,
    totalWeight: total,
    cgOk: !isNaN(cg) && cg >= CG_FWD && cg <= CG_AFT,
    weightOk: total <= MTOW,
    pilotOk: Wpilot >= MIN_PILOT,
    crewOk: Wz <= MAX_CREW,
    baggageOk: WBag <= MAX_BAGGAGE,
    fuelOk: fuelL <= FUEL_CAPACITY_L,
  }
}
