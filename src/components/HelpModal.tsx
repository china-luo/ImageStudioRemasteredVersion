import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { AppMode } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { APP_REPOSITORY_URL } from '../lib/appBrand'
import { CloseIcon, HelpCircleIcon } from './icons'

interface HelpModalProps {
  appMode: AppMode
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function HelpModal({ appMode, onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  const modalRef = useRef<HTMLDivElement>(null)
  const isAgentMode = appMode === 'agent'
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)

  return createPortal(
    <div data-no-drag-select className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="ui-backdrop animate-overlay-in absolute inset-0" />
      <div
        ref={modalRef}
        className="ui-modal animate-modal-in relative z-10 flex max-h-[85vh] w-full max-w-md flex-col p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2.5 text-base font-bold text-[var(--text-1)]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <HelpCircleIcon className="h-4 w-4" />
            </span>
            操作指南
          </h3>
          <button onClick={onClose} className="ui-icon-btn ui-icon-btn-sm" aria-label="关闭">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="custom-scrollbar mb-5 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1 text-sm text-[var(--text-2)]">
          {isAgentMode ? (
            <section className="ui-inset p-4">
              <ul className="list-disc space-y-2 pl-4 leading-relaxed">
                <li>需要使用 Responses API 配置。</li>
                <li>如需 Agent 搜索互联网或读取 URL 内容，可在设置的 Agent 配置中开启“网络搜索”。</li>
                <li>
                  输入 <strong className="font-semibold text-[var(--accent)]">@</strong>{' '}
                  可引用参考图或前面轮次生成的图片；Agent 也会自行参考上下文中的图片。
                </li>
                <li>编辑某轮消息重新发送，或重新生成某轮消息，会产生可切换的分支。</li>
                <li>生成的图片会同步到画廊；删除对话默认不会删除画廊中的记录。</li>
              </ul>
            </section>
          ) : isMobile ? (
            <>
              <section className="ui-inset p-4">
                <h4 className="mb-2.5 text-sm font-semibold text-[var(--text-1)]">多选记录</h4>
                <p className="leading-relaxed">
                  在历史记录卡片上<strong className="font-semibold text-[var(--accent)]">左右滑动</strong>
                  即可选中或取消选中该卡片。
                </p>
              </section>
              <section className="ui-inset p-4">
                <h4 className="mb-2.5 text-sm font-semibold text-[var(--text-1)]">批量操作</h4>
                <p className="leading-relaxed">
                  选中一条或多条记录后，页面底部会出现操作栏，支持
                  <strong className="font-semibold text-[var(--text-1)]">取消选择</strong>、
                  <strong className="font-semibold text-[var(--accent)]">全选当前可见记录</strong>、
                  <strong className="font-semibold text-amber-500">批量收藏</strong>、
                  <strong className="font-semibold text-emerald-500">批量下载</strong>，和
                  <strong className="font-semibold text-red-500">批量删除</strong>。
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="ui-inset p-4">
                <h4 className="mb-2.5 text-sm font-semibold text-[var(--text-1)]">快捷导航</h4>
                <ul className="list-disc space-y-2 pl-4 leading-relaxed">
                  <li>
                    按 <kbd className="ui-kbd">Ctrl</kbd> + <kbd className="ui-kbd">K</kbd> 或{' '}
                    <kbd className="ui-kbd">⌘</kbd> + <kbd className="ui-kbd">K</kbd>{' '}
                    打开快捷命令面板，快速切换工作空间与深浅主题。
                  </li>
                  <li>点击左侧栏顶部折叠按钮可切换紧凑图标栏模式，获得更大创作画布。</li>
                </ul>
              </section>
              <section className="ui-inset p-4">
                <h4 className="mb-2.5 text-sm font-semibold text-[var(--text-1)]">多选记录</h4>
                <ul className="list-disc space-y-2 pl-4 leading-relaxed">
                  <li>
                    使用鼠标在空白处<strong className="font-semibold text-[var(--accent)]">拖拽框选</strong>。
                  </li>
                  <li>
                    按住 <kbd className="ui-kbd">Ctrl</kbd> 或 <kbd className="ui-kbd">⌘</kbd>{' '}
                    并点击卡片，可添加或移除单项。
                  </li>
                  <li>再次框选已选中的卡片会将其取消选中。</li>
                  <li>点击卡片外任意空白处可取消所有选择。</li>
                </ul>
              </section>
              <section className="ui-inset p-4">
                <h4 className="mb-2.5 text-sm font-semibold text-[var(--text-1)]">批量操作</h4>
                <p className="leading-relaxed">
                  选中一条或多条记录后，页面底部会出现操作栏，支持
                  <strong className="font-semibold text-[var(--text-1)]">取消选择</strong>、
                  <strong className="font-semibold text-[var(--accent)]">全选当前可见记录</strong>、
                  <strong className="font-semibold text-amber-500">批量收藏</strong>、
                  <strong className="font-semibold text-emerald-500">批量下载</strong>，和
                  <strong className="font-semibold text-red-500">批量删除</strong>。
                </p>
              </section>
            </>
          )}
        </div>

        <div className="border-t border-[var(--line)] pt-4">
          <a
            href={APP_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="mx-auto flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.589 2 12.253c0 4.531 2.865 8.374 6.839 9.731.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.186-1.11-1.502-1.11-1.502-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.565 2.341 1.113 2.91.851.091-.662.349-1.113.635-1.369-2.221-.259-4.556-1.138-4.556-5.064 0-1.119.39-2.034 1.029-2.751-.103-.26-.446-1.303.098-2.716 0 0 .84-.276 2.75 1.051A9.384 9.384 0 0 1 12 6.957a9.37 9.37 0 0 1 2.504.345c1.909-1.327 2.747-1.051 2.747-1.051.546 1.413.203 2.456.1 2.716.64.717 1.028 1.632 1.028 2.751 0 3.936-2.339 4.802-4.566 5.056.359.317.678.943.678 1.9 0 1.371-.012 2.477-.012 2.816 0 .274.18.594.688.493C21.138 20.623 24 16.782 24 12.253 24 6.589 19.523 2 12 2Z"
              />
            </svg>
            @china-luo
          </a>
        </div>
      </div>
    </div>,
    document.body,
  )
}
