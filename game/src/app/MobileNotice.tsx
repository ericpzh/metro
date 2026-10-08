// What a phone or tablet sees instead of the game: a single plain page that
// asks for a computer. It is all that main.tsx mounts in mobile mode, so the
// scene, the simulation and the three.js bundle never load.

import { useState } from 'react'

export function MobileNotice({ onProceed }: { onProceed: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context or denied): the address bar is
      // still there to copy from by hand.
    }
  }

  return (
    <div className="mobileGate">
      <div className="mobileCard">
        <div className="mobileBrand">地铁站设计师</div>
        <h1>请在电脑上打开</h1>
        <p className="mobileLead">本游戏需要鼠标和键盘，手机和平板暂时无法游玩。</p>
        <p className="muted">请用电脑浏览器打开同一个网址，就能开始设计地铁站。</p>

        <ul className="mobileWhy">
          <li>用鼠标旋转视角，建造和拆除设备</li>
          <li>用键盘切换楼层、撤销和重做</li>
          <li>在更宽的屏幕上，才看得清整座车站</li>
        </ul>

        <button className="primary mobileCopy" onClick={() => void copy()}>
          {copied ? '已复制，请粘贴到电脑浏览器' : '复制本页网址'}
        </button>
        <button className="mobileContinue" onClick={onProceed}>
          仍要继续
        </button>
      </div>
    </div>
  )
}
