import * as db from './db'
import { ValidationError } from './tools'

/**
 * File storage.
 *
 * One bucket, `tool-images`, created by `0011_tool_images.sql`. The rules there
 * are the authority on who may write — this module only carries the client-side
 * half so a bad file is refused before it is sent, with the same wording the
 * forms use for every other field.
 *
 * A tool's picture is optional everywhere, so every function here fails soft in
 * the one direction that matters: a delete that cannot be performed is reported
 * and ignored, never allowed to fail the tool save it followed.
 */

export const TOOL_IMAGE_BUCKET = 'tool-images'

/** One folder per account, created by `0022_profile_photos.sql`. */
export const AVATAR_BUCKET = 'avatars'

/** Matched by the bucket's own `allowed_mime_types` and `file_size_limit`. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** The `accept` attribute for a file input, from the list above. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

/**
 * Check a chosen file before it is uploaded.
 *
 * Type only. The size is checked after compression, where it is the size that
 * is actually being sent — a 9 MB photo straight off a phone camera is a normal
 * thing to choose, and it lands well under the limit once resized.
 *
 * @returns {string|null} the error to show against the field, or null
 */
export function validateImageFile(file) {
  if (!file) return null
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Choose a JPEG, PNG or WebP image.'
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Compression
 *
 * A tool photo is a shelf reference, not a print: about 1280px on its long
 * edge at 82% quality is where it stops looking like a photograph of a wrench
 * and starts looking like a smaller file. Everything here runs in the browser
 * before the upload, so the bucket only ever receives the compressed image.
 * ------------------------------------------------------------------ */

export const MAX_IMAGE_DIMENSION = 1280
export const IMAGE_QUALITY = 0.82

/** Does this browser encode WebP from a canvas? Asked once, cheaply. */
let webpSupport = null
function supportsWebP() {
  if (webpSupport !== null) return webpSupport
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpSupport = false
  }
  return webpSupport
}

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality))

/**
 * Resize and re-encode an image for upload.
 *
 * The aspect ratio is preserved exactly — the long edge is capped and the short
 * edge follows it, so portrait, landscape and square photos are all scaled,
 * never cropped or stretched. An image already inside the cap is not enlarged.
 *
 * WebP where the browser can encode it, JPEG otherwise. Anything that cannot be
 * decoded, encoded, or that comes out no smaller than it went in, falls through
 * to the original file: compression is an optimisation, never a reason for a
 * picture to fail to upload.
 *
 * @param {File} file
 * @returns {Promise<File|Blob>} the file to upload
 */
export async function compressImage(file, { maxDimension = MAX_IMAGE_DIMENSION } = {}) {
  if (!file?.type?.startsWith('image/')) return file
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // not decodable here — let the upload carry the original
  }

  try {
    const { width, height } = bitmap
    if (!width || !height) return file

    // One scale factor for both axes: that is what keeps the ratio exact.
    const scale = Math.min(1, maxDimension / Math.max(width, height))
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) return file
    // Better downscaling than the default on every engine that offers it.
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    const type = supportsWebP() ? 'image/webp' : 'image/jpeg'
    const blob = await canvasToBlob(canvas, type, IMAGE_QUALITY)
    if (!blob) return file

    // Whichever is actually smaller wins. A photograph always compresses; a
    // picture that is already small, already WebP, or unusually hard to encode
    // can come back larger than it went in, and uploading the bigger of the two
    // would defeat the point. This is also what stops a second edit of the same
    // tool re-encoding a picture that has nothing left to give.
    if (blob.size >= file.size) return file

    const base = String(file.name ?? 'tool-image').replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.${type === 'image/webp' ? 'webp' : 'jpg'}`, { type })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}

const extensionFor = (file) => {
  const fromName = String(file.name ?? '').split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  return file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
}

/**
 * Upload a tool's picture and return its public URL.
 *
 * The object is named after the tool with a timestamp, so replacing a picture
 * writes a new object rather than relying on a cache to expire — the old one is
 * removed by the caller once the record points at the new URL.
 *
 * @param {File} file
 * @param {string} toolId
 * @returns {Promise<string>} public URL to store on the tool record
 */
export async function uploadToolImage(file, toolId) {
  const error = validateImageFile(file)
  if (error) throw new ValidationError({ imageUrl: error })

  // Both entry points — a file chosen from disk and a photo taken with the
  // camera — arrive here, so compressing at this point covers both with one
  // rule and nothing reaches the bucket uncompressed.
  const upload = await compressImage(file)

  // The limit is the bucket's own, so it is checked against what is actually
  // being sent. A picture still over it after resizing is genuinely too big.
  if (upload.size > MAX_IMAGE_BYTES) {
    throw new ValidationError({
      imageUrl: `That image is still too large after compression (max ${Math.round(
        MAX_IMAGE_BYTES / 1024 / 1024,
      )} MB). Try a smaller picture.`,
    })
  }

  const safeId = String(toolId ?? 'tool').replace(/[^A-Za-z0-9-]/g, '') || 'tool'
  const path = `${safeId}/${Date.now()}.${extensionFor(upload)}`

  try {
    return await db.uploadFile(TOOL_IMAGE_BUCKET, path, upload, { contentType: upload.type })
  } catch (err) {
    throw new Error(
      /does not exist on this database/.test(err?.message ?? '')
        ? 'Tool images are not set up on this database yet (migration 0011).'
        : (err?.message ?? 'The image could not be uploaded.'),
    )
  }
}

/** The object path inside the bucket for a public URL this module wrote. */
function pathFromPublicUrl(url) {
  if (typeof url !== 'string') return null
  const marker = `/${TOOL_IMAGE_BUCKET}/`
  const at = url.indexOf(marker)
  if (at === -1) return null
  const path = url.slice(at + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

/**
 * Delete a picture that is no longer referenced.
 *
 * Best-effort: the tool record is the source of truth, and an orphaned object
 * costs a few kilobytes. A URL from anywhere else is ignored rather than
 * guessed at.
 */
export async function removeToolImage(url) {
  const path = pathFromPublicUrl(url)
  if (!path) return false
  try {
    return await db.removeFile(TOOL_IMAGE_BUCKET, path)
  } catch (err) {
    console.warn('[storage] tool image could not be removed', path, err)
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Profile photos
 *
 * The same pipeline as a tool picture — validate, compress in the browser,
 * upload — against the `avatars` bucket, whose policies only let an account
 * write inside its own folder. Smaller on the long edge, because this is only
 * ever drawn as a circle a few dozen pixels across.
 * ------------------------------------------------------------------ */

const AVATAR_DIMENSION = 512

/**
 * Upload an account's own picture and return its public URL.
 *
 * The object is `<uid>/<timestamp>.<ext>`: the first segment is what the policy
 * checks against the signed-in account, and the timestamp means replacing a
 * photo writes a new object rather than waiting for a cache to expire.
 */
export async function uploadAvatar(file, userId) {
  const error = validateImageFile(file)
  if (error) throw new ValidationError({ avatarUrl: error })
  if (!userId) throw new Error('No account to attach the picture to.')

  const upload = await compressImage(file, { maxDimension: AVATAR_DIMENSION })
  if (upload.size > MAX_IMAGE_BYTES) {
    throw new ValidationError({
      avatarUrl: `That image is still too large after compression (max ${Math.round(
        MAX_IMAGE_BYTES / 1024 / 1024,
      )} MB). Try a smaller picture.`,
    })
  }

  const path = `${String(userId).replace(/[^A-Za-z0-9-]/g, '')}/${Date.now()}.${extensionFor(upload)}`
  try {
    return await db.uploadFile(AVATAR_BUCKET, path, upload, { contentType: upload.type })
  } catch (err) {
    throw new Error(
      /does not exist on this database/.test(err?.message ?? '')
        ? 'Profile photos are not set up on this database yet (migration 0022).'
        : (err?.message ?? 'The picture could not be uploaded.'),
    )
  }
}

/** Delete a picture that is no longer referenced. Best-effort, like the tools'. */
export async function removeAvatar(url) {
  if (typeof url !== 'string') return false
  const marker = `/${AVATAR_BUCKET}/`
  const at = url.indexOf(marker)
  if (at === -1) return false
  const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0])
  if (!path) return false
  try {
    return await db.removeFile(AVATAR_BUCKET, path)
  } catch (err) {
    console.warn('[storage] avatar could not be removed', path, err)
    return false
  }
}
