import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, ShieldCheck, XCircle } from 'lucide-react'
import { SectionCard, SelectField, Spinner, TextField } from '../components/ui'
import { DeleteAccountControl } from '../components/AccountSettings'
import Walkthrough, { usePageTour } from '../components/Walkthrough'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import * as userService from '../services/users'
import { ValidationError } from '../services/tools'
import { ROLE, YEAR_LEVELS } from '../utils/constants'
import { cx } from '../utils/helpers'
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
 * What an instructor account may do, in the words of the job rather than the
 * permission names. Read straight off the instructor row of the permission
 * matrix in `utils/permissions.js` — nothing here grants anything.
 */
const INSTRUCTOR_CAPABILITIES = [
  'View the inventory, edit tool records and change a tool’s status.',
  'Scan a tool label to see its status, its borrower and the loan behind it.',
  'Issue tools to yourself or to any student, and receive anyone’s return.',
  'See every transaction in the laboratory, extend a due date, or report a tool lost.',
  'Schedule, update and complete maintenance on laboratory equipment.',
  'Read the laboratory’s staff notifications.',
]

/** The counterpart list: what the role deliberately does not carry. */
const INSTRUCTOR_LIMITS = [
  'Creating, editing or deleting user accounts — the directory stays with the administrator.',
  'Laboratory configuration and reports.',
  'Clearing the notification centre for everyone.',
]

/**
 * The administrator's counterpart lists — the admin row of the same permission
 * matrix, in the words of the job. Nothing here grants anything.
 */
const ADMIN_CAPABILITIES = [
  'Register, edit, retire and delete tool records, and print their QR labels.',
  'Issue and receive tools for anyone, extend a due date, or report a tool lost.',
  'Create, edit and delete user accounts, and approve student profile changes.',
  'Schedule, update and complete maintenance on laboratory equipment.',
  'Read the laboratory reports and export the records from Settings.',
  'Configure the laboratory and manage the stored data.',
]

/**
 * First-run walkthrough for the account page. A student edits their own details
 * and waits for approval; staff read theirs, so each gets its own wording.
 */
const accountTour = (student, instructor = false) =>
  student
    ? [
        {
          target: 'account-form',
          title: 'Your details',
          text: 'Your name, student ID, programme, year level and contact number all live in this form.',
        },
        {
          target: 'account-approval',
          title: 'Changes need approval',
          text: 'Submitting sends the change to an administrator. Your account keeps working, and your current details stay in place until they approve it.',
        },
      ]
    : instructor
      ? [
          {
            target: 'account-form',
            title: 'Your account details',
            text: 'What the laboratory has on file for you, read-only. Ask the laboratory administrator to correct anything that is wrong.',
          },
          {
            target: 'account-role',
            title: 'What your role covers',
            text: 'The instructor account in the words of the job — what you may do at the counter, and the few things that stay with the administrator.',
          },
          {
            target: 'account-danger',
            title: 'Closing the account',
            text: 'Deleting your own account is permanent and asks for your email typed out first. Your transaction history stays in the laboratory record.',
          },
        ]
      : [
          {
            target: 'account-form',
            title: 'Your account details',
            text: 'What the laboratory has on file for you. Your own edits save straight away — student records go through the approval queue instead.',
          },
          {
            target: 'account-role',
            title: 'What your role covers',
            text: 'The administrator account in the words of the job: the tools, accounts, servicing, reports and configuration you control.',
          },
          {
            target: 'account-danger',
            title: 'Closing the account',
            text: 'Deleting your own account is permanent and asks for your email typed out first. Every other account is managed from the Users page.',
          },
        ]

export default function ProfilePage() {
  const { user, refreshUser } = useApp()
  const toast = useToast()

  const isStudent = user?.role === ROLE.STUDENT
  const isInstructor = user?.role === ROLE.INSTRUCTOR
  const isAdmin = user?.role === ROLE.ADMIN
  // Neither staff account is enrolled and neither goes through the approval
  // queue, so the student-only fields and the review card are dropped for both.
  const isStaffAccount = isInstructor || isAdmin
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
  const tourSteps = useMemo(() => accountTour(isStudent, isInstructor), [isStudent, isInstructor])

  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(initial), [initial])

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
      // Placed against the form the change was submitted from, so the notice
      // reads as an answer to that action rather than a banner in the shell.
      toast.success('Your changes were sent to an administrator for approval.', {
        title: 'Submitted for approval',
        anchor: '[data-tour="account-form"]',
      })
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors ?? {})
      else if (err?.name === 'NoChangesError')
        toast.info('Nothing has changed yet.', { anchor: '[data-tour="account-form"]' })
      else toast.error(err.message ?? 'Your changes could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  const badge = STATUS_STYLE[reviewStatus] ?? STATUS_STYLE.Approved

  const isPending = reviewStatus === userService.PROFILE_REVIEW.PENDING

  return (
    <>
      {/* A submission in review is the first thing on the page: it explains why
          the form below is showing what it is showing. Nothing else about the
          review flow changes. */}
      {isPending && (
        <div className={`mb-4 rounded-xl border px-4 py-3.5 ${badge.className}`}>
          <p className="text-sm font-bold">{badge.label}</p>
          <p className="mt-1 text-xs leading-relaxed">
            An administrator is reviewing your changes. Your account works normally in the
            meantime, and your current details stay in place until they are approved.
          </p>
          {user?.profileSubmittedAt && (
            <p className="mt-2 text-[11px] font-semibold opacity-80">
              Submitted {formatDate(user.profileSubmittedAt)}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* The form is one submission split across two grouped cards, so the
            fields read as sections rather than as one long column. The field
            grid stays two columns at every width — the fields are short, and
            one column per field would make the card scroll on a phone. */}
        <form onSubmit={submit} className="space-y-3" noValidate data-tour="account-form">
          <SectionCard title="Personal information">
            <div className="grid grid-cols-2 gap-3">
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
              {/* A student number is a student's field — an instructor has none,
                  so the row would only ever read as an empty box on their page. */}
              {!isStaffAccount && (
                <TextField
                  label="Student ID"
                  value={form.studentId ?? ''}
                  onChange={setField('studentId')}
                  error={errors.studentId}
                  placeholder="MCC-0000-0000"
                  className="mono"
                  disabled={!isStudent}
                />
              )}
              {!isStaffAccount && (
                <TextField
                  label="Contact number"
                  value={form.contact ?? ''}
                  onChange={setField('contact')}
                  error={errors.contact}
                  placeholder="0917 000 0000"
                  disabled={!isStudent}
                />
              )}
              <div className="col-span-2">
                <TextField
                  label="Email address"
                  value={user?.email ?? ''}
                  onChange={() => {}}
                  disabled
                  hint="Your sign-in address cannot be changed here."
                />
              </div>
            </div>
          </SectionCard>

          {/* An instructor is not enrolled: they keep the department they teach in
              and drop the year level entirely, so this card is theirs rather than
              a student's form with two boxes greyed out. */}
          <SectionCard title={isStaffAccount ? 'Department' : 'Academic information'}>
            <div className={cx('grid gap-3', !isStaffAccount && 'grid-cols-2')}>
              <TextField
                label={isStaffAccount ? 'Department' : 'Programme'}
                value={form.department ?? ''}
                onChange={setField('department')}
                error={errors.department}
                disabled={!isStudent}
              />
              {!isStaffAccount && (
                <SelectField
                  label="Year level"
                  value={form.yearLevel ?? ''}
                  onChange={setField('yearLevel')}
                  error={errors.yearLevel}
                  options={YEAR_LEVELS}
                  placeholder="Select a year level"
                  disabled={!isStudent}
                />
              )}
            </div>
          </SectionCard>

          {/* The action area, deliberately outside the field cards: the
              explanation belongs to the button, not to a form row. */}
          {isStudent && (
            <div className="card p-4">
              <p className="subtle text-xs leading-relaxed">
                Changes are sent to an administrator for approval. Your current details stay in
                place until the change is approved.
              </p>
              <button type="submit" className="btn btn-primary btn-lg mt-3 w-full" disabled={saving}>
                {saving && <Spinner />}
                Submit for approval
              </button>
            </div>
          )}
        </form>

        <div className="space-y-4">
          {/* While a change is in review the banner at the top of the page says
              this already, so the card only carries the settled states. It is
              dropped for an instructor: their fields are read-only, so "Edit it
              above to submit a change" describes something they cannot do. */}
          {!isPending && !isStaffAccount && (
            <SectionCard title="Approval status" data-tour="account-approval">
              <div className={`rounded-lg border px-3.5 py-3 ${badge.className}`}>
                <p className="text-sm font-bold">{badge.label}</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {reviewStatus === userService.PROFILE_REVIEW.REJECTED
                    ? user?.profileReviewNote ||
                      'Your last changes were not approved. Your previous details are unchanged.'
                    : 'Your profile is up to date. Edit it above to submit a change.'}
                </p>
                {user?.profileReviewedAt && (
                  <p className="mt-1.5 text-[11px] opacity-80">
                    Reviewed {formatDate(user.profileReviewedAt)}
                  </p>
                )}
              </div>
            </SectionCard>
          )}

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

          {/* An instructor cannot open the Users page, so telling them their
              details are edited there sent them to a route that answers
              "Restricted area". They are told who does hold the record instead,
              and given the operational summary that makes this page worth
              opening — read-only, and with nothing from user management on it. */}
          {isInstructor && (
            <>
              <SectionCard title="About this page">
                <p className="muted flex gap-2 text-sm leading-relaxed">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                  These are the details the laboratory holds for you. Staff records are maintained
                  by the laboratory administrator — ask them to correct anything that is wrong
                  here. The approval flow applies to student accounts only.
                </p>
              </SectionCard>

              <SectionCard
                data-tour="account-role"
                title="Your role in the laboratory"
                description="What an instructor account may do"
              >
                <ul className="space-y-2">
                  {INSTRUCTOR_CAPABILITIES.map((line) => (
                    <li key={line} className="flex gap-2 text-sm leading-relaxed">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="muted">{line}</span>
                    </li>
                  ))}
                </ul>

                {/* The other half of the answer: the two or three things a
                    colleague will otherwise go looking for and not find. */}
                <p className="subtle mt-4 text-[11px] font-bold uppercase tracking-wider">
                  Not part of this role
                </p>
                <ul className="mt-2 space-y-2">
                  {INSTRUCTOR_LIMITS.map((line) => (
                    <li key={line} className="flex gap-2 text-sm leading-relaxed">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 opacity-40" />
                      <span className="muted">{line}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </>
          )}

          {!isStudent && !isInstructor && (
            <>
              <SectionCard title="About this page">
                <p className="muted flex gap-2 text-sm leading-relaxed">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                  This is your own administrator account — the details the laboratory holds for
                  you. Edit them, and every other staff and student record, from the Users page.
                  The approval flow applies to student accounts only; yours saves straight away.
                </p>
              </SectionCard>

              <SectionCard
                data-tour="account-role"
                title="Your role in the laboratory"
                description="What an Admin account may do"
              >
                <ul className="space-y-2">
                  {ADMIN_CAPABILITIES.map((line) => (
                    <li key={line} className="flex gap-2 text-sm leading-relaxed">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="muted">{line}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </>
          )}

        </div>
      </div>

      {/* Last on the page and on its own, so nothing destructive sits beside an
          ordinary field. The confirmation flow is the control's own. */}
      <SectionCard
        data-tour="account-danger"
        title="Danger zone"
        description="Irreversible actions on this account"
        className="mt-4"
      >
        <DeleteAccountControl />
      </SectionCard>

      <Walkthrough steps={tourSteps} open={tour.open} onClose={tour.close} compact={isStudent} />
    </>
  )
}
