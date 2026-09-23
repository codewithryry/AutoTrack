import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, History, MapPin, MapPinOff, SearchX, X } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import {
  DetailItem,
  EmptyState,
  ErrorState,
  FilterSelect,
  MobileFilterBar,
  SearchInput,
  Skeleton,
  StatusBadge,
} from '../components/ui'
import { useDebounced, useTools, useTransactions } from '../hooks'
import { useApp } from '../context/AppContext'
import * as toolService from '../services/tools'
import { checkpointsOf } from '../services/transactions'
import { PERM, can } from '../utils/permissions'
import { ACTIVE_TXN_STATUSES, TOOL_STATUS, TOOL_STATUSES, TXN_STATUS } from '../utils/constants'
import { cx } from '../utils/helpers'
import { formatDateTime, timeAgo, toDate } from '../utils/dates'
import { formatAccuracy, formatCoords } from '../utils/geo'

/**
 * ToolTrack Map — where each tool is now, based on the latest location recorded
 * during its current loan.
 *
 * Two questions, kept apart in the data and on screen:
 *
 *   Current location   only a tool with an open loan (`Borrowed` / `Overdue`)
 *                      has one: the newest valid point of *that* loan — its
 *                      latest checkpoint, or the borrow point if none was
 *                      recorded yet. That is the marker.
 *   Location history   every point of every loan the viewer may read, including
 *                      return points of closed loans. Listed per tool, never
 *                      drawn as a live marker.
 *
 *   Available pin      an `Available` tool with no open loan is drawn apart, in
 *                      its own colour, at the return point of its latest closed
 *                      loan — "last returned here". It is never a current
 *                      location and never counts as Active or Located.
 *
 * Any other status with no open loan has no marker. The inventory's storage
 * location is a text label with no coordinates, so it cannot be pinned.
 *
 * No new store and no new endpoint: the points are the ones `0008` keeps on each
 * loan. Authorization is the existing one — the `transactions_select` policy and
 * the data layer's scoping return staff every loan and a student only their own
 * before anything reaches this page. A student's map is further narrowed to the
 * tools currently out with them.
 *
 * These are recorded events, not a GPS feed: a marker moves only when somebody
 * records a checkpoint.
 */

const SOURCE_LABELS = {
  borrow: 'Borrowed',
  checkpoint: 'Checkpoint',
  return: 'Returned',
}

const isValidPoint = (point) =>
  Number.isFinite(point?.lat) &&
  Number.isFinite(point?.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180 &&
  !!toDate(point.capturedAt)

const stamp = (point) => toDate(point.capturedAt)?.getTime() ?? 0
const newestFirst = (a, b) => stamp(b) - stamp(a)

/** Every valid recorded point of one loan, labelled with where it came from. */
function pointsOf(txn) {
  const points = [
    txn.borrowLocation && { ...txn.borrowLocation, source: 'borrow' },
    ...checkpointsOf(txn).map((point) => ({ ...point, source: 'checkpoint' })),
    txn.returnLocation && { ...txn.returnLocation, source: 'return' },
  ]
  return points
    .filter(isValidPoint)
    .map((point, index) => ({ ...point, key: `${txn.id}-${point.source}-${index}`, txnId: txn.id }))
}

const isActiveLoan = (txn) => ACTIVE_TXN_STATUSES.includes(txn.status)

export default function ToolMapPage() {
  const { user } = useApp()
  const { tools, loading: loadingTools, error: toolsError, reload: reloadTools } = useTools()
  const {
    transactions,
    loading: loadingTxns,
    error: txnError,
    reload: reloadTxns,
  } = useTransactions()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [focusPoint, setFocusPoint] = useState(null)
  const debouncedSearch = useDebounced(search)
  const detailsRef = useRef(null)

  const seesAll = can(user, PERM.TXN_VIEW_ALL)

  // Loans per tool, as the data layer returned them (already scoped by role).
  const loansByTool = useMemo(() => {
    const byTool = new Map()
    for (const txn of transactions) {
      if (!byTool.has(txn.toolId)) byTool.set(txn.toolId, [])
      byTool.get(txn.toolId).push(txn)
    }
    return byTool
  }, [transactions])

  // Staff: the inventory. A student: only the tools currently out with them.
  const authorizedTools = useMemo(() => {
    if (seesAll) return tools
    return tools.filter((tool) =>
      (loansByTool.get(tool.id) ?? []).some((txn) => txn.userId === user?.id && isActiveLoan(txn)),
    )
  }, [tools, loansByTool, seesAll, user?.id])

  // Per tool: its open loan, the current location recorded during that loan,
  // and the full history of the loans the viewer may read.
  const tracking = useMemo(() => {
    const map = new Map()
    for (const tool of authorizedTools) {
      const loans = loansByTool.get(tool.id) ?? []
      const activeLoan = loans.find(isActiveLoan) ?? null
      // The open loan's points in the order they were recorded — borrow point
      // first, then checkpoints as they were appended — and the last valid one
      // wins. Recording order rather than `capturedAt`: the borrow point of a
      // loan issued from a request was stamped by the borrower's device when
      // they asked, and a checkpoint by whichever device recorded it, so their
      // clocks need not agree.
      const current = activeLoan
        ? (pointsOf(activeLoan)
            .filter((point) => point.source !== 'return')
            .at(-1) ?? null)
        : null
      const history = loans.flatMap(pointsOf).sort(newestFirst)
      // An available tool's pin: where its latest closed loan was handed back.
      // Only that loan's return point — an older one may predate a later loan
      // that went back without a reading.
      let resting = null
      if (!activeLoan && tool.status === TOOL_STATUS.AVAILABLE) {
        const closedAt = (txn) => toDate(txn.returnDate ?? txn.borrowDate)?.getTime() ?? 0
        const lastClosed = loans.reduce(
          (latest, txn) => (!latest || closedAt(txn) > closedAt(latest) ? txn : latest),
          null,
        )
        resting = lastClosed
          ? (pointsOf(lastClosed).find((point) => point.source === 'return') ?? null)
          : null
      }
      map.set(tool.id, { activeLoan, current, resting, history })
    }
    return map
  }, [authorizedTools, loansByTool])

  const categoryOptions = useMemo(
    () => [...new Set(authorizedTools.map((tool) => tool.category).filter(Boolean))].sort(),
    [authorizedTools],
  )

  const filtered = useMemo(
    () => toolService.filterTools(authorizedTools, { search: debouncedSearch, status, category }),
    [authorizedTools, debouncedSearch, status, category],
  )

  const visible = useMemo(
    () => filtered.filter((tool) => tracking.get(tool.id)?.current),
    [filtered, tracking],
  )

  // Available tools shown at their last return point, in their own colour.
  const restingTools = useMemo(
    () => filtered.filter((tool) => tracking.get(tool.id)?.resting),
    [filtered, tracking],
  )

  // Every pin on the map: current locations first, then available tools.
  const pinned = useMemo(() => [...visible, ...restingTools], [visible, restingTools])

  // Checked out, but the open loan carries no valid point: checkout went ahead
  // without a reading (refused, unavailable, or not a secure origin), as the
  // existing borrow flow allows. Named here rather than silently absent — and
  // never given an older loan's point instead.
  const unlocated = useMemo(
    () =>
      filtered.filter((tool) => {
        const info = tracking.get(tool.id)
        return info?.activeLoan && !info.current
      }),
    [filtered, tracking],
  )

  const counts = useMemo(() => {
    let active = 0
    let located = 0
    let resting = 0
    for (const tool of authorizedTools) {
      const info = tracking.get(tool.id)
      if (info?.activeLoan) active += 1
      if (info?.current) located += 1
      if (info?.resting) resting += 1
    }
    return { active, located, resting }
  }, [authorizedTools, tracking])

  // The newest location update among the markers on the map.
  const lastUpdated = useMemo(() => {
    let newest = null
    for (const tool of visible) {
      const point = tracking.get(tool.id).current
      if (!newest || stamp(point) > stamp(newest)) newest = point
    }
    return newest?.capturedAt ?? null
  }, [visible, tracking])

  // A selection that the filters have since hidden is dropped.
  useEffect(() => {
    if (selectedId && !pinned.some((tool) => tool.id === selectedId)) {
      setSelectedId(null)
      setFocusPoint(null)
    }
  }, [pinned, selectedId])

  const loading = (loadingTools && tools.length === 0) || (loadingTxns && transactions.length === 0)
  const error = toolsError || txnError
  const retry = () => {
    reloadTools()
    reloadTxns()
  }

  const hasFilters = status !== 'all' || category !== 'all'
  const selectedTool = pinned.find((tool) => tool.id === selectedId) ?? null

  let overlay = null
  if (authorizedTools.length === 0) {
    overlay = { icon: MapPin, title: 'No tools available.' }
  } else if (counts.located === 0 && counts.resting === 0) {
    overlay = {
      icon: MapPinOff,
      title: 'No tool locations available.',
      description:
        counts.active === 0
          ? 'No authorized tool is checked out, so none has a current location. Past locations remain on each tool’s record.'
          : 'The authorized tools have not recorded a valid location yet.',
    }
  } else if (filtered.length === 0) {
    overlay = hasFilters
      ? { icon: SearchX, title: 'No tools match the selected filters.' }
      : { icon: SearchX, title: 'No matching tools found.' }
  } else if (pinned.length === 0) {
    overlay = {
      icon: MapPinOff,
      title: 'No active location',
      description:
        'The matching tools are not checked out, or have not recorded a location during their current loan.',
    }
  }

  return (
    <div>
      {error ? (
        <div className="card">
          <ErrorState
            title="Unable to load tool locations."
            description="Please try again."
            onRetry={retry}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-2.5 sm:p-3">
            {/* The inventory's toolbar, as it is on a phone: the search with one
                square control at its end that opens every filter in a sheet.
                From `sm` the two dropdowns sit inline beside it. */}
            <div className="flex items-center gap-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search tools..."
                className="min-w-0 flex-1"
              />
              <div className="sm:hidden">
                <MobileFilterBar
                  iconOnly
                  filters={[
                    {
                      key: 'status',
                      label: 'Status',
                      value: status,
                      onChange: setStatus,
                      options: [{ value: 'all', label: 'All statuses' }, ...TOOL_STATUSES],
                    },
                    {
                      key: 'category',
                      label: 'Category',
                      value: category,
                      onChange: setCategory,
                      options: [{ value: 'all', label: 'All categories' }, ...categoryOptions],
                    },
                  ]}
                  hasFilters={hasFilters}
                  onClear={() => {
                    setStatus('all')
                    setCategory('all')
                  }}
                />
              </div>
              <div className="hidden gap-2 sm:flex">
                <FilterSelect
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[{ value: 'all', label: 'All statuses' }, ...TOOL_STATUSES]}
                />
                <FilterSelect
                  label="Category"
                  value={category}
                  onChange={setCategory}
                  options={[{ value: 'all', label: 'All categories' }, ...categoryOptions]}
                />
              </div>
            </div>

            {/* A phone: the four counts as one row of small tinted tiles, and
                the last update as a quiet line under them. */}
            <dl className="mt-3 grid grid-cols-4 gap-2 sm:hidden">
              <PhoneStat label="Tools" value={authorizedTools.length} tone="bg-slate-500/10" />
              <PhoneStat label="Active" value={counts.active} tone="bg-amberline-400/15" />
              <PhoneStat label="Located" value={counts.located} tone="bg-blue-500/10" />
              <PhoneStat label="Visible" value={pinned.length} tone="bg-emerald-500/10" />
            </dl>
            <p className="subtle mt-2.5 flex items-center gap-1.5 px-1 text-[11.5px] font-semibold sm:hidden">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Last updated: {lastUpdated ? timeAgo(lastUpdated) : '—'}
            </p>

            <dl className="mt-3 hidden grid-cols-5 gap-2 border-t pt-3 sm:grid">
              <Stat label="Tools" value={authorizedTools.length} />
              <Stat label="Active" value={counts.active} />
              <Stat label="Located" value={counts.located} />
              <Stat label="Visible" value={pinned.length} />
              <Stat
                label="Last updated"
                value={lastUpdated ? timeAgo(lastUpdated) : '—'}
              />
            </dl>
          </div>

          {/* Desktop: the map on the left, the selected tool beside it. A phone
              stacks them, map first. */}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
            <div className="card relative isolate overflow-hidden">
              {loading ? (
                <div className="grid h-[60vh] min-h-[320px] place-items-center lg:h-[calc(100dvh-15rem)]">
                  <div className="flex flex-col items-center gap-2">
                    <Skeleton className="h-6 w-32 rounded" />
                    <p className="subtle text-xs">Loading tool locations...</p>
                  </div>
                </div>
              ) : (
                <>
                  <LeafletMap
                    tools={pinned}
                    tracking={tracking}
                    selectedId={selectedId}
                    focusPoint={focusPoint}
                    onSelect={(id) => {
                      setSelectedId(id)
                      setFocusPoint(null)
                      // Stacked below the map on a phone, so bring it into view.
                      if (window.matchMedia('(max-width: 1023px)').matches) {
                        requestAnimationFrame(() =>
                          detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                        )
                      }
                    }}
                  />
                  {overlay && (
                    <div
                      className="absolute inset-0 z-[1000] grid place-items-center p-4"
                      style={{ background: 'rgb(var(--surface) / 0.75)' }}
                    >
                      <EmptyState
                        compact
                        icon={overlay.icon}
                        title={overlay.title}
                        description={overlay.description}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div
              ref={detailsRef}
              className="min-w-0 scroll-mt-20 space-y-3 lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto"
            >
              <SelectedToolPanel
                key={selectedTool?.id ?? 'none'}
                tool={selectedTool}
                info={selectedTool ? tracking.get(selectedTool.id) : null}
                focusKey={focusPoint?.key}
                onFocus={setFocusPoint}
                onClose={() => {
                  setSelectedId(null)
                  setFocusPoint(null)
                }}
              />

              {!loading && unlocated.length > 0 && (
                <div className="card p-4">
                  <p className="subtle mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                    <MapPinOff className="h-3.5 w-3.5" /> Checked out without a location ({unlocated.length})
                  </p>
                  <p className="muted mb-2 text-xs">
                    No location was recorded at checkout or since, so these tools have no current location.
                    The borrower can record a location checkpoint from the tool’s page to place it on
                    the map.
                  </p>
                  <ul className="divide-y">
                    {unlocated.map((tool) => (
                      <li key={tool.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {tool.name} <span className="subtle font-mono text-xs">#{tool.id}</span>
                          </span>
                          <span className="subtle block truncate text-xs">
                            {tracking.get(tool.id).activeLoan.userName || '—'} ·{' '}
                            {tracking.get(tool.id).activeLoan.status}
                          </span>
                        </span>
                        <Link to={`/tools/${tool.id}`} className="btn btn-outline btn-sm shrink-0">
                          View Tool
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PhoneStat({ label, value, tone }) {
  return (
    <div className={cx('flex min-w-0 flex-col items-center rounded-2xl px-1 py-2.5 text-center', tone)}>
      <dd className="text-xl font-extrabold leading-none tabular-nums">{value}</dd>
      <dt className="subtle mt-1.5 w-full truncate text-[10px] font-bold uppercase tracking-wide">
        {label}
      </dt>
    </div>
  )
}

function Stat({ label, value, className }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="subtle text-[11px] font-bold uppercase tracking-wider">{label}</dt>
      <dd className="truncate text-lg font-extrabold tabular-nums">{value}</dd>
    </div>
  )
}

/**
 * The Leaflet map itself. Leaflet and the clustering plugin are loaded when the
 * page is opened, so nothing about them reaches the rest of the app.
 */
function LeafletMap({ tools, tracking, selectedId, focusPoint, onSelect }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const clusterRef = useRef(null)
  const focusRef = useRef(null)
  const markersRef = useRef([])
  const fittedRef = useRef('')
  const onSelectRef = useRef(onSelect)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  onSelectRef.current = onSelect

  const fitToMarkers = () => {
    const L = leafletRef.current
    if (!L || !mapRef.current || markersRef.current.length === 0) return
    mapRef.current.fitBounds(L.featureGroup(markersRef.current).getBounds(), {
      padding: [40, 40],
      maxZoom: 16,
    })
  }
  const fitRef = useRef(fitToMarkers)
  fitRef.current = fitToMarkers

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const L = (await import('leaflet')).default
        // The clustering plugin extends the global `L`.
        window.L = L
        await import('leaflet.markercluster')
        if (cancelled || !containerRef.current) return
        const map = L.map(containerRef.current, { worldCopyJump: true }).setView([12.8797, 121.774], 5)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        }).addTo(map)

        // Zoom to visible tools, under the +/− buttons.
        const FitControl = L.Control.extend({
          onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar')
            const button = L.DomUtil.create('a', 'tooltrack-fit', bar)
            button.href = '#'
            button.title = 'Zoom to visible tools'
            button.setAttribute('role', 'button')
            button.setAttribute('aria-label', 'Zoom to visible tools')
            button.innerHTML =
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
            L.DomEvent.disableClickPropagation(bar)
            L.DomEvent.on(button, 'click', (event) => {
              L.DomEvent.preventDefault(event)
              fitRef.current()
            })
            return bar
          },
        })
        new FitControl({ position: 'topleft' }).addTo(map)

        const cluster = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 50,
          iconCreateFunction: (group) =>
            L.divIcon({
              html: `<span>${group.getChildCount()} tools</span>`,
              className: 'tooltrack-cluster',
              iconSize: [56, 32],
            }),
        })
        map.addLayer(cluster)
        leafletRef.current = L
        mapRef.current = map
        clusterRef.current = cluster
        setReady(true)
      } catch (err) {
        console.warn('[map] the map could not be loaded', err)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Markers: one per pinned tool — at the current location of its open loan, or
  // for an available tool, where it was last returned.
  useEffect(() => {
    if (!ready) return
    const L = leafletRef.current
    const cluster = clusterRef.current
    cluster.clearLayers()
    markersRef.current = tools.map((tool) => {
      const { current, resting, activeLoan } = tracking.get(tool.id)
      const point = current ?? resting
      const state = !current
        ? 'available'
        : activeLoan?.status === TXN_STATUS.OVERDUE
          ? 'overdue'
          : 'out'
      const label = `${tool.name} #${tool.id}`
      const marker = L.marker([point.lat, point.lng], {
        icon: pinIcon(L, { selected: tool.id === selectedId, state }),
        title: label,
        keyboard: true,
      })
      marker.bindTooltip(escapeHtml(`${label} · ${PIN_LABELS[state]}`), {
        direction: 'top',
        offset: [0, -28],
      })
      marker.on('click', () => onSelectRef.current(tool.id))
      return marker
    })
    cluster.addLayers(markersRef.current)

    // Fit to the markers when the set of visible tools changes, not on every
    // re-render, so a click never throws the view somewhere else.
    const signature = tools.map((tool) => tool.id).join('|')
    if (markersRef.current.length && signature !== fittedRef.current) {
      fittedRef.current = signature
      fitRef.current()
    }
  }, [ready, tools, tracking, selectedId])

  // A history entry the user opened: drawn apart from the current markers, as a
  // ring rather than a pin, and removed when they close it.
  useEffect(() => {
    if (!ready) return
    const L = leafletRef.current
    focusRef.current?.remove()
    focusRef.current = null
    if (!focusPoint) return
    focusRef.current = L.circleMarker([focusPoint.lat, focusPoint.lng], {
      radius: 9,
      color: '#64748b',
      weight: 3,
      dashArray: '4 4',
      fillOpacity: 0.15,
    })
      .bindTooltip(escapeHtml(`${SOURCE_LABELS[focusPoint.source]} · ${formatDateTime(focusPoint.capturedAt)}`))
      .addTo(mapRef.current)
    mapRef.current.setView([focusPoint.lat, focusPoint.lng], Math.max(mapRef.current.getZoom(), 16))
  }, [ready, focusPoint])

  // Keep the map sized to its box when the viewport changes.
  useEffect(() => {
    if (!ready || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [ready])

  return (
    <>
      <div ref={containerRef} className="h-[60vh] min-h-[320px] w-full lg:h-[calc(100dvh-15rem)]" />
      {ready && (
        <div
          className="pointer-events-none absolute bottom-6 left-2 z-[1000] flex flex-col gap-1 rounded-lg
                     px-2 py-1.5 text-[11px] font-semibold shadow"
          style={{ background: 'rgb(var(--surface))' }}
        >
          <span className="flex items-center gap-1.5">
            <span className="tooltrack-dot" /> Checked out
          </span>
          <span className="flex items-center gap-1.5">
            <span className="tooltrack-dot is-overdue" /> Overdue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="tooltrack-dot is-available" /> Available
          </span>
        </div>
      )}
      {failed && (
        <div
          className="absolute inset-0 z-[1000] grid place-items-center"
          style={{ background: 'rgb(var(--surface))' }}
        >
          <ErrorState
            title="Unable to load tool locations."
            description="Please try again."
            onRetry={() => window.location.reload()}
          />
        </div>
      )}
    </>
  )
}

const PIN_LABELS = {
  out: 'Checked out',
  overdue: 'Overdue',
  available: 'Available — last returned here',
}

function pinIcon(L, { selected, state }) {
  const classes = [
    'tooltrack-pin',
    state === 'overdue' && 'is-overdue',
    state === 'available' && 'is-available',
    selected && 'is-selected',
  ]
  return L.divIcon({
    className: '',
    html: `<span class="${classes.filter(Boolean).join(' ')}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  })
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

function SelectedToolPanel({ tool, info, focusKey, onFocus, onClose }) {
  const [showHistory, setShowHistory] = useState(false)

  if (!tool || !(info?.current || info?.resting)) {
    return (
      <div className="card">
        <EmptyState
          compact
          icon={MapPin}
          title="Selected Tool"
          description="Choose a marker on the map to see where that tool is now."
        />
      </div>
    )
  }

  const { current, resting, history, activeLoan } = info
  const point = current ?? resting
  return (
    <div className="card min-w-0 p-4">
      <p className="subtle mb-2 text-[11px] font-bold uppercase tracking-wider">Selected Tool</p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold">{tool.name}</p>
          <p className="subtle font-mono text-xs">#{tool.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/tools/${tool.id}`} className="btn btn-primary btn-sm">
            View Tool
          </Link>
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            className="btn btn-outline btn-sm"
            aria-expanded={showHistory}
          >
            <History className="h-4 w-4" /> Location History
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <DetailItem label="Status">
          <StatusBadge status={tool.status} />
        </DetailItem>
        <DetailItem label="Assigned to">{activeLoan?.userName || '—'}</DetailItem>
        <DetailItem label={current ? 'Current location' : 'Last returned here'} mono>
          {formatCoords(point)}
          <span className="subtle block font-sans text-xs">
            {SOURCE_LABELS[point.source]}
            {point.capturedByName ? ` by ${point.capturedByName}` : ''} · {formatAccuracy(point)}
          </span>
        </DetailItem>
        <DetailItem label="Last update">
          {timeAgo(point.capturedAt)}
          <span className="subtle block text-xs">{formatDateTime(point.capturedAt)}</span>
        </DetailItem>
      </div>

      {showHistory && (
        <div className="mt-5 border-t pt-4">
          <p className="subtle mb-2 text-[11px] font-bold uppercase tracking-wider">Location History</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {history.map((point) => (
              <li key={point.key}>
                <button
                  type="button"
                  onClick={() => onFocus(focusKey === point.key ? null : point)}
                  className={cx(
                    'flex w-full items-start justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    focusKey === point.key
                      ? 'bg-amberline-400/15'
                      : 'hover:bg-black/[0.035] dark:hover:bg-white/5',
                  )}
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{SOURCE_LABELS[point.source]}</span>
                    <span className="subtle block text-xs">
                      {formatDateTime(point.capturedAt)} · {formatCoords(point)}
                    </span>
                  </span>
                  {point.key === current?.key && (
                    <span className="shrink-0 rounded-md bg-amberline-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amberline-600 dark:text-amberline-400">
                      Current
                    </span>
                  )}
                  {point.key === resting?.key && (
                    <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">
                      Last returned
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
