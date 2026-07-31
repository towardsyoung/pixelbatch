import { useState } from 'react'

interface CompareViewProps {
  before: string
  after: string
  alt: string
}

export function CompareView({ before, after, alt }: CompareViewProps) {
  const [position, setPosition] = useState(50)

  return (
    <div className="compare">
      <img src={before} alt={`${alt} 处理前`} draggable={false} />
      <div className="compare__after" style={{ width: `${position}%` }}>
        <img src={after} alt={`${alt} 处理后`} draggable={false} />
      </div>
      <div className="compare__line" style={{ left: `${position}%` }}>
        <span />
      </div>
      <span className="compare__label compare__label--before">原图</span>
      <span className="compare__label compare__label--after">结果</span>
      <input
        aria-label="拖动查看处理前后对比"
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
      />
    </div>
  )
}
