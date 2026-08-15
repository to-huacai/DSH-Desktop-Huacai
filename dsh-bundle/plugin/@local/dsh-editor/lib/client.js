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
    return module.exports
  },
})
