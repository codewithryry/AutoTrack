import { useEffect, useState } from 'react'
import { Eye, EyeOff, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  ConfirmDialog,
  EmptyState,
  Modal,
  SectionCard,
  SelectField,
  TextAreaField,
  TextField,
  Toggle,
} from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { useAnnouncements } from '../hooks/useAnnouncements'
import * as announcementService from '../services/announcements'
import { formatDateTime } from '../utils/dates'

const { ANNOUNCEMENT_PRIORITY } = announcementService

const EMPTY_FORM = {
  title: '',
  message: '',
  priority: ANNOUNCEMENT_PRIORITY.NORMAL,
  published: true,
}

const PRIORITY_OPTIONS = Object.values(ANNOUNCEMENT_PRIORITY).map((value) => ({
  value,
  label: value,
}))

/**
 * Settings → Announcements, for Admin and Instructor accounts: create, edit,
 * delete, and publish or unpublish the notices every account sees in the
 * notification centre. The page only mounts it for `ANNOUNCEMENT_MANAGE`, and
 * every write re-checks the permission in the service.
 */
export default function AnnouncementsManager() {
  const { user } = useApp()
  const toast = useToast()
  const { all } = useAnnouncements()
  // null when closed, `{ id: null }` for a new announcement, or the row edited.
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const openEditor = (row) => setEditing(row ?? { id: null })

  const run = (action, success) => {
    try {
      action()
      if (success) toast.success(success)
      return true
    } catch (err) {
      toast.error(err.message ?? 'Unable to save the announcement.')
      return false
    }
  }

  const togglePublished = (row) =>
    run(
      () => announcementService.setPublished(user, row.id, !row.published),
      row.published ? 'Announcement unpublished.' : 'Announcement published.',
    )

  const confirmDelete = () => {
    run(() => announcementService.remove(user, deleting.id), 'Announcement deleted.')
    setDeleting(null)
  }

  return (
    <>
      <SectionCard
        title="Announcements"
        description="Notices every account sees in the announcements panel"
        action={
          <button type="button" onClick={() => openEditor(null)} className="btn btn-primary btn-sm shrink-0">
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        }
        bodyClassName={all.length ? 'p-0' : undefined}
      >
        {all.length ? (
          <ul className="divide-y">
            {all.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="min-w-0 text-sm font-bold">{row.title}</p>
                    {row.priority !== ANNOUNCEMENT_PRIORITY.NORMAL && <Badge>{row.priority}</Badge>}
                    <Badge
                      className={
                        row.published
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : undefined
                      }
                    >
                      {row.published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <p className="muted mt-0.5 line-clamp-2 text-xs">{row.message}</p>
                  <p className="subtle mt-1 text-[11px]">
                    {formatDateTime(row.createdAt)} · {row.authorName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => togglePublished(row)}
                    className="btn btn-ghost btn-icon"
                    aria-label={row.published ? `Unpublish ${row.title}` : `Publish ${row.title}`}
                    title={row.published ? 'Unpublish' : 'Publish'}
                  >
                    {row.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(row)}
                    className="btn btn-ghost btn-icon"
                    aria-label={`Edit ${row.title}`}
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    className="btn btn-ghost btn-icon"
                    aria-label={`Delete ${row.title}`}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={Megaphone}
            title="No announcements yet"
            description="Post a notice for students and staff."
          />
        )}
      </SectionCard>

      <AnnouncementEditor editing={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this announcement?"
        message={`"${deleting?.title ?? ''}" will be removed for every account.`}
        confirmLabel="Delete"
      />
    </>
  )
}

/**
 * Create or edit one announcement — used by Settings → Announcements and by
 * the "New" button in the announcements panel.
 *
 * @param {{ editing: null | { id: null } | object, onClose: () => void }} props
 *   `null` closed, `{ id: null }` for a new announcement, or the row to edit.
 */
export function AnnouncementEditor({ editing, onClose }) {
  const { user } = useApp()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

  // A fresh form every time the editor opens.
  useEffect(() => {
    if (!editing) return
    setForm(
      editing.id
        ? {
            title: editing.title,
            message: editing.message,
            priority: editing.priority,
            published: editing.published,
          }
        : EMPTY_FORM,
    )
    setErrors({})
  }, [editing])

  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const save = (event) => {
    event.preventDefault()
    const validation = announcementService.validate(form)
    if (Object.keys(validation).length) {
      setErrors(validation)
      return
    }
    try {
      if (editing.id) {
        announcementService.update(user, editing.id, form)
        toast.success('Announcement updated.')
      } else {
        announcementService.create(user, form)
        toast.success(form.published ? 'Announcement published.' : 'Announcement saved as a draft.')
      }
      onClose()
    } catch (err) {
      toast.error(err.message ?? 'Unable to save the announcement.')
    }
  }

  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      title={editing?.id ? 'Edit announcement' : 'New announcement'}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-outline">
            Cancel
          </button>
          <button type="submit" form="announcement-form" className="btn btn-primary">
            {editing?.id ? 'Save changes' : form.published ? 'Publish' : 'Save draft'}
          </button>
        </>
      }
    >
      <form id="announcement-form" onSubmit={save} className="space-y-3" noValidate>
        <TextField
          label="Title"
          required
          maxLength={80}
          value={form.title}
          onChange={(e) => setField('title')(e.target.value)}
          error={errors.title}
        />
        <TextAreaField
          label="Message"
          required
          rows={4}
          maxLength={500}
          value={form.message}
          onChange={(e) => setField('message')(e.target.value)}
          error={errors.message}
        />
        <SelectField
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={form.priority}
          onChange={(e) => setField('priority')(e.target.value)}
          error={errors.priority}
        />
        <Toggle
          label="Published"
          description="Unpublished announcements stay in Settings as drafts."
          checked={form.published}
          onChange={setField('published')}
        />
      </form>
    </Modal>
  )
}
