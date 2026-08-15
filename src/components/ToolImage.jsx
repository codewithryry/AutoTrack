import { useState } from 'react'
import { Wrench } from 'lucide-react'
import { cx } from '../utils/helpers'

/**
 * A tool's picture, or the tile the inventory has always drawn without one.
 *
 * The picture is optional on every tool, so the fallback is not an error state:
 * it is the same tinted surface and muted wrench the tool rows already use, at
 * whatever size the caller asks for. A URL that fails to load — an object
 * removed behind the record's back, or an offline first paint — falls back to
 * exactly the same tile rather than a broken image icon.
 */
export default function ToolImage({ tool, className, rounded = 'rounded-lg', alt }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : tool?.imageUrl

  return (
    <div
      className={cx('relative grid shrink-0 place-items-center overflow-hidden', rounded, className)}
      style={{ background: 'rgb(var(--surface-3))' }}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? tool?.name ?? 'Tool'}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          // `contain`, not `cover`: a tool photo is a record of the thing, so
          // the whole of it has to be visible. Portrait, landscape and square
          // pictures all fit inside the same tile and letterbox against the
          // surface behind them rather than being cropped to fill it.
          //
          // Positioned rather than laid out: this tile is a centred grid, and a
          // grid item that is centred rather than stretched resolves `h-full`
          // against its own content — a tall photo in the phone's wide, short
          // tile grew past the tile and `overflow-hidden` cut its top and
          // bottom off, which is the crop the picture showed on a phone.
          // `inset-0` pins the element to the tile at every width instead, so
          // `object-contain` is what decides how the picture sits inside it.
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <Wrench className="h-1/2 w-1/2 opacity-30" aria-hidden="true" />
      )}
    </div>
  )
}
