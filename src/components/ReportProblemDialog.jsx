import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, SelectField, Spinner, TextAreaField } from './ui'
import { useToast } from '../context/ToastContext'
import * as maintenanceService from '../services/maintenance'
import { MAINTENANCE_TYPES } from '../utils/constants'

/**
 * Report a problem with the tool currently being looked at.
 *
 * The tool is passed in and never typed: this opens from the scan result and
 * from the tool's own page, so by the time anybody can press it the tool is
 * already identified. That is the whole point of the flow — scan, look, report,
 * without transcribing a Tool ID from a label.
 *
 * A report becomes a corrective maintenance record in `Scheduled`, which is the
 * same row the service log already lists. No separate reports system, no new
 * table: staff work reported faults and planned services from one queue.
 *
 * Every role may report. The database function behind it decides what a report
 * is allowed to contain, so a student filing one and an administrator filing one
 * produce the same record.
 */
export default function ReportProblemDialog({ tool, open, onClose, onReported }) {
  const toast = useToast()

  // `Corrective` is the existing type for something that is wrong now, as
  // opposed to a service that was planned. It is the right default for the one
  // action called "report a problem".
  const [type, setType] = useState('Corrective')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  // A fresh form each time it opens, so a previous draft never attaches itself
  // to a different tool.
  useEffect(() => {
    if (!open) return
    setType('Corrective')
    setDescription('')
    setErrors({})
    setBusy(false)
  }, [open, tool?.id])

  const submit = async (event) => {
    event.preventDefault()
    // The guard against a double tap. The database also collapses a repeat
    // within five minutes, so a dropped connection and a retry cannot file the
    // same fault twice either.
    if (busy) return

    setBusy(true)
    setErrors({})
    try {
      await maintenanceService.reportProblem({
        toolId: tool.id,
        type,
        description,
      })
      toast.success('Thank you — the laboratory staff have been notified.', {
        title: 'Problem reported',
      })
      onReported?.()
      onClose()
    } catch (err) {
      // `ValidationError` carries per-field messages; anything else is a single
      // sentence about the attempt rather than about one input.
      if (err?.errors) setErrors(err.errors)
      else toast.error(err?.message ?? 'The report could not be sent.')
      setBusy(false)
    }
  }

  if (!tool) return null

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Report a problem"
      description={`${tool.name} · ${tool.id}`}
    >
      <form onSubmit={submit} className="space-y-3">
        {/* What is being reported against, so nobody has to trust that the right
            tool was picked up from the screen behind the dialog. */}
        <div
          className="flex items-start gap-2.5 rounded-lg border p-3"
          style={{ background: 'rgb(var(--surface-2))' }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <p className="subtle text-xs leading-relaxed">
            This report is filed against <span className="font-semibold">{tool.name}</span> and goes
            to the laboratory staff, who will decide what happens next. The tool's status is not
            changed by reporting it.
          </p>
        </div>

        <SelectField
          label="What kind of problem?"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={MAINTENANCE_TYPES}
          error={errors.type}
          required
        />

        <TextAreaField
          label="What is wrong?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          hint="What you noticed, and when. Staff see this on the service log."
          rows={4}
          maxLength={500}
          required
        />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner />}
            Send report
          </button>
        </div>
      </form>
    </Modal>
  )
}
