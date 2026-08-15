import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Grid3x3,
  List,
  MapPin,
  MoreVertical,
  Plus,
  QrCode,
  Search,
  Trash2,
  Pencil,
  Wrench,
  HardHat,
  ShieldAlert,
  RotateCcw,
  PackageSearch,
  Repeat,
} from 'lucide-react'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import {
  ConditionBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterSelect,
  MobileFilterBar,
  PageHeader,
  SearchInput,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  TableWrap,
} from '../components/ui'
import ToolForm from '../components/ToolForm'
import ToolImage from '../components/ToolImage'
import { QRCodeModal } from '../components/QRCodeDisplay'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useLocalStorage, useMediaQuery, useTools } from '../hooks'
import * as toolService from '../services/tools'
import { isStaff, isStudent, PERM } from '../utils/permissions'
import { CATEGORIES, CONDITIONS, LOCATIONS, TOOL_STATUS, TOOL_STATUSES } from '../utils/constants'
import { cx } from '../utils/helpers'
import { formatDate } from '../utils/dates'

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'id', label: 'Tool ID' },
  { value: 'status', label: 'Status' },
  { value: 'category', label: 'Category' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

export const TOOLS_CSV_COLUMNS = [
  { key: 'id', label: 'Tool ID' },
  { key: 'name', label: 'Tool Name' },
  { key: 'category', label: 'Category' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'serialNumber', label: 'Serial Number' },
  { key: 'location', label: 'Location' },
  { key: 'condition', label: 'Condition' },
  { key: 'status', label: 'Status' },
  { key: 'purchaseDate', label: 'Purchase Date', format: (v) => formatDate(v, '') },
  { key: 'lastMaintenanceDate', label: 'Last Maintenance', format: (v) => formatDate(v, '') },
  { key: 'nextMaintenanceDate', label: 'Next Maintenance', format: (v) => formatDate(v, '') },
]

/**
 * First-run walkthrough for the inventory. Steps point at controls that really
 * live on this page; `Walkthrough` drops any step whose target is absent (for
 * example the Add-tool button on a read-only account), so the tour stays honest.
 *
 * The closing step has no target to drop, so it takes the role instead: a
 * student is never shown the QR, edit or status controls, and their tour must
 * not describe them.
 */
const toolsTour = (isCrib) => [
  {
    target: 'tools-list',
    title: 'The tool inventory',
    text: 'One record per registered tool: its name, its ID, what condition it is in, where it is kept, and whether it is on the shelf or out on loan.',
  },
  {
    target: 'tools-search',
    title: 'Find one tool',
    text: 'Type a tool name, the ID from its QR label, a brand or a serial number — the records narrow as you type.',
  },
  {
    target: 'tools-filters',
    title: 'Narrow the records',
    text: 'Show only what you need — available tools, one category, one storage location, one condition — and sort what is left.',
  },
  {
    target: 'tools-add',
    title: 'Register a new tool',
    text: 'Add a tool here to generate its QR label, ready for the shelf.',
  },
  {
    title: 'Open a tool',
    text: isCrib
      ? 'Tap any tool for its full record and history. The ⋮ menu edits it, shows its QR code, or updates its status.'
      : 'Tap any tool for its full record — status, condition and where it is kept — or use Borrow to identify it at the borrow desk and request it.',
  },
]

export default function ToolsPage() {
  const { user, can } = useApp()
  const toast = useToast()
  const { tools, loading, error, reload } = useTools()
  const [searchParams, setSearchParams] = useSearchParams()

  // The phone shell — the same breakpoint the layout switches its rail on.
  const isPwa = useMediaQuery('(max-width: 1023px)')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [category, setCategory] = useState(searchParams.get('category') ?? 'all')
  const [condition, setCondition] = useState('all')
  const [location, setLocation] = useState('all')
  const [sort, setSort] = useState('name-asc')

  // The inventory can grow large and this is a PWA, so a student's default is
  // the compact list; staff keep the card/table pair they had. The preference
  // is stored per role, so one account's choice never leaks onto another's.
  const studentViewer = isStudent(user)
  const [view, setView] = useLocalStorage(
    `stms.tools.view.${studentViewer ? 'student' : 'staff'}`,
    studentViewer ? 'list' : 'grid',
  )
  const VIEW_OPTIONS = studentViewer
    ? [
        { value: 'list', label: 'List', icon: List, title: 'List view' },
        { value: 'grid', label: 'Card', icon: Grid3x3, title: 'Card view' },
      ]
    : [
        { value: 'grid', label: 'Card', icon: Grid3x3, title: 'Card view' },
        { value: 'table', label: 'Table', icon: List, title: 'Table view' },
      ]

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [qrTool, setQrTool] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  // A stable array: `Walkthrough` re-resolves its targets whenever `steps`
  // changes identity, which would restart the tour on every render.
  const tourSteps = useMemo(() => toolsTour(isStaff(user)), [user])

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('tools', user?.id)

  // Keep the status filter reflected in the URL so dashboard cards can deep-link.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (status === 'all') next.delete('status')
    else next.set('status', status)
    if (category === 'all') next.delete('category')
    else next.set('category', category)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, category])

  const filtered = useMemo(
    () =>
      toolService.filterTools(tools, {
        search: debouncedSearch,
        // A student's inventory is what they can actually ask for: the tools
        // on the shelf right now. Everything out on loan, under maintenance or
        // out of service belongs to the staff view of the room.
        status: studentViewer ? TOOL_STATUS.AVAILABLE : status,
        category,
        condition,
        location,
        sort,
      }),
    [tools, debouncedSearch, status, category, condition, location, sort, studentViewer],
  )

  const hasFilters =
    !!debouncedSearch ||
    status !== 'all' ||
    category !== 'all' ||
    condition !== 'all' ||
    location !== 'all'

  // The same filters the desktop row holds, described once for the phone's
  // chips. A student's list is pinned to Available, so the status chip would be
  // a control with one setting — it is left out of their bar entirely.
  const MOBILE_FILTERS = [
    ...(studentViewer
      ? []
      : [
          {
            key: 'status',
            label: 'Status',
            value: status,
            onChange: setStatus,
            options: [{ value: 'all', label: 'All statuses' }, ...TOOL_STATUSES],
          },
        ]),
    {
      key: 'category',
      label: 'Category',
      value: category,
      onChange: setCategory,
      options: [{ value: 'all', label: 'All categories' }, ...CATEGORIES],
    },
    {
      key: 'condition',
      label: 'Condition',
      value: condition,
      onChange: setCondition,
      options: [{ value: 'all', label: 'All conditions' }, ...CONDITIONS],
    },
    {
      key: 'location',
      label: 'Location',
      value: location,
      onChange: setLocation,
      options: [{ value: 'all', label: 'All locations' }, ...LOCATIONS],
    },
    { key: 'sort', label: 'Sort', value: sort, onChange: setSort, options: SORT_OPTIONS },
  ]

  const resetFilters = () => {
    setSearch('')
    setStatus('all')
    setCategory('all')
    setCondition('all')
    setLocation('all')
  }

  /* ----------------------------- actions ----------------------------- */

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  /**
   * `?new=1` opens the same create form — how the phone's bottom bar reaches it
   * while this page is open. The parameter is dropped again the moment it is
   * honoured, so a back navigation does not reopen the form.
   */
  useEffect(() => {
    if (!searchParams.get('new')) return
    if (can(PERM.TOOL_CREATE)) openCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const openEdit = (tool) => {
    setEditing(tool)
    setFormOpen(true)
  }

  const runStatusAction = async (tool, action, label) => {
    setBusy(true)
    try {
      await action()
      // Next to the control that created or edited the record.
      toast.success(`${tool.name} — ${label}.`, { anchor: '[data-tour="tools-add"]' })
    } catch (err) {
      toast.error(err.message ?? 'Unable to update the tool.')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const requestDelete = (tool) => {
    setConfirm({
      kind: 'delete',
      tool,
      title: `Delete ${tool.name}?`,
      message: `${tool.id} and its QR code will be removed from the inventory. Borrowing history is kept for the record.`,
      confirmLabel: 'Delete tool',
      onConfirm: async () => {
        setBusy(true)
        try {
          await toolService.remove(tool.id, user)
          toast.success(`${tool.name} was deleted.`, { anchor: '[data-tour="tools-list"]' })
          setConfirm(null)
        } catch (err) {
          if (err.name === 'ActiveTransactionError') {
            // The tool is out on loan, so deletion is refused — forcing it
            // would corrupt the open transaction's history. Explain that here
            // instead of offering a destructive override.
            setConfirm((c) => ({
              ...c,
              title: 'This tool is still on loan',
              message: err.message,
              confirmLabel: 'Close',
              variant: 'primary',
              onConfirm: () => setConfirm(null),
            }))
          } else {
            toast.error(err.message ?? 'Unable to delete the tool.')
            setConfirm(null)
          }
        } finally {
          setBusy(false)
        }
      },
    })
  }

  return (
    <>
      {/* On a phone the bottom bar's "+" carries this action, so the header row
          is the desktop's only — and with nothing left in it since the download
          and print buttons went, it stands down there entirely and the filters
          come up to the top, the way Transactions now opens. */}
      {can(PERM.TOOL_CREATE) && (
        <div className="hidden lg:block">
          <PageHeader hideTitle>
            <button
              type="button"
              onClick={openCreate}
              className="btn btn-primary"
              data-tour="tools-add"
            >
              <Plus className="h-4 w-4" />
              Add tool
            </button>
          </PageHeader>
        </div>
      )}

      {/* ------------------------------ toolbar ------------------------------
          One card carrying everything above the results, laid out for the width
          it has rather than crammed into a single row:

            phone    search (its own row, with the filter sheet's button at the
                     end of it) · then the count and the view switch facing each
                     other on a compact second row
            desktop  search beside the inline dropdowns, with the count and the
                     view switch closing the same row — so the width is used and
                     nothing floats in its own band of empty space.

          Every control, filter and handler is the page's own, unchanged. */}
      <div className="card mb-3 p-2.5 sm:mb-4 sm:p-3">
        <div className="flex flex-col gap-2 sm:gap-3">
          {/* The search takes the full width of the card at every size — the
              same opening row the Transactions and Maintenance cards use — so
              nothing is left hanging beside it on a wide screen. */}
          <div className="flex items-center gap-2" data-tour="tools-search">
            <div className="min-w-0 flex-1">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search by name, ID, brand, serial or location…"
              />
            </div>
            {/* The phone's filters: one square control at the end of the search
                row, opening every filter in a sheet. */}
            <div data-tour="tools-filters" className="sm:hidden">
              <MobileFilterBar
                iconOnly
                filters={MOBILE_FILTERS}
                hasFilters={hasFilters}
                onClear={resetFilters}
              />
            </div>
          </div>

          {/* The desktop row: dropdowns that wrap rather than scroll, then the
              count and the view switch pushed to the far end of the same row. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {!studentViewer && (
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={[{ value: 'all', label: 'All statuses' }, ...TOOL_STATUSES]}
              />
            )}
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={[{ value: 'all', label: 'All categories' }, ...CATEGORIES]}
            />
            <FilterSelect
              label="Condition"
              value={condition}
              onChange={setCondition}
              options={[{ value: 'all', label: 'All conditions' }, ...CONDITIONS]}
            />
            <FilterSelect
              label="Location"
              value={location}
              onChange={setLocation}
              options={[{ value: 'all', label: 'All locations' }, ...LOCATIONS]}
            />
            <FilterSelect label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
            {hasFilters && (
              <button type="button" onClick={resetFilters} className="btn btn-ghost btn-sm shrink-0">
                Clear
              </button>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ResultCount loading={loading} shown={filtered.length} total={tools.length} />
              <ViewSwitch view={view} onChange={setView} options={VIEW_OPTIONS} />
            </div>
          </div>

          {/* The phone's second row: two separate controls, but the count
              stretches across whatever the switch does not take, so the row is
              used end to end rather than leaving a gap between them. */}
          <div className="flex items-center gap-2 sm:hidden">
            <ResultCount
              loading={loading}
              shown={filtered.length}
              total={tools.length}
              className="min-w-0 flex-1"
            />
            <ViewSwitch view={view} onChange={setView} options={VIEW_OPTIONS} />
          </div>
        </div>
      </div>

      {/* ------------------------------ results ------------------------------
          `data-tour` is on the wrapper rather than on the grid or the table, so
          the walkthrough highlights the records whichever view is showing — and
          still has something to point at while they are loading or while a filter
          leaves the list empty. */}
      <div data-tour="tools-list">
        {error ? (
          <div className="card">
            <ErrorState
              title="The inventory could not be loaded"
              description={error.message}
              onRetry={reload}
            />
          </div>
        ) : loading && !tools.length ? (
          <div className="card">
            <SkeletonRows rows={6} columns={5} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <EmptyState
              // Adding the first tool is the raised "+" in the bottom bar and
              // the button above the list on the desktop, so it is not offered
              // a third time here.
              icon={PackageSearch}
              title="No tools found."
              description={
                hasFilters
                  ? 'No tools match the current search and filters.'
                  : 'The inventory is empty. The first tool added generates its own QR code.'
              }
              action={
                hasFilters ? (
                  <button type="button" onClick={resetFilters} className="btn btn-outline">
                    Clear filters
                  </button>
                ) : null
              }
            />
          </div>
        ) : view === 'list' ? (
          <ToolList
            tools={filtered}
            can={can}
            onEdit={openEdit}
            onQR={setQrTool}
            onDelete={requestDelete}
            onStatus={runStatusAction}
            user={user}
          />
        ) : view === 'table' ? (
          <ToolTable
            tools={filtered}
            can={can}
            onEdit={openEdit}
            onQR={setQrTool}
            onDelete={requestDelete}
            onStatus={runStatusAction}
            user={user}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                can={can}
                onEdit={openEdit}
                onQR={setQrTool}
                onDelete={requestDelete}
                onStatus={runStatusAction}
                user={user}
              />
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------ dialogs ------------------------------ */}
      <ToolForm
        open={formOpen}
        tool={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => setFormOpen(false)}
      />
      <QRCodeModal tool={qrTool} open={!!qrTool} onClose={() => setQrTool(null)} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm?.({ force: confirm.force })}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.variant}
        loading={busy}
      />

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent(user)} />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Row / card actions
 * ------------------------------------------------------------------ */

function useToolActions({ tool, user, onStatus }) {
  return useMemo(() => {
    const items = []
    if (tool.status !== TOOL_STATUS.MAINTENANCE) {
      items.push({
        key: 'maintenance',
        label: 'Mark for maintenance',
        icon: HardHat,
        run: () =>
          onStatus(
            tool,
            () => toolService.markMaintenance(tool.id, user, 'Sent for maintenance.'),
            'sent for maintenance',
          ),
      })
    }
    if (tool.status !== TOOL_STATUS.DAMAGED) {
      items.push({
        key: 'damaged',
        label: 'Mark as damaged',
        icon: ShieldAlert,
        run: () =>
          onStatus(
            tool,
            () => toolService.markDamaged(tool.id, user, 'Reported damaged.'),
            'marked as damaged',
          ),
      })
    }
    if (tool.status !== TOOL_STATUS.LOST) {
      items.push({
        key: 'lost',
        label: 'Report lost',
        icon: PackageSearch,
        run: () =>
          onStatus(tool, () => toolService.markLost(tool.id, user, 'Reported lost.'), 'reported lost'),
      })
    }
    if (tool.status !== TOOL_STATUS.AVAILABLE) {
      items.push({
        key: 'restore',
        label: 'Restore to available',
        icon: RotateCcw,
        run: () =>
          onStatus(
            tool,
            () => toolService.restore(tool.id, user, 'Restored to service.'),
            'restored to available',
          ),
      })
    }
    return items
  }, [tool, user, onStatus])
}

const MENU_WIDTH = 224

/**
 * Row/card action menu.
 *
 * The panel is portalled to the body and positioned from the trigger's viewport
 * rect: inside the table it would otherwise be clipped by the horizontal scroll
 * container, and inside a card by the card's own bounds.
 */
function ActionMenu({ tool, can, onEdit, onQR, onDelete, onStatus, user }) {
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const statusActions = useToolActions({ tool, user, onStatus })

  const open = !!position
  const close = () => setPosition(null)

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    )
    // Flip above the trigger when there is not enough room below.
    const spaceBelow = window.innerHeight - rect.bottom
    setPosition({
      left,
      top: spaceBelow > 300 ? rect.bottom + 4 : undefined,
      bottom: spaceBelow > 300 ? undefined : window.innerHeight - rect.top + 4,
    })
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return
      close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    // Any scroll would detach the panel from its trigger, so close instead.
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const canEdit = can(PERM.TOOL_EDIT)
  const canStatus = can(PERM.TOOL_STATUS)
  const canDelete = can(PERM.TOOL_DELETE)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          open ? close() : place()
        }}
        className="btn btn-ghost btn-icon"
        aria-label={`Actions for ${tool.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="card fixed z-[60] overflow-hidden p-1 shadow-panel animate-slide-up"
            style={{ ...position, width: MENU_WIDTH }}
            role="menu"
          >
            {isStaff(user) && (
              <MenuItem
                icon={QrCode}
                label="View QR code"
                onClick={() => {
                  close()
                  onQR(tool)
                }}
              />
            )}
            <MenuItem icon={Wrench} label="Open tool page" to={`/tools/${tool.id}`} />
            {canEdit && (
              <MenuItem
                icon={Pencil}
                label="Edit tool"
                onClick={() => {
                  close()
                  onEdit(tool)
                }}
              />
            )}

            {canStatus && statusActions.length > 0 && (
              <>
                <div className="my-1 border-t" />
                {statusActions.map((action) => (
                  <MenuItem
                    key={action.key}
                    icon={action.icon}
                    label={action.label}
                    onClick={() => {
                      close()
                      action.run()
                    }}
                  />
                ))}
              </>
            )}

            {canDelete && (
              <>
                <div className="my-1 border-t" />
                <MenuItem
                  icon={Trash2}
                  label="Delete tool"
                  danger
                  onClick={() => {
                    close()
                    onDelete(tool)
                  }}
                />
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

function MenuItem({ icon: Icon, label, onClick, to, danger }) {
  const className = cx(
    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
    danger
      ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'hover:bg-black/5 dark:hover:bg-white/5',
  )
  if (to) {
    return (
      <Link to={to} className={className} role="menuitem">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={className} role="menuitem">
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  )
}

function ToolCard({ tool, ...actions }) {
  return (
    <article className="card group flex flex-col p-4 transition-all hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        {/* The picture leads the card at the same size as the status tiles
            elsewhere; a tool without one keeps the icon tile. */}
        <Link to={`/tools/${tool.id}`} className="shrink-0">
          <ToolImage tool={tool} className="h-12 w-12" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            to={`/tools/${tool.id}`}
            className="block truncate text-sm font-bold leading-tight hover:underline"
          >
            {tool.name}
          </Link>
          <p className="subtle mono mt-0.5 text-xs">{tool.id}</p>
        </div>
        <ActionMenu tool={tool} {...actions} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={tool.status} />
        <ConditionBadge condition={tool.condition} />
      </div>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span
            className="badge border-transparent px-1.5 py-0"
            style={{ background: 'rgb(var(--surface-3))', color: 'rgb(var(--text-muted))' }}
          >
            {tool.category}
          </span>
        </div>
        <div className="muted flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{tool.location}</span>
        </div>
        {(tool.brand || tool.model) && (
          <p className="subtle truncate">
            {[tool.brand, tool.model].filter(Boolean).join(' · ')}
          </p>
        )}
        {tool.serialNumber && (
          <p className="subtle mono truncate text-[11px]">S/N {tool.serialNumber}</p>
        )}
      </dl>

      <div className="mt-3 flex gap-2 border-t pt-3">
        <Link to={`/tools/${tool.id}`} className="btn btn-outline btn-sm flex-1">
          Details
        </Link>
        {/* The inventory's way into borrowing: it lands on the request form
            with this tool selected, which is the only place a request record
            is created. A student's list is available tools only. */}
        {isStudent(actions.user) && tool.status === TOOL_STATUS.AVAILABLE && (
          <Link to={`/requests/new?tool=${tool.id}`} className="btn btn-primary btn-sm flex-1">
            <Repeat className="h-3.5 w-3.5" />
            Request
          </Link>
        )}
        {/* The QR panel downloads and prints the shelf label — staff work, and
            the same rule the tool page applies. */}
        {isStaff(actions.user) && (
          <button
            type="button"
            onClick={() => actions.onQR(tool)}
            className="btn btn-outline btn-sm btn-icon shrink-0"
            aria-label={`QR code for ${tool.name}`}
          >
            <QrCode className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  )
}

/**
 * The student's compact list view.
 *
 * One row per tool, sized for a phone and the PWA's narrow layouts: image,
 * name, id, category and shelf in two lines, badges on the right, and the two
 * actions that matter — the tool record and Borrow, which opens the borrow
 * desk with this tool selected. It reads the same `filtered` list as the card
 * view, so search, filters, sorting and the tour all behave identically.
 */
function ToolList({ tools, ...actions }) {
  return (
    <div className="card divide-y overflow-hidden p-0">
      {tools.map((tool) => (
        <div key={tool.id} className="flex items-center gap-3 px-3 py-2.5">
          <Link to={`/tools/${tool.id}`} className="shrink-0">
            <ToolImage tool={tool} className="h-10 w-10" rounded="rounded-md" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              to={`/tools/${tool.id}`}
              className="block truncate text-sm font-bold leading-tight hover:underline"
            >
              {tool.name}
            </Link>
            <p className="subtle mt-0.5 flex items-center gap-1 truncate text-xs">
              <span className="mono shrink-0">{tool.id}</span>
              <span>·</span>
              <span className="truncate">{tool.category}</span>
              <span>·</span>
              <MapPin className="h-3 w-3 shrink-0 opacity-60" />
              <span className="truncate">{tool.location}</span>
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <ConditionBadge condition={tool.condition} />
            <StatusBadge status={tool.status} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link to={`/tools/${tool.id}`} className="btn btn-outline btn-sm">
              Details
            </Link>
            {isStudent(actions.user) && tool.status === TOOL_STATUS.AVAILABLE && (
              <Link to={`/requests/new?tool=${tool.id}`} className="btn btn-primary btn-sm">
                <Repeat className="h-3.5 w-3.5" />
                Request
              </Link>
            )}
            {isStaff(actions.user) && <ActionMenu tool={tool} {...actions} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function ToolTable({ tools, ...actions }) {
  return (
    <SectionCard bodyClassName="p-0">
      <TableWrap>
        <table className="tbl">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Category</th>
              <th>Location</th>
              <th>Condition</th>
              <th>Status</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.id}>
                <td>
                  <Link to={`/tools/${tool.id}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                    <ToolImage tool={tool} className="h-9 w-9" rounded="rounded-md" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{tool.name}</span>
                      <span className="subtle mono block text-xs">{tool.id}</span>
                    </span>
                  </Link>
                </td>
                <td className="whitespace-nowrap text-xs">{tool.category}</td>
                <td className="max-w-[180px] truncate text-xs">{tool.location}</td>
                <td>
                  <ConditionBadge condition={tool.condition} />
                </td>
                <td>
                  <StatusBadge status={tool.status} />
                </td>
                <td>
                  <ActionMenu tool={tool} {...actions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </SectionCard>
  )
}

/**
 * How much of the inventory is on screen — a pill rather than loose type, so it
 * sits on the toolbar as deliberately as the switch beside it.
 */
function ResultCount({ loading, shown, total, className }) {
  return (
    <p
      className={cx(
        'subtle inline-flex min-h-[34px] items-center rounded-xl border px-3',
        'text-[11px] font-bold uppercase tracking-wider',
        className ?? 'shrink-0',
      )}
      style={{ background: 'rgb(var(--surface-2))' }}
    >
      {loading ? 'Loading…' : `${shown} of ${total} tools`}
    </p>
  )
}

/**
 * List or grid. A segmented control: one tinted track with the chosen half
 * filled, so it reads as a switch rather than as two loose icon buttons.
 * Switching is state, not a route — the search and every filter stay put.
 */
function ViewSwitch({ view, onChange, options, bare = false }) {
  return (
    <div
      // `bare` drops the track: the phone's toolbar puts the switch inside the
      // same pill as the count, and a border within a border reads as clutter.
      className={cx(
        'flex shrink-0 items-center gap-0.5',
        !bare && 'rounded-xl border p-0.5',
      )}
      style={bare ? undefined : { background: 'rgb(var(--surface-2))' }}
      role="group"
      aria-label="View"
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = view === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            // Named, not just drawn: two unlabelled glyphs are a guess, and the
            // words cost a few pixels on the one row that has them to spare.
            className={cx(
              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold',
              'uppercase tracking-wide transition-colors',
              active ? 'btn-dark shadow-sm' : 'muted hover:bg-black/[0.04] dark:hover:bg-white/5',
            )}
            aria-label={option.title}
            aria-pressed={active}
            title={option.title}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
