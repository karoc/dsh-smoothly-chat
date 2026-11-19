/**
 * Design-token styles for the Smoothly Chat panel.
 *
 * Injected as a module-top-level side effect (never inside a ctx.effect
 * closure): rolldown can drop a closure-only call together with the module,
 * which historically crashed the whole web client. `import './styles.ts'`
 * pins it.
 */

const ID = 'dsh-smoothly-chat'

const CSS = `
.dsc-root {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
}
.dsc-peers {
  width: 264px;
  flex: 0 0 264px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l2);
}
.dsc-peers-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsc-peers-title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
}
.dsc-requests {
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsc-requests-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dsc-request {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.dsc-peer-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px;
}
.dsc-peer-list::-webkit-scrollbar { display: none; }
.dsc-peer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
.dsc-peer:hover { background: var(--dsw-alias-bg-layer-2); }
.dsc-peer.active {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-border-l3);
}
.dsc-peer-main { flex: 1; min-width: 0; }
.dsc-peer-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-peer-preview {
  margin-top: 2px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsc-dot.on { background: var(--dsw-alias-state-success-primary, #22c55e); }
.dsc-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: var(--dsw-alias-state-error-primary);
}
.dsc-self {
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  font-size: 11px;
  color: var(--dsw-alias-text-tertiary, var(--dsw-alias-label-tertiary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dsc-chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dsc-chat-title { font-weight: 600; }
.dsc-chat-sub { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsc-spacer { flex: 1; }
.dsc-banner {
  margin: 8px 14px 0;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
}
.dsc-banner.warn { border-color: var(--dsw-alias-state-warning-primary, #d97706); }
.dsc-banner.error { border-color: var(--dsw-alias-state-error-primary); }
.dsc-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsc-thread::-webkit-scrollbar { display: none; }
.dsc-msg { display: flex; flex-direction: column; max-width: 72%; }
.dsc-msg.in { align-self: flex-start; align-items: flex-start; }
.dsc-msg.out { align-self: flex-end; align-items: flex-end; }
.dsc-bubble {
  padding: 8px 11px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  background: var(--dsw-alias-bg-module-platform);
}
.dsc-msg.out .dsc-bubble {
  background: var(--dsw-alias-button-primary-fill);
  color: #fff;
}
.dsc-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  border: 1px solid var(--dsw-alias-border-l2);
  min-width: 200px;
}
.dsc-file-name { font-weight: 500; word-break: break-all; }
.dsc-file-size { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsc-file-action {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--dsw-alias-brand-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
}
.dsc-status { margin-top: 3px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dsc-status.failed { color: var(--dsw-alias-state-error-primary); }
.dsc-progress {
  display: inline-block;
  width: 96px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  vertical-align: middle;
}
.dsc-progress-fill {
  display: block;
  height: 100%;
  background: var(--dsw-alias-brand-primary);
  transition: width 120ms linear;
}
.dsc-upload {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsc-upload .dsc-progress { flex: 1; }
.dsc-transfer { display: inline-flex; align-items: center; }
.dsc-transfer .dsc-progress { width: 64px; }
.dsc-composer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsc-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  min-height: 38px;
  max-height: 160px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  outline: none;
}
.dsc-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-composer-row { display: flex; align-items: center; gap: 8px; }
.dsc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.dsc-btn:hover { background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); }
.dsc-btn.primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
  color: #fff;
}
.dsc-btn:disabled { opacity: 0.5; cursor: default; }
.dsc-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  justify-content: center;
}
.dsc-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.dsc-check input { accent-color: var(--dsw-alias-button-primary-fill); }
.dsc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 18px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  padding: 24px;
}
.dsc-empty strong { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dsc-add-panel {
  margin: 0 14px 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsc-add-title { font-weight: 600; font-size: 12px; }
.dsc-input {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.dsc-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsc-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); line-height: 1.4; }
.dsc-row { display: flex; align-items: center; gap: 6px; }
.dsc-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.dsc-icon-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-error-primary);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
}
.dsc-dragover { outline: 2px dashed var(--dsw-alias-brand-primary); outline-offset: -6px; }
`

if (typeof document !== 'undefined' && document.querySelector(`style[data-dsh-plugin-css="${ID}"]`) === null) {
  const style = document.createElement('style')
  style.setAttribute('data-dsh-plugin-css', ID)
  style.textContent = CSS
  document.head.appendChild(style)
}

export { ID as STYLE_ID }
