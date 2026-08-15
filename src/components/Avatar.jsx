import { useState } from 'react'
import { cx, initials } from '../utils/helpers'

/**
 * Somebody's face, or their initials.
 *
 * One component wherever an account is named, so a profile photo appears in the
 * same shape everywhere and an account without one keeps exactly the tile the
 * app has always drawn. A URL that fails to load falls back to the initials
 * too — a broken picture is the same thing as no picture here.
 *
 * The size is the caller's: pass the height/width classes it already used.
 */
export default function Avatar({ name, url, className, style, alt }) {
  const [failed, setFailed] = useState(false)
  const show = url && !failed

  return (
    <span
      className={cx(
        'grid shrink-0 place-items-center overflow-hidden rounded-full font-extrabold',
        className,
      )}
      style={
        show
          ? undefined
          : (style ?? { background: 'rgb(var(--rail))', color: 'rgb(var(--accent))' })
      }
    >
      {show ? (
        <img
          src={url}
          alt={alt ?? `${name ?? 'Account'} profile picture`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  )
}
