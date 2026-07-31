import {
  FolderSearch,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Scan,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ImageViewerProps {
  src: string
  fileName: string
  onClose: () => void
  onReveal: () => void
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4

export function ImageViewer({ src, fileName, onClose, onReveal }: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

  function resetView() {
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }

  function zoom(delta: number) {
    setScale((current) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta))
      if (next <= 1) setOffset({ x: 0, y: 0 })
      return next
    })
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === '+' || event.key === '=') zoom(0.25)
      if (event.key === '-') zoom(-0.25)
      if (event.key === '0') resetView()
      if (event.key.toLowerCase() === 'r') setRotation((value) => value + 90)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="结果大图查看">
      <header className="image-viewer__header">
        <div>
          <span>RESULT PREVIEW</span>
          <strong>{fileName}</strong>
        </div>
        <div className="image-viewer__tools">
          <button onClick={() => zoom(-0.25)} aria-label="缩小" disabled={scale <= MIN_SCALE}>
            <Minus size={17} />
          </button>
          <output>{Math.round(scale * 100)}%</output>
          <button onClick={() => zoom(0.25)} aria-label="放大" disabled={scale >= MAX_SCALE}>
            <Plus size={17} />
          </button>
          <i />
          <button onClick={resetView} aria-label="适应窗口" title="适应窗口（0）">
            <Scan size={17} />
          </button>
          <button
            onClick={() => setRotation((value) => value - 90)}
            aria-label="向左旋转"
            title="向左旋转"
          >
            <RotateCcw size={17} />
          </button>
          <button
            onClick={() => setRotation((value) => value + 90)}
            aria-label="向右旋转"
            title="向右旋转（R）"
          >
            <RotateCw size={17} />
          </button>
          <i />
          <button onClick={onReveal} aria-label="定位文件" title="在文件夹中显示">
            <FolderSearch size={17} />
          </button>
          <button className="image-viewer__close" onClick={onClose} aria-label="关闭大图">
            <X size={19} />
          </button>
        </div>
      </header>

      <div
        className={`image-viewer__stage ${dragging ? 'is-dragging' : ''}`}
        onDoubleClick={resetView}
        onWheel={(event) => {
          event.preventDefault()
          zoom(event.deltaY < 0 ? 0.15 : -0.15)
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragStart.current = {
            x: event.clientX,
            y: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y
          }
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (!dragging) return
          setOffset({
            x: dragStart.current.offsetX + event.clientX - dragStart.current.x,
            y: dragStart.current.offsetY + event.clientY - dragStart.current.y
          })
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <img
          src={src}
          alt={`${fileName} 大图`}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`
          }}
        />
        <div className="image-viewer__hint">
          滚轮缩放 · 拖动查看 · 双击适应 · ESC 关闭
        </div>
      </div>
    </div>,
    document.body
  )
}
