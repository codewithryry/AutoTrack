import { useEffect, useState } from 'react'
import {
  Modal,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from './ui'
import { useToast } from '../context/ToastContext'
import { useApp } from '../context/AppContext'
import * as toolService from '../services/tools'
import { ValidationError } from '../services/tools'
import {
  CATEGORIES,
  CONDITIONS,
  LOCATIONS,
  SERIAL_CRITICAL_CATEGORIES,
  TOOL_STATUS,
  TOOL_STATUSES,
} from '../utils/constants'
import { toDateInput, fromDateInput, addDaysISO } from '../utils/dates'

const BLANK = {
  id: '',
  name: '',
  category: '',
  description: '',
  brand: '',
  model: '',
  serialNumber: '',
  location: '',
  condition: '',
  status: TOOL_STATUS.AVAILABLE,
  purchaseDate: '',
  lastMaintenanceDate: '',
  nextMaintenanceDate: '',
  notes: '',
}

/**
 * Create/edit tool dialog.
 *
 * Validation runs in the service layer so the same rules apply to any future
 * caller; this component just renders the returned field errors.
 */
export default function ToolForm({ open, onClose, tool, onSaved }) {
  const { user, settings } = useApp()
  const toast = useToast()
  const isEdit = !!tool

  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})

    if (tool) {
      setForm({
        ...BLANK,
        ...tool,
        purchaseDate: toDateInput(tool.purchaseDate),
        lastMaintenanceDate: toDateInput(tool.lastMaintenanceDate),
        nextMaintenanceDate: toDateInput(tool.nextMaintenanceDate),
      })
    } else {
      // Pre-fill the next sequential id so the QR code is predictable.
      toolService.nextToolId().then((id) =>
        setForm({
          ...BLANK,
          id,
          nextMaintenanceDate: toDateInput(
            addDaysISO(new Date(), settings.maintenanceIntervalDays),
          ),
        }),
      )
    }
  }, [open, tool, settings.maintenanceIntervalDays])

  const setField = (field) => (event) => {
    const value = event?.target ? event.target.value : event
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})

    const payload = {
      ...form,
      purchaseDate: fromDateInput(form.purchaseDate),
      lastMaintenanceDate: fromDateInput(form.lastMaintenanceDate),
      nextMaintenanceDate: fromDateInput(form.nextMaintenanceDate),
    }

    try {
      const saved = isEdit
        ? await toolService.updateTool(tool.id, payload, user)
        : await toolService.create(payload, user)
      toast.success(
        isEdit ? `${saved.name} was updated.` : `${saved.name} was added to the inventory.`,
        { title: isEdit ? 'Tool updated' : 'Tool added' },
      )
      onSaved?.(saved)
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) {
        setErrors(err.errors)
        toast.error('Please correct the highlighted fields.')
      } else {
        toast.error(err.message ?? 'Unable to save the tool.')
      }
    } finally {
      setSaving(false)
    }
  }

  const serialRequired = SERIAL_CRITICAL_CATEGORIES.includes(form.category)

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={isEdit ? `Edit ${tool.name}` : 'Add a tool'}
      description={
        isEdit
          ? `Tool ID ${tool.id} — the QR code stays the same.`
          : 'A unique QR code is generated from the Tool ID.'
      }
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="tool-form" className="btn btn-primary" disabled={saving}>
            {saving && <Spinner />}
            {isEdit ? 'Save changes' : 'Add tool'}
          </button>
        </>
      }
    >
      <form id="tool-form" onSubmit={submit} className="space-y-5" noValidate>
        <fieldset className="space-y-4">
          <legend className="label mb-2">Identification</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Tool ID"
              required
              value={form.id}
              onChange={setField('id')}
              error={errors.id}
              disabled={isEdit}
              hint={isEdit ? 'Tool IDs are permanent.' : 'Format: TOOL-00001'}
              className="mono"
            />
            <TextField
              label="Tool name"
              required
              value={form.name}
              onChange={setField('name')}
              error={errors.name}
              placeholder="e.g. Combination Wrench 14mm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Category"
              required
              value={form.category}
              onChange={setField('category')}
              options={CATEGORIES}
              placeholder="Select a category"
              error={errors.category}
            />
            <SelectField
              label="Storage location"
              required
              value={form.location}
              onChange={setField('location')}
              options={LOCATIONS}
              placeholder="Select a location"
              error={errors.location}
              hint="Where the tool is returned to in the laboratory."
            />
          </div>

          <TextAreaField
            label="Description"
            value={form.description}
            onChange={setField('description')}
            error={errors.description}
            placeholder="What the tool is used for in the workshop."
            rows={2}
          />
        </fieldset>

        <fieldset className="space-y-4 border-t pt-5">
          <legend className="label mb-2">Equipment details</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Brand"
              value={form.brand}
              onChange={setField('brand')}
              error={errors.brand}
              placeholder="e.g. Mitutoyo"
            />
            <TextField
              label="Model"
              value={form.model}
              onChange={setField('model')}
              error={errors.model}
              placeholder="e.g. 530-312"
            />
            <TextField
              label="Serial number"
              value={form.serialNumber}
              onChange={setField('serialNumber')}
              error={errors.serialNumber}
              placeholder={serialRequired ? 'Recommended for this category' : 'Optional'}
              hint={
                serialRequired
                  ? 'Diagnostic and measuring equipment is tracked by serial.'
                  : undefined
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Condition"
              required
              value={form.condition}
              onChange={setField('condition')}
              options={CONDITIONS}
              placeholder="Select a condition"
              error={errors.condition}
            />
            <SelectField
              label="Status"
              value={form.status}
              onChange={setField('status')}
              options={TOOL_STATUSES}
              error={errors.status}
              hint="A tool on loan cannot have its status changed here."
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t pt-5">
          <legend className="label mb-2">Service schedule</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Purchase date"
              type="date"
              value={form.purchaseDate}
              onChange={setField('purchaseDate')}
              error={errors.purchaseDate}
            />
            <TextField
              label="Last maintenance"
              type="date"
              value={form.lastMaintenanceDate}
              onChange={setField('lastMaintenanceDate')}
              error={errors.lastMaintenanceDate}
            />
            <TextField
              label="Next maintenance"
              type="date"
              value={form.nextMaintenanceDate}
              onChange={setField('nextMaintenanceDate')}
              error={errors.nextMaintenanceDate}
            />
          </div>

          <TextAreaField
            label="Notes"
            value={form.notes}
            onChange={setField('notes')}
            error={errors.notes}
            placeholder="Anything a student or instructor should know before using this tool."
            rows={2}
          />
        </fieldset>
      </form>
    </Modal>
  )
}
