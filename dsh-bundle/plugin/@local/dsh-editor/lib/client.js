/**
 * @local/dsh-editor — browser half (built artifact format).
 *
 * Adds an "editor mode" to the dsh web UI, switchable with the default
 * codex-style chat mode:
 *
 *   [ 文件树 ] [ 可编辑文件 ] [ 对话 ]
 *
 * Implementation notes:
 *   - Editor mode is applied as `body.dsh-editor-mode`. A plugin-owned
 *     stylesheet re-arranges the app's three-column grid (sidebar | center |
 *     details) so the sidebar becomes the file tree, the details column is
 *     hidden, the conversation moves to the right column, and an overlay
 *     panel (registered in shell.overlay, always mounted) renders the editor
 *     over the middle column.
 *   - The grid columns are located without hashed class names: the app frame
 *     is the div whose direct child carries `data-shell-overlay`, and its
 *     first three children are always sidebar / center / details (verified
 *     against the shipped layout bundle and live DOM).
 *   - The file tree occupies the single `sidebar.workspaces` seat ONLY while
 *     editor mode is active (the original workspace browser returns on exit).
 *   - All file data comes from the node half's /dsh-editor/* endpoints.
 *
 * Mode persistence: localStorage 'dsh.editor.mode' = '1' | '0'.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-editor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // Sidebar icons from the shared primitives library (same style as the
    // shipped Settings / Archive triggers). Fall back to minimal inline SVG
    // shapes if the library is ever unavailable so the plugin never dies.
    let IconCode = null
    let IconChat = null
    let FolderOpenIcon = null
    let FolderCloseIcon = null
    let MarkdownTextComponent = null
    let IconCopyOutline16 = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      if (primitives) {
        IconCode = primitives.IconCodeOutline16 || null
        IconChat = primitives.IconNewChatOutline16 || null
        FolderOpenIcon = primitives.IconFolderOpen16 || null
        FolderCloseIcon = primitives.IconFolderClose16 || null
        MarkdownTextComponent = primitives.MarkdownText || null
        IconCopyOutline16 = primitives.IconCopyOutline16 || null
      }
    } catch (e) { /* fall back to inline svg */ }

    function FallbackCodeIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', { d: 'M4.5 5L2 8l2.5 3M11.5 5L14 8l-2.5 3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }
    function FallbackChatIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', { d: 'M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5z', fill: 'currentColor' }),
      )
    }
    function FallbackFolderIcon({ size, open }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', {
          d: open
            ? 'M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 2h5.5A1.5 1.5 0 0 1 14.5 6.5v5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z'
            : 'M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 2h5.5A1.5 1.5 0 0 1 14.5 6.5V12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 1.5 12z',
          fill: 'currentColor',
        }),
      )
    }
    function FallbackPreviewIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('path', { d: 'M8 3C4.6 3 1.8 5.2 1.1 8c.7 2.8 3.5 5 6.9 5s6.2-2.2 6.9-5c-.7-2.8-3.5-5-6.9-5z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
        React.createElement('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.3 }),
      )
    }
    /** Fallback markdown preview (plain text) when the primitives MarkdownText
     *  is unavailable — the real renderer is used in the browser. */
    function FallbackMarkdownPreview({ text }) {
      return React.createElement('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 } },
        String(text || ''),
      )
    }
    function FallbackCopyIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('path', { d: 'M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2', stroke: 'currentColor', strokeWidth: 1.3 }),
      )
    }
    function FallbackCutIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('circle', { cx: 5, cy: 4.5, r: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('circle', { cx: 5, cy: 11.5, r: 2, stroke: 'currentColor', strokeWidth: 1.3 }),
        React.createElement('path', { d: 'M6.5 6l7 7M6.5 10l7-7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
      )
    }
    function FallbackTerminalIcon({ size }) {
      return React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        React.createElement('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.4 }),
        React.createElement('path', { d: 'M4.5 6l2 2-2 2M7.5 10.5h4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Browser services this client plugin needs. */
    const inject = ['slots', 'sessions', 'workspaces']

    const PLUGIN_ID = '@local/dsh-editor'
    const STORAGE_KEY = 'dsh.editor.mode'

    // ── shared state + pub/sub (components re-render via listeners) ────────

    const state = {
      mode: false,
      roots: [],
      rootId: null,
      tree: null,
      treeLoading: false,
      treeError: '',
      truncated: false,
      selectedPath: null,
      content: '',
      highlightHtml: '',
      dirty: false,
      saving: false,
      loadingFile: false,
      message: '',
      messageKind: 'ok', // ok | err
      preview: false,
      menu: null, // { x, y, hasSel, text, start, end } — editor context menu
      treeMenu: null, // { x, y, path } — file-tree context menu
      chatCards: [], // [{ id, kind: 'code'|'file', path, lang?, block }] — reference cards above the composer
      treeW: 260,
      chatW: 420,
      sessionMenuOpen: false, // session dropdown (chat-column top bar)
      sessionQuery: '',
      toast: null, // { text, kind: 'ok'|'err' } — transient top-center toast (1.12)
      terminalBusy: false, // native terminal button in-flight (1.12)
      terminalOpen: false, // embedded terminal panel visible (1.12)
      termShell: '', // embedded shell preference: '' | 'cmd' | 'powershell' (1.12)
      termStatus: 'closed', // embedded terminal status: closed|connecting|open|exited|error (1.12)
      termMeta: null, // { cwd, shell, pid } from the server (1.12)
      termError: '', // last embedded-terminal error message (1.12)
    }

      /** Runtime session opener, wired in apply() once the sessions service is available. */
      let openSession = null
      /** Runtime new-session starter, wired in apply() once the workspaces service is available. */
      let startSession = null
    const listeners = new Set()
    function emit() {
      for (const fn of Array.from(listeners)) {
        try { fn() } catch (e) { /* listener error; keep going */ }
      }
    }
    function setState(patch) {
      Object.assign(state, patch)
      emit()
    }

    /** Expanded directory paths (relative, '/' separated). */
    const expandedDirs = new Set()

    // ── stylesheet (editor-mode layout + plugin UI) ────────────────────────

    let styleEl = null
    function ensureStyle() {
      if (styleEl !== null) return styleEl
      if (typeof document === 'undefined') return null
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', PLUGIN_ID)
      styleEl.setAttribute('data-plugin-css', PLUGIN_ID + '/main')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      return styleEl
    }

    const CSS = [
      // frame = the div that directly owns the shell-overlay layer
      'body.dsh-editor-mode div:has(> div[data-shell-overlay]){',
      'grid-template-columns:var(--dsh-editor-tree-w,260px) minmax(280px,1fr) var(--dsh-editor-chat-w,420px) !important;',
      'transition:none !important;',
      '}',
      'body.dsh-editor-mode div:has(> div[data-shell-overlay])>div:nth-child(1){grid-column:1;grid-row:1;}',
      'body.dsh-editor-mode div:has(> div[data-shell-overlay])>div:nth-child(2){grid-column:3;grid-row:1;}',
      'body.dsh-editor-mode div:has(> div[data-shell-overlay])>div:nth-child(3){display:none;}',
      'body.dsh-editor-mode div:has(> div[data-shell-overlay])>div[data-side]{display:none;}',
      // sidebar footer actions: the app lays the actions out in one flex ROW,
      // so a second full-width action (ours, beside 归档) would be pushed out
      // of the sidebar and clipped. Stack them in a column instead.
      '[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column!important;width:100%!important;min-width:0!important;}',
      // editor overlay panel (middle column); column widths come from CSS
      // variables so the user can drag the resize handles (defaults 260/420)
      '.dsh-editor-panel{position:fixed;left:var(--dsh-editor-tree-w,260px);right:var(--dsh-editor-chat-w,420px);top:0;bottom:0;z-index:5;',
      'display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#ffffff);',
      'border-left:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));',
      'border-right:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));',
      'font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);}',
      // column resize handles (tree|editor and editor|chat): always-visible
      // divider line + wide hit area + hover grip so the affordance is obvious
      '.dsh-editor-resize{position:absolute;top:0;bottom:0;width:13px;cursor:col-resize;z-index:6;touch-action:none;display:flex;align-items:center;justify-content:center;}',
      '.dsh-editor-resize::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;margin-left:-0.5px;',
      'background:var(--dsw-alias-border-l2,rgba(0,0,0,.12));}',
      '.dsh-editor-resize::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:3px;height:44px;border-radius:2px;',
      'background:var(--dsw-alias-border-l3,rgba(0,0,0,.28));opacity:0;transition:opacity .15s;display:flex;}',
      '.dsh-editor-resize:hover::before,.dsh-editor-resize.dragging::before{background:var(--dsw-alias-state-business-primary,#4176e6);width:2px;}',
      '.dsh-editor-resize:hover::after,.dsh-editor-resize.dragging::after{opacity:1;}',
      '.dsh-editor-resize:hover{background:rgba(65,118,230,.10);}',
      '.dsh-editor-resize-tree{left:-6px;}',
      '.dsh-editor-resize-chat{right:-6px;}',
      '.dsh-editor-panel-header{display:flex;align-items:center;gap:8px;padding:8px 12px;',
      'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));flex:none;min-height:40px;}',
      '.dsh-editor-panel-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'font-family:var(--ds-font-mono,ui-monospace,Consolas,monospace);font-size:12px;color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-panel-save{padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
      'background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:var(--dsw-alias-label-primary,#1f2328);cursor:pointer;font-size:12px;flex:none;}',
      '.dsh-editor-panel-save:disabled{opacity:.5;cursor:default;}',
      '.dsh-editor-panel-save:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#eaeef2);}',
      '.dsh-editor-panel-status{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);flex:none;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-editor-panel-status.err{color:var(--dsw-alias-state-error-primary,#cf222e);}',
      '.dsh-editor-panel-lang{flex:none;font-size:11px;padding:2px 8px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-2,#eaeef2);color:var(--dsw-alias-label-secondary,#57606a);}',
      // editor body: highlighted <pre> behind a transparent-text <textarea>
      '.dsh-editor-editor{position:relative;flex:1;min-height:0;background:var(--dsw-alias-bg-layer-1,#f6f8fa);display:flex;flex-direction:row;}',
      '.dsh-editor-edit-col{position:relative;flex:1;min-width:0;}',
      '.dsh-editor-pre{position:absolute;inset:0;margin:0;overflow:hidden;pointer-events:none;padding:12px 14px;box-sizing:border-box;',
      'font-family:var(--ds-font-mono,ui-monospace,"Cascadia Code",Consolas,monospace);font-size:13px;line-height:1.6;tab-size:2;',
      'white-space:pre;color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-preview-col{flex:1;min-width:0;overflow:auto;box-sizing:border-box;padding:14px 20px 40px;',
      'border-left:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-bg-base,#ffffff);}',
      '.dsh-editor-preview-col .markdown{max-width:760px;margin:0 auto;font-size:14px;line-height:1.7;}',
      '.dsh-editor-preview-col .markdown h1,.dsh-editor-preview-col .markdown h2,.dsh-editor-preview-col .markdown h3{',
      'margin:1.2em 0 .5em;line-height:1.3;color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-preview-col .markdown p{margin:.6em 0;}',
      '.dsh-editor-preview-col .markdown code{font-size:12.5px;}',
      '.dsh-editor-preview-col .markdown pre{margin:.8em 0;}',
      '.dsh-editor-preview-col .markdown img{max-width:100%;}',
      '.dsh-editor-preview-col .markdown blockquote{margin:.6em 0;padding-left:12px;border-left:3px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-preview-col .markdown table{border-collapse:collapse;margin:.8em 0;}',
      '.dsh-editor-preview-col .markdown th,.dsh-editor-preview-col .markdown td{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding:5px 10px;}',
      '.dsh-editor-preview-col .markdown a{color:var(--dsw-alias-state-business-primary,#4176e6);}',
      '.dsh-editor-preview-col .markdown hr{border:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));margin:1em 0;}',
      // editor mode button (preview toggle)
      '.dsh-editor-panel-previewbtn{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#f6f8fa);',
      'color:var(--dsw-alias-label-secondary,#57606a);cursor:pointer;font-size:12px;flex:none;}',
      '.dsh-editor-panel-previewbtn:hover{background:var(--dsw-alias-bg-layer-2,#eaeef2);color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-panel-previewbtn.active{background:var(--dsw-alias-state-business-tertiary,rgba(65,118,230,.14));',
      'color:var(--dsw-alias-state-business-primary,#4176e6);border-color:var(--dsw-alias-state-business-primary,#4176e6);}',
      // editor context menu (right-click)
      '.dsh-editor-menu{position:fixed;z-index:80;min-width:172px;padding:4px;border-radius:10px;box-sizing:border-box;',
      'background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));',
      'box-shadow:0 8px 28px rgba(0,0,0,.16);font-size:13px;color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:none;background:transparent;',
      'color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;border-radius:6px;cursor:pointer;text-align:left;font-family:inherit;}',
      '.dsh-editor-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.06));}',
      '.dsh-editor-menu-item:disabled{opacity:.45;cursor:default;}',
      '.dsh-editor-menu-item svg{flex:none;color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
      // file-reference cards above the composer
      '.dsh-editor-cards{display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 4px;}',
      '.dsh-editor-card{display:inline-flex;align-items:center;gap:6px;max-width:340px;padding:3px 8px;border-radius:8px;',
      'background:var(--dsw-alias-bg-layer-2,#eaeef2);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));',
      'color:var(--dsw-alias-label-primary,#1f2328);font-size:12px;box-sizing:border-box;}',
      '.dsh-editor-card svg{flex:none;color:var(--dsw-alias-state-business-primary,#4176e6);}',
      '.dsh-editor-card-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-mono,ui-monospace,Consolas,monospace);}',
      '.dsh-editor-card-close{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);',
      'cursor:pointer;font-size:15px;line-height:1;padding:1px 3px;border-radius:4px;}',
      '.dsh-editor-card-close:hover{color:var(--dsw-alias-state-error-primary,#cf222e);background:rgba(207,34,46,.08);}',
      // drag a file onto the conversation: highlight + hint badge
      '[data-slot="conversation"][data-dsh-editor-droptarget]{outline:2px dashed var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-2px;border-radius:8px;}',
      '[data-slot="conversation"][data-dsh-editor-droptarget]::before{content:"松开以添加文件引用";position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:90;',
      'padding:7px 16px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff;font-size:12px;',
      'box-shadow:0 4px 18px rgba(0,0,0,.25);pointer-events:none;white-space:nowrap;}',
      '.dsh-editor-textarea{position:absolute;inset:0;width:100%;height:100%;border:none;outline:none;resize:none;padding:12px 14px;box-sizing:border-box;',
      'background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary,#1f2328);overflow:auto;',
      'font-family:var(--ds-font-mono,ui-monospace,"Cascadia Code",Consolas,monospace);font-size:13px;line-height:1.6;tab-size:2;',
      'white-space:pre;word-wrap:normal;}',
      '.dsh-editor-textarea::selection{background:rgba(65,118,230,.22);}',
      '.dsh-editor-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#8b949e);}',
      '.dsh-editor-hint{flex:1;display:flex;align-items:center;justify-content:center;',
      'color:var(--dsw-alias-label-tertiary,#8b949e);font-size:13px;padding:24px;text-align:center;}',
        // session switcher: compact strip (current session + ▾ + new) pinned to
        // the top of the chat column; the full list opens as a dropdown below
        '.dsh-editor-session-tabs{position:fixed;top:0;right:0;width:var(--dsh-editor-chat-w,420px);height:44px;z-index:9;display:flex;align-items:center;gap:6px;padding:0 12px;box-sizing:border-box;overflow:hidden;pointer-events:auto;',
        'background:var(--dsw-alias-bg-base,#ffffff);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));font-size:12px;color:var(--dsw-alias-label-primary,#1f2328);}',
        '.dsh-editor-session-tabs-title{flex:none;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px;white-space:nowrap;}',
        '.dsh-editor-session-trigger{flex:1;min-width:0;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 8px 0 10px;border-radius:999px;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:var(--dsw-alias-label-primary,#1f2328);',
        'cursor:pointer;font-size:12px;white-space:nowrap;font-family:inherit;}',
        '.dsh-editor-session-trigger:hover{background:var(--dsw-alias-bg-layer-2,#eaeef2);}',
        '.dsh-editor-session-trigger-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left;}',
        '.dsh-editor-session-trigger-count{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:8px;',
        'background:var(--dsw-alias-bg-layer-2,#eaeef2);color:var(--dsw-alias-label-tertiary,#8b949e);}',
        '.dsh-editor-session-chevron{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary,#8b949e);transition:transform .15s;}',
        '.dsh-editor-session-chevron.open{transform:rotate(180deg);}',
        // dropdown with the full session list (drops below the strip, over the
        // chat column; scrolls internally when there are many sessions)
        '.dsh-editor-session-menu{position:fixed;top:44px;right:0;width:var(--dsh-editor-chat-w,420px);max-height:calc(100vh - 56px);overflow-y:auto;z-index:10;box-sizing:border-box;padding:6px;',
        'background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-top:none;',
        'border-radius:0 0 12px 12px;box-shadow:0 10px 30px rgba(0,0,0,.16);}',
        '.dsh-editor-session-search{width:100%;box-sizing:border-box;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));',
        'background:var(--dsw-alias-bg-layer-1,#f6f8fa);color:var(--dsw-alias-label-primary,#1f2328);font-size:12px;outline:none;margin-bottom:4px;font-family:inherit;}',
        '.dsh-editor-session-search:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);}',
        '.dsh-editor-session-menu-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:7px 10px;border:none;background:transparent;',
        'border-radius:8px;color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;cursor:pointer;text-align:left;font-family:inherit;}',
        '.dsh-editor-session-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.06));}',
        '.dsh-editor-session-menu-item.active{background:var(--dsw-alias-state-business-tertiary,rgba(65,118,230,.14));color:var(--dsw-alias-state-business-primary,#4176e6);}',
        '.dsh-editor-session-menu-item-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.dsh-editor-session-menu-item-check{flex:none;color:var(--dsw-alias-state-business-primary,#4176e6);}',
        '.dsh-editor-session-menu-empty{padding:14px 10px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;}',
        // "+ 新会话" pill at the end of the session strip (the file tree replaces
        // the sidebar that normally owns the new-session affordance)
        '.dsh-editor-session-new{flex:none;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;',
        'border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.24));background:transparent;color:var(--dsw-alias-label-secondary,#57606a);',
        'cursor:pointer;font-size:12px;white-space:nowrap;font-family:inherit;}',
        '.dsh-editor-session-new:hover{background:var(--dsw-alias-state-business-tertiary,rgba(65,118,230,.12));color:var(--dsw-alias-state-business-primary,#4176e6);border-color:var(--dsw-alias-state-business-primary,#4176e6);}',
        // push the whole conversation below the 44px session strip (outlet is
        // display:contents, so the root div below [data-slot="conversation"] is
        // the one to pad) — nothing of the default conversation is covered
        'body.dsh-editor-mode [data-slot="conversation"]>div{padding-top:44px;box-sizing:border-box;}',

      // token colors (light theme)
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-com{color:#6a737d;font-style:italic;}',
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-str{color:#032f62;}',
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-num{color:#005cc5;}',
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-kw{color:#d73a49;}',
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-fn{color:#6f42c1;}',
      'body:not([data-ds-dark-theme]) .dsh-editor-pre .tok-tag{color:#22863a;}',
      // token colors (dark theme)
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-com{color:#8b949e;font-style:italic;}',
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-str{color:#a5d6ff;}',
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-num{color:#79c0ff;}',
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-kw{color:#ff7b72;}',
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-fn{color:#d2a8ff;}',
      'body[data-ds-dark-theme] .dsh-editor-pre .tok-tag{color:#7ee787;}',
      // file tree (sidebar.workspaces seat)
      '.dsh-editor-tree{height:100%;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;}',
      '.dsh-editor-tree-header{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;flex:none;}',
      '.dsh-editor-tree-title{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;flex:none;',
      'color:var(--dsw-alias-label-primary,#1f2328);white-space:nowrap;}',
      '.dsh-editor-tree-title svg{color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-tree-select{flex:1;min-width:0;font-size:12px;padding:4px 6px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#f6f8fa);',
      'color:var(--dsw-alias-label-primary,#1f2328);outline:none;cursor:pointer;}',
      '.dsh-editor-tree-select:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);}',
      '.dsh-editor-tree-back{display:flex;align-items:center;gap:5px;flex:none;font-size:12px;padding:4px 9px;border-radius:6px;',
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-1,#f6f8fa);',
      'color:var(--dsw-alias-label-secondary,#57606a);cursor:pointer;}',
      '.dsh-editor-tree-back:hover{background:var(--dsw-alias-bg-layer-2,#eaeef2);color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-tree-body{flex:1;overflow:auto;padding:2px 8px 12px;box-sizing:border-box;}',
      '.dsh-editor-tree-msg{padding:16px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#8b949e);white-space:pre-wrap;word-break:break-word;line-height:1.6;}',
      // tree rows
      '.dsh-editor-node-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:6px;cursor:pointer;',
      'color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:20px;white-space:nowrap;user-select:none;box-sizing:border-box;}',
      '.dsh-editor-node-row:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(0,0,0,.05));}',
      '.dsh-editor-node-row.selected{background:var(--dsw-alias-state-business-tertiary,rgba(65,118,230,.14));}',
      '.dsh-editor-node-icon{flex:none;width:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#8b949e);}',
      '.dsh-editor-node-icon.folder{color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-node-icon.folder.open{color:var(--dsw-alias-state-business-primary,#4176e6);}',
      '.dsh-editor-node-dot{flex:none;width:7px;height:7px;border-radius:50%;margin:0 5px;opacity:.85;}',
      '.dsh-editor-node-name{overflow:hidden;text-overflow:ellipsis;}',
      '.dsh-editor-node-file .dsh-editor-node-name{color:var(--dsw-alias-label-secondary,#57606a);}',
      '.dsh-editor-node-file.selected .dsh-editor-node-name{color:var(--dsw-alias-state-business-primary,#4176e6);font-weight:600;}',
      '.dsh-editor-node-dir .dsh-editor-node-name{font-weight:600;}',
      '.dsh-editor-node-badge{flex:none;margin-left:auto;font-size:10px;line-height:14px;padding:0 6px;border-radius:8px;',
      'background:var(--dsw-alias-bg-layer-2,#eaeef2);color:var(--dsw-alias-label-tertiary,#8b949e);}',
      // children with a guide line
      '.dsh-editor-tree-children{margin-left:15px;border-left:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09));padding-left:5px;}',
      '.dsh-editor-tree-foot{flex:none;padding:7px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);',
      'border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      // terminal button (1.12) + transient toast (rendered in shell.overlay)
      '.dsh-editor-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:120;display:flex;align-items:center;gap:8px;',
      'max-width:min(72vw,640px);padding:8px 16px;border-radius:10px;box-sizing:border-box;font-size:12.5px;line-height:1.5;',
      'box-shadow:0 6px 24px rgba(0,0,0,.18);pointer-events:none;word-break:break-all;font-family:inherit;}',
      '.dsh-editor-toast.ok{background:var(--dsw-alias-bg-layer-2,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));',
      'color:var(--dsw-alias-label-primary,#1f2328);}',
      '.dsh-editor-toast.err{background:#fff1f0;border:1px solid rgba(207,34,46,.35);color:#cf222e;}',
      'body[data-ds-dark-theme] .dsh-editor-toast.err{background:rgba(207,34,46,.18);border-color:rgba(207,34,46,.5);color:#ffb3b0;}',
      // embedded terminal panel (1.12) — fixed bottom bar, Qoder-style.
      // `left` tracks the sidebar/file-tree column (measured live) so the
      // sidebar footer actions stay visible while the panel is open.
      '.dsh-editor-term-panel{position:fixed;left:var(--dsh-term-left,0px);right:0;bottom:0;height:240px;z-index:15;display:flex;flex-direction:column;',
      'pointer-events:auto;background:#0d1117;color:#e6edf3;border-top:1px solid rgba(255,255,255,.14);',
      'font-family:var(--ds-font-mono,ui-monospace,"Cascadia Code",Consolas,monospace);box-shadow:0 -6px 24px rgba(0,0,0,.22);}',
      '.dsh-editor-term-head{display:flex;align-items:center;gap:8px;height:34px;flex:none;padding:0 10px;box-sizing:border-box;',
      'background:#161b22;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:#8b949e;font-family:inherit;}',
      '.dsh-editor-term-head-title{flex:none;display:inline-flex;align-items:center;gap:6px;font-weight:600;color:#e6edf3;}',
      '.dsh-editor-term-head-title svg{color:#8b949e;}',
      '.dsh-editor-term-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#8b949e;}',
      '.dsh-editor-term-dot.open{background:#3fb950;}',
      '.dsh-editor-term-dot.connecting{background:#d29922;}',
      '.dsh-editor-term-dot.exited,.dsh-editor-term-dot.error{background:#f85149;}',
      '.dsh-editor-term-cwd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;color:#8b949e;}',
      '.dsh-editor-term-shell{flex:none;padding:1px 8px;border-radius:10px;background:rgba(255,255,255,.08);color:#e6edf3;font-size:11px;}',
      '.dsh-editor-term-select{flex:none;padding:2px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:#0d1117;',
      'color:#e6edf3;font-size:11px;outline:none;font-family:inherit;cursor:pointer;}',
      '.dsh-editor-term-btn{flex:none;padding:3px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;',
      'color:#c9d1d9;font-size:11px;cursor:pointer;font-family:inherit;}',
      '.dsh-editor-term-btn:hover{background:rgba(255,255,255,.1);}',
      '.dsh-editor-term-btn.close{display:inline-flex;align-items:center;padding:3px 8px;}',
      '.dsh-editor-term-viewport{position:relative;flex:1;min-height:0;overflow:hidden;padding:6px 10px;background:#0d1117;cursor:text;}',
      '.dsh-editor-term-line{position:absolute;left:10px;right:10px;white-space:pre;font-size:13px;line-height:1.45;color:#e6edf3;}',
      '.dsh-editor-term-cursor{position:absolute;width:8px;background:#e6edf3;animation:dsh-term-blink 1s steps(1) infinite;pointer-events:none;}',
      '@keyframes dsh-term-blink{0%,55%{opacity:1}56%,100%{opacity:0}}',
      '.dsh-editor-term-hidden-ta{position:absolute;opacity:0;width:2px;height:2px;left:0;top:0;border:none;padding:0;resize:none;overflow:hidden;}',
      // keep content clear of the panel while it is open
      'body.dsh-editor-terminal-open [data-slot="conversation"]>div{padding-bottom:248px;box-sizing:border-box;}',
      'body.dsh-editor-terminal-open .dsh-editor-panel{bottom:248px;}',
      '.dsh-editor-term-banner{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;',
      'background:#0d1117;color:#f85149;font-size:13px;font-family:inherit;z-index:2;padding:12px;text-align:center;}',
    ].join('')

    // ── API helpers ────────────────────────────────────────────────────────

    async function api(path, opts) {
      const res = await fetch(path, opts)
      let data = null
      try { data = await res.json() } catch (e) { /* non-JSON body */ }
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) ? data.error : ('请求失败 (HTTP ' + res.status + ')'))
      }
      return data
    }

    async function loadRoots() {
      let roots = []
      try {
        const data = await api('/dsh-editor/roots')
        roots = Array.isArray(data.workspaces) ? data.workspaces : []
      } catch (e) {
        setState({ roots: [], treeError: e.message })
        return
      }
      const patch = { roots, treeError: '' }
      if (!state.rootId && roots.length > 0) patch.rootId = roots[0].id
      setState(patch)
      if (patch.rootId || state.rootId) loadTree(state.rootId || patch.rootId)
    }

    async function loadTree(rootId) {
      setState({ treeLoading: true, treeError: '' })
      try {
        const data = await api('/dsh-editor/tree?root=' + encodeURIComponent(rootId))
        setState({ tree: Array.isArray(data.tree) ? data.tree : [], treeLoading: false, truncated: !!data.truncated })
      } catch (e) {
        setState({ treeLoading: false, treeError: e.message })
      }
    }

    async function selectFile(path) {
      if (state.dirty) {
        let ok = true
        try { ok = window.confirm('当前文件有未保存的修改，放弃并打开其他文件？') } catch (e) { ok = true }
        if (!ok) return
      }
      setState({ loadingFile: true, selectedPath: path, message: '', messageKind: 'ok' })
      try {
        const data = await api('/dsh-editor/file?root=' + encodeURIComponent(state.rootId) + '&path=' + encodeURIComponent(path))
        const content = data.content
        let highlightHtml = ''
        if (content.length <= MAX_HIGHLIGHT_CHARS) {
          try { highlightHtml = buildHighlight(content, detectLang(path)) } catch (e) { /* plain */ }
        }
        setState({ loadingFile: false, content, highlightHtml, dirty: false, preview: false, menu: null })
      } catch (e) {
        setState({ loadingFile: false, message: e.message, messageKind: 'err' })
      }
    }

    async function saveFile() {
      if (!state.selectedPath || state.saving || state.dirty === false) {
        if (!state.selectedPath) return
        if (state.dirty === false) { setState({ message: '没有需要保存的修改', messageKind: 'ok' }); return }
        if (state.saving) return
      }
      setState({ saving: true, message: '', messageKind: 'ok' })
      try {
        await api('/dsh-editor/file', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: state.rootId, path: state.selectedPath, content: state.content }),
        })
        setState({ saving: false, dirty: false, message: '已保存 ✓', messageKind: 'ok' })
      } catch (e) {
        setState({ saving: false, message: e.message, messageKind: 'err' })
      }
    }

    // ── syntax highlighting (lightweight, dependency-free tokenizer) ───────
    // A regex tokenizer feeds a highlighted <pre> that sits behind the
    // editing <textarea> (transparent text, visible caret). Zero external
    // dependencies so it works fully offline inside the embedded exe.

    const EXT_LANG = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
      json: 'json', md: 'md', markdown: 'md', html: 'html', htm: 'html',
      xml: 'xml', svg: 'xml', css: 'css', scss: 'css', less: 'css',
      py: 'py', python: 'py', rs: 'rs', go: 'go', java: 'java',
      c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
      cs: 'cs', swift: 'swift', kt: 'kt', kotlin: 'kt', sh: 'sh', bash: 'sh', zsh: 'sh',
      ps1: 'ps1', yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql',
      php: 'php', rb: 'rb', ruby: 'rb', ini: 'ini', conf: 'ini',
    }

    const KEYWORDS = {
      js: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null true false undefined',
      ts: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await interface type enum implements private protected public readonly abstract declare namespace module any unknown never string number boolean null true false undefined',
      jsx: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await null true false undefined',
      tsx: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await interface type enum implements private protected public readonly abstract declare namespace module any unknown never string number boolean null true false undefined',
      json: 'true false null',
      py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False',
      rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
      go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil',
      java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null',
      c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while true false',
      cpp: 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept operator private protected public register reinterpret_cast return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while',
      cs: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await',
      swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as any catch false is nil self Self super throws throw true try',
      kt: 'as as? break class continue do else false for fun if in !in interface is !is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg',
      sh: 'if then else elif fi for while until do done case esac function in select time coproc true false',
      ps1: 'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function getter hidden if in param process return set static switch throw trap try until using var while workflow true false null',
      yaml: 'true false null yes no on off',
      toml: 'true false',
      sql: 'select from where insert into values update delete create table alter drop index view join inner left right full outer on as and or not null primary key foreign references unique default check constraint trigger procedure function begin end declare set if else while case when then',
      php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endeval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null',
      rb: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
      css: 'important',
      ini: 'true false',
      html: '',
      xml: '',
      md: '',
      text: '',
    }

    const MAX_HIGHLIGHT_CHARS = 150000

    /** Detect the tokenizer language id from a file path. */
    function detectLang(path) {
      if (!path) return 'text'
      const m = /\.([A-Za-z0-9_]+)$/.exec(path)
      const ext = m ? m[1].toLowerCase() : ''
      return EXT_LANG[ext] || 'text'
    }

    /** Accent dot color per language (file tree). */
    const LANG_COLORS = {
      js: '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6', json: '#8a8a3a',
      py: '#3572a5', rs: '#dea584', go: '#00add8', java: '#b07219', c: '#777777',
      cpp: '#f34b7d', cs: '#178600', swift: '#f05138', kt: '#a97bff', sh: '#89e051',
      ps1: '#5391fe', yaml: '#cb171e', toml: '#9c4221', sql: '#e38c00', php: '#4f5d95',
      rb: '#701516', html: '#e34c26', xml: '#0060ac', css: '#563d7c', md: '#083fa1',
      ini: '#888888', text: '#9aa4b2',
    }
    function langColor(lang) {
      return LANG_COLORS[lang] || '#9aa4b2'
    }

    /** Count files under a tree node (for the directory badge). */
    function countFiles(nodes) {
      let n = 0
      if (!Array.isArray(nodes)) return 0
      for (const node of nodes) {
        if (node.kind === 'file') n += 1
        else if (node.kind === 'dir') n += countFiles(node.children)
      }
      return n
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    }

    /**
     * Render `code` as highlighted HTML for the overlay <pre>. Returns plain
     * escaped text for huge files (keeps typing responsive).
     */
    function buildHighlight(code, lang) {
      if (typeof code !== 'string') return ''
      if (code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code)
      const kwSet = KEYWORDS[lang] || ''
      const kw = {}
      if (kwSet) {
        for (const w of kwSet.split(/\s+/)) if (w) kw[w] = true
      }
      // SQL/Shell/HTML-family keywords are conventionally case-insensitive.
      const caseInsensitiveKw = lang === 'sql' || lang === 'sh' || lang === 'ps1' || lang === 'html' || lang === 'xml' || lang === 'css' || lang === 'yaml'
      const hashComment = lang === 'py' || lang === 'sh' || lang === 'yaml' || lang === 'rb' || lang === 'ps1' || lang === 'toml'
      const sqlComment = lang === 'sql'
      const htmlish = lang === 'html' || lang === 'xml' || lang === 'jsx' || lang === 'tsx' || lang === 'md'
      const parts = []
      const comments = ['\\/\\/[^\\n]*', '\\/\\*[\\s\\S]*?\\*\\/', '<!--[\\s\\S]*?-->']
      if (hashComment) comments.push('#[^\\n]*')
      if (sqlComment) comments.push('--[^\\n]*')
      // named groups keep indices stable whether or not the htmlish group is present
      parts.push('(?<com>' + comments.join('|') + ')')
      parts.push("(?<str>'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\.|[^`\\\\])*`)")
      parts.push('(?<num>\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|0x[0-9a-fA-F]+\\b)')
      if (htmlish) parts.push('(?<tag><\\/?[A-Za-z][\\w-]*|\\/?>|\\b[A-Za-z_][\\w-]*(?==))')
      parts.push('(?<fn>[A-Za-z_$][\\w$]*)(?=\\s*\\()')
      parts.push('(?<id>[A-Za-z_$][\\w$]*)')
      const re = new RegExp(parts.join('|'), 'g')
      const out = []
      let last = 0
      let m
      while ((m = re.exec(code)) !== null) {
        if (m.index > last) out.push(escapeHtml(code.slice(last, m.index)))
        last = re.lastIndex
        const g = m.groups || {}
        const keyOf = (ident) => caseInsensitiveKw ? String(ident).toLowerCase() : String(ident)
        if (g.com) out.push('<span class="tok-com">' + escapeHtml(g.com) + '</span>')
        else if (g.str) out.push('<span class="tok-str">' + escapeHtml(g.str) + '</span>')
        else if (g.num) out.push('<span class="tok-num">' + escapeHtml(g.num) + '</span>')
        else if (g.tag) out.push('<span class="tok-tag">' + escapeHtml(g.tag) + '</span>')
        else if (g.fn) out.push(kw[keyOf(g.fn)] ? '<span class="tok-kw">' + escapeHtml(g.fn) + '</span>' : '<span class="tok-fn">' + escapeHtml(g.fn) + '</span>')
        else if (g.id) out.push(kw[keyOf(g.id)] ? '<span class="tok-kw">' + escapeHtml(g.id) + '</span>' : escapeHtml(g.id))
      }
      if (last < code.length) out.push(escapeHtml(code.slice(last)))
      return out.join('')
    }

    // ── column widths (resizable file tree / chat) ─────────────────────────
    // Live values ride CSS variables on <html>; the grid override and the
    // editor overlay both read them, so dragging updates the layout instantly.

    function clampWidth(value, min, max) {
      return Math.max(min, Math.min(max, Math.round(value)))
    }

    function applyWidths() {
      try {
        const root = document.documentElement
        if (root) {
          root.style.setProperty('--dsh-editor-tree-w', state.treeW + 'px')
          root.style.setProperty('--dsh-editor-chat-w', state.chatW + 'px')
        }
      } catch (e) { /* ignore */ }
    }

    function persistWidths() {
      try {
        localStorage.setItem('dsh.editor.treew', String(state.treeW))
        localStorage.setItem('dsh.editor.chatw', String(state.chatW))
      } catch (e) { /* ignore */ }
    }

    function restoreWidths() {
      try {
        const tw = parseInt(localStorage.getItem('dsh.editor.treew') || '', 10)
        const cw = parseInt(localStorage.getItem('dsh.editor.chatw') || '', 10)
        if (!isNaN(tw)) state.treeW = clampWidth(tw, 180, 480)
        if (!isNaN(cw)) state.chatW = clampWidth(cw, 320, 600)
      } catch (e) { /* ignore */ }
      applyWidths()
    }

    /** Drag handle between the file tree and the editor (side='tree') or the
     *  editor and the chat (side='chat'). Updates the CSS variables live and
     *  persists on release. */
    function ResizeHandle({ side }) {
      const draggingRef = React.useRef(false)
      const elRef = React.useRef(null)
      const onPointerDown = (e) => {
        e.preventDefault()
        draggingRef.current = true
        if (elRef.current) elRef.current.classList.add('dragging')
        const startX = e.clientX
        const startTree = state.treeW
        const startChat = state.chatW
        let current = { tree: startTree, chat: startChat }
        const onMove = (ev) => {
          const dx = ev.clientX - startX
          if (side === 'tree') current.tree = clampWidth(startTree + dx, 180, 480)
          else current.chat = clampWidth(startChat - dx, 320, 600)
          try {
            const root = document.documentElement
            root.style.setProperty('--dsh-editor-tree-w', current.tree + 'px')
            root.style.setProperty('--dsh-editor-chat-w', current.chat + 'px')
          } catch (err) { /* ignore */ }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          draggingRef.current = false
          if (elRef.current) elRef.current.classList.remove('dragging')
          try { document.body.style.cursor = '' } catch (err) { /* ignore */ }
          try { document.body.style.userSelect = '' } catch (err) { /* ignore */ }
          setState({ treeW: current.tree, chatW: current.chat })
          persistWidths()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        try { document.body.style.cursor = 'col-resize' } catch (err) { /* ignore */ }
        try { document.body.style.userSelect = 'none' } catch (err) { /* ignore */ }
      }
      return React.createElement('div', {
        className: 'dsh-editor-resize dsh-editor-resize-' + side,
        ref: elRef,
        onPointerDown: onPointerDown,
        title: side === 'tree' ? '拖动调整文件树宽度' : '拖动调整对话区宽度',
      })
    }

    // ── mode ───────────────────────────────────────────────────────────────

    let treeSlotReady = false
    let treePending = false
    let treeDisposer = null
    let slotsRef = null

    function registerTree() {
      if (treeDisposer !== null || slotsRef === null) return
      if (!treeSlotReady) { treePending = true; return }
      // single seat: shadow the workspace browser with a lower priority so the
      // original occupant returns once this registration is disposed.
      treeDisposer = slotsRef.register(
        { name: 'sidebar.workspaces', priority: -1 },
        () => React.createElement(FileTreePanel, null),
      )
    }
    function unregisterTree() {
      if (treeDisposer !== null) {
        try { treeDisposer() } catch (e) { /* already gone */ }
        treeDisposer = null
      }
      treePending = false
    }

    function setMode(next) {
      state.mode = next
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch (e) { /* session-only */ }
      try { document.body.classList.toggle('dsh-editor-mode', next) } catch (e) { /* ignore */ }
      if (next) {
        registerTree()
        loadRoots()
      } else {
        unregisterTree()
        setState({ message: '', menu: null, treeMenu: null, sessionMenuOpen: false, sessionQuery: '' })
      }
      emit()
    }

    // ── React components ───────────────────────────────────────────────────

    function useForce() {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        listeners.add(force)
        return () => { listeners.delete(force) }
      }, [])
      return force
    }

    /** Sidebar-foot toggle: 编辑器模式 ⇄ 对话模式. Adapts to the rail (narrow)
     * sidebar like the shipped Settings/Archive triggers: icon-only circle in
     * rail state, icon + label in the wide state. */
    function ModeToggle(props) {
      useForce()
      const wide = !props || props.wide !== false
      const rail = !wide
      const label = state.mode ? '返回对话模式' : '编辑器模式'
      const ModeIcon = state.mode ? (IconChat || FallbackChatIcon) : (IconCode || FallbackCodeIcon)
      const base = {
        boxSizing: 'border-box', cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        background: 'transparent', border: 'none', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', flex: 'none',
        transition: 'background 0.15s ease',
      }
      const buttonStyle = rail
        ? { ...base, width: '36px', height: '36px', justifyContent: 'center', gap: '0', borderRadius: '50%', margin: '8px 0 10px', padding: '0' }
        : { ...base, width: 'calc(100% + 8px)', height: '34px', borderRadius: '12px', gap: '8px', margin: '4px -4px', padding: '6px 2px 6px 10px', fontSize: '14px', lineHeight: '22px', overflow: 'hidden' }
      const onEnter = (e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover-solid, rgba(0,0,0,.05))' }
      const onLeave = (e) => { e.currentTarget.style.background = 'transparent' }
      return React.createElement('button', {
        type: 'button',
        onClick: () => setMode(!state.mode),
        title: state.mode ? '切换回默认对话模式' : '切换到编辑器模式（文件树 + 编辑 + 对话）',
        'aria-label': label,
        style: buttonStyle,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
      },
        React.createElement('span', { style: { flex: 'none', display: 'inline-flex', color: 'var(--dsw-alias-label-secondary, #57606a)' } },
          React.createElement(ModeIcon, { size: 16 }),
        ),
        !rail ? React.createElement('span', null, label) : null,
      )
    }

    // ── terminal (1.12) ────────────────────────────────────────────────────

    /** Transient top-center toast (rendered via a dedicated shell.overlay cell). */
    let toastTimer = null
    function showToast(text, kind) {
      setState({ toast: { text: String(text || ''), kind: kind === 'err' ? 'err' : 'ok' } })
      if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
      toastTimer = setTimeout(() => {
        toastTimer = null
        setState({ toast: null })
      }, 3200)
    }

    /**
     * Workspace id for the terminal: editor-mode tree root first, then the
     * current conversation session's workspace (both modes), else '' (the
     * node half falls back to the first registry workspace).
     *
     * HOOK RULE: this is a React hook — it must be called unconditionally at
     * the top of a component's render (never inside effects/handlers, never
     * behind a condition), or React throws. Returns the workspaceId of the
     * current session when available.
     */
    function useTermSessionWorkspace(props) {
      const useSessions = props && typeof props.useSessions === 'function' ? props.useSessions : null
      if (!useSessions) return ''
      const list = useSessions((s) => s)
      try {
        const current = list && list.current
        const byId = list && list.byId
        const session = current !== undefined && current !== null && byId ? (byId[current] || undefined) : undefined
        if (session && session.workspaceId) return session.workspaceId
      } catch (e) { /* no sessions data available */ }
      return ''
    }

    /** Pure root computation (no hooks): tree root wins, then session workspace. */
    function termRootFor(sessionWorkspace) {
      return state.rootId || sessionWorkspace || ''
    }

    /** Open a native terminal rooted at the current workspace. */
    async function openTerminal(rootId) {
      if (state.terminalBusy) return
      setState({ terminalBusy: true })
      try {
        const res = await fetch('/dsh-editor-terminal/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: rootId || '' }),
        })
        let data = null
        try { data = await res.json() } catch (e) { /* non-JSON body */ }
        if (!data || data.ok !== true) {
          throw new Error((data && data.error) ? data.error : ('请求失败 (HTTP ' + res.status + ')'))
        }
        showToast('已打开终端: ' + (data.cwd || ''), 'ok')
      } catch (e) {
        showToast('打开终端失败: ' + (e && e.message ? e.message : String(e)), 'err')
      } finally {
        setState({ terminalBusy: false })
      }
    }

    /** Sidebar-foot terminal button — visible in BOTH conversation mode and
     *  editor mode (the footer action seat survives the mode switch). */
    function TerminalButton(props) {
      useForce()
      const wide = !props || props.wide !== false
      const rail = !wide
      // hooks FIRST, unconditionally (never behind a condition)
      const rootRef = React.useRef('')
      const sessionWorkspace = useTermSessionWorkspace(props)
      rootRef.current = termRootFor(sessionWorkspace)
      const base = {
        boxSizing: 'border-box', cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        background: 'transparent', border: 'none', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', flex: 'none',
        transition: 'background 0.15s ease',
      }
      const buttonStyle = rail
        ? { ...base, width: '36px', height: '36px', justifyContent: 'center', gap: '0', borderRadius: '50%', margin: '8px 0 10px', padding: '0', opacity: state.terminalBusy ? 0.55 : 1 }
        : { ...base, width: 'calc(100% + 8px)', height: '34px', borderRadius: '12px', gap: '8px', margin: '4px -4px', padding: '6px 2px 6px 10px', fontSize: '14px', lineHeight: '22px', overflow: 'hidden', opacity: state.terminalBusy ? 0.55 : 1 }
      const onEnter = (e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover-solid, rgba(0,0,0,.05))' }
      const onLeave = (e) => { e.currentTarget.style.background = 'transparent' }
      return React.createElement('button', {
        type: 'button',
        onClick: () => setTerminalOpen(!state.terminalOpen, rootRef.current),
        title: state.terminalOpen ? '关闭内置终端面板' : '打开内置终端面板（Qoder 式，当前工作区目录）',
        'aria-label': '打开终端',
        disabled: state.terminalBusy,
        style: buttonStyle,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
      },
        React.createElement('span', { style: { flex: 'none', display: 'inline-flex', color: 'var(--dsw-alias-label-secondary, #57606a)' } },
          React.createElement(FallbackTerminalIcon, { size: 16 }),
        ),
        !rail ? React.createElement('span', null, '终端') : null,
      )
    }

    /** Toast layer — separate additive shell.overlay cell (id dsh-editor-toast). */
    function ToastLayer() {
      useForce()
      if (!state.toast) return null
      return React.createElement('div', { className: 'dsh-editor-toast ' + state.toast.kind, role: 'status' },
        state.toast.text,
      )
    }

    // ── embedded terminal (1.12): mini ANSI emulator + WebSocket panel ─────
    // A dependency-free xterm-ish emulator (grid + SGR colors + scrollback +
    // wide-char handling) fed by a ConPTY shell relayed over /dsh-editor-terminal/ws.

    // style interning
    const termStyleIds = new Map()
    const termStyles = []
    function termStyleId(fg, bg, bold, dim, ul, inv) {
      const key = fg + ',' + bg + ',' + (bold ? 1 : 0) + (dim ? 1 : 0) + (ul ? 1 : 0) + (inv ? 1 : 0)
      let id = termStyleIds.get(key)
      if (id === undefined) {
        id = termStyles.length
        termStyles.push({ fg, bg, bold: !!bold, dim: !!dim, ul: !!ul, inv: !!inv })
        termStyleIds.set(key, id)
      }
      return id
    }
    termStyleId(-1, -1, false, false, false, false) // style 0 = default

    // truecolor ids encode rgb directly (>= 1000000)
    function termTrueColorId(r, g, b) {
      return 1000000 + ((r & 255) << 16) + ((g & 255) << 8) + (b & 255)
    }
    function termCssColor(id) {
      if (id === -1) return null
      if (id >= 1000000) {
        const v = id - 1000000
        return 'rgb(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ')'
      }
      if (id >= 16 && id <= 255) {
        let r, g, b
        if (id <= 231) {
          const n = id - 16
          const step = [0, 95, 135, 175, 215, 255]
          r = step[Math.floor(n / 36)]
          g = step[Math.floor((n % 36) / 6)]
          b = step[n % 6]
        } else {
          const v = 8 + 10 * (id - 232)
          r = v; g = v; b = v
        }
        return 'rgb(' + r + ',' + g + ',' + b + ')'
      }
      const PALETTE = [
        '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#0abeb0', '#e5e5e5',
        '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
      ]
      return PALETTE[id] || null
    }

    /** Display width of one code point (0 = combining, 2 = wide CJK). */
    function termCharWidth(cp) {
      if (cp === 0 || cp === 0x200d) return 0
      if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff)) return 2
      return 1
    }

    /**
     * Minimal xterm-compatible emulator. `lines` holds history + screen (the
     * screen is always the LAST `rows` lines). Cursor rows are screen-relative.
     */
    class TermEmu {
      constructor(cols, rows, maxHistory) {
        this.maxHistory = maxHistory || 1500
        this.cols = cols
        this.rows = rows
        this.lines = []
        this.cursor = { r: 0, c: 0 }
        this.saved = { r: 0, c: 0 }
        this.cursorVisible = true
        this.curStyle = { fg: -1, bg: -1, bold: false, dim: false, ul: false, inv: false }
        this.offset = 0 // scrollback offset in lines (0 = live)
        this.dirtyAll = true
        this.escState = 0 // 0 normal, 1 esc, 2 csi, 3 osc, 4 ignore-until-st, 5 one-char
        this.escBuf = ''
        this.reset()
      }
      newLine() {
        return { ch: new Array(this.cols).fill(' '), st: new Array(this.cols).fill(0) }
      }
      reset() {
        this.lines = []
        for (let r = 0; r < this.rows; r++) this.lines.push(this.newLine())
        this.cursor = { r: 0, c: 0 }
        this.saved = { r: 0, c: 0 }
        this.cursorVisible = true
        this.curStyle = { fg: -1, bg: -1, bold: false, dim: false, ul: false, inv: false }
        this.offset = 0
        this.escState = 0
        this.escBuf = ''
        this.dirtyAll = true
      }
      absRow() {
        return this.lines.length - this.rows + this.cursor.r
      }
      styleNow() {
        const s = this.curStyle
        return termStyleId(s.fg, s.bg, s.bold, s.dim, s.ul, s.inv)
      }
      scrollUpOne() {
        this.lines.splice(this.lines.length - this.rows, 1)
        this.lines.push(this.newLine())
        if (this.lines.length > this.rows + this.maxHistory) {
          this.lines.splice(0, this.lines.length - this.rows - this.maxHistory)
        }
        this.dirtyAll = true
      }
      linefeed() {
        this.cursor.r += 1
        if (this.cursor.r >= this.rows) {
          this.cursor.r = this.rows - 1
          this.scrollUpOne()
        } else {
          this.dirtyAll = true
        }
      }
      putChar(str, width) {
        if (width === 0) return // combining char: ignore (no base-cell merge for v1)
        const abs = this.absRow()
        const line = this.lines[abs]
        const st = this.styleNow()
        const c = this.cursor.c
        if (c < this.cols) {
          line.ch[c] = str
          line.st[c] = st
          if (width === 2 && c + 1 < this.cols) {
            line.ch[c + 1] = '\0' // wide-char placeholder cell
            line.st[c + 1] = st
          }
        }
        this.cursor.c += width
        if (this.cursor.c >= this.cols) {
          this.cursor.c = 0
          this.linefeed()
        }
      }
      eraseLine(mode) {
        const abs = this.absRow()
        const line = this.lines[abs]
        const from = mode === 1 ? 0 : this.cursor.c
        const to = mode === 0 ? this.cols : this.cursor.c + 1
        for (let c = from; c < to && c < this.cols; c++) {
          line.ch[c] = ' '
          line.st[c] = 0
        }
        this.dirtyAll = true
      }
      eraseDisplay(mode) {
        if (mode === 2 || mode === 3) {
          for (let r = 0; r < this.rows; r++) {
            const line = this.lines[this.lines.length - this.rows + r]
            for (let c = 0; c < this.cols; c++) { line.ch[c] = ' '; line.st[c] = 0 }
          }
        } else if (mode === 1) {
          for (let r = 0; r <= this.cursor.r; r++) {
            const abs = this.lines.length - this.rows + r
            const line = this.lines[abs]
            const from = r === this.cursor.r ? 0 : 0
            const to = r === this.cursor.r ? this.cursor.c + 1 : this.cols
            for (let c = from; c < to; c++) { line.ch[c] = ' '; line.st[c] = 0 }
          }
        } else {
          for (let r = this.cursor.r; r < this.rows; r++) {
            const abs = this.lines.length - this.rows + r
            const line = this.lines[abs]
            const from = r === this.cursor.r ? this.cursor.c : 0
            for (let c = from; c < this.cols; c++) { line.ch[c] = ' '; line.st[c] = 0 }
          }
        }
        this.dirtyAll = true
      }
      eraseChars(n) {
        const abs = this.absRow()
        const line = this.lines[abs]
        for (let i = 0; i < n && this.cursor.c + i < this.cols; i++) {
          line.ch[this.cursor.c + i] = ' '
          line.st[this.cursor.c + i] = 0
        }
        this.dirtyAll = true
      }
      deleteChars(n) {
        const abs = this.absRow()
        const line = this.lines[abs]
        for (let i = this.cursor.c; i < this.cols - n; i++) {
          line.ch[i] = line.ch[i + n]
          line.st[i] = line.st[i + n]
        }
        for (let i = Math.max(this.cursor.c, this.cols - n); i < this.cols; i++) {
          line.ch[i] = ' '
          line.st[i] = 0
        }
        this.dirtyAll = true
      }
      insertChars(n) {
        const abs = this.absRow()
        const line = this.lines[abs]
        for (let i = this.cols - 1; i >= this.cursor.c + n; i--) {
          line.ch[i] = line.ch[i - n]
          line.st[i] = line.st[i - n]
        }
        for (let i = this.cursor.c; i < this.cursor.c + n && i < this.cols; i++) {
          line.ch[i] = ' '
          line.st[i] = 0
        }
        this.dirtyAll = true
      }
      insertLines(n) {
        for (let i = 0; i < n; i++) {
          this.lines.splice(this.lines.length - this.rows + this.cursor.r, 0, this.newLine())
          this.lines.pop() // drop the last screen line
        }
        this.dirtyAll = true
      }
      deleteLines(n) {
        for (let i = 0; i < n; i++) {
          this.lines.splice(this.lines.length - this.rows + this.cursor.r, 1)
          this.lines.push(this.newLine())
        }
        this.dirtyAll = true
      }
      scrollRegionUp(n) {
        for (let i = 0; i < n; i++) {
          this.lines.splice(this.lines.length - this.rows, 1)
          this.lines.push(this.newLine())
        }
        this.dirtyAll = true
      }
      scrollRegionDown(n) {
        for (let i = 0; i < n; i++) {
          this.lines.splice(this.lines.length - 1, 1)
          this.lines.unshift(this.newLine())
        }
        if (this.lines.length > this.rows + this.maxHistory) {
          this.lines.length = this.rows + this.maxHistory
        }
        this.dirtyAll = true
      }
      sgr(params) {
        const st = this.curStyle
        if (!params || params.length === 0) params = [0]
        for (let i = 0; i < params.length; i++) {
          const v = params[i]
          if (v === 0) { st.fg = -1; st.bg = -1; st.bold = false; st.dim = false; st.ul = false; st.inv = false }
          else if (v === 1) st.bold = true
          else if (v === 2) st.dim = true
          else if (v === 4) st.ul = true
          else if (v === 7) st.inv = true
          else if (v === 21 || v === 22) st.bold = false
          else if (v === 24) st.ul = false
          else if (v === 27) st.inv = false
          else if (v >= 30 && v <= 37) st.fg = v - 30
          else if (v === 39) st.fg = -1
          else if (v >= 40 && v <= 47) st.bg = v - 40
          else if (v === 49) st.bg = -1
          else if (v >= 90 && v <= 97) st.fg = 8 + (v - 90)
          else if (v >= 100 && v <= 107) st.bg = 8 + (v - 100)
          else if (v === 38 || v === 48) {
            const next = params[i + 1]
            if (next === 5 && params[i + 2] !== undefined) {
              if (v === 38) st.fg = params[i + 2]
              else st.bg = params[i + 2]
              i += 2
            } else if (next === 2 && params[i + 2] !== undefined && params[i + 3] !== undefined && params[i + 4] !== undefined) {
              const id = termTrueColorId(params[i + 2], params[i + 3], params[i + 4])
              if (v === 38) st.fg = id
              else st.bg = id
              i += 4
            }
          }
        }
      }
      /** Feed one output chunk (complete UTF-8 string). */
      feed(data) {
        if (!data) return
        let i = 0
        const len = data.length
        while (i < len) {
          const ch = data[i]
          if (this.escState === 0) {
            if (ch === '\x1b') { this.escState = 1; this.escBuf = ''; i++; continue }
            if (ch === '\r') { this.cursor.c = 0; i++; continue }
            if (ch === '\n' || ch === '\x0b' || ch === '\x0c') { this.linefeed(); i++; continue }
            if (ch === '\b') { if (this.cursor.c > 0) this.cursor.c--; i++; continue }
            if (ch === '\t') { this.cursor.c = Math.min(this.cols - 1, (Math.floor(this.cursor.c / 8) + 1) * 8); i++; continue }
            if (ch === '\x07' || ch === '\x0e' || ch === '\x0f') { i++; continue }
            const cp = data.codePointAt(i)
            const str = String.fromCodePoint(cp)
            this.putChar(str, termCharWidth(cp))
            i += str.length
            continue
          }
          if (this.escState === 1) {
            if (ch === '[') { this.escState = 2; this.escBuf = ''; i++; continue }
            if (ch === ']') { this.escState = 3; this.escBuf = ''; i++; continue }
            if (ch === 'P' || ch === 'X' || ch === '^' || ch === '_') { this.escState = 4; i++; continue }
            if (ch === '7') { this.saved = { r: this.cursor.r, c: this.cursor.c }; this.escState = 0; i++; continue }
            if (ch === '8') { this.cursor = { r: Math.min(this.rows - 1, this.saved.r), c: Math.min(this.cols - 1, this.saved.c) }; this.escState = 0; i++; continue }
            if (ch === 'c') { this.reset(); this.escState = 0; i++; continue }
            if (ch === 'D') { this.scrollRegionUp(1); this.escState = 0; i++; continue }
            if (ch === 'M') { this.scrollRegionDown(1); this.escState = 0; i++; continue }
            if (ch === 'E') { this.linefeed(); this.cursor.c = 0; this.escState = 0; i++; continue }
            if (ch === 'F') { if (this.cursor.r > 0) this.cursor.r--; this.cursor.c = 0; this.escState = 0; i++; continue }
            if (ch === 'H') { this.cursor.c = Math.min(this.cols - 1, (Math.floor(this.cursor.c / 8) + 1) * 8); this.escState = 0; i++; continue }
            if (ch === '(' || ch === ')' || ch === '#' || ch === '=' || ch === '>') { this.escState = 5; i++; continue }
            this.escState = 0; i++; continue // unknown ESC sequence: drop it
          }
          if (this.escState === 2) {
            // CSI: collect until a final byte 0x40-0x7e
            const code = ch.charCodeAt(0)
            if (code >= 0x40 && code <= 0x7e) {
              this.escBuf += ch
              this.dispatchCsi(this.escBuf)
              this.escState = 0
              this.escBuf = ''
            } else {
              this.escBuf += ch
            }
            i++
            continue
          }
          if (this.escState === 3) {
            // OSC: ignore until BEL or ST
            if (ch === '\x07') this.escState = 0
            else if (ch === '\x1b') this.escState = 6
            i++
            continue
          }
          if (this.escState === 4) {
            // DCS/PM/APC: ignore until ST or BEL
            if (ch === '\x07') this.escState = 0
            else if (ch === '\x1b') this.escState = 6
            i++
            continue
          }
          if (this.escState === 5) { this.escState = 0; i++; continue }
          if (this.escState === 6) {
            // expecting '\' to close ST
            this.escState = 0
            i++
            continue
          }
          i++
        }
      }
      dispatchCsi(buf) {
        let b = buf
        let privateMode = false
        if (b[0] === '?' || b[0] === '>' || b[0] === '=') {
          privateMode = b[0] === '?'
          b = b.slice(1)
        }
        const final = b[b.length - 1]
        const body = b.slice(0, -1)
        const params = body === '' ? [] : body.split(';').map((s) => (s === '' ? 0 : parseInt(s, 10)))
        const n = (i) => { const v = params[i]; return v === undefined || Number.isNaN(v) ? 1 : v }
        const r = this.cursor.r
        const c = this.cursor.c
        switch (final) {
          case 'A': this.cursor.r = Math.max(0, r - n(0)); break
          case 'B': this.cursor.r = Math.min(this.rows - 1, r + n(0)); break
          case 'C': this.cursor.c = Math.min(this.cols - 1, c + n(0)); break
          case 'D': this.cursor.c = Math.max(0, c - n(0)); break
          case 'E': this.cursor.r = Math.min(this.rows - 1, r + n(0)); this.cursor.c = 0; break
          case 'F': this.cursor.r = Math.max(0, r - n(0)); this.cursor.c = 0; break
          case 'G': this.cursor.c = Math.max(0, Math.min(this.cols - 1, n(0) - 1)); break
          case 'd': this.cursor.r = Math.max(0, Math.min(this.rows - 1, n(0) - 1)); break
          case 'H': case 'f':
            this.cursor.r = Math.max(0, Math.min(this.rows - 1, n(0) - 1))
            this.cursor.c = Math.max(0, Math.min(this.cols - 1, n(1) - 1))
            break
          case 'J': this.eraseDisplay(n(0)); break
          case 'K': this.eraseLine(n(0)); break
          case 'X': this.eraseChars(n(0)); break
          case 'P': this.deleteChars(n(0)); break
          case '@': this.insertChars(n(0)); break
          case 'L': this.insertLines(n(0)); break
          case 'M': this.deleteLines(n(0)); break
          case 'S': this.scrollRegionUp(n(0)); break
          case 'T': this.scrollRegionDown(n(0)); break
          case 'm': this.sgr(params); break
          case 's': this.saved = { r: this.cursor.r, c: this.cursor.c }; break
          case 'u': this.cursor = { r: Math.min(this.rows - 1, this.saved.r), c: Math.min(this.cols - 1, this.saved.c) }; break
          case 'h': case 'l':
            if (privateMode && n(0) === 25) this.cursorVisible = final === 'h'
            break
          default: break // DA/DSR/decals ignored
        }
      }
      resize(cols, rows) {
        cols = Math.max(20, cols)
        rows = Math.max(5, rows)
        if (cols === this.cols && rows === this.rows) return
        const nextLines = this.lines.map((line) => {
          const ch = new Array(cols).fill(' ')
          const st = new Array(cols).fill(0)
          for (let i = 0; i < Math.min(cols, line.ch.length); i++) {
            if (line.ch[i] !== '\0') { ch[i] = line.ch[i]; st[i] = line.st[i] }
          }
          return { ch, st }
        })
        if (rows > this.rows) {
          for (let i = 0; i < rows - this.rows; i++) nextLines.push(this.newLine())
        }
        this.lines = nextLines
        this.cols = cols
        this.rows = rows
        this.cursor.r = Math.max(0, Math.min(rows - 1, this.cursor.r))
        this.cursor.c = Math.max(0, Math.min(cols - 1, this.cursor.c))
        if (this.lines.length > rows + this.maxHistory) {
          this.lines.splice(0, this.lines.length - rows - this.maxHistory)
        }
        this.dirtyAll = true
      }
      /** Plain text of the screen area (tests / clipboard). */
      screenText() {
        const out = []
        for (let r = 0; r < this.rows; r++) {
          const line = this.lines[this.lines.length - this.rows + r]
          let text = ''
          for (let c = 0; c < this.cols; c++) if (line.ch[c] !== '\0') text += line.ch[c]
          out.push(text.replace(/\s+$/, ''))
        }
        return out.join('\n').replace(/\n+$/, '')
      }
      /** HTML for one line (plain text when unstyled, spans per style run). */
      renderLineHtml(line) {
        let html = ''
        let buf = ''
        let cur = -1
        const cols = line.ch.length
        const push = () => {
          if (!buf) return
          if (cur === 0 || cur === -1) html += escapeHtml(buf)
          else {
            const s = termStyles[cur]
            let css = ''
            let fg = s.inv ? s.bg : s.fg
            let bg = s.inv ? s.fg : s.bg
            const fgColor = termCssColor(fg)
            const bgColor = termCssColor(bg)
            if (fgColor) css += 'color:' + fgColor + ';'
            if (bgColor) css += 'background-color:' + bgColor + ';'
            if (s.bold) css += 'font-weight:600;'
            if (s.dim) css += 'opacity:.72;'
            if (s.ul) css += 'text-decoration:underline;'
            html += '<span style="' + css + '">' + escapeHtml(buf) + '</span>'
          }
          buf = ''
        }
        for (let i = 0; i < cols; i++) {
          const ch = line.ch[i]
          if (ch === '\0') continue
          const st = line.st[i]
          if (st !== cur) { push(); cur = st }
          buf += ch
        }
        push()
        return html === '' ? '&nbsp;' : html
      }
    }

    // ── embedded terminal wiring (ws + panel) ──────────────────────────────

    let termEmu = null // created lazily with panel dims
    let termEmuEls = null // { viewport, lines: [], ta, cursor, probe }
    let termRenderTimer = null
    const termNet = {
      ws: null,
      status: 'closed',
      cwd: '',
      shell: '',
      pid: 0,
      reconnectTimer: null,
      discard: false,
    }

    function termStatusText() {
      switch (state.termStatus) {
        case 'connecting': return '连接中…'
        case 'open': return '已连接'
        case 'exited': return '已退出'
        case 'error': return '不可用'
        default: return '未连接'
      }
    }

    function termSetStatus(status, patch) {
      const p = { termStatus: status }
      if (patch) Object.assign(p, patch)
      setState(p)
    }

    function termScheduleReconnect() {
      if (termNet.reconnectTimer !== null || !state.terminalOpen) return
      termNet.reconnectTimer = setTimeout(() => {
        termNet.reconnectTimer = null
        if (state.terminalOpen) termConnect(termNet.lastRoot)
      }, 1500)
    }

    function termConnect(rootId) {
      if (termNet.ws && (termNet.ws.readyState === 0 || termNet.ws.readyState === 1)) return
      if (typeof WebSocket === 'undefined') return
      termNet.lastRoot = rootId || termNet.lastRoot || ''
      termEnsureEmu() // the init frame always carries the current grid dims
      termSetStatus('connecting', { termError: '' })
      let ws
      try {
        const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://'
        ws = new WebSocket(proto + window.location.host + '/dsh-editor-terminal/ws?root=' + encodeURIComponent(rootId || ''))
      } catch (e) {
        termSetStatus('error', { termError: String(e && e.message ? e.message : e) })
        return
      }
      termNet.ws = ws
      ws.onopen = () => {
        termSetStatus('connecting', { termError: '' })
        if (termEmu) {
          try {
            ws.send(JSON.stringify({
              t: 'init',
              cols: termEmu.cols,
              rows: termEmu.rows,
              shell: state.termShell === 'cmd' ? 'cmd' : undefined,
            }))
          } catch (e) { /* ignore */ }
        }
      }
      ws.onmessage = (ev) => {
        let msg = null
        try { msg = JSON.parse(ev.data) } catch (e) { return }
        if (!msg || typeof msg !== 'object') return
        if (msg.t === 'meta') {
          termNet.cwd = msg.cwd || ''
          termNet.shell = msg.shell || ''
          termNet.pid = msg.pid || 0
          setState({ termMeta: { cwd: termNet.cwd, shell: termNet.shell, pid: termNet.pid }, termStatus: 'open' })
        } else if (msg.t === 'hist') {
          if (termEmu) { termEmu.reset(); termEmu.feed(msg.d || '') }
          termRenderNow()
        } else if (msg.t === 'out') {
          if (termEmu) termEmu.feed(msg.d || '')
          termScheduleRender()
        } else if (msg.t === 'exit') {
          termSetStatus('exited', { termError: '' })
        } else if (msg.t === 'err') {
          termSetStatus('error', { termError: msg.m || '终端不可用' })
        }
      }
      ws.onclose = () => {
        termNet.ws = null
        if (termNet.discard) { termNet.discard = false; termSetStatus('closed'); return }
        termSetStatus('closed')
        termScheduleReconnect()
      }
      ws.onerror = () => { /* onclose follows */ }
    }

    function termSend(obj) {
      const ws = termNet.ws
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify(obj)) } catch (e) { /* ignore */ }
      }
    }

    function termClose() {
      termNet.discard = true
      const ws = termNet.ws
      termNet.ws = null
      if (ws) { try { ws.close() } catch (e) { /* ignore */ } }
      if (termNet.reconnectTimer !== null) { clearTimeout(termNet.reconnectTimer); termNet.reconnectTimer = null }
      termSetStatus('closed')
    }

    function termRestart(shell) {
      if (termEmu) { termEmu.reset() }
      termRenderNow()
      termSend({ t: 'restart', shell: shell === 'cmd' ? 'cmd' : undefined })
      termSetStatus('connecting', { termError: '' })
    }

    function termEnsureEmu() {
      if (termEmu) return termEmu
      termEmu = new TermEmu(100, 24)
      return termEmu
    }

    /** Build the DOM scaffold for the terminal viewport (once per mount). */
    function termEnsureEls(viewportEl) {
      if (termEmuEls && termEmuEls.viewport === viewportEl) return termEmuEls
      // font probe: an absolutely-positioned span WITHOUT left/right so its
      // offsetWidth equals the text width (10 cells), inheriting the panel font
      const probe = document.createElement('span')
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.whiteSpace = 'pre'
      probe.style.left = '0'
      probe.style.top = '0'
      probe.style.pointerEvents = 'none'
      probe.textContent = '0123456789'
      viewportEl.appendChild(probe)
      const lineEls = []
      for (let i = 0; i < 80; i++) {
        const el = document.createElement('div')
        el.className = 'dsh-editor-term-line'
        el.style.visibility = 'hidden'
        viewportEl.appendChild(el)
        lineEls.push(el)
      }
      const cursor = document.createElement('div')
      cursor.className = 'dsh-editor-term-cursor'
      cursor.style.visibility = 'hidden'
      viewportEl.appendChild(cursor)
      const ta = document.createElement('textarea')
      ta.className = 'dsh-editor-term-hidden-ta'
      ta.setAttribute('autocapitalize', 'off')
      ta.setAttribute('autocomplete', 'off')
      ta.setAttribute('autocorrect', 'off')
      ta.setAttribute('spellcheck', 'false')
      viewportEl.appendChild(ta)
      termEmuEls = { viewport: viewportEl, probe, lineEls, cursor, ta, cellW: 8, cellH: 19 }
      termUpdateMetrics()
      return termEmuEls
    }

    /** Keep the terminal panel clear of the sidebar: measure the frame's first
     *  column (the sidebar / file tree) so the footer buttons stay visible. */
    function termMeasureLeft() {
      try {
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay && overlay.parentElement
        const first = frame && frame.firstElementChild
        if (first && first.offsetWidth > 0) {
          document.documentElement.style.setProperty('--dsh-term-left', first.offsetWidth + 'px')
        }
      } catch (e) { /* ignore */ }
    }

    function termUpdateMetrics() {
      const els = termEmuEls
      if (!els || !termEmu) return
      els.cellW = Math.max(1, els.probe.offsetWidth / 10)
      els.cellH = Math.max(1, els.probe.offsetHeight)
      const w = els.viewport.clientWidth - 20
      const h = els.viewport.clientHeight - 12
      const cols = Math.max(20, Math.floor(w / els.cellW))
      const rows = Math.max(5, Math.floor(h / els.cellH))
      if (cols !== termEmu.cols || rows !== termEmu.rows) {
        termEmu.resize(cols, rows)
        termSend({ t: 'resize', cols: termEmu.cols, rows: termEmu.rows })
        termScheduleRender()
      }
    }

    function termScheduleRender() {
      if (termRenderTimer !== null) return
      termRenderTimer = requestAnimationFrame(() => {
        termRenderTimer = null
        termRenderNow()
      })
    }

    function termRenderNow() {
      const els = termEmuEls
      const emu = termEmu
      if (!els || !emu) return
      const start = Math.max(0, emu.lines.length - emu.rows - emu.offset)
      for (let i = 0; i < emu.rows; i++) {
        const el = els.lineEls[i]
        if (!el) break
        const line = emu.lines[start + i]
        el.style.top = (6 + i * els.cellH) + 'px'
        el.style.height = els.cellH + 'px'
        el.style.visibility = 'visible'
        el.innerHTML = line ? emu.renderLineHtml(line) : ''
      }
      for (let i = emu.rows; i < els.lineEls.length; i++) {
        els.lineEls[i].style.visibility = 'hidden'
      }
      // cursor (only on the live view)
      if (emu.offset === 0 && emu.cursorVisible) {
        els.cursor.style.left = (10 + emu.cursor.c * els.cellW) + 'px'
        els.cursor.style.top = (6 + emu.cursor.r * els.cellH) + 'px'
        els.cursor.style.width = els.cellW + 'px'
        els.cursor.style.height = els.cellH + 'px'
        els.cursor.style.visibility = 'visible'
      } else {
        els.cursor.style.visibility = 'hidden'
      }
    }

    /** Key-to-sequence mapping for the terminal textarea. */
    function termKeySequence(e) {
      const k = e.key
      if (k === 'Enter') return '\r'
      if (k === 'Backspace') return '\x7f'
      if (k === 'Tab') return '\t'
      if (k === 'Delete') return '\x1b[3~'
      if (k === 'Insert') return '\x1b[2~'
      if (k === 'Home') return '\x1b[H'
      if (k === 'End') return '\x1b[F'
      if (k === 'PageUp') return '\x1b[5~'
      if (k === 'PageDown') return '\x1b[6~'
      if (k === 'ArrowUp') return '\x1b[A'
      if (k === 'ArrowDown') return '\x1b[B'
      if (k === 'ArrowRight') return '\x1b[C'
      if (k === 'ArrowLeft') return '\x1b[D'
      if (k === 'F1') return '\x1bOP'
      if (k === 'F2') return '\x1bOQ'
      if (k === 'F3') return '\x1bOR'
      if (k === 'F4') return '\x1bOS'
      if (k === 'Escape') return '\x1b'
      if (e.altKey && k.length === 1) return '\x1b' + k
      if (e.ctrlKey && k.length === 1 && !e.shiftKey && !e.altKey) {
        const code = k.toLowerCase().charCodeAt(0) - 96
        if (code >= 1 && code <= 26) return String.fromCharCode(code)
      }
      if (e.ctrlKey && k === 'Enter') return '\r'
      return null
    }

    function termSetupInput() {
      const els = termEmuEls
      if (!els) return
      const ta = els.ta
      ta.onkeydown = (e) => {
        const seq = termKeySequence(e)
        if (seq !== null) {
          e.preventDefault()
          termSend({ t: 'input', d: seq })
          return
        }
        // Ctrl+V / Cmd+V: let the paste event deliver the text
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) return
        // plain printable characters flow through the input event
      }
      ta.oninput = (e) => {
        if (e.isComposing) return
        const text = ta.value
        ta.value = ''
        if (text) termSend({ t: 'input', d: text })
      }
      ta.oncompositionend = (e) => {
        const text = e.data || ''
        ta.value = ''
        if (text) termSend({ t: 'input', d: text })
      }
      ta.onpaste = (e) => {
        e.preventDefault()
        const text = (e.clipboardData && e.clipboardData.getData('text')) || ''
        if (text) termSend({ t: 'input', d: text })
      }
    }

    /** Embedded terminal panel — fixed bottom bar, both modes. */
    function TerminalPanel(props) {
      useForce()
      if (!state.terminalOpen) return null
      const viewportRef = React.useRef(null)
      const rootRef = React.useRef('')
      // hooks FIRST, unconditionally (useSessions must never run inside the
      // effect or a click handler — that would throw and kill the panel)
      const sessionWorkspace = useTermSessionWorkspace(props)
      rootRef.current = termRootFor(sessionWorkspace)

      React.useEffect(() => {
        const viewportEl = viewportRef.current
        if (!viewportEl) return undefined
        termEnsureEmu()
        termEnsureEls(viewportEl)
        termSetupInput()
        termUpdateMetrics()
        termMeasureLeft()
        if (!(termNet.ws && (termNet.ws.readyState === 0 || termNet.ws.readyState === 1))) {
          termConnect(rootRef.current)
        }
        // measure again after fonts settle + when the layout (sidebar width,
        // window size) changes
        const t1 = setTimeout(() => { termUpdateMetrics(); termMeasureLeft() }, 120)
        const t2 = setTimeout(() => { termUpdateMetrics(); termMeasureLeft() }, 600)
        const onResize = () => { termUpdateMetrics(); termMeasureLeft() }
        window.addEventListener('resize', onResize)
        let ro = null
        try {
          ro = new ResizeObserver(onResize)
          ro.observe(viewportEl)
        } catch (e) { /* no ResizeObserver */ }
        const onWheel = (e) => {
          if (!termEmu) return
          const before = termEmu.offset
          const max = Math.max(0, termEmu.lines.length - termEmu.rows)
          if (e.deltaY > 0) termEmu.offset = Math.min(max, termEmu.offset + 3)
          else if (e.deltaY < 0) termEmu.offset = Math.max(0, termEmu.offset - 3)
          if (termEmu.offset !== before) termRenderNow()
        }
        viewportEl.addEventListener('wheel', onWheel, { passive: true })
        return () => {
          clearTimeout(t1)
          clearTimeout(t2)
          window.removeEventListener('resize', onResize)
          if (ro) { try { ro.disconnect() } catch (e) { /* ignore */ } }
          viewportEl.removeEventListener('wheel', onWheel)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const header = React.createElement('div', { className: 'dsh-editor-term-head' },
        React.createElement('span', { className: 'dsh-editor-term-head-title' },
          React.createElement(FallbackTerminalIcon, { size: 14 }),
          '终端',
        ),
        React.createElement('span', { className: 'dsh-editor-term-dot ' + state.termStatus }),
        React.createElement('span', { className: 'dsh-editor-term-shell' }, termStatusText()),
        React.createElement('span', { className: 'dsh-editor-term-cwd', title: (state.termMeta && state.termMeta.cwd) || '' },
          (state.termMeta && state.termMeta.cwd) || '',
        ),
        React.createElement('select', {
          className: 'dsh-editor-term-select',
          title: '选择终端 Shell',
          value: state.termShell,
          onChange: (e) => { setState({ termShell: e.target.value }); termRestart(e.target.value) },
        },
          React.createElement('option', { value: '' }, 'PowerShell'),
          React.createElement('option', { value: 'cmd' }, 'CMD'),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-term-btn',
          title: '重新启动终端（会终止当前会话）',
          onClick: () => termRestart(state.termShell),
        }, '重新启动'),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-term-btn',
          title: '在系统终端中打开当前工作区目录',
          onClick: () => openTerminal(rootRef.current),
        }, '外部终端'),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-term-btn close',
          title: '关闭终端面板（会话保持运行）',
          onClick: () => setTerminalOpen(false),
        }, '×'),
      )

      const viewport = React.createElement('div', {
        className: 'dsh-editor-term-viewport',
        ref: viewportRef,
        onClick: () => { if (termEmuEls && termEmuEls.ta) termEmuEls.ta.focus() },
      })

      const banner = state.termStatus === 'error' && state.termError
        ? React.createElement('div', { className: 'dsh-editor-term-banner' }, state.termError)
        : null

      return React.createElement('div', { className: 'dsh-editor-term-panel' },
        header,
        banner,
        viewport,
      )
    }

    /** Toggle the embedded terminal panel (Qoder-style). */
    function setTerminalOpen(open, rootId) {
      setState({ terminalOpen: !!open })
      try { document.body.classList.toggle('dsh-editor-terminal-open', !!open) } catch (e) { /* ignore */ }
      if (open) {
        termNet.lastRoot = rootId || termNet.lastRoot || ''
        termEnsureEmu()
        termConnect(termNet.lastRoot)
      } else {
        termClose()
      }
    }

    /** Single tree node (dir or file). */
    function TreeNode({ node, depth }) {
      const isDir = node.kind === 'dir'
      const isOpen = isDir && expandedDirs.has(node.path)
      const isSelected = !isDir && state.selectedPath === node.path

      const onToggle = () => {
        if (!isDir) { selectFile(node.path); return }
        if (isOpen) expandedDirs.delete(node.path)
        else expandedDirs.add(node.path)
        emit()
      }

      let icon = null
      if (isDir) {
        const FolderIcon = isOpen ? (FolderOpenIcon || FallbackFolderIcon) : (FolderCloseIcon || FallbackFolderIcon)
        icon = React.createElement('span', { className: 'dsh-editor-node-icon folder' + (isOpen ? ' open' : '') },
          React.createElement(FolderIcon, { size: 15, open: isOpen }),
        )
      } else {
        const lang = detectLang(node.path)
        icon = React.createElement('span', { className: 'dsh-editor-node-dot', style: { background: langColor(lang) } })
      }

      const badge = isDir && isOpen && Array.isArray(node.children) && node.children.length > 0
        ? React.createElement('span', { className: 'dsh-editor-node-badge' },
            String(node.children.filter((c) => c.kind === 'file').length))
        : null

      const children = isDir && isOpen && Array.isArray(node.children) && node.children.length > 0
        ? React.createElement('div', { className: 'dsh-editor-tree-children' },
            node.children.map((child) => React.createElement(TreeNode, { key: child.path, node: child, depth: depth + 1 })))
        : null

      const rowProps = {
        className: 'dsh-editor-node-row ' + (isDir ? 'dsh-editor-node-dir' : 'dsh-editor-node-file') + (isSelected ? ' selected' : ''),
        onClick: onToggle,
        title: node.path,
      }
      if (!isDir) {
        // whole-file drag to the conversation + file context menu
        rowProps.draggable = true
        rowProps.onDragStart = (e) => {
          try {
            e.dataTransfer.setData('application/x-dsh-editor-file', node.path)
            e.dataTransfer.setData('text/plain', node.path)
            e.dataTransfer.effectAllowed = 'copy'
          } catch (err) { /* ignore */ }
        }
        rowProps.onContextMenu = (e) => {
          e.preventDefault()
          setState({ treeMenu: { x: e.clientX, y: e.clientY, path: node.path } })
        }
      }

      return React.createElement('div', null,
        React.createElement('div', rowProps,
          icon,
          React.createElement('span', { className: 'dsh-editor-node-name' }, node.name),
          badge,
        ),
        children,
      )
    }

    /** File tree — occupies sidebar.workspaces while editor mode is on. */
    function FileTreePanel() {
      useForce()
      if (!state.mode) return null

      const folderIcon = FolderOpenIcon || FallbackFolderIcon

      const header = React.createElement('div', { className: 'dsh-editor-tree-header' },
        React.createElement('span', { className: 'dsh-editor-tree-title' },
          React.createElement(folderIcon, { size: 15, open: true }),
          '项目',
        ),
        React.createElement('select', {
          className: 'dsh-editor-tree-select',
          value: state.rootId || '',
          onChange: (e) => { const id = e.target.value; setState({ rootId: id }); loadTree(id) },
          title: '选择项目',
        },
          state.roots.length === 0
            ? React.createElement('option', { value: '' }, '无项目')
            : state.roots.map((r) => React.createElement('option', { key: r.id, value: r.id }, r.title)),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-tree-back',
          onClick: () => setMode(false),
          title: '切换回默认对话模式',
        },
          React.createElement(IconChat || FallbackChatIcon, { size: 13 }),
          '对话',
        ),
      )

      let body
      if (state.treeLoading && !state.tree) {
        body = React.createElement('div', { className: 'dsh-editor-tree-msg' }, '加载中…')
      } else if (state.treeError) {
        body = React.createElement('div', { className: 'dsh-editor-tree-msg' }, state.treeError)
      } else if (!state.tree || state.tree.length === 0) {
        body = React.createElement('div', { className: 'dsh-editor-tree-msg' },
          state.roots.length === 0
            ? '未找到工作区。\n请先返回对话模式，创建或选择一个工作区。'
            : '（空目录）')
      } else {
        body = React.createElement('div', { className: 'dsh-editor-tree-body' },
          state.tree.map((node) => React.createElement(TreeNode, { key: node.path, node, depth: 0 })))
      }

      const totalFiles = state.tree ? countFiles(state.tree) : 0
      const foot = state.truncated
        ? React.createElement('div', { className: 'dsh-editor-tree-foot' }, '目录过大，仅显示部分文件')
        : React.createElement('div', { className: 'dsh-editor-tree-foot' },
            state.selectedPath ? ('编辑: ' + state.selectedPath) : ('共 ' + totalFiles + ' 个文件 · 右键/拖拽文件可添加到对话'))

      // file context menu (right-click on a tree file)
      const treeMenu = state.treeMenu
      let treeMenuEl = null
      if (treeMenu) {
        const vw = (typeof window !== 'undefined' && window.innerWidth) || 0
        const vh = (typeof window !== 'undefined' && window.innerHeight) || 0
        const menuItem = (label, icon, fn) => React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-menu-item',
          onClick: fn,
        }, icon, label)
        treeMenuEl = React.createElement('div', {
          className: 'dsh-editor-menu',
          style: {
            left: Math.max(4, Math.min(treeMenu.x, Math.max(0, vw - 190))),
            top: Math.max(4, Math.min(treeMenu.y, Math.max(0, vh - 90))),
          },
        },
          menuItem('添加到对话', React.createElement(IconChat || FallbackChatIcon, { size: 14 }), () => {
            const path = treeMenu.path
            setState({ treeMenu: null })
            addFileCard(path)
          }),
          menuItem('复制路径', React.createElement(IconCopyOutline16 || FallbackCopyIcon, { size: 14 }), () => {
            copyToClipboard(treeMenu.path)
            setState({ treeMenu: null, message: '已复制路径: ' + treeMenu.path, messageKind: 'ok' })
          }),
        )
      }

      return React.createElement('div', { className: 'dsh-editor-tree' }, header, body, foot, treeMenuEl)
    }

      /** Horizontal session switcher pinned to the top of the chat column. */
      function SessionTabsBar(props) {
        useForce()
        const noList = { ids: [], byId: {}, current: undefined }
        const noWorkspaces = { items: [], archivedSessionIds: [] }
        const useSessions = (props && typeof props.useSessions === 'function') ? props.useSessions : () => noList
        const useWorkspaces = (props && typeof props.useWorkspaces === 'function') ? props.useWorkspaces : () => noWorkspaces
        const list = useSessions((s) => s)
        const ws = useWorkspaces((s) => s)
        if (!state.mode) return null
        const archivedRaw = ws && ws.archivedSessionIds
        const archived = new Set(Array.isArray(archivedRaw) ? archivedRaw : (archivedRaw instanceof Set ? archivedRaw : []))
        const current = list && list.current
        const items = (Array.isArray(list && list.ids) ? list.ids : [])
          .map((id) => list.byId && list.byId[id])
          .filter((s) => s && s.origin !== 'subagent' && !archived.has(s.id) && (!s.blank || s.id === current))
          .sort((a, b) => ((b && b.updatedAt) || 0) - ((a && a.updatedAt) || 0))
        const sessionTitle = (s) => s && s.blank ? '新建会话' : ((s && s.displayTitle) || (s && s.id) || '')
        // resolve the client Workspace id for the "+ 新会话" action: match the
        // current file-tree root by id first, then by path (startSession falls
        // back to the recent workspace when nothing matches)
        const newWorkspaceId = (() => {
          const rootId = state.rootId
          const wsItems = Array.isArray(ws && ws.items) ? ws.items : []
          const byId = wsItems.find((w) => w && String(w.workspaceId) === String(rootId))
          if (byId) return byId.workspaceId
          const root = state.roots.find((r) => String(r && r.id) === String(rootId))
          if (root && root.path) {
            const norm = (p) => String(p || '').replace(/[\\/]+$/, '')
            const byPath = wsItems.find((w) => w && w.path && norm(w.path) === norm(root.path))
            if (byPath) return byPath.workspaceId
          }
          return rootId || undefined
        })()
        const currentSummary = current !== undefined && current !== null && list && list.byId
          ? (list.byId[current] || undefined)
          : undefined
        const currentTitle = currentSummary
          ? sessionTitle(currentSummary)
          : (items.length > 0 ? '选择会话…' : '无会话')
        const query = String(state.sessionQuery || '').trim().toLowerCase()
        const shown = query
          ? items.filter((s) => sessionTitle(s).toLowerCase().indexOf(query) !== -1)
          : items
        const menuOpen = !!state.sessionMenuOpen
        const toggleMenu = () => {
          setState({ sessionMenuOpen: !menuOpen, sessionQuery: '' })
        }
        return React.createElement('div', { className: 'dsh-editor-session-tabs', 'aria-label': '会话列表' },
          React.createElement('span', { className: 'dsh-editor-session-tabs-title' }, '会话'),
          React.createElement('button', {
            key: '__trigger',
            type: 'button',
            className: 'dsh-editor-session-trigger',
            title: '点击查看全部会话',
            onClick: toggleMenu,
          },
            React.createElement('span', { className: 'dsh-editor-session-trigger-label' }, currentTitle),
            React.createElement('span', { className: 'dsh-editor-session-trigger-count' }, String(items.length)),
            React.createElement('span', { className: 'dsh-editor-session-chevron' + (menuOpen ? ' open' : '') },
              React.createElement('svg', { width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
                React.createElement('path', { d: 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              ),
            ),
          ),
          React.createElement('button', {
            key: '__new',
            type: 'button',
            className: 'dsh-editor-session-new',
            title: '在当前项目新建一个会话',
            onClick: () => { if (startSession) { try { startSession(newWorkspaceId) } catch (e) { /* ignore */ } } },
          }, '+ 新会话'),
          menuOpen
            ? React.createElement('div', { key: '__menu', className: 'dsh-editor-session-menu', role: 'listbox', 'aria-label': '全部会话' },
                items.length > 8
                  ? React.createElement('input', {
                      className: 'dsh-editor-session-search',
                      placeholder: '搜索会话…',
                      value: state.sessionQuery || '',
                      autoFocus: true,
                      onChange: (e) => setState({ sessionQuery: e.target.value }),
                    })
                  : null,
                shown.length === 0
                  ? React.createElement('div', { className: 'dsh-editor-session-menu-empty' },
                      query ? '无匹配会话' : '暂无会话')
                  : shown.map((s) => React.createElement('button', {
                      key: s.id,
                      type: 'button',
                      role: 'option',
                      'aria-selected': s.id === current,
                      className: 'dsh-editor-session-menu-item' + (s.id === current ? ' active' : ''),
                      title: sessionTitle(s),
                      onClick: () => {
                        setState({ sessionMenuOpen: false, sessionQuery: '' })
                        if (openSession) { try { openSession(s.id) } catch (e) { /* ignore */ } }
                      },
                    },
                      React.createElement('span', { className: 'dsh-editor-session-menu-item-title' }, sessionTitle(s)),
                      s.id === current
                        ? React.createElement('span', { className: 'dsh-editor-session-menu-item-check' }, '✓')
                        : null,
                    )),
              )
            : null,
        )
      }


    /** Editor overlay — rendered in shell.overlay (always registered). */
    function EditorPanel(props) {
      useForce()
      const preRef = React.useRef(null)
      const taRef = React.useRef(null)
      if (!state.mode) return null
        const sessionTabs = React.createElement(SessionTabsBar, props)

      // resize handles are always present in editor mode (also when no file is
      // open yet — the hint panel still needs resizable columns)
      const handles = [
        React.createElement(ResizeHandle, { key: 'tree', side: 'tree' }),
        React.createElement(ResizeHandle, { key: 'chat', side: 'chat' }),
      ]

      if (!state.selectedPath) {
        return React.createElement('div', { className: 'dsh-editor-panel' },
          handles[0],
          handles[1],
            sessionTabs,
          React.createElement('div', { className: 'dsh-editor-hint' },
            '从左侧文件树选择一个文件开始编辑',
          ),
        )
      }

      const lang = detectLang(state.selectedPath)
      const huge = state.content.length > MAX_HIGHLIGHT_CHARS

      const onKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault()
          saveFile()
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          const el = e.target
          const start = el.selectionStart
          const end = el.selectionEnd
          const next = state.content.slice(0, start) + '  ' + state.content.slice(end)
          applyContent(next, true)
          // restore caret after React re-render
          requestAnimationFrame(() => {
            try { el.selectionStart = el.selectionEnd = start + 2 } catch (err) { /* ignore */ }
          })
          return
        }
      }

      // keep the highlight <pre> in sync with the transparent <textarea>
      const onScroll = (e) => {
        const pre = preRef.current
        if (pre) {
          pre.scrollTop = e.target.scrollTop
          pre.scrollLeft = e.target.scrollLeft
        }
      }

      const status = state.message
        ? React.createElement('span', { className: 'dsh-editor-panel-status ' + state.messageKind }, state.message)
        : (state.dirty
            ? React.createElement('span', { className: 'dsh-editor-panel-status' }, '未保存')
            : null)

      const langLabel = lang === 'text' ? '纯文本' : lang
      const isMarkdown = lang === 'md'

      // markdown preview toggle (top-right, before save)
      const previewBtn = isMarkdown
        ? React.createElement('button', {
            type: 'button',
            className: 'dsh-editor-panel-previewbtn' + (state.preview ? ' active' : ''),
            onClick: () => setState({ preview: !state.preview, message: '' }),
            title: state.preview ? '关闭预览，回到编辑' : '打开 Markdown 渲染预览',
          },
            React.createElement(FallbackPreviewIcon, { size: 14 }),
            state.preview ? '编辑' : '预览',
          )
        : null

      // rendered markdown preview (side-by-side with the editor)
      let previewPane = null
      if (state.preview && isMarkdown) {
        const PreviewRenderer = MarkdownTextComponent || FallbackMarkdownPreview
        previewPane = React.createElement('div', { className: 'dsh-editor-preview-col' },
          React.createElement(PreviewRenderer, { text: state.content }),
        )
      }

      // right-click context menu (cut / copy / add to chat)
      const menu = state.menu
      let menuEl = null
      if (menu) {
        const vw = (typeof window !== 'undefined' && window.innerWidth) || 0
        const vh = (typeof window !== 'undefined' && window.innerHeight) || 0
        const style = {
          left: Math.max(4, Math.min(menu.x, Math.max(0, vw - 190))),
          top: Math.max(4, Math.min(menu.y, Math.max(0, vh - 130))),
        }
        const item = (label, icon, fn, disabled) => React.createElement('button', {
          type: 'button',
          className: 'dsh-editor-menu-item',
          disabled: disabled,
          onClick: fn,
        }, icon, label)
        menuEl = React.createElement('div', { className: 'dsh-editor-menu', style },
          item('剪切', React.createElement(FallbackCutIcon, { size: 14 }), () => doCut(menu), !menu.hasSel),
          item('复制', React.createElement(IconCopyOutline16 || FallbackCopyIcon, { size: 14 }), () => doCopy(menu), !menu.hasSel),
          React.createElement('div', { className: 'dsh-editor-menu-sep' }),
          item('添加到对话', React.createElement(IconChat || FallbackChatIcon, { size: 14 }), () => doAddToChat(menu), !menu.hasSel),
        )
      }

      return React.createElement('div', { className: 'dsh-editor-panel' },
        handles[0],
        handles[1],
          sessionTabs,
        menuEl,
        React.createElement('div', { className: 'dsh-editor-panel-header' },
          React.createElement('span', { className: 'dsh-editor-panel-path', title: state.selectedPath }, state.selectedPath),
          React.createElement('span', { className: 'dsh-editor-panel-lang', title: '语法高亮语言' }, langLabel),
          status,
          previewBtn,
          React.createElement('button', {
            type: 'button',
            className: 'dsh-editor-panel-save',
            disabled: state.saving || state.loadingFile,
            onClick: saveFile,
          }, state.saving ? '保存中…' : '保存'),
        ),
        state.loadingFile
          ? React.createElement('div', { className: 'dsh-editor-hint' }, '读取中…')
          : React.createElement('div', { className: 'dsh-editor-editor' },
              React.createElement('div', { className: 'dsh-editor-edit-col' },
                React.createElement('pre', {
                  className: 'dsh-editor-pre',
                  ref: preRef,
                  'aria-hidden': true,
                  dangerouslySetInnerHTML: { __html: state.highlightHtml },
                }),
                React.createElement('textarea', {
                  className: 'dsh-editor-textarea',
                  ref: taRef,
                  value: state.content,
                  onChange: (e) => applyContent(e.target.value, true),
                  onScroll: onScroll,
                  onKeyDown: onKeyDown,
                  onContextMenu: (e) => { e.preventDefault(); openContextMenu(e, e.target) },
                  spellCheck: false,
                  autoCapitalize: 'off',
                  autoCorrect: 'off',
                  wrap: 'off',
                  placeholder: huge ? '文件过大，已关闭语法高亮' : '（空文件）',
                }),
              ),
              previewPane,
            ),
      )
    }

    /** Set editor content and re-render the syntax highlight synchronously. */
    function applyContent(next, markDirty) {
      const patch = { content: next }
      if (markDirty) { patch.dirty = true; patch.message = '' }
      const lang = detectLang(state.selectedPath)
      if (state.selectedPath && next.length <= MAX_HIGHLIGHT_CHARS) {
        try { patch.highlightHtml = buildHighlight(next, lang) } catch (e) { /* keep old highlight */ }
      }
      setState(patch)
    }

    // ── editor context menu: cut / copy / add-selection-to-chat ────────────

    function closeMenu() {
      if (state.menu === null) return
      setState({ menu: null })
    }

    async function copyToClipboard(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (e) { /* try legacy path */ }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch (e) {
        return false
      }
    }

    function openContextMenu(e, ta) {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const hasSel = start !== null && end !== null && start !== end
      const text = hasSel ? state.content.slice(start, end) : ''
      setState({
        menu: {
          x: e.clientX,
          y: e.clientY,
          hasSel,
          text,
          start: start || 0,
          end: end || 0,
        },
      })
    }

    async function doCopy(menu) {
      if (!menu || !menu.hasSel) { closeMenu(); return }
      await copyToClipboard(menu.text)
      setState({ message: '已复制 ' + menu.text.length + ' 字符到剪贴板', messageKind: 'ok', menu: null })
    }

    async function doCut(menu) {
      if (!menu || !menu.hasSel) { closeMenu(); return }
      const copied = await copyToClipboard(menu.text)
      const next = state.content.slice(0, menu.start) + state.content.slice(menu.end)
      applyContent(next, true)
      setState({ menu: null, message: copied ? '已剪切并复制 ' + menu.text.length + ' 字符' : '已剪切所选内容', messageKind: 'ok' })
    }

    /** Locate the conversation composer <textarea> (React-controlled). */
    function findComposerTextarea() {
      try {
        const conversation = document.querySelector('[data-slot="conversation"]')
        if (!conversation) return null
        const all = Array.from(conversation.querySelectorAll('textarea'))
        if (all.length === 0) return null
        // the composer carries a data-phase attribute; prefer it, else the last
        const withPhase = all.filter((t) => t.hasAttribute('data-phase'))
        if (withPhase.length > 0) return withPhase[0]
        return all[all.length - 1]
      } catch (e) {
        return null
      }
    }

    /**
     * Build the text merged into the outgoing message for a code-snippet card:
     * a compact backticked file path reference plus the selected code as a
     * fenced block. Falls back to plain text when the selection contains
     * fences.
     */
    function buildSnippetInsert(path, code) {
      const lang = detectLang(path)
      const safeCode = code.endsWith('\n') ? code : code + '\n'
      const pathRef = '`' + (path || '') + '`'
      if (safeCode.indexOf('```') === 0 || safeCode.indexOf('\n```') !== -1) {
        return '\n' + pathRef + '\n\n' + safeCode + '\n'
      }
      const fence = lang && lang !== 'text' ? lang : ''
      return '\n' + pathRef + '\n\n```' + fence + '\n' + safeCode + '```\n'
    }

    function doAddToChat(menu) {
      if (!menu || !menu.hasSel) { closeMenu(); return }
      const path = state.selectedPath
      const block = buildSnippetInsert(path, menu.text)
      if (!findComposerTextarea()) {
        setState({ menu: null, message: '未找到对话输入框，已复制到剪贴板', messageKind: 'err' })
        copyToClipboard(menu.text)
        return
      }
      const id = 'card-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      setState({
        menu: null,
        chatCards: [...state.chatCards, { id, kind: 'code', path, lang: detectLang(path), block }],
        message: '已添加到对话（发送时自动带上文件引用）',
        messageKind: 'ok',
      })
    }

    /** Add a whole-file reference card. The path is merged into the message at
     *  send time (the AI can read the file itself). */
    function addFileCard(path) {
      if (!path) return
      if (!findComposerTextarea()) {
        setState({ message: '未找到对话输入框，已复制路径', messageKind: 'err' })
        copyToClipboard(path)
        return
      }
      const id = 'file-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      setState({
        chatCards: [...state.chatCards, { id, kind: 'file', path, block: '\n`' + path + '`\n' }],
        message: '已添加文件引用: ' + path,
        messageKind: 'ok',
      })
    }

    /** Drag & drop a file from the tree onto the conversation: document-level
     *  delegation so it survives app re-renders. */
    function setupFileDrop(ctx) {
      const FILE_MIME = 'application/x-dsh-editor-file'
      const isInConversation = (el) => {
        let node = el
        while (node && node !== document.body) {
          if (node.getAttribute && node.getAttribute('data-slot') === 'conversation') return true
          node = node.parentElement
        }
        return false
      }
      const onDragOver = (e) => {
        if (!e.dataTransfer || !e.dataTransfer.types) return
        if (!Array.prototype.includes.call(e.dataTransfer.types, FILE_MIME)) return
        if (!isInConversation(e.target)) return
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'copy' } catch (err) { /* ignore */ }
        const conv = e.target.closest('[data-slot="conversation"]')
        if (conv) conv.setAttribute('data-dsh-editor-droptarget', 'true')
      }
      const onDragLeave = () => {
        const conv = document.querySelector('[data-slot="conversation"]')
        if (conv) conv.removeAttribute('data-dsh-editor-droptarget')
      }
      const onDrop = (e) => {
        const conv = document.querySelector('[data-slot="conversation"]')
        if (conv) conv.removeAttribute('data-dsh-editor-droptarget')
        if (!e.dataTransfer || !isInConversation(e.target)) return
        const path = e.dataTransfer.getData(FILE_MIME)
        if (path) {
          e.preventDefault()
          addFileCard(path)
        }
      }
      try {
        document.addEventListener('dragover', onDragOver)
        document.addEventListener('dragleave', onDragLeave)
        document.addEventListener('drop', onDrop)
      } catch (e) { /* environment without full DOM (tests) */ }
      ctx.effect(() => () => {
        try {
          document.removeEventListener('dragover', onDragOver)
          document.removeEventListener('dragleave', onDragLeave)
          document.removeEventListener('drop', onDrop)
        } catch (e) { /* ignore */ }
      }, 'dsh-editor: file drop')
    }

    /** Merge reference cards into the outgoing message text. */
    function buildSubmitText(cards, userText) {
      const refs = (Array.isArray(cards) ? cards : [])
        .map((c) => (c.kind === 'code' ? c.block : '\n`' + c.path + '`\n'))
        .join('')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
      const ut = String(userText || '').replace(/^\s+|\s+$/g, '')
      if (!refs) return ut
      return refs + (ut ? '\n\n' + ut : '')
    }

    /** Remove one reference card (nothing was inserted into the composer; the
     *  reference is only merged at send time). */
    function removeChatCard(id) {
      setState({ chatCards: state.chatCards.filter((c) => c.id !== id) })
    }

    /**
     * Reference cards row above the conversation composer. Cards hold file
     * references only — nothing is typed into the textarea. On submit, the
     * wrapped inputActions.submit prepends every card's reference to the
     * draft, so the AI receives the file paths / code snippets.
     */
    function ChatCardRow(props) {
      useForce()
      const inputActions = props && props.inputActions
      const useInput = props && props.useInput
      const draftRef = React.useRef('')
      if (typeof useInput === 'function') {
        draftRef.current = useInput((s) => (s && typeof s.draft === 'string' ? s.draft : '')) || ''
      }

      // Wrap the shared submit action (send-button path) once: prepend card
      // references, clear cards.
      React.useEffect(() => {
        if (!inputActions || typeof inputActions.submit !== 'function') return undefined
        if (inputActions.__dshEditorWrapped) return undefined
        const original = inputActions.submit
        inputActions.__dshEditorWrapped = true
        inputActions.submit = function (mode) {
          if (state.chatCards && state.chatCards.length > 0) {
            try {
              const next = buildSubmitText(state.chatCards, draftRef.current)
              if (typeof inputActions.setDraft === 'function') inputActions.setDraft(next)
              setState({ chatCards: [] })
            } catch (e) { /* keep cards if injection fails */ }
          }
          return original.apply(this, arguments)
        }
        return () => {
          if (inputActions.__dshEditorWrapped) {
            inputActions.__dshEditorWrapped = false
            inputActions.submit = original
          }
        }
      }, [inputActions])

      // Enter-to-send path goes through the shell directly (not actions.submit),
      // so also inject via a native keydown listener on the composer textarea
      // (bubble phase fires before React's delegated handler).
      React.useEffect(() => {
        if (!inputActions || typeof inputActions.setDraft !== 'function') return undefined
        let ta = null
        const detach = () => { if (ta) { ta.removeEventListener('keydown', onEnterInject); ta = null } }
        const attach = () => {
          const el = findComposerTextarea()
          if (el && el !== ta) {
            detach()
            ta = el
            ta.addEventListener('keydown', onEnterInject)
          }
        }
        const onEnterInject = (e) => {
          if (!e || e.key !== 'Enter' || e.shiftKey || e.isComposing) return
          if (!state.chatCards || state.chatCards.length === 0) return
          try {
            const next = buildSubmitText(state.chatCards, ta.value)
            inputActions.setDraft(next)
            setState({ chatCards: [] })
          } catch (err) { /* keep cards */ }
        }
        attach()
        const retries = [400, 1200, 3000]
        const timers = retries.map((ms) => setTimeout(attach, ms))
        return () => {
          timers.forEach((t) => clearTimeout(t))
          detach()
        }
      }, [inputActions])

      if (!state.chatCards || state.chatCards.length === 0) return null
      const FileIcon = FolderOpenIcon || FallbackFolderIcon
      return React.createElement('div', { className: 'dsh-editor-cards' },
        state.chatCards.map((card) => React.createElement('div', { key: card.id, className: 'dsh-editor-card', title: card.path },
          React.createElement(FileIcon, { size: 13, open: false }),
          React.createElement('span', { className: 'dsh-editor-card-path' }, card.path),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-editor-card-close',
            onClick: () => removeChatCard(card.id),
            title: '移除文件引用',
            'aria-label': '移除 ' + card.path,
          }, '×'),
        )),
      )
    }

    /** Dismiss the context menus (editor + file tree) and the session dropdown
     *  on outside click / Esc / blur. */
    function setupMenuDismiss(ctx) {
      const onDown = (e) => {
        if (state.menu === null && state.treeMenu === null && !state.sessionMenuOpen) return
        if (e.target && e.target.closest && e.target.closest(
          '.dsh-editor-menu, .dsh-editor-session-menu, .dsh-editor-session-trigger')) return
        const patch = {}
        if (state.menu !== null) patch.menu = null
        if (state.treeMenu !== null) patch.treeMenu = null
        if (state.sessionMenuOpen) { patch.sessionMenuOpen = false; patch.sessionQuery = '' }
        if (Object.keys(patch).length > 0) setState(patch)
      }
      const onKey = (e) => {
        if (e.key !== 'Escape') return
        const patch = {}
        if (state.menu !== null) patch.menu = null
        if (state.treeMenu !== null) patch.treeMenu = null
        if (state.sessionMenuOpen) { patch.sessionMenuOpen = false; patch.sessionQuery = '' }
        if (Object.keys(patch).length > 0) setState(patch)
      }
      const onBlur = () => {
        const patch = {}
        if (state.menu !== null) patch.menu = null
        if (state.treeMenu !== null) patch.treeMenu = null
        if (state.sessionMenuOpen) { patch.sessionMenuOpen = false; patch.sessionQuery = '' }
        if (Object.keys(patch).length > 0) setState(patch)
      }
      try {
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('blur', onBlur)
      } catch (e) { /* ignore */ }
      ctx.effect(() => () => {
        try {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('blur', onBlur)
        } catch (e) { /* ignore */ }
      }, 'dsh-editor: menu dismiss')
    }

    // ── plugin ─────────────────────────────────────────────────────────────

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slotsRef = slots
        openSession = (id) => {
          const sessions = ctx && ctx.sessions
          if (sessions && typeof sessions.open === 'function') sessions.open(id)
        }
        startSession = (workspaceId) => {
          const workspaces = ctx && ctx.workspaces
          if (workspaces && typeof workspaces.startSession === 'function') workspaces.startSession(workspaceId)
        }

      ensureStyle()

      // Mode toggle — always visible at the sidebar foot (both modes).
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-editor-toggle', order: 60, label: () => (state.mode ? '返回对话模式' : '编辑器模式') },
        (props) => React.createElement(ModeToggle, props),
      ))

      // Terminal button — always visible at the sidebar foot (both modes).
      slots.inject('sidebar.footer.action', () => slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-editor-terminal', order: 70, label: '终端' },
        (props) => React.createElement(TerminalButton, props),
      ))

      // Toast layer — its own additive shell.overlay cell (never replaces the
      // editor panel cell; the layer is click-through).
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'dsh-editor-toast', order: 20, label: '终端提示' },
        () => React.createElement(ToastLayer, null),
      ))

      // Embedded terminal panel — fixed bottom bar, both modes (1.12).
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'dsh-editor-terminal-panel', order: 30, label: '终端面板' },
        (props) => React.createElement(TerminalPanel, props),
      ))

      // Editor overlay — always registered; renders null unless editor mode.
      slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'dsh-editor-panel', order: 10, label: '编辑器' },
        (props) => React.createElement(EditorPanel, props),
      ))

      // File-reference cards row above the conversation composer.
      slots.inject('conversation.input.dock', () => slots.register(
        { name: 'conversation.input.dock', id: 'dsh-editor-cards', order: 10, label: '文件引用卡片' },
        (props) => React.createElement(ChatCardRow, props),
      ))

      // File tree — occupies the single sidebar.workspaces seat ONLY in editor
      // mode (the workspace browser returns on exit).
      slots.inject('sidebar.workspaces', () => {
        treeSlotReady = true
        if (state.mode && treeDisposer === null) registerTree()
      })

      ctx.effect(() => () => {
        if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null }
        if (termRenderTimer !== null) { cancelAnimationFrame(termRenderTimer); termRenderTimer = null }
        termClose()
        if (styleEl !== null) {
          try { styleEl.remove() } catch (e) { /* ignore */ }
          styleEl = null
        }
        unregisterTree()
      }, 'dsh-editor: cleanup')

      // Restore persisted column widths + mode.
      restoreWidths()
      setupMenuDismiss(ctx)
      setupFileDrop(ctx)
      let initial = false
      try { initial = localStorage.getItem(STORAGE_KEY) === '1' } catch (e) { /* ignore */ }
      state.mode = initial
      try { document.body.classList.toggle('dsh-editor-mode', initial) } catch (e) { /* ignore */ }
      if (initial) {
        registerTree()
        loadRoots()
      }
    }

    exports.inject = inject
    exports.apply = apply
    // test/debug hooks (the web kernel only uses inject/apply)
    exports._highlight = buildHighlight
    exports._detectLang = detectLang
    exports._escapeHtml = escapeHtml
    exports._testSelect = function (path, content, preview) {
      state.selectedPath = path
      state.content = content
      state.preview = !!preview
      try { state.highlightHtml = buildHighlight(content, detectLang(path)) } catch (e) { /* plain */ }
      emit()
    }
    exports._testMenu = function (x, y, hasSel, text, start, end) {
      state.menu = { x: x || 0, y: y || 0, hasSel: !!hasSel, text: text || '', start: start || 0, end: end || (text ? text.length : 0) }
      emit()
    }
    exports._buildSnippet = buildSnippetInsert
    exports._buildSubmitText = buildSubmitText
    exports._testCards = function (cards) {
      state.chatCards = Array.isArray(cards) ? cards : []
      emit()
    }
    exports._testTreeMenu = function (x, y, path) {
      state.treeMenu = { x: x || 0, y: y || 0, path: path || '' }
      emit()
    }
    exports._testSessionMenu = function (open, query) {
      state.sessionMenuOpen = !!open
      state.sessionQuery = query || ''
      emit()
    }
    // embedded-terminal emulator test hooks (parser/grid, no DOM)
    exports._termNew = function (cols, rows) { return new TermEmu(cols || 40, rows || 8, 50) }
    exports._termFeed = function (emu, text) { emu.feed(text) }
    exports._termText = function (emu) { return emu.screenText() }
    exports._termWidthOf = termCharWidth
    // component render hooks (React renderToString regression tests)
    exports._termButtonElement = function (props) { return React.createElement(TerminalButton, props) }
    exports._termPanelElement = function (props) { return React.createElement(TerminalPanel, props) }
    exports._testTerminalOpen = function (open) { state.terminalOpen = !!open; emit() }
    exports._testTreeRoot = function (rootId) { state.rootId = rootId || null; emit() }
    return module.exports
  },
})
