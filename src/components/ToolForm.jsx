import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import {
  Field,
  Modal,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from './ui'
import ToolImage from './ToolImage'
import * as storage from '../services/storage'
import { useToast } from '../context/ToastContext'
import { useApp } from '../context/AppContext'
import { useMediaQuery } from '../hooks'
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

/**
 * Does this browser understand `<input capture>` at all?
 *
 * Read once from the element itself rather than sniffed from the user agent.
 * The companion half — whether the device has a camera worth opening — is the
 * coarse-pointer query below, which is what separates a phone or tablet from a
 * desktop where `capture` is understood but only reopens the file picker.
 */
const CAPTURE_SUPPORTED =
  typeof document !== 'undefined' && 'capture' in document.createElement('input')

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
  imageUrl: null,
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

  // A touch device — a phone or tablet, installed or in a tab — is where
  // `capture` opens the camera rather than the file picker.
  const touchDevice = useMediaQuery('(pointer: coarse)')
  const cameraSupported = CAPTURE_SUPPORTED && touchDevice

  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  // The picture is uploaded on selection so the dialog can show it, which means
  // the object can outlive the choice: a replaced or removed URL is retired
  // once the record no longer points at it, and only then.
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef(null)
  const cameraInput = useRef(null)
  const retired = useRef([])

  useEffect(() => {
    if (!open) return
    setErrors({})
    retired.current = []

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

  /** Upload the chosen file and point the form at it. */
  const pickImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so choosing the same file twice still fires
    if (!file) return

    const invalid = storage.validateImageFile(file)
    if (invalid) {
      setErrors((e) => ({ ...e, imageUrl: invalid }))
      return
    }

    setUploading(true)
    setErrors((e) => ({ ...e, imageUrl: undefined }))
    try {
      const url = await storage.uploadToolImage(file, form.id || tool?.id)
      // Replacing: the picture being displaced is retired once the save lands.
      if (form.imageUrl) retired.current.push(form.imageUrl)
      setForm((f) => ({ ...f, imageUrl: url }))
    } catch (err) {
      const message =
        err instanceof ValidationError
          ? (err.errors?.imageUrl ?? 'That image could not be used.')
          : (err.message ?? 'The image could not be uploaded.')
      setErrors((e) => ({ ...e, imageUrl: message }))
    } finally {
      setUploading(false)
    }
  }

  const removeImage = () => {
    if (form.imageUrl) retired.current.push(form.imageUrl)
    setForm((f) => ({ ...f, imageUrl: null }))
    setErrors((e) => ({ ...e, imageUrl: undefined }))
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
      // The record is saved and no longer points at these, so the objects they
      // named are removed. Best-effort by design — see `services/storage.js`.
      for (const url of retired.current) {
        if (url !== saved.imageUrl) await storage.removeToolImage(url)
      }
      retired.current = []

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

          {/* Optional throughout: a tool without a picture shows the same tile
              the inventory draws for it, and saves exactly as before. */}
          <Field
            label="Picture"
            error={errors.imageUrl}
            hint={
              errors.imageUrl
                ? undefined
                : 'Optional. JPEG, PNG or WebP, up to 5 MB — shown on the tool card and its page.'
            }
          >
            <div className="mt-1 flex items-center gap-3">
              <ToolImage
                tool={form}
                className="h-20 w-20 border"
                rounded="rounded-xl"
                alt={form.name ? `Picture of ${form.name}` : 'Tool picture'}
              />
              <div className="flex min-w-0 flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept={storage.IMAGE_ACCEPT}
                  onChange={pickImage}
                  className="hidden"
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading || saving}
                >
                  {uploading ? <Spinner /> : <ImagePlus className="h-4 w-4" />}
                  {form.imageUrl ? 'Replace' : 'Upload'}
                </button>

                {/* The camera, through the browser's own capability rather than
                    a library: `capture` asks a phone to open the camera app
                    directly, and the file it hands back is an ordinary File —
                    so it goes through the same validation, upload and save as
                    a picture chosen from disk. Offered only where the input
                    actually supports it. */}
                {cameraSupported && (
                  <>
                    <input
                      ref={cameraInput}
                      type="file"
                      accept={storage.IMAGE_ACCEPT}
                      capture="environment"
                      onChange={pickImage}
                      className="hidden"
                    />
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => cameraInput.current?.click()}
                      disabled={uploading || saving}
                    >
                      <Camera className="h-4 w-4" />
                      Take a picture
                    </button>
                  </>
                )}
                {form.imageUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={removeImage}
                    disabled={uploading || saving}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </Field>
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
