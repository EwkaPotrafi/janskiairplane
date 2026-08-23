import { useState, useMemo } from 'react'
import {
  CG_FWD, CG_AFT, MTOW, MAX_BAGGAGE, FUEL_CAPACITY_L, FUEL_RESERVE_L,
  EMPTY_WEIGHT, EMPTY_CG, DEFAULT_BURN_LPH, FUEL_TYPES,
  UNIT_SYSTEMS, toDisplay, toMetric, densityIn,
  evaluateLoad, projectBurn,
} from './calculator.js'

const STATUS_COLOR = { GO: 'text-go', WARN: 'text-warn', NO_GO: 'text-nogo', PENDING: 'text-white/80' }
const STATUS_BG = { GO: 'bg-go', WARN: 'bg-warn', NO_GO: 'bg-nogo', PENDING: 'bg-ink-soft' }
const STATUS_LABEL = { GO: 'GO', WARN: 'CAUTION', NO_GO: 'NO GO', PENDING: 'AWAITING LOAD' }
const STATUS_ICON = { GO: '✓', WARN: '⚠', NO_GO: '✕', PENDING: '…' }
const DOT = { go: 'bg-go', warn: 'bg-warn', 'no-go': 'bg-nogo', pending: 'bg-ink-soft' }

const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—')
const hhmm = h => `${Math.floor(h)}h ${Math.round((h % 1) * 60).toString().padStart(2, '0')}m`

const Eyebrow = ({ children, className = '' }) => (
  <p className={`font-[family-name:var(--font-caption)] text-[10px] font-bold tracking-[0.14em] uppercase ${className}`}>
    {children}
  </p>
)

function CompactField({ label, unit, value, onChange, active, min, max, step = 0.1 }) {
  const id = `f-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className={`border border-ink px-3 py-2 ${active ? 'bg-field-active' : 'bg-white'}`}>
      <label htmlFor={id} className="block font-[family-name:var(--font-caption)] text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </label>
      <div className="flex items-baseline gap-1">
        <input
          id={id} type="number" inputMode="decimal" value={value}
          onChange={e => onChange(e.target.value)} min={min} max={max} step={step}
          className="w-full min-w-0 bg-transparent font-[family-name:var(--font-data)] text-[15px] font-bold text-ink outline-none"
        />
        <span className="shrink-0 font-[family-name:var(--font-caption)] text-[10px] font-semibold text-ink-soft">{unit}</span>
      </div>
    </div>
  )
}

/**
 * Weight-vs-CG envelope drawn from the POH. The POH gives one CG range that
 * does not vary with weight, so the approved region is a rectangle.
 * The dashed track shows where the CG travels as fuel burns off.
 */
function EnvelopeChart({ cg, totalWeight, emptyWeight, inside, burn, sys }) {
  const W = 520, H = 250
  const pad = { t: 18, r: 16, b: 34, l: 52 }
  const xMin = 215, xMax = 330, yMin = 330, yMax = 620

  const px = mm => pad.l + ((mm - xMin) / (xMax - xMin)) * (W - pad.l - pad.r)
  const py = kg => H - pad.b - ((kg - yMin) / (yMax - yMin)) * (H - pad.t - pad.b)
  const cx = mm => px(Math.min(Math.max(mm, xMin), xMax))
  const cy = kg => py(Math.min(Math.max(kg, yMin), yMax))

  // Ticks are chosen to be round numbers in whichever system is displayed.
  const xTicks = sys.id === 'metric'
    ? [240, 260, 280, 300, 320]
    : [9.5, 10, 10.5, 11, 11.5, 12, 12.5].map(i => i / sys.l)
  const yTicks = sys.id === 'metric'
    ? [350, 400, 450, 500, 550, 600]
    : [800, 900, 1000, 1100, 1200, 1300].map(lb => lb / sys.w)

  const floor = Math.max(yMin, emptyWeight || yMin)
  const hasPoint = Number.isFinite(cg) && totalWeight > 0
  const showBurn = hasPoint && burn?.rows?.length > 1 && Number.isFinite(burn.dry?.cg)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-h-[170px]" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label={hasPoint
           ? `Load point at ${fmt(toDisplay(cg, sys.l), 1)} ${sys.length} and ${fmt(toDisplay(totalWeight, sys.w), 1)} ${sys.weight}, ${inside ? 'inside' : 'outside'} the approved envelope.`
           : 'Approved centre of gravity envelope. No load entered yet.'}>
      <rect width={W} height={H} fill="var(--color-chart-fill)" />

      {xTicks.map(v => (
        <g key={`x${v}`}>
          <line x1={px(v)} y1={pad.t} x2={px(v)} y2={H - pad.b} stroke="#1a1a1a" strokeOpacity="0.1" />
          <text x={px(v)} y={H - pad.b + 15} textAnchor="middle" fontFamily="var(--font-data)" fontSize="12" fill="#666">
            {sys.id === 'metric' ? v : fmt(toDisplay(v, sys.l), 1)}
          </text>
        </g>
      ))}
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={pad.l} y1={py(v)} x2={W - pad.r} y2={py(v)} stroke="#1a1a1a" strokeOpacity="0.1" />
          <text x={pad.l - 6} y={py(v) + 4} textAnchor="end" fontFamily="var(--font-data)" fontSize="12" fill="#666">
            {sys.id === 'metric' ? v : Math.round(toDisplay(v, sys.w))}
          </text>
        </g>
      ))}

      <rect x={px(CG_FWD)} y={py(MTOW)} width={px(CG_AFT) - px(CG_FWD)} height={py(floor) - py(MTOW)}
            fill="var(--color-accent)" fillOpacity="0.2" stroke="var(--color-accent)" strokeWidth="2" />

      <line x1={pad.l} y1={py(MTOW)} x2={W - pad.r} y2={py(MTOW)}
            stroke="var(--color-nogo)" strokeWidth="1" strokeDasharray="4 3" />
      <text x={W - pad.r - 2} y={py(MTOW) - 5} textAnchor="end"
            fontFamily="var(--font-caption)" fontSize="12" fontWeight="700" fill="var(--color-nogo)">
        MTOW {sys.id === 'metric' ? `${MTOW} kg` : `${Math.round(toDisplay(MTOW, sys.w))} lb`}
      </text>

      <text x={px(CG_FWD)} y={pad.t + 9} textAnchor="middle" fontFamily="var(--font-caption)" fontSize="12" fontWeight="700" fill="#666">FWD</text>
      <text x={px(CG_AFT)} y={pad.t + 9} textAnchor="middle" fontFamily="var(--font-caption)" fontSize="12" fontWeight="700" fill="#666">AFT</text>

      {/* Fuel-burn track: takeoff point down to dry tanks */}
      {showBurn && (
        <g>
          <line x1={cx(cg)} y1={cy(totalWeight)} x2={cx(burn.dry.cg)} y2={cy(burn.dry.totalWeight)}
                stroke="var(--color-ink)" strokeWidth="1.5" strokeDasharray="5 3" strokeOpacity="0.75" />
          <circle cx={cx(burn.dry.cg)} cy={cy(burn.dry.totalWeight)} r="5"
                  fill="#fff" stroke={burn.dry.inside ? 'var(--color-ink)' : 'var(--color-nogo)'} strokeWidth="2" />
          <text x={cx(burn.dry.cg) + 9} y={cy(burn.dry.totalWeight) + 4}
                fontFamily="var(--font-caption)" fontSize="11" fontWeight="700" fill="#666">DRY</text>
        </g>
      )}

      {hasPoint && (
        <g>
          <line x1={cx(cg) - 16} y1={cy(totalWeight)} x2={cx(cg) + 16} y2={cy(totalWeight)}
                stroke={inside ? 'var(--color-go)' : 'var(--color-nogo)'} strokeWidth="1" />
          <line x1={cx(cg)} y1={cy(totalWeight) - 16} x2={cx(cg)} y2={cy(totalWeight) + 16}
                stroke={inside ? 'var(--color-go)' : 'var(--color-nogo)'} strokeWidth="1" />
          <circle cx={cx(cg)} cy={cy(totalWeight)} r="8"
                  fill={inside ? 'var(--color-go)' : 'var(--color-nogo)'} stroke="#fff" strokeWidth="3" />
        </g>
      )}

      <text x={6} y={pad.t + 2} fontFamily="var(--font-caption)" fontSize="12" fontWeight="700" fill="#666">
        {sys.weight.toUpperCase()}
      </text>
      <text x={W / 2} y={H - 4} textAnchor="middle" fontFamily="var(--font-caption)" fontSize="12" fontWeight="700" fill="#666">
        CG ARM ({sys.length.toUpperCase()} AFT OF WING LEADING EDGE)
      </text>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="#1a1a1a" />
    </svg>
  )
}

const SummaryStat = ({ label, value, unit, tone = 'text-ink' }) => (
  <div className="border border-ink px-3 py-2">
    <Eyebrow className="text-ink-soft">{label}</Eyebrow>
    <p className={`font-[family-name:var(--font-data)] text-[17px] font-bold ${tone}`}>
      {value}<span className="ml-1 text-[11px] font-semibold text-ink-soft">{unit}</span>
    </p>
  </div>
)

export default function App() {
  const [unitId, setUnitId] = useState('metric')
  const sys = UNIT_SYSTEMS[unitId]

  // Field values are held in the CURRENTLY DISPLAYED units so typing never
  // round-trips through a conversion; they are converted to metric only when
  // handed to the calculator, which is where every limit is enforced.
  const [pilot, setPilot] = useState('')
  const [copilot, setCopilot] = useState('')
  const [fuelV, setFuelV] = useState('')
  const [fuelTypeIdx, setFuelTypeIdx] = useState(0)
  const [baggage, setBaggage] = useState('')
  const [burnRate, setBurnRate] = useState(String(DEFAULT_BURN_LPH))
  const [emptyWeight, setEmptyWeight] = useState(String(EMPTY_WEIGHT))
  const [emptyCG, setEmptyCG] = useState(String(EMPTY_CG))

  /** Convert every stored field when the unit system changes. */
  const switchUnits = nextId => {
    if (nextId === unitId) return
    const from = UNIT_SYSTEMS[unitId], to = UNIT_SYSTEMS[nextId]
    const conv = (v, fk, dp) => (v === '' ? '' : String(+(toDisplay(toMetric(n(v), from[fk]), to[fk])).toFixed(dp)))
    setPilot(p => conv(p, 'w', 1)); setCopilot(p => conv(p, 'w', 1))
    setBaggage(p => conv(p, 'w', 2)); setEmptyWeight(p => conv(p, 'w', 1))
    setFuelV(p => conv(p, 'v', 1)); setBurnRate(p => conv(p, 'v', 2))
    setEmptyCG(p => conv(p, 'l', 2))
    setUnitId(nextId)
  }

  // Everything below the boundary is metric.
  const metric = useMemo(() => ({
    emptyWeight: toMetric(n(emptyWeight), sys.w),
    emptyCG: toMetric(n(emptyCG), sys.l),
    pilot: toMetric(n(pilot), sys.w),
    copilot: toMetric(n(copilot), sys.w),
    fuelL: toMetric(n(fuelV), sys.v),
    baggage: toMetric(n(baggage), sys.w),
    fuelTypeIdx,
    burnRateLph: toMetric(n(burnRate), sys.v),
  }), [emptyWeight, emptyCG, pilot, copilot, fuelV, baggage, fuelTypeIdx, burnRate, sys])

  const r = useMemo(() => evaluateLoad(metric), [metric])
  const burn = useMemo(() => projectBurn(metric, metric.burnRateLph), [metric])

  const D = { w: v => toDisplay(v, sys.w), v: v => toDisplay(v, sys.v), l: v => toDisplay(v, sys.l) }

  const reset = () => {
    setPilot(''); setCopilot(''); setFuelV(''); setBaggage(''); setFuelTypeIdx(0)
    const to = UNIT_SYSTEMS[unitId]
    setBurnRate(String(+toDisplay(DEFAULT_BURN_LPH, to.v).toFixed(2)))
    setEmptyWeight(String(+toDisplay(EMPTY_WEIGHT, to.w).toFixed(1)))
    setEmptyCG(String(+toDisplay(EMPTY_CG, to.l).toFixed(2)))
  }

  return (
    <div className="min-h-screen bg-white font-[family-name:var(--font-body)]">

      {/* ---------------- Header ---------------- */}
      <header className="bg-surface-inverse text-white">
        <div className="mx-auto max-w-[1440px] px-5 py-4 lg:px-20 lg:py-8">
          <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-4 lg:pb-5">
            <div className="flex items-center gap-3">
              <div className="h-[34px] w-[34px] bg-accent" aria-hidden="true" />
              <span className="font-[family-name:var(--font-heading)] text-lg font-bold">Topaz W&amp;B</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden font-[family-name:var(--font-caption)] text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60 sm:inline">
                SP-ZARB · KR-030-600
              </span>
              <div className="flex border border-white/30" role="group" aria-label="Unit system">
                {Object.values(UNIT_SYSTEMS).map(u => (
                  <button
                    key={u.id}
                    onClick={() => switchUnits(u.id)}
                    aria-pressed={unitId === u.id}
                    className={`px-3 py-1.5 font-[family-name:var(--font-caption)] text-[10px] font-bold uppercase tracking-[0.1em] transition ${
                      unitId === u.id ? 'bg-accent text-white' : 'text-white/70 hover:bg-white/10'}`}
                  >
                    {u.id === 'metric' ? 'kg · L · mm' : 'lb · gal · in'}
                  </button>
                ))}
              </div>
            </div>
          </nav>

          <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-12 lg:pt-8">
            <div>
              <Eyebrow className="text-accent">Preflight weight &amp; balance</Eyebrow>
              <h1 className="mt-2 font-[family-name:var(--font-heading)] text-[24px] font-bold leading-[1.05] lg:mt-3 lg:text-[44px] lg:leading-none">
                Weight and balance<br />before the prop turns
              </h1>
              <p className="mt-3 hidden max-w-[46ch] text-sm leading-relaxed text-white/70 lg:block">
                Enter crew, fuel and baggage. Every value is checked against the
                KR-030-600 Topaz flight manual — total mass, CG position and
                envelope clearance — before showing a clear GO or NO GO.
              </p>
              <button onClick={reset}
                className="mt-4 border border-white/30 px-4 py-2 font-[family-name:var(--font-caption)] text-[11px] font-bold uppercase tracking-[0.1em] text-white transition hover:bg-white hover:text-ink lg:mt-6 lg:py-2.5">
                ↺ Reset load
              </button>
            </div>

            <div className="relative bg-photo-panel lg:min-h-[200px]">
              <div className="absolute inset-0 opacity-[0.07]"
                   style={{ backgroundImage: 'repeating-linear-gradient(135deg,#fff 0 1px,transparent 1px 9px)' }}
                   aria-hidden="true" />
              <div className="relative m-3 max-w-[280px] bg-black/70 p-4 backdrop-blur-sm lg:m-6 lg:p-5">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_BG[r.status]}`} aria-hidden="true" />
                  <Eyebrow className="text-white/60">Current status</Eyebrow>
                </div>
                <p className={`mt-2 font-[family-name:var(--font-heading)] font-extrabold leading-none ${STATUS_COLOR[r.status]} ${r.status === 'PENDING' ? 'text-[24px]' : 'text-[40px]'}`}>
                  {STATUS_LABEL[r.status]}
                </p>
                <p className="mt-2 text-xs leading-snug text-white/70">
                  {r.status === 'PENDING'
                    ? 'Enter pilot weight and fuel to evaluate this load.'
                    : r.status === 'GO'
                      ? `${fmt(r.marginPct)}% CG margin and ${fmt(D.w(r.weightRemaining), 0)} ${sys.weight} below max takeoff weight.`
                      : r.checks.filter(c => c.status !== 'go' && c.status !== 'pending').map(c => c.detail).join('. ') + '.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ---------------- Work area ---------------- */}
      <main className="mx-auto max-w-[1440px] px-5 py-8 lg:px-20 lg:py-12">
        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)_316px]">

          <section className="panel-hard bg-white p-5">
            <Eyebrow className="text-ink-soft">Aircraft loading</Eyebrow>
            <h2 className="mt-1 font-[family-name:var(--font-heading)] text-[22px] font-bold">Preflight values</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Mass entries grouped by station, so a missing value is easy to catch before dispatch.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <CompactField label="Pilot" unit={sys.weight} value={pilot} onChange={setPilot} min={0} step={1} active />
              <CompactField label="Copilot" unit={sys.weight} value={copilot} onChange={setCopilot} min={0} step={1} />
              <CompactField label="Fuel" unit={sys.volume} value={fuelV} onChange={setFuelV} min={0} step={1} />
              <div className="border border-ink bg-white px-3 py-2">
                <label htmlFor="fuel-type" className="block font-[family-name:var(--font-caption)] text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                  Fuel type
                </label>
                <select id="fuel-type" value={fuelTypeIdx} onChange={e => setFuelTypeIdx(Number(e.target.value))}
                        className="w-full bg-transparent font-[family-name:var(--font-data)] text-[15px] font-bold text-ink outline-none">
                  {FUEL_TYPES.map((f, i) => <option key={i} value={i}>{f.short}</option>)}
                </select>
              </div>
              <CompactField label="Baggage" unit={sys.weight} value={baggage} onChange={setBaggage} min={0} step={0.1} />
              <div className="border border-ink bg-surface-muted px-3 py-2">
                <Eyebrow className="text-ink-soft">Fuel mass</Eyebrow>
                <p className="font-[family-name:var(--font-data)] text-[15px] font-bold">
                  {fmt(D.w(r.fuelMass))}<span className="ml-1 text-[10px] font-semibold text-ink-soft">{sys.weight}</span>
                </p>
              </div>
            </div>

            <p className="mt-3 flex gap-2 bg-surface-inverse px-3 py-2.5 text-[11px] leading-snug text-white/80">
              <span aria-hidden="true">ⓘ</span>
              Fuel mass = {sys.volume} × {fmt(densityIn(sys, r.fuelType.density), 2)} {sys.weight}/{sys.volume} ({r.fuelType.label}).
            </p>

            <details className="mt-4 border-t border-ink/15 pt-3">
              <summary className="cursor-pointer font-[family-name:var(--font-caption)] text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft">
                Empty aircraft (from weighing protocol)
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <CompactField label="Empty weight" unit={sys.weight} value={emptyWeight} onChange={setEmptyWeight} step={0.1} />
                <CompactField label="Empty CG" unit={sys.length} value={emptyCG} onChange={setEmptyCG} step={0.1} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink-soft">
                SP-ZARB, weighed 2025-03-28. Change only after a re-weigh.
              </p>
            </details>
          </section>

          <section className="panel-hard bg-white p-5">
            <Eyebrow className="text-ink-soft">Centre of gravity</Eyebrow>
            <h2 className="mt-1 font-[family-name:var(--font-heading)] text-[22px] font-bold">Envelope clearance</h2>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <SummaryStat label="Total weight" value={fmt(D.w(r.totalWeight))} unit={sys.weight}
                           tone={r.totalWeight > MTOW ? 'text-nogo' : 'text-go'} />
              <SummaryStat label="CG position" value={r.hasCG ? fmt(D.l(r.cg), sys.id === 'metric' ? 1 : 2) : '—'} unit={sys.length}
                           tone={!r.hasCG ? 'text-ink' : r.cgInside ? 'text-go' : 'text-nogo'} />
              <SummaryStat label="Margin" value={fmt(r.marginPct)} unit="%"
                           tone={!Number.isFinite(r.marginPct) ? 'text-ink' : r.marginPct < 10 ? 'text-warn' : 'text-go'} />
            </div>

            <div className="mt-4">
              <EnvelopeChart cg={r.cg} totalWeight={r.totalWeight} emptyWeight={metric.emptyWeight}
                             inside={r.cgInside} burn={burn} sys={sys} />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-ink-soft">
                Blue zone: approved envelope ({fmt(D.l(CG_FWD), sys.id === 'metric' ? 0 : 2)}–{fmt(D.l(CG_AFT), sys.id === 'metric' ? 0 : 2)} {sys.length})
                {burn.rows.length > 1 && ' · dashed: CG track as fuel burns'}
              </span>
              <span className={`font-[family-name:var(--font-caption)] font-bold uppercase tracking-[0.1em] ${r.complete ? (r.cgInside ? 'text-go' : 'text-nogo') : 'text-ink-soft'}`}>
                {!r.complete ? 'Awaiting load' : r.cgInside ? 'Load point valid' : 'Load point outside'}
              </span>
            </div>
          </section>

          <section className="panel-hard bg-white p-5">
            <Eyebrow className="text-ink-soft">Checklist</Eyebrow>
            <h2 className="mt-1 font-[family-name:var(--font-heading)] text-[22px] font-bold">GO / NO GO</h2>

            <div className={`mt-4 flex items-center gap-3 p-4 ${STATUS_BG[r.status]} text-white`}>
              <span className="text-xl" aria-hidden="true">{STATUS_ICON[r.status]}</span>
              <div>
                <p className="font-[family-name:var(--font-heading)] text-xl font-bold leading-none">{STATUS_LABEL[r.status]}</p>
                <p className="mt-1 text-[11px] text-white/85">
                  {r.status === 'GO' ? 'All required checks pass'
                    : r.status === 'WARN' ? 'Legal, but review before departure'
                    : r.status === 'PENDING' ? 'Enter pilot weight and fuel'
                    : 'One or more limits exceeded'}
                </p>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {r.checks.map(c => (
                <li key={c.id} className="flex gap-2.5 border border-ink/15 px-3 py-2.5">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      {c.label}
                      <span className="sr-only"> — {c.status === 'go' ? 'pass' : c.status === 'warn' ? 'caution' : c.status === 'pending' ? 'not yet entered' : 'fail'}</span>
                    </p>
                    <p className="text-[11px] leading-snug text-ink-soft">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ---------------- Fuel burn ---------------- */}
        <section className="panel-hard mt-6 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow className="text-ink-soft">In flight</Eyebrow>
              <h2 className="mt-1 font-[family-name:var(--font-heading)] text-[22px] font-bold">Fuel burn &amp; CG drift</h2>
              <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-ink-soft">
                Fuel sits at 175 mm, forward of the crew at 370 mm, so burning it moves the
                CG <strong>aft</strong>. A load that is legal at takeoff can approach the aft
                limit later in the flight.
              </p>
            </div>
            <div className="w-[180px]">
              <CompactField label="Burn rate" unit={sys.rate} value={burnRate} onChange={setBurnRate} min={0} step={0.5} />
            </div>
          </div>

          {burn.rows.length > 1 ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryStat label="Endurance to dry" value={hhmm(burn.enduranceH)} unit="" />
                <SummaryStat label={`To ${fmt(D.v(FUEL_RESERVE_L), sys.id === 'metric' ? 0 : 1)} ${sys.volume} reserve`}
                             value={hhmm(burn.toReserveH)} unit="" tone="text-warn" />
                <SummaryStat label="CG at dry tanks" value={fmt(D.l(burn.dry.cg), sys.id === 'metric' ? 1 : 2)} unit={sys.length}
                             tone={burn.dry.inside ? 'text-go' : 'text-nogo'} />
                <SummaryStat label="CG drift" value={`+${fmt(D.l(burn.dry.cg - r.cg), sys.id === 'metric' ? 1 : 2)}`} unit={`${sys.length} aft`} />
              </div>

              <div className={`mt-4 flex items-start gap-2.5 p-3 text-xs ${burn.staysInside ? 'bg-go/10 text-go' : 'bg-warn/10 text-warn'}`}>
                <span aria-hidden="true">{burn.staysInside ? '✓' : '⚠'}</span>
                <span className="font-semibold">
                  {burn.staysInside
                    ? `CG stays inside the envelope for the whole flight, down to dry tanks.`
                    : `CG leaves the envelope after ${hhmm(burn.exitAtH)} at this burn rate. Reduce baggage or rebalance the load.`}
                </span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-ink">
                      {['Elapsed', `Fuel (${sys.volume})`, `Fuel mass (${sys.weight})`, `Weight (${sys.weight})`, `CG (${sys.length})`, 'Envelope'].map(h => (
                        <th key={h} className="py-2 pr-4 font-[family-name:var(--font-caption)] text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-[family-name:var(--font-data)] text-[13px]">
                    {burn.rows.map((row, i) => (
                      <tr key={i} className={`border-b border-ink/10 ${i === 0 ? 'bg-field-active' : ''}`}>
                        <td className="py-2 pr-4 font-bold">{i === 0 ? 'Takeoff' : hhmm(row.hours)}</td>
                        <td className="py-2 pr-4">{fmt(D.v(row.fuelL))}</td>
                        <td className="py-2 pr-4">{fmt(D.w(row.fuelMass))}</td>
                        <td className="py-2 pr-4">{fmt(D.w(row.totalWeight))}</td>
                        <td className="py-2 pr-4 font-bold">{fmt(D.l(row.cg), sys.id === 'metric' ? 1 : 2)}</td>
                        <td className={`py-2 pr-4 font-bold ${row.inside ? 'text-go' : 'text-nogo'}`}>{row.inside ? 'IN' : 'OUT'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[11px] leading-snug text-ink-soft">
                Burn rate is a planning figure you supply — {DEFAULT_BURN_LPH} L/h is the
                manufacturer's cruise figure for the Rotax 912 iS. It is not a certified
                limit and does not account for taxi, climb, or power setting.
              </p>
            </>
          ) : (
            <p className="mt-5 border border-ink/15 p-4 text-xs text-ink-soft">
              Enter pilot weight, fuel quantity and a burn rate to project CG drift through the flight.
            </p>
          )}
        </section>
      </main>

      {/* ---------------- Live data band ---------------- */}
      <section className="bg-accent text-white">
        <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-20">
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div>
              <Eyebrow className="text-white/70">Live mass model</Eyebrow>
              <h2 className="mt-2 font-[family-name:var(--font-heading)] text-[26px] font-extrabold leading-[1.05] lg:text-[32px]">
                Calculated from the<br />current preflight inputs
              </h2>
              <p className="mt-2 text-[11px] text-white/70">Updates as you type — no button to press.</p>
            </div>

            <div className="grid grid-cols-2 border-t border-white/25 lg:grid-cols-4 lg:border-t-0">
              {[
                { label: `Total weight (${sys.weight})`, value: fmt(D.w(r.totalWeight)), detail: r.totalWeight > MTOW ? `${fmt(D.w(r.totalWeight - MTOW), 0)} over MTOW` : `${fmt(D.w(r.weightRemaining), 0)} under MTOW`, ok: r.totalWeight <= MTOW },
                { label: `CG position (${sys.length})`, value: r.hasCG ? fmt(D.l(r.cg), sys.id === 'metric' ? 1 : 2) : '—', detail: !r.hasCG ? 'Awaiting load' : r.cgInside ? 'Inside envelope' : 'Outside envelope', ok: r.cgInside },
                { label: 'Endurance', value: burn.enduranceH > 0 ? hhmm(burn.enduranceH) : '—', detail: burn.toReserveH > 0 ? `${hhmm(burn.toReserveH)} to reserve` : 'Enter fuel and burn rate', ok: burn.enduranceH > 0 },
                { label: 'Decision', value: STATUS_LABEL[r.status], detail: r.status === 'GO' ? 'All hard limits pass' : r.status === 'WARN' ? 'Review noted item' : r.status === 'PENDING' ? 'Awaiting input' : 'Do not depart', ok: r.status !== 'NO_GO' },
              ].map((m, i) => (
                <div key={m.label} className={`px-4 py-4 lg:py-0 ${i > 0 ? 'lg:border-l lg:border-white/25' : ''}`}>
                  <Eyebrow className="text-white/70">{m.label}</Eyebrow>
                  <p className="mt-1 font-[family-name:var(--font-data)] text-[26px] font-bold leading-none lg:text-[34px]">{m.value}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/85">
                    <span className={`h-1.5 w-1.5 rounded-full ${m.ok ? 'bg-white' : 'bg-nogo'}`} aria-hidden="true" />
                    {m.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-[1440px] px-5 py-6 text-[11px] leading-relaxed text-ink-soft lg:px-20">
        Limits from KR-030-600 Topaz flight manual IUL-KR-030-600-iS (2025-04-08):
        MTOW {MTOW} kg · CG {CG_FWD}–{CG_AFT} mm · baggage {MAX_BAGGAGE} kg · fuel {FUEL_CAPACITY_L} L usable.
        Empty weight and CG from the SP-ZARB weighing protocol of 2025-03-28.
        All limits are certified in metric and checked in metric; imperial is a display conversion.
        Cross-check against the flight manual — this tool does not replace it.
      </footer>
    </div>
  )
}
