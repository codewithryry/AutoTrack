import { useEffect, useRef, useState } from 'react'
import { Download, Printer, QrCode } from 'lucide-react'
import { Modal, Spinner } from './ui'
import { useToast } from '../context/ToastContext'
import { useApp } from '../context/AppContext'
import { downloadQR, drawToCanvas, printQRLabels } from '../utils/qr'

/** Renders a tool's QR code onto a canvas. */
export function QRCanvas({ toolId, size = 200, className }) {
  const canvasRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    drawToCanvas(canvasRef.current, toolId, { size }).catch((err) => {
      console.error('[qr] render failed', err)
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [toolId, size])

  if (failed) {
    return (
      <div
        className="grid place-items-center rounded-lg border border-dashed p-4 text-center"
        style={{ width: size, height: size }}
      >
        <p className="subtle text-xs">QR code could not be rendered.</p>
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-label={`QR code for ${toolId}`}
      role="img"
    />
  )
}

/** Full QR panel with download and print actions. */
export function QRCodePanel({ tool, size = 200 }) {
  const toast = useToast()
  const { settings } = useApp()
  const [printing, setPrinting] = useState(false)

  const handleDownload = async () => {
    try {
      await downloadQR(tool)
      toast.success(`QR code for ${tool.id} downloaded.`)
    } catch (err) {
      toast.error(err.message ?? 'Unable to download the QR code.')
    }
  }

  const handlePrint = async () => {
    setPrinting(true)
    try {
      await printQRLabels([tool], { labName: settings.labName })
    } catch (err) {
      toast.error(err.message ?? 'Unable to open the print window.')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-xl bg-white p-3 shadow-card ring-1 ring-black/5">
        <QRCanvas toolId={tool.id} size={size} />
      </div>
      <p className="mono mt-2.5 text-sm font-bold tracking-wide">{tool.id}</p>
      <p className="subtle text-center text-xs">Scan this code to borrow or return</p>

      <div className="mt-3 flex w-full gap-2">
        <button type="button" onClick={handleDownload} className="btn btn-outline btn-sm flex-1">
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="btn btn-outline btn-sm flex-1"
          disabled={printing}
        >
          {printing ? <Spinner className="h-3.5 w-3.5" /> : <Printer className="h-3.5 w-3.5" />}
          Print label
        </button>
      </div>
    </div>
  )
}

/** Modal wrapper, used from the tools list row menu. */
export function QRCodeModal({ tool, open, onClose }) {
  if (!tool) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tool.name}
      description={`${tool.category} · ${tool.location}`}
      size="sm"
      footer={
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Close
        </button>
      }
    >
      <QRCodePanel tool={tool} size={220} />
    </Modal>
  )
}

export const QRIcon = QrCode
