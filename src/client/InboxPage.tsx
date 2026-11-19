/**
 * The Smoothly Chat panel: peer list on the left, one thread on the right,
 * composer at the bottom. Everything it shows comes from the host's mailbox
 * API — no conversation is created, read, or written by this component.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCloseOutlineRegular,
  IconCopyOutlineRegular,
  IconPaperclipOutlineRegular,
  IconPlusOutlineRegular,
  IconRefreshOutlineRegular,
  IconSendOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningTriangleOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { EnvelopeIcon } from './EnvelopeIcon.tsx'
import {
  approveRequest,
  checkUpdates,
  createInvite,
  denyRequest,
  downloadFile,
  formatSize,
  formatTime,
  pairWith,
  retryDelivery,
  selectPeer,
  sendFile,
  sendText,
  setPanelVisible,
  unpairPeer,
  useInbox,
  type PeerView,
  type ThreadMessage,
} from './state.ts'

/** Props injected by the slot framework (locale namespace `smoothly.chat`). */
export interface InboxPageProps {
  /** Bound translator of this plugin's namespace. */
  t?: (key: string) => string
}

/** Replace `{name}` placeholders in a translated template. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => key in vars ? String(vars[key]) : match)
}

/** Build a translator with a raw-key fallback (the framework supplies one in practice). */
function translator(t: InboxPageProps['t']): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => fill(t === undefined ? key : t(key), vars ?? {})
}

/** The panel body. */
export function InboxPage(props: InboxPageProps) {
  const tr = translator(props.t)
  const snapshot = useInbox()
  const { state, threads, selected, loading, error } = snapshot
  const [draft, setDraft] = useState('')
  const [broadcast, setBroadcast] = useState(false)
  const [panel, setPanel] = useState<'none' | 'pair' | 'invite'>('none')
  const [invitation, setInvitation] = useState('')
  const [inviteString, setInviteString] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setPanelVisible(true)
    return () => { setPanelVisible(false) }
  }, [])

  const peers = state?.peers ?? []
  const requests = state?.requests ?? []
  const peer = peers.find(candidate => candidate.deviceId === selected)
  const messages = selected === null ? [] : threads[selected] ?? []

  useEffect(() => {
    if (threadRef.current !== null) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages.length, selected])

  useEffect(() => {
    if (panel !== 'invite' || inviteString !== '') return
    let active = true
    void createInvite()
      .then(invite => { if (active) setInviteString(invite.string) })
      .catch((cause: unknown) => { if (active) setActionError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [panel, inviteString])

  const run = useCallback(async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await task()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const submit = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    void run(async () => {
      await sendText(text, broadcast)
      setDraft('')
    })
  }

  const attach = (files: FileList | null): void => {
    const file = files?.[0]
    if (file === undefined) return
    void run(async () => { await sendFile(file, broadcast) })
  }

  const submitPair = (): void => {
    const value = invitation.trim()
    if (value === '') return
    void run(async () => {
      const paired = await pairWith(value)
      setInvitation('')
      setPanel('none')
      if (paired !== undefined && paired.pairedAt === undefined) setNotice(tr('pairRequestSent'))
    })
  }

  const copyInvite = (): void => {
    if (inviteString === '') return
    void navigator.clipboard.writeText(inviteString).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => { setActionError('clipboard unavailable') })
  }

  const startUnpair = (): void => {
    if (peer === undefined) return
    if (!confirmUnpair) {
      setConfirmUnpair(true)
      return
    }
    setConfirmUnpair(false)
    void run(async () => { await unpairPeer(peer.deviceId) })
  }

  const download = (message: ThreadMessage): void => {
    void downloadFile(message).catch((cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const preview = (candidate: PeerView): string => {
    const thread = threads[candidate.deviceId] ?? []
    const last = thread.at(-1)
    if (candidate.pairedAt === undefined) return tr('pairPending')
    if (last === undefined) return candidate.host
    if (last.kind === 'file') return `📎 ${last.file?.name ?? tr('file')}`
    return last.text ?? ''
  }

  const peerName = (candidate: PeerView): string => candidate.name !== '' ? candidate.name : candidate.deviceId.slice(0, 8)

  return (
    <div
      className={`dsc-root${dragging ? ' dsc-dragover' : ''}`}
      data-dsc-root="smoothly-chat"
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        attach(event.dataTransfer.files)
      }}
    >
      <aside className="dsc-peers">
        <div className="dsc-peers-head">
          <span className="dsc-peers-title">{tr('peers')}</span>
          <button
            type="button"
            className="dsc-btn dsc-icon-btn"
            title={tr('addPeer')}
            onClick={() => { setPanel(panel === 'pair' ? 'none' : 'pair'); setConfirmUnpair(false) }}
          >
            <IconPlusOutlineRegular size={14} />
          </button>
        </div>

        {panel !== 'none' && (
          <div className="dsc-add-panel">
            <div className="dsc-row">
              <span className="dsc-add-title">{panel === 'pair' ? tr('addPeerTitle') : tr('inviteTitle')}</span>
              <span className="dsc-spacer" />
              <button type="button" className="dsc-btn dsc-icon-btn" onClick={() => { setPanel('none'); setInviteString('') }}>
                <IconCloseOutlineRegular size={13} />
              </button>
            </div>
            {panel === 'pair' ? (
              <>
                <div className="dsc-hint">{tr('pairHint')}</div>
                <input
                  className="dsc-input"
                  placeholder={tr('pairPlaceholder')}
                  value={invitation}
                  onChange={event => { setInvitation(event.target.value) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') submitPair() }}
                />
                <div className="dsc-row">
                  <button type="button" className="dsc-btn primary" disabled={busy || invitation.trim() === ''} onClick={submitPair}>
                    {busy ? tr('pairing') : tr('pairAction')}
                  </button>
                  <button
                    type="button"
                    className="dsc-btn"
                    onClick={() => { setPanel('invite'); setInviteString('') }}
                  >
                    {tr('invite')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="dsc-hint">{tr('inviteHint')}</div>
                <input className="dsc-input" readOnly value={inviteString} onFocus={event => { event.target.select() }} />
                <div className="dsc-row">
                  <button type="button" className="dsc-btn" disabled={inviteString === ''} onClick={copyInvite}>
                    <IconCopyOutlineRegular size={13} />
                    {copied ? tr('copied') : tr('copy')}
                  </button>
                  <button type="button" className="dsc-btn" onClick={() => { setPanel('pair') }}>
                    {tr('addPeer')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {requests.length > 0 && (
          <div className="dsc-requests">
            <button type="button" className="dsc-requests-head" onClick={() => { setRequestsOpen(open => !open) }}>
              <span className="dsc-badge">{requests.length}</span>
              <span>{tr('requestsTitle', { count: requests.length })}</span>
              <span className="dsc-spacer" />
              <span className="dsc-hint">{requestsOpen ? '▾' : '▸'}</span>
            </button>
            {requestsOpen && requests.map(request => (
              <div key={request.deviceId} className="dsc-request">
                <div className="dsc-peer-main">
                  <div className="dsc-peer-name">{request.name !== '' ? request.name : request.deviceId.slice(0, 8)}</div>
                  <div className="dsc-peer-preview">{tr('requestLine', { name: '', address: request.host, port: request.port }).replace(/^ · /u, '')}</div>
                </div>
                <button type="button" className="dsc-btn primary" disabled={busy} onClick={() => { void run(async () => { await approveRequest(request.deviceId) }) }}>
                  {tr('approve')}
                </button>
                <button type="button" className="dsc-btn" disabled={busy} onClick={() => { void run(async () => { await denyRequest(request.deviceId) }) }}>
                  {tr('deny')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="dsc-peer-list">
          {peers.map(candidate => (
            <div
              key={candidate.deviceId}
              className={`dsc-peer${candidate.deviceId === selected ? ' active' : ''}`}
              onClick={() => { void selectPeer(candidate.deviceId); setConfirmUnpair(false) }}
            >
              <span className={`dsc-dot${candidate.reachable ? ' on' : ''}`} />
              <div className="dsc-peer-main">
                <div className="dsc-peer-name">{peerName(candidate)}</div>
                <div className="dsc-peer-preview">{preview(candidate)}</div>
              </div>
              {candidate.unread > 0 && <span className="dsc-badge">{candidate.unread > 99 ? '99+' : String(candidate.unread)}</span>}
            </div>
          ))}
          {peers.length === 0 && <div className="dsc-hint" style={{ padding: '10px' }}>{tr('emptyPeers')}</div>}
        </div>
        {state !== undefined && (
          <div className="dsc-self">
            {tr('selfLine', {
              name: state.self.name,
              address: state.addresses.find(row => !row.internal && row.family === 'IPv4')?.address ?? '127.0.0.1',
              port: state.settings.port,
            })}
          </div>
        )}
      </aside>

      <section className="dsc-main">
        {state?.serverError != null && (
          <div className="dsc-banner error">
            <IconWarningTriangleOutlineRegular size={13} /> {tr('serverError', { message: state.serverError })}
          </div>
        )}
        {state !== undefined && !state.lanReachable && (
          <div className="dsc-banner warn">
            <IconWarningTriangleOutlineRegular size={13} /> {tr('lanWarn')}
          </div>
        )}
        {notice !== null && (
          <div className="dsc-banner">
            {notice}
            <button type="button" className="dsc-file-action" onClick={() => { setNotice(null) }}>{tr('noticeDismiss')}</button>
          </div>
        )}
        {(actionError ?? error) !== undefined && (actionError ?? error) !== null && (
          <div className="dsc-banner error">{tr('actionFailed', { message: actionError ?? error ?? '' })}</div>
        )}

        {peer === undefined ? (
          <div className="dsc-empty">
            <EnvelopeIcon size={22} />
            <strong>{tr('emptyThread')}</strong>
            <span>{tr('emptyThreadHint')}</span>
          </div>
        ) : (
          <>
            <div className="dsc-chat-head">
              <span className={`dsc-dot${peer.reachable ? ' on' : ''}`} />
              <div>
                <div className="dsc-chat-title">{peerName(peer)}</div>
                <div className="dsc-chat-sub">
                  {peer.reachable ? tr('online') : tr('offline')} · {peer.host}:{peer.port}
                </div>
              </div>
              <span className="dsc-spacer" />
              <button
                type="button"
                className="dsc-btn"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    const info = await checkUpdates()
                    const short = (commit?: string): string => commit === undefined ? '?' : commit.slice(0, 7)
                    if (info.error !== undefined) setNotice(tr('updateFailed', { message: info.error }))
                    else if (info.upToDate) setNotice(tr('updateCurrent', { version: info.installed.version, commit: short(info.installed.commit) }))
                    else setNotice(tr('updateAvailable', { commit: short(info.latest?.commit), date: info.latest?.date ?? '' }))
                  })
                }}
              >
                <IconRefreshOutlineRegular size={13} />
                {tr('updateCheck')}
              </button>
              {confirmUnpair ? (
                <div className="dsc-row">
                  <span className="dsc-hint">{tr('unpairConfirm', { name: peerName(peer) })}</span>
                  <button type="button" className="dsc-btn" disabled={busy} onClick={startUnpair}>{tr('unpair')}</button>
                  <button type="button" className="dsc-btn" onClick={() => { setConfirmUnpair(false) }}>{tr('cancel')}</button>
                </div>
              ) : (
                <button type="button" className="dsc-btn dsc-icon-btn" title={tr('unpair')} onClick={startUnpair}>
                  <IconTrashOutlineRegular size={13} />
                </button>
              )}
            </div>

            <div className="dsc-thread" ref={threadRef}>
              {messages.map(message => (
                <div key={message.id} className={`dsc-msg ${message.dir === 'in' ? 'in' : 'out'}`}>
                  {message.kind === 'file' && message.file !== undefined ? (
                    <div className="dsc-file">
                      <div>
                        <div className="dsc-file-name">{message.file.name}</div>
                        <div className="dsc-file-size">{formatSize(message.file.size)}</div>
                      </div>
                      {message.dir === 'in' && (
                        <button type="button" className="dsc-file-action" onClick={() => { download(message) }}>
                          {tr('download')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="dsc-bubble">{message.text}</div>
                  )}
                  <div className={`dsc-status${message.status === 'failed' ? ' failed' : ''}`}>
                    {formatTime(message.at)}
                    {message.dir === 'out' && ` · ${message.status === 'sent' ? tr('sent') : message.status === 'pending' ? tr('pending') : tr('failed')}`}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <div className="dsc-empty" style={{ margin: '8px 0' }}>
                  <strong>{tr('emptyThread')}</strong>
                </div>
              )}
            </div>

            <div className="dsc-composer">
              <textarea
                className="dsc-textarea"
                placeholder={tr('messagePlaceholder')}
                value={draft}
                onChange={event => { setDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <div className="dsc-composer-row">
                <input
                  ref={fileRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(event) => { attach(event.target.files); event.target.value = '' }}
                />
                <button type="button" className="dsc-btn dsc-icon-btn" title={tr('attach')} onClick={() => { fileRef.current?.click() }}>
                  <IconPaperclipOutlineRegular size={14} />
                </button>
                <label className="dsc-check">
                  <input type="checkbox" checked={broadcast} onChange={event => { setBroadcast(event.target.checked) }} />
                  {tr('broadcast')}
                </label>
                <span className="dsc-spacer" />
                {busy && <span className="dsc-chat-sub">{tr('sending')}</span>}
                <button type="button" className="dsc-btn" disabled={busy} onClick={() => { void run(async () => { await retryDelivery() }) }}>
                  <IconRefreshOutlineRegular size={13} />
                  {tr('retry')}
                </button>
                <button type="button" className="dsc-btn primary" disabled={busy || draft.trim() === ''} onClick={submit}>
                  <IconSendOutlineRegular size={13} />
                  {tr('send')}
                </button>
              </div>
            </div>
          </>
        )}
        {loading && state === undefined && <div className="dsc-hint" style={{ padding: '12px' }}>{tr('loading')}</div>}
      </section>
    </div>
  )
}
