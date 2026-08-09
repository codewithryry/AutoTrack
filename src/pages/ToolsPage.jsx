import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Download,
  Grid3x3,
  List,
  MapPin,
  MoreVertical,
  Plus,
  Printer,
  QrCode,
  Trash2,
  Pencil,
  Wrench,
  HardHat,
  ShieldAlert,
  RotateCcw,
  PackageSearch,
} from 'lucide-react'
import {
  ConditionBadge,
  ConfirmDialog,
  EmptyState,
  FilterSelect,
  PageHeader,
  SearchInput,
  SectionCard,
  SkeletonRows,
  StatusBadge,
  Spinner,
  TableWrap,
} from '../components/ui'
import ToolForm from '../components/ToolForm'
import { QRCodeModal } from '../components/QRCodeDisplay'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useDebounced, useLocalStorage, useTools } from '../hooks'
import * as toolService from '../services/tools'
import { PERM } from '../utils/permissions'
import { CATEGORIES, CONDITIONS, LOCATIONS, TOOL_STATUS, TOOL_STATUSES } from '../utils/constants'
import { cx, downloadCSV } from '../utils/helpers'
import { formatDate } from '../utils/dates'
import { printQRLabels } from '../utils/qr'

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'id', label: 'Tool ID' },
  { value: 'status', label: 'Status' },
  { value: 'category', label: 'Category' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

const CSV_COLUMNS = [
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

export default function ToolsPage() {
  const { user, can, settings } = useApp()
  const toast = useToast()
  const { tools, loading } = useTools()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all')
  const [category, setCategory] = useState(searchParams.get('category') ?? 'all')
  const [condition, setCondition] = useState('all')
  const [location, setLocation] = useState('all')
  const [sort, setSort] = useState('name-asc')
  const [view, setView] = useLocalStorage('stms.tools.view', 'grid')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [qrTool, setQrTool] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)

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
        status,
        category,
        condition,
        location,
        sort,
      }),
    [tools, debouncedSearch, status, category, condition, location, sort],
  )

  const hasFilters =
    !!debouncedSearch ||
    status !== 'all' ||
    category !== 'all' ||
    condition !== 'all' ||
    location !== 'all'

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

  const openEdit = (tool) => {
    setEditing(tool)
    setFormOpen(true)
  }

  const runStatusAction = async (tool, action, label) => {
    setBusy(true)
    try {
      await action()
      toast.success(`${tool.name} — ${label}.`)
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
      onConfirm: async ({ force = false } = {}) => {
        setBusy(true)
        try {
          await toolService.remove(tool.id, user, { force })
          toast.success(`${tool.name} was deleted.`)
          setConfirm(null)
        } catch (err) {
          if (err.name === 'ActiveTransactionError') {
            // Escalate to an explicit second confirmation rather than silently forcing.
            setConfirm((c) => ({
              ...c,
              title: 'This tool is still on loan',
              message: err.message,
              confirmLabel: 'Delete anyway',
              force: true,
            }))
          } else {
            toast.error(err.message ?? 'Unable to delete the tool.')
          }
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const exportCSV = () => {
    downloadCSV(filtered, CSV_COLUMNS, `tools-${new Date().toISOString().slice(0, 10)}.csv`)
    toast.success(`${filtered.length} tools exported to CSV.`)
  }

  const printAllLabels = async () => {
    if (!filtered.length) return
    setPrinting(true)
    try {
      await printQRLabels(filtered, { labName: settings.labName })
    } catch (err) {
      toast.error(err.message ?? 'Unable to open the print window.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Tool inventory"
        description={`${tools.length} tools registered in ${settings.labName}`}
        icon={Wrench}
      >
        <button
          type="button"
          onClick={exportCSV}
          className="btn btn-outline"
          disabled={!filtered.length}
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </button>
        <button
          type="button"
          onClick={printAllLabels}
          className="btn btn-outline"
          disabled={!filtered.length || printing}
        >
          {printing ? <Spinner /> : <Printer className="h-4 w-4" />}
          <span className="hidden sm:inline">Print labels</span>
        </button>
        {can(PERM.TOOL_CREATE) && (
          <button type="button" onClick={openCreate} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Add tool
          </button>
        )}
      </PageHeader>

      {/* ------------------------------ filters ------------------------------ */}
      <div className="card mb-4 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by name, ID, brand, serial or location…"
              className="flex-1"
            />
            <div className="hidden shrink-0 items-center gap-1 rounded-lg border p-0.5 sm:flex">
              <button
                type="button"
                onClick={() => setView('grid')}
                className={cx('btn btn-sm btn-icon', view === 'grid' ? 'btn-dark' : 'btn-ghost')}
                aria-label="Grid view"
                aria-pressed={view === 'grid'}
              >
                <Grid3x3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                className={cx('btn btn-sm btn-icon', view === 'table' ? 'btn-dark' : 'btn-ghost')}
                aria-label="Table view"
                aria-pressed={view === 'table'}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
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
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="subtle text-xs font-semibold uppercase tracking-wider">
          {loading ? 'Loading…' : `${filtered.length} of ${tools.length} tools`}
        </p>
      </div>

      {/* ------------------------------ results ------------------------------ */}
      {loading && !tools.length ? (
        <div className="card">
          <SkeletonRows rows={6} columns={5} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={PackageSearch}
            title="No tools found."
            description={
              hasFilters
                ? 'No tools match the current search and filters.'
                : 'The inventory is empty. Add the first tool to generate its QR code.'
            }
            action={
              hasFilters ? (
                <button type="button" onClick={resetFilters} className="btn btn-outline">
                  Clear filters
                </button>
              ) : can(PERM.TOOL_CREATE) ? (
                <button type="button" onClick={openCreate} className="btn btn-primary">
                  <Plus className="h-4 w-4" />
                  Add the first tool
                </button>
              ) : null
            }
          />
        </div>
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
        loading={busy}
      />
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
            <MenuItem
              icon={QrCode}
              label="View QR code"
              onClick={() => {
                close()
                onQR(tool)
              }}
            />
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
        <div className="min-w-0">
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
        <button
          type="button"
          onClick={() => actions.onQR(tool)}
          className="btn btn-outline btn-sm btn-icon shrink-0"
          aria-label={`QR code for ${tool.name}`}
        >
          <QrCode className="h-4 w-4" />
        </button>
      </div>
    </article>
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
                  <Link to={`/tools/${tool.id}`} className="block min-w-0 hover:underline">
                    <span className="block truncate font-semibold">{tool.name}</span>
                    <span className="subtle mono block text-xs">{tool.id}</span>
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
