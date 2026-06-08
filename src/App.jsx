import { useState, useMemo } from 'react'
import {
  ARM_CREW, ARM_FUEL, ARM_BAGGAGE,
  CG_FWD, CG_AFT,
  MTOW, MIN_PILOT, MAX_CREW, MAX_BAGGAGE, FUEL_CAPACITY_L,
  FUEL_TYPES,
  calculateCG,
} from './calculator.js'

function Field({ label, unit, value, onChange, min, max, step = 0.1, hint }) {
  const id = label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {hint && <span className="ml-1 text-xs text-gray-400">({hint})</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-500 w-10 shrink-0">{unit}</span>
      </div>
    </div>
  )
}

function StatusBadge({ ok, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function CGBar({ cg }) {
  const rangeMin = 200
  const rangeMax = 350
  const clampedCG = Math.max(rangeMin, Math.min(rangeMax, cg))
  const fwdPct = ((CG_FWD - rangeMin) / (rangeMax - rangeMin)) * 100
  const aftPct = ((CG_AFT - rangeMin) / (rangeMax - rangeMin)) * 100
  const cgPct = ((clampedCG - rangeMin) / (rangeMax - rangeMin)) * 100

  return (
    <div className="mt-2">
      <div className="relative h-8 rounded bg-gray-100 border border-gray-200 overflow-visible">
        <div
          className="absolute top-0 h-full bg-green-200 rounded"
          style={{ left: `${fwdPct}%`, width: `${aftPct - fwdPct}%` }}
        />
        <div className="absolute top-0 h-full border-l-2 border-green-600" style={{ left: `${fwdPct}%` }} />
        <div className="absolute top-0 h-full border-l-2 border-green-600" style={{ left: `${aftPct}%` }} />
        {!isNaN(cg) && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow"
            style={{
              left: `${cgPct}%`,
              backgroundColor: cg >= CG_FWD && cg <= CG_AFT ? '#16a34a' : '#dc2626',
            }}
          />
        )}
      </div>
      <div className="relative mt-1 text-xs text-gray-500">
        <span className="absolute" style={{ left: `${fwdPct}%`, transform: 'translateX(-50%)' }}>{CG_FWD}</span>
        <span className="absolute" style={{ left: `${aftPct}%`, transform: 'translateX(-50%)' }}>{CG_AFT}</span>
      </div>
      <p className="text-xs text-gray-400 mt-4 text-center">mm from wing leading edge</p>
    </div>
  )
}

export default function App() {
  // Default values from factory weighing protocol dated 2025-03-28
  // Aircraft SP-ZARB, serial 30-15-06
  const [emptyWeight, setEmptyWeight] = useState('352.7')
  const [emptyCG, setEmptyCG] = useState('239')
  const [pilot, setPilot] = useState('')
  const [copilot, setCopilot] = useState('')
  const [fuelLiters, setFuelLiters] = useState('')
  const [fuelTypeIdx, setFuelTypeIdx] = useState(0)
  const [baggage, setBaggage] = useState('')

  const fuelDensity = FUEL_TYPES[fuelTypeIdx].density

  const G = parseFloat(emptyWeight) || 0
  const S = parseFloat(emptyCG) || 0
  const Wpilot = parseFloat(pilot) || 0
  const Wcopilot = parseFloat(copilot) || 0
  const Wz = Wpilot + Wcopilot
  const WPal = (parseFloat(fuelLiters) || 0) * fuelDensity
  const WBag = parseFloat(baggage) || 0

  const totalWeight = G + Wz + WPal + WBag

  const cg = useMemo(() => {
    if (!Wpilot) return NaN
    return calculateCG(G, S, Wz, WPal, WBag)
  }, [G, S, Wz, Wpilot, WPal, WBag])

  const cgOk = !isNaN(cg) && cg >= CG_FWD && cg <= CG_AFT
  const weightOk = totalWeight <= MTOW
  const pilotOk = Wpilot >= MIN_PILOT
  const crewOk = Wz <= MAX_CREW
  const baggageOk = WBag <= MAX_BAGGAGE
  const fuelOk = (parseFloat(fuelLiters) || 0) <= FUEL_CAPACITY_L

  const allOk = cgOk && weightOk && pilotOk && crewOk && baggageOk && fuelOk
  const hasInput = G > 0 && Wpilot > 0

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">KR-030-600 Topaz</h1>
          <p className="text-sm text-gray-500">Weight & Centre of Gravity Calculator</p>
        </div>

        <div className="space-y-4">

          {/* Empty aircraft */}
          <div className="rounded-xl bg-white shadow-sm border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Empty Aircraft</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Empty weight"
                unit="kg"
                value={emptyWeight}
                onChange={setEmptyWeight}
                min={200}
                max={400}
                step={0.1}
                hint="SP-ZARB: 352.7 kg"
              />
              <Field
                label="Empty CG"
                unit="mm"
                value={emptyCG}
                onChange={setEmptyCG}
                min={220}
                max={260}
                step={0.1}
                hint="SP-ZARB: 239 mm"
              />
            </div>
          </div>

          {/* Loading */}
          <div className="rounded-xl bg-white shadow-sm border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Loading</h2>
            <div className="space-y-4">

              {/* Crew — two columns */}
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Pilot"
                  unit="kg"
                  value={pilot}
                  onChange={setPilot}
                  min={70}
                  max={200}
                  step={1}
                  hint="min 70 kg"
                />
                <Field
                  label="Co-pilot"
                  unit="kg"
                  value={copilot}
                  onChange={setCopilot}
                  min={0}
                  max={200}
                  step={1}
                  hint="optional"
                />
              </div>
              {Wz > 0 && (
                <p className="text-xs text-gray-400 -mt-2">
                  Total crew: <span className="font-medium text-gray-600">{Wz} kg</span>
                  <span className="ml-1">(max {MAX_CREW} kg)</span>
                </p>
              )}

              {/* Fuel with type selector */}
              <div>
                <label htmlFor="fuel" className="block text-sm font-medium text-gray-700 mb-1">
                  Fuel <span className="text-xs text-gray-400">(max 95 L usable)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      id="fuel"
                      type="number"
                      value={fuelLiters}
                      onChange={e => setFuelLiters(e.target.value)}
                      min={0}
                      max={95}
                      step={1}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-500 w-6 shrink-0">L</span>
                  </div>
                  <select
                    value={fuelTypeIdx}
                    onChange={e => setFuelTypeIdx(Number(e.target.value))}
                    className="rounded-md border border-gray-300 px-2 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  >
                    {FUEL_TYPES.map((ft, i) => (
                      <option key={i} value={i}>{ft.label}</option>
                    ))}
                  </select>
                </div>
                {WPal > 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    {fuelDensity} kg/L → <span className="font-medium text-gray-600">{WPal.toFixed(1)} kg</span>
                  </p>
                )}
              </div>

              <Field
                label="Baggage"
                unit="kg"
                value={baggage}
                onChange={setBaggage}
                min={0}
                max={10}
                step={0.1}
                hint="max 10 kg (2×5 kg)"
              />
            </div>
          </div>

          {/* Results */}
          <div className="rounded-xl bg-white shadow-sm border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Results</h2>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">Total weight</p>
                <p className="text-xl font-bold text-gray-900">
                  {totalWeight > 0 ? totalWeight.toFixed(1) : '—'} <span className="text-sm font-normal">kg</span>
                </p>
                <p className="text-xs text-gray-400">limit {MTOW} kg</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">CG position</p>
                <p className="text-xl font-bold text-gray-900">
                  {!isNaN(cg) ? cg.toFixed(1) : '—'} <span className="text-sm font-normal">mm</span>
                </p>
                <p className="text-xs text-gray-400">limit {CG_FWD}–{CG_AFT} mm</p>
              </div>
            </div>

            <CGBar cg={cg} />

            {hasInput && (
              <div className="flex flex-wrap gap-2 mt-5">
                <StatusBadge ok={weightOk} label={`Weight ≤ ${MTOW} kg`} />
                <StatusBadge ok={cgOk} label="CG in range" />
                <StatusBadge ok={pilotOk} label="Pilot ≥ 70 kg" />
                <StatusBadge ok={crewOk} label="Crew ≤ 200 kg" />
                <StatusBadge ok={baggageOk} label="Baggage ≤ 10 kg" />
                <StatusBadge ok={fuelOk} label="Fuel ≤ 95 L" />
              </div>
            )}

            {hasInput && (
              <div className={`mt-4 rounded-lg p-4 text-center font-semibold text-lg ${allOk ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                {allOk ? 'GO — Loading within limits' : 'NO GO — Check warnings above'}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
