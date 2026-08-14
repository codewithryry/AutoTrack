import { APP_NAME } from '../utils/constants'
import { cx } from '../utils/helpers'

/**
 * Branding for the two public authentication screens.
 *
 * Used only by `LoginPage` and `SignUpPage` — it is deliberately not wired into
 * the application shell, whose branding is unchanged.
 *
 * The institutional marks are real image files, so the sizing does the work:
 * `h-*` fixes the height, `w-auto` lets each keep its own aspect ratio, and
 * `object-contain` stops either being stretched. `min-w-0` on the row plus
 * `max-w-full` on each image is what guarantees they shrink rather than push
 * the page sideways at 320 px.
 */

/** Re-exported so the auth screens have one name to import. */
export const BRAND_NAME = APP_NAME

/** The two institutional logos, side by side. */
export function InstitutionLogos({ className, onDark = false, size = 'md' }) {
  const height = size === 'sm' ? 'h-9 sm:h-10' : 'h-11 sm:h-12'
  return (
    <div className={cx('flex min-w-0 flex-wrap items-center gap-2.5 sm:gap-3', className)}>
      {[
        { src: '/MINSU.png', alt: 'Mindoro State University' },
        { src: '/BTVTEDLOGO.png', alt: 'Bachelor of Technical-Vocational Teacher Education' },
      ].map(({ src, alt }) => (
        <span
          key={src}
          className={cx(
            'grid min-w-0 shrink place-items-center rounded-xl p-1.5',
            // A light chip keeps a dark-inked logo legible on the dark panel.
            onDark ? 'bg-white/90 ring-1 ring-white/25' : 'bg-white ring-1 ring-black/5',
          )}
        >
          <img
            src={src}
            alt={alt}
            loading="eager"
            decoding="async"
            className={cx(height, 'w-auto max-w-full object-contain')}
          />
        </span>
      ))}
    </div>
  )
}

/**
 * Logos plus the wordmark, as the header of each auth screen.
 *
 * `tracking-[0.2em]` and the weight match the existing headings rather than
 * introducing a new type treatment.
 */
export function AuthBrandLockup({ onDark = false, className, align = 'center' }) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      <InstitutionLogos onDark={onDark} />
      <div className="min-w-0">
        <p
          className={cx(
            'text-balance break-words text-lg font-extrabold tracking-[0.06em] sm:text-xl',
            onDark ? 'text-white' : '',
          )}
        >
          {BRAND_NAME}
        </p>
      </div>
    </div>
  )
}
