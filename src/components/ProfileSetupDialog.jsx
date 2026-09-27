import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, SelectField, Spinner, TextField } from './ui'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { ValidationError } from '../services/tools'
import { OTHER_OPTION, PROGRAMMES } from '../utils/constants'

const BLANK = { studentId: '', department: PROGRAMMES[0], departmentOther: '', contact: '' }

/**
 * Required details for a new student account created with Google.
 *
 * Google supplies the name and email; the student ID and programme it cannot.
 * The account is only created once this is submitted, so it cannot be closed
 * by accident — "Cancel sign-up" is the only other way out, and it signs the
 * Google session out again without creating anything. The fields and their
 * checks are the same as the student fields on the Create Account form.
 */
export default function ProfileSetupDialog() {
  const { profileSetup, finishProfileSetup, cancelProfileSetup } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const isOther = form.department === OTHER_OPTION

  const setField = (field) => (event) => {
    setForm((f) => ({ ...f, [field]: event.target.value }))
    const shown = field === 'departmentOther' ? 'department' : field
    setErrors((e) => ({ ...e, [shown]: undefined, form: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const profile = await finishProfileSetup({
        studentId: form.studentId,
        department: isOther ? form.departmentOther : form.department,
        contact: form.contact,
      })
      setForm(BLANK)
      toast.success('Account created successfully.', {
        title: `Welcome, ${profile.fullName.split(' ')[0]}`,
      })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors)
      else setErrors({ form: err?.message ?? 'Your account could not be created. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const cancel = async () => {
    setSaving(true)
    await cancelProfileSetup()
    setSaving(false)
    setForm(BLANK)
    setErrors({})
    navigate('/signup', { replace: true })
  }

  return (
    <Modal
      open={!!profileSetup}
      onClose={cancel}
      dismissible={false}
      title="Complete your student details"
      description={profileSetup ? `${profileSetup.fullName} · ${profileSetup.email}` : undefined}
      footer={
        <>
          <button type="button" onClick={cancel} disabled={saving} className="btn btn-outline">
            Cancel sign-up
          </button>
          <button type="submit" form="profile-setup-form" disabled={saving} className="btn btn-primary">
            {saving && <Spinner />}
            {saving ? 'Creating account…' : 'Finish sign-up'}
          </button>
        </>
      }
    >
      <form id="profile-setup-form" onSubmit={submit} className="space-y-3" noValidate>
        <p className="muted text-xs leading-relaxed">
          Your Google account is connected. Add these details to finish creating your Tool Track
          account.
        </p>
        {errors.form && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium
                       text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {errors.form}
          </div>
        )}
        <TextField
          label="Student ID"
          required
          value={form.studentId}
          onChange={setField('studentId')}
          error={errors.studentId}
          placeholder="MCC-0000-0000"
          className="mono"
        />
        <SelectField
          label="Programme"
          required
          value={form.department}
          onChange={setField('department')}
          error={isOther ? undefined : errors.department}
          options={PROGRAMMES}
        />
        {isOther && (
          <TextField
            label="Programme (please specify)"
            required
            value={form.departmentOther}
            onChange={setField('departmentOther')}
            error={errors.department}
          />
        )}
        <TextField
          label="Contact number"
          value={form.contact}
          onChange={setField('contact')}
          error={errors.contact}
          placeholder="0917 000 0000"
          hint="Optional — the tool room uses it to reach you."
        />
      </form>
    </Modal>
  )
}
