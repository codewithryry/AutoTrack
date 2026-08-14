import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CheckCircle2, Clock, RotateCcw, ShieldCheck, UserRound, XCircle } from 'lucide-react'
import { AppearanceControl, DeleteAccountControl } from '../components/AccountSettings'
import { Badge, PageHeader, SectionCard, SelectField, Spinner, TextField } from '../components/ui'
import Walkthrough, { resetTours, usePageTour } from '../components/Walkthrough'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as userService from '../services/users'
import { ValidationError } from '../services/tools'
import { ROLE, YEAR_LEVELS } from '../utils/constants'
import { formatDate } from '../utils/dates'

/**
 * The signed-in student's own profile.
 *
 * Editing is free; applying is not. A save is submitted for review and parked
 * as a pending change — the approved profile is left exactly as it was until an
 * administrator approves it, and the account keeps working the whole time.
 *
 * Students only, by design. An instructor's or administrator's profile flow is
 * unchanged, so this page shows them their details without the review path.
 */

const STATUS_STYLE = {
  [userService.PROFILE_REVIEW.PENDING]: {
    icon: Clock,
    label: 'Pending approval',
    className:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
  },
  [userService.PROFILE_REVIEW.REJECTED]: {
    icon: XCircle,
    label: 'Not approved',
    className:
      'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200',
  },
  [userService.PROFILE_REVIEW.APPROVED]: {
    icon: CheckCircle2,
    label: 'Approved',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  },
}

const FIELD_LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  studentId: 'Student ID',
  course: 'Course',
  yearLevel: 'Year level',
  department: 'Programme',
  contact: 'Contact number',
}

/**
 * First-run walkthrough for the account page. A student edits their own details
 * and waits for approval; staff read theirs, so each gets its own wording.
 */
const accountTour = (student) =>
  student
    ? [
        {
          target: 'account-form',
          title: 'Your details',
          text: 'Your name, student ID, programme, year level and contact number all live in this form.',
          icon: UserRound,
        },
        {
          target: 'account-approval',
          title: 'Changes need approval',
          text: 'Submitting sends the change to an administrator. Your account keeps working, and your current details stay in place until they approve it.',
          icon: Clock,
        },
        {
          target: 'account-settings',
          title: 'Bring the tours back',
          text: 'Every page explains itself once. Tap here to have all the walkthroughs run again from your next visit.',
          icon: RotateCcw,
        },
      ]
    : [
        {
          target: 'account-form',
          title: 'Your account details',
          text: 'What the laboratory has on file for you. Staff records are edited from the Users page.',
          icon: UserRound,
        },
        {
          target: 'account-settings',
          title: 'Bring the tours back',
          text: 'Tap here to have every page walkthrough run again from your next visit.',
          icon: RotateCcw,
        },
      ]

export default function ProfilePage() {
  const { user, refreshUser } = useApp()
  const toast = useToast()
  const { hash } = useLocation()

  const isStudent = user?.role === ROLE.STUDENT
  const reviewStatus = user?.profileReviewStatus ?? userService.PROFILE_REVIEW.APPROVED
  const pending = user?.pendingProfile ?? null

  // The form starts from the approved profile, patched with anything already
  // waiting — so a student sees what they submitted, not a stale copy.
  const initial = useMemo(() => {
    const base = userService.effectiveProfile(user) ?? {}
    return Object.fromEntries(
      userService.SELF_EDITABLE_FIELDS.map((f) => [f, base[f] ?? '']),
    )
  }, [user])

  // Once per account on this device, remembered separately from every other page.
  const tour = usePageTour('account', user?.id)
  const tourSteps = useMemo(() => accountTour(isStudent), [isStudent])

  /** Forgets every page's tour for this account so they all run again. */
  const restartTours = () => {
    resetTours(user?.id)
    toast.success('The walkthroughs will run again the next time you open each page.')
  }

  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(initial), [initial])

  // The account menu's Settings entry is `/profile#settings`; the router does not
  // scroll to a hash on its own, so the card is brought into view here.
  useEffect(() => {
    if (hash !== '#settings') return
    document.getElementById('settings')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [hash])

  const setField = (name) => (value) => {
    setForm((f) => ({ ...f, [name]: value?.target?.value ?? value }))
    setErrors((e) => ({ ...e, [name]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setErrors({})
    setSaving(true)
    try {
      await userService.submitProfileChanges(form, user)
      await refreshUser()
      toast.success('Your changes were sent to an administrator for approval.', {
        title: 'Submitted for approval',
      })
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors ?? {})
      else if (err?.name === 'NoChangesError') toast.info('Nothing has changed yet.')
      else toast.error(err.message ?? 'Your changes could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  const badge = STATUS_STYLE[reviewStatus] ?? STATUS_STYLE.Approved
  const BadgeIcon = badge.icon

  return (
    <>
      {/* The sidebar and the sticky header already name this page, so it keeps
          only its approval badge. */}
      <PageHeader hideTitle>
        <Badge className={badge.className}>
          <BadgeIcon className="h-3 w-3" />
          {badge.label}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard
          title={isStudent ? 'Edit your details' : 'Your details'}
          description={
            isStudent
              ? 'Changes are sent to an administrator for approval before they replace your profile.'
              : undefined
          }
          data-tour="account-form"
        >
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="First name"
                value={form.firstName ?? ''}
                onChange={setField('firstName')}
                error={errors.firstName}
                disabled={!isStudent}
              />
              <TextField
                label="Last name"
                value={form.lastName ?? ''}
                onChange={setField('lastName')}
                error={errors.lastName}
                disabled={!isStudent}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Student ID"
                value={form.studentId ?? ''}
                onChange={setField('studentId')}
                error={errors.studentId}
                placeholder="MCC-0000-0000"
                className="mono"
                disabled={!isStudent}
              />
              <TextField
                label="Programme"
                value={form.department ?? ''}
                onChange={setField('department')}
                error={errors.department}
                disabled={!isStudent}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Year level"
                value={form.yearLevel ?? ''}
                onChange={setField('yearLevel')}
                error={errors.yearLevel}
                options={YEAR_LEVELS}
                placeholder="Select a year level"
                disabled={!isStudent}
              />
              <TextField
                label="Contact number"
                value={form.contact ?? ''}
                onChange={setField('contact')}
                error={errors.contact}
                placeholder="0917 000 0000"
                disabled={!isStudent}
              />
            </div>

            <TextField
              label="Email address"
              value={user?.email ?? ''}
              onChange={() => {}}
              disabled
              hint="Your sign-in address cannot be changed here."
            />

            {/* One clear action row, separated from the fields above it and
                full-width on a phone so it stays inside the thumb's reach. */}
            {isStudent && (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
                <p className="subtle flex-1 text-xs leading-snug">
                  Your current details stay in place until an administrator approves the change.
                </p>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg w-full sm:w-auto"
                  disabled={saving}
                >
                  {saving && <Spinner />}
                  Submit for approval
                </button>
              </div>
            )}
          </form>
        </SectionCard>

        <div className="space-y-4">
          {/* The account menu's Settings entry lands here. It holds the one
              preference this page owns: whether the guided tours run again. */}
          <SectionCard
            id="settings"
            title="Settings"
            description="Preferences for this device"
            data-tour="account-settings"
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Guided walkthroughs</p>
                  <p className="subtle text-xs leading-snug">
                    Each page explains itself once. Show them all again from the next visit.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={restartTours}
                  className="btn btn-outline w-full shrink-0 sm:w-auto"
                >
                  <RotateCcw className="h-4 w-4" />
                  Show tours again
                </button>
              </div>

              <div className="border-t pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Appearance</p>
                    <p className="subtle text-xs leading-snug">
                      Choose how the app looks on this device.
                    </p>
                  </div>
                  <AppearanceControl className="w-full shrink-0 sm:w-64" />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Approval status" data-tour="account-approval">
            <div className={`rounded-lg border px-3.5 py-3 ${badge.className}`}>
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <BadgeIcon className="h-4 w-4" />
                {badge.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {reviewStatus === userService.PROFILE_REVIEW.PENDING
                  ? 'An administrator is reviewing your changes. Your account works normally in the meantime, and your current details stay in place until they are approved.'
                  : reviewStatus === userService.PROFILE_REVIEW.REJECTED
                    ? user?.profileReviewNote ||
                      'Your last changes were not approved. Your previous details are unchanged.'
                    : 'Your profile is up to date. Edit it above to submit a change.'}
              </p>
              {user?.profileReviewedAt && reviewStatus !== userService.PROFILE_REVIEW.PENDING && (
                <p className="mt-1.5 text-[11px] opacity-80">
                  Reviewed {formatDate(user.profileReviewedAt)}
                </p>
              )}
              {user?.profileSubmittedAt && reviewStatus === userService.PROFILE_REVIEW.PENDING && (
                <p className="mt-1.5 text-[11px] opacity-80">
                  Submitted {formatDate(user.profileSubmittedAt)}
                </p>
              )}
            </div>
          </SectionCard>

          {pending && (
            <SectionCard title="Waiting for approval" description="What you asked to change">
              <dl className="space-y-2.5">
                {Object.entries(pending).map(([field, value]) => (
                  <div key={field} className="text-sm">
                    <dt className="subtle text-[11px] font-bold uppercase tracking-wider">
                      {FIELD_LABELS[field] ?? field}
                    </dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="subtle line-through">{user?.[field] || '—'}</span>
                      <span aria-hidden="true">→</span>
                      <span className="font-semibold">{value || '—'}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
          )}

          {!isStudent && (
            <SectionCard title="About this page">
              <p className="muted flex gap-2 text-sm leading-relaxed">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                Approval applies to student accounts. Your own details are managed from the Users
                page.
              </p>
            </SectionCard>
          )}

          <SectionCard title="Account" description="Irreversible actions on this account">
            <DeleteAccountControl />
          </SectionCard>
        </div>
      </div>

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} />
    </>
  )
}
