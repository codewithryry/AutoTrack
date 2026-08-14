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

/**
 * The three marks of the row, in the order they are read: the university, the
 * application between them, and the programme.
 *
 * The two institutional seals share one height; `scale` is only used to lift the
 * application's own mark a little above them, so the middle of the row reads as
 * the subject and the seals as its credentials.
 */
const LOGOS = [
  { src: '/MINSU.png', alt: 'Mindoro State University', scale: 1 },
  // The application's own mark, in the middle and a little larger than the two
  // institutional seals beside it.
  { src: '/Logoapp.png', alt: '', scale: 1.3 },
  { src: '/BTVTEDLOGO.png', alt: 'Bachelor of Technical-Vocational Teacher Education', scale: 1 },
]

/**
 * The three marks in a centred row.
 *
 * No chip behind them: they sit straight on the page, so the screen opens on the
 * marks themselves rather than on white boxes.
 */
export function InstitutionLogos({ className, size = 'md' }) {
  // One height for the row, in pixels so each mark can be nudged against it.
  const base = size === 'sm' ? 44 : 56
  return (
    <div
      className={cx('flex min-w-0 flex-wrap items-center justify-center gap-4 sm:gap-5', className)}
    >
      {LOGOS.map(({ src, alt, scale }) => (
        <img
          key={src}
          src={src}
          alt={alt}
          aria-hidden={alt ? undefined : 'true'}
          loading="eager"
          decoding="async"
          style={{ height: base * scale }}
          className="w-auto max-w-full shrink object-contain"
        />
      ))}
    </div>
  )
}

/**
 * Who the marks belong to, set above them.
 *
 * The seals are small at this size and not everyone reads them at a glance, so
 * the university and the programme are named in words as well.
 */
export function InstitutionNames({ className, onDark = false }) {
  return (
    <p
      className={cx(
        'text-balance text-center text-[10.5px] font-bold uppercase leading-relaxed tracking-[0.14em]',
        onDark ? 'text-navy-400' : 'subtle',
        className,
      )}
    >
      Mindoro State University · BTVTEd
    </p>
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
      <InstitutionLogos />
      <AuthWordmark onDark={onDark} />
    </div>
  )
}

/**
 * The wordmark on its own.
 *
 * The phone layout carries the institutional marks in a band across the top of
 * the screen instead of inside the form block, so the block itself needs the
 * name and nothing else.
 */
export function AuthWordmark({ onDark = false, className }) {
  return (
    <p
      className={cx(
        'min-w-0 text-balance break-words text-lg font-extrabold tracking-tight sm:text-xl',
        onDark && 'text-white',
        className,
      )}
    >
      {BRAND_NAME}
    </p>
  )
}
