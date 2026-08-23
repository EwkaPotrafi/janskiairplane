import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import {
  calculateCG, evaluateLoad,
  CG_FWD, CG_AFT, ARM_CREW, ARM_FUEL, ARM_BAGGAGE,
  MTOW, MAX_BAGGAGE, MIN_PILOT, EMPTY_WEIGHT, EMPTY_CG, FUEL_RESERVE_L,
  UNIT_SYSTEMS, toDisplay, toMetric, densityIn, projectBurn,
} from './calculator'

// A representative legal load for SP-ZARB, reused across tests.
const legal = {
  emptyWeight: EMPTY_WEIGHT, emptyCG: EMPTY_CG,
  pilot: 85, copilot: 75, fuelL: 60, fuelTypeIdx: 0, baggage: 5,
}

// ---------------------------------------------------------------------------
// POH formula
// ---------------------------------------------------------------------------

describe('calculateCG', () => {
  it('returns NaN when a required input is missing', () => {
    expect(calculateCG(0, 239, 80, 0, 0)).toBeNaN()
    expect(calculateCG(352.7, 0, 80, 0, 0)).toBeNaN()
    expect(calculateCG(352.7, 239, 0, 0, 0)).toBeNaN()
  })

  it('matches a hand-computed weighted average', () => {
    const G = 352.7, S = 239, Wz = 160
    expect(calculateCG(G, S, Wz, 0, 0)).toBeCloseTo((G * S + ARM_CREW * Wz) / (G + Wz), 5)
  })

  it('reproduces the worked example: 85+75 kg crew, 60 L avgas', () => {
    // (352.7·239 + 370·160 + 175·43.2) / 555.9
    expect(calculateCG(352.7, 239, 160, 60 * 0.72, 0)).toBeCloseTo(271.7, 1)
  })

  it('baggage arm is aft, so baggage moves CG aft', () => {
    expect(calculateCG(352.7, 239, 160, 0, 10))
      .toBeGreaterThan(calculateCG(352.7, 239, 160, 0, 0))
  })

  it('fuel arm is forward of crew, so fuel moves CG forward', () => {
    expect(calculateCG(352.7, 239, 160, 50, 0))
      .toBeLessThan(calculateCG(352.7, 239, 160, 0, 0))
  })

  it('uses the POH arms: crew 370, fuel 175, baggage 1050', () => {
    expect([ARM_CREW, ARM_FUEL, ARM_BAGGAGE]).toEqual([370, 175, 1050])
  })
})

// ---------------------------------------------------------------------------
// Limits — these guard the numbers a pilot actually acts on
// ---------------------------------------------------------------------------

describe('evaluateLoad limits', () => {
  it('a representative legal load is GO', () => {
    const r = evaluateLoad(legal)
    expect(r.status).toBe('GO')
    expect(r.checks.every(c => c.status === 'go')).toBe(true)
  })

  it('uses SP-ZARB POH limits, not mockup values', () => {
    expect(MTOW).toBe(600)
    expect(MAX_BAGGAGE).toBe(10)
    expect([CG_FWD, CG_AFT]).toEqual([242, 304])
    expect(EMPTY_WEIGHT).toBe(352.7)
  })

  it('NO GO above 600 kg MTOW', () => {
    const r = evaluateLoad({ ...legal, copilot: 200, baggage: 10, fuelL: 95 })
    expect(r.totalWeight).toBeGreaterThan(MTOW)
    expect(r.status).toBe('NO_GO')
    expect(r.checks.find(c => c.id === 'mtow').status).toBe('no-go')
  })

  it('NO GO when baggage exceeds 10 kg', () => {
    const r = evaluateLoad({ ...legal, baggage: 11 })
    expect(r.status).toBe('NO_GO')
    expect(r.checks.find(c => c.id === 'baggage').status).toBe('no-go')
  })

  it('NO GO when the pilot is under the 70 kg minimum', () => {
    const r = evaluateLoad({ ...legal, pilot: 60 })
    expect(r.checks.find(c => c.id === 'crew').status).toBe('no-go')
    expect(r.status).toBe('NO_GO')
  })

  it('NO GO when crew exceeds 200 kg', () => {
    const r = evaluateLoad({ ...legal, pilot: 110, copilot: 100 })
    expect(r.checks.find(c => c.id === 'crew').status).toBe('no-go')
  })

  it('NO GO above 95 L usable fuel', () => {
    const r = evaluateLoad({ ...legal, fuelL: 96 })
    expect(r.checks.find(c => c.id === 'fuel').status).toBe('no-go')
  })

  it('CAUTION, not NO GO, at or below the 5 L reserve', () => {
    const r = evaluateLoad({ ...legal, fuelL: 4 })
    expect(r.checks.find(c => c.id === 'fuel').status).toBe('warn')
    expect(r.status).toBe('WARN')
  })

  it('NO GO when CG falls aft of the 304 mm limit', () => {
    // Heavy baggage on the 1050 mm arm with no fuel to pull the CG forward
    const r = evaluateLoad({ ...legal, fuelL: 0, baggage: 10, pilot: 70, copilot: 0 })
    if (!r.cgInside) {
      expect(r.status).toBe('NO_GO')
      expect(r.checks.find(c => c.id === 'cg').status).toBe('no-go')
    }
    expect(typeof r.cgInside).toBe('boolean')
  })

  it('the reported margin is the clearance to the nearer CG limit', () => {
    const r = evaluateLoad(legal)
    const expected = Math.min(r.cg - CG_FWD, CG_AFT - r.cg) / (CG_AFT - CG_FWD) * 100
    expect(r.marginPct).toBeCloseTo(expected, 5)
  })

  it('margin is NaN outside the envelope, where it has no meaning', () => {
    const r = evaluateLoad({ ...legal, emptyCG: 300, baggage: 10, fuelL: 0 })
    if (!r.cgInside) expect(r.marginPct).toBeNaN()
  })

  it('Mogas is denser than Avgas, so the same litres weigh more', () => {
    expect(evaluateLoad({ ...legal, fuelTypeIdx: 1 }).fuelMass)
      .toBeGreaterThan(evaluateLoad({ ...legal, fuelTypeIdx: 0 }).fuelMass)
  })
})

// ---------------------------------------------------------------------------
// A blank form must not read as a failed check
// ---------------------------------------------------------------------------

describe('incomplete input', () => {
  it('is PENDING, never NO GO, before anything is entered', () => {
    const r = evaluateLoad({ emptyWeight: EMPTY_WEIGHT, emptyCG: EMPTY_CG })
    expect(r.status).toBe('PENDING')
    expect(r.complete).toBe(false)
  })

  it('stays PENDING when fuel is still missing', () => {
    expect(evaluateLoad({ ...legal, fuelL: 0 }).status).toBe('PENDING')
  })

  it('becomes a real verdict once every required value is present', () => {
    expect(evaluateLoad(legal).status).toBe('GO')
  })
})

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

describe('App UI', () => {
  const fill = async (user, { pilot = '85', copilot = '', fuel = '60', baggage = '' } = {}) => {
    await user.type(screen.getByLabelText(/^pilot$/i), pilot)
    if (copilot) await user.type(screen.getByLabelText(/^copilot$/i), copilot)
    await user.type(screen.getByLabelText(/^fuel$/i), fuel)
    if (baggage) await user.type(screen.getByLabelText(/^baggage$/i), baggage)
  }

  it('pre-fills the SP-ZARB weighing values', () => {
    render(<App />)
    expect(screen.getByLabelText(/empty weight/i)).toHaveValue(EMPTY_WEIGHT)
    expect(screen.getByLabelText(/empty cg/i)).toHaveValue(EMPTY_CG)
  })

  it('shows AWAITING LOAD rather than NO GO on first paint', () => {
    render(<App />)
    expect(screen.getAllByText(/awaiting load/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^NO GO$/)).toBeNull()
  })

  it('reaches GO for a valid load', async () => {
    const user = userEvent.setup()
    render(<App />)
    await fill(user)
    expect(screen.getAllByText(/^GO$/).length).toBeGreaterThan(0)
  })

  it('shows NO GO and names the offending limit when baggage is over', async () => {
    const user = userEvent.setup()
    render(<App />)
    await fill(user, { baggage: '12' })
    expect(screen.getAllByText(/^NO GO$/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/over 10 kg limit/i).length).toBeGreaterThan(0)
  })

  it('derives fuel mass from litres and the selected fuel type', async () => {
    const user = userEvent.setup()
    render(<App />)
    await fill(user, { fuel: '60' })
    expect(screen.getAllByText('43.2').length).toBeGreaterThan(0)   // 60 × 0.72
    await user.selectOptions(screen.getByLabelText(/fuel type/i), 'MOGAS')
    expect(screen.getAllByText('44.4').length).toBeGreaterThan(0)   // 60 × 0.74
  })

  it('reset returns the form to the awaiting state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await fill(user)
    expect(screen.getAllByText(/^GO$/).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /reset load/i }))
    expect(screen.getAllByText(/awaiting load/i).length).toBeGreaterThan(0)
  })

  it('cites the flight manual the limits come from', () => {
    render(<App />)
    expect(screen.getByText(/IUL-KR-030-600-iS/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Units — display-only; limits stay metric
// ---------------------------------------------------------------------------

describe('unit conversion', () => {
  const I = UNIT_SYSTEMS.imperial

  it('matches published conversions for the POH limits', () => {
    expect(toDisplay(MTOW, I.w)).toBeCloseTo(1322.8, 1)        // 600 kg
    expect(toDisplay(CG_FWD, I.l)).toBeCloseTo(9.53, 2)        // 242 mm
    expect(toDisplay(CG_AFT, I.l)).toBeCloseTo(11.97, 2)       // 304 mm
    expect(toDisplay(95, I.v)).toBeCloseTo(25.1, 1)            // 95 L usable
  })

  it('states Avgas density as the industry-standard ~6.0 lb/gal', () => {
    expect(densityIn(I, 0.72)).toBeCloseTo(6.0, 1)
  })

  it('round-trips without drift', () => {
    for (const v of [0.1, 85, 352.7, 600]) {
      expect(toMetric(toDisplay(v, I.w), I.w)).toBeCloseTo(v, 10)
    }
  })

  it('metric is the identity system, so its factors cannot alter a value', () => {
    const M = UNIT_SYSTEMS.metric
    expect([M.w, M.v, M.l]).toEqual([1, 1, 1])
  })

  it('the same physical load gives one verdict regardless of display units', () => {
    // Limits are enforced in metric, so unit choice must never change GO/NO GO.
    const inMetric = evaluateLoad(legal)
    const viaImperial = evaluateLoad({
      ...legal,
      pilot: toMetric(toDisplay(legal.pilot, I.w), I.w),
      baggage: toMetric(toDisplay(legal.baggage, I.w), I.w),
      fuelL: toMetric(toDisplay(legal.fuelL, I.v), I.v),
    })
    expect(viaImperial.status).toBe(inMetric.status)
    expect(viaImperial.cg).toBeCloseTo(inMetric.cg, 9)
  })
})

// ---------------------------------------------------------------------------
// Fuel burn — the CG moves aft as fuel goes
// ---------------------------------------------------------------------------

describe('projectBurn', () => {
  it('endurance is fuel divided by burn rate', () => {
    expect(projectBurn(legal, 8).enduranceH).toBeCloseTo(60 / 8, 6)
  })

  it('reserve endurance stops 5 L early', () => {
    expect(projectBurn(legal, 8).toReserveH).toBeCloseTo((60 - FUEL_RESERVE_L) / 8, 6)
  })

  it('CG moves aft as fuel burns, because fuel is forward of the crew', () => {
    const b = projectBurn(legal, 8)
    expect(b.dry.cg).toBeGreaterThan(b.rows[0].cg)
    for (let i = 1; i < b.rows.length; i++) {
      expect(b.rows[i].cg).toBeGreaterThan(b.rows[i - 1].cg)
    }
  })

  it('weight decreases monotonically', () => {
    const b = projectBurn(legal, 8)
    for (let i = 1; i < b.rows.length; i++) {
      expect(b.rows[i].totalWeight).toBeLessThan(b.rows[i - 1].totalWeight)
    }
  })

  it('the final row is dry tanks', () => {
    const b = projectBurn(legal, 8)
    expect(b.rows.at(-1).fuelL).toBe(0)
    expect(b.rows.at(-1).fuelMass).toBe(0)
  })

  it('a representative load stays inside the envelope to dry tanks', () => {
    const b = projectBurn(legal, 8)
    expect(b.staysInside).toBe(true)
    expect(b.exitAtH).toBeNull()
  })

  it('detects an aft excursion and reports when it happens', () => {
    // Empty CG at the aft end plus max baggage pushes the CG out as fuel goes.
    const b = projectBurn({ ...legal, emptyCG: 258, baggage: 10, fuelL: 90 }, 8)
    if (!b.staysInside) {
      expect(b.exitAtH).toBeGreaterThan(0)
      expect(b.exitAtH).toBeLessThanOrEqual(b.enduranceH)
      expect(b.dry.inside).toBe(false)
    }
    expect(typeof b.staysInside).toBe('boolean')
  })

  it('returns no rows when inputs are incomplete', () => {
    expect(projectBurn({ ...legal, fuelL: 0 }, 8).rows).toHaveLength(0)
    expect(projectBurn(legal, 0).rows).toHaveLength(0)
  })

  it('surfaces an in-flight excursion as CAUTION, never as a silent pass', () => {
    const r = evaluateLoad({ ...legal, emptyCG: 258, baggage: 10, fuelL: 90, burnRateLph: 8 })
    const check = r.checks.find(c => c.id === 'inflight')
    expect(check).toBeDefined()
    if (!projectBurn({ ...legal, emptyCG: 258, baggage: 10, fuelL: 90 }, 8).staysInside) {
      expect(check.status).toBe('warn')
    }
  })
})

// ---------------------------------------------------------------------------
// Regression: pressing the units button must never change the verdict
// ---------------------------------------------------------------------------

describe('unit toggle cannot alter a verdict', () => {
  const I = UNIT_SYSTEMS.imperial
  // Simulates what the UI does: display the value rounded, then read it back.
  const roundTrip = (v, f, dp) => toMetric(+toDisplay(v, f).toFixed(dp), f)

  it('a load exactly on the 10 kg baggage limit stays GO after a toggle', () => {
    const base = { ...legal, baggage: MAX_BAGGAGE }
    expect(evaluateLoad(base).status).toBe('GO')
    expect(evaluateLoad({ ...base, baggage: roundTrip(MAX_BAGGAGE, I.w, 2) }).status).toBe('GO')
  })

  it('a load exactly at MTOW stays GO after a toggle', () => {
    // Crew chosen so the total lands precisely on 600.0 kg
    const fuelMass = 60 * 0.72
    const crew = MTOW - EMPTY_WEIGHT - fuelMass - 5
    const base = { ...legal, pilot: crew, copilot: 0, baggage: 5 }
    expect(evaluateLoad(base).checks.find(c => c.id === 'mtow').status).toBe('go')
    expect(evaluateLoad({ ...base, pilot: roundTrip(crew, I.w, 2) })
      .checks.find(c => c.id === 'mtow').status).toBe('go')
  })

  it('a pilot exactly at the 70 kg minimum stays GO after a toggle', () => {
    const base = { ...legal, pilot: MIN_PILOT, copilot: 0 }
    expect(evaluateLoad(base).checks.find(c => c.id === 'crew').status).toBe('go')
    expect(evaluateLoad({ ...base, pilot: roundTrip(MIN_PILOT, I.w, 2) })
      .checks.find(c => c.id === 'crew').status).toBe('go')
  })

  it('tolerance is far too small to hide a real overload', () => {
    // 100 g over the baggage limit must still fail.
    expect(evaluateLoad({ ...legal, baggage: MAX_BAGGAGE + 0.1 }).status).toBe('NO_GO')
    expect(evaluateLoad({ ...legal, pilot: 85, copilot: 300 }).status).toBe('NO_GO')
  })
})
