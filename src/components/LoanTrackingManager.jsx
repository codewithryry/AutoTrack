import { useEffect, useSyncExternalStore } from 'react'
import { MapPin, Settings2 } from 'lucide-react'
import { Modal } from './ui'
import { useApp } from '../context/AppContext'
import * as loanTracking from '../services/loanTracking'

const { TRACKING_STATE } = loanTracking

/**
 * Hands the signed-in account to the loan tracker, and asks for location the
 * one time it is needed: when the account has a borrowed tool and Android has
 * not been told yes yet. Renders nothing otherwise — and nothing at all outside
 * the Android app, where `attach` / `detach` are no-ops.
 */
export default function LoanTrackingManager() {
  const { user, authReady } = useApp()
  const state = useSyncExternalStore(loanTracking.subscribe, loanTracking.getSnapshot)

  // Only once the session is known: a null user while the stored session is
  // still being read is not a sign-out, and must not stop a running tracker.
  useEffect(() => {
    if (!authReady) return
    if (user) void loanTracking.attach(user)
    else void loanTracking.detach({ reason: 'signedOut' })
  }, [authReady, user])

  if (!user) return null

  const asking = state.status === TRACKING_STATE.NEEDS_PERMISSION
  const blocked = state.status === TRACKING_STATE.BLOCKED
  const count = state.loans.length

  return (
    <Modal
      open={asking || blocked}
      onClose={loanTracking.decline}
      title={blocked ? 'Location is turned off for Tool Track' : 'Allow location for your borrowed tool'}
      description={
        count > 1 ? `You have ${count} borrowed tools.` : 'You have a borrowed tool.'
      }
      footer={
        <>
          <button type="button" onClick={loanTracking.decline} className="btn btn-outline">
            Not now
          </button>
          {blocked ? (
            <button type="button" onClick={loanTracking.openSettings} className="btn btn-primary">
              <Settings2 className="h-4 w-4" />
              Open settings
            </button>
          ) : (
            <button type="button" onClick={loanTracking.requestPermission} className="btn btn-primary">
              <MapPin className="h-4 w-4" />
              Allow location
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed">
        <p>{loanTracking.PERMISSION_RATIONALE}</p>
        <p className="muted text-xs">
          Location is recorded only while a tool is out with you — when you move, and at least every
          10 minutes — and stops as soon as it is returned. A notification shows whenever it is on.
        </p>
        {blocked && (
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
            Android is set to refuse location for Tool Track. Open settings, choose Permissions →
            Location, and allow it while using the app.
          </p>
        )}
      </div>
    </Modal>
  )
}
