/**
 * @local/dsh-updater — browser half (built artifact format).
 *
 * Registered through window.__ModuleLoader__.load({ id, factory }); the
 * factory receives the module-table require and returns the Cordis plugin
 * object ({ inject, apply }) the web kernel mounts. Renders one preference
 * row inside Settings → General (settings.general.item): shows the local vs
 * latest version and offers a one-click update; all data comes from the node
 * half's JSON endpoints at /dsh-updater/check and /dsh-updater/update.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-updater',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Browser services this client plugin needs. */
    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.general.item', () => slots.register(
        { name: 'settings.general.item', id: 'dsh-updater', order: 30 },
        () => React.createElement(UpdateItem, null),
      ))
    }

    function UpdateItem() {
      const [state, setState] = React.useState({
        status: 'idle', // idle | checking | done | updated | error
        data: null,
        error: '',
        updating: false,
      })

      const check = async () => {
        setState((s) => ({ ...s, status: 'checking', error: '' }))
        try {
          const res = await fetch('/dsh-updater/check', { cache: 'no-store' })
          const data = await res.json()
          if (!data || data.ok !== true) {
            setState((s) => ({ ...s, status: 'error', error: (data && data.error) || '检查失败', data: data || null }))
            return
          }
          setState((s) => ({ ...s, status: 'done', data: data, error: '' }))
        } catch (err) {
          setState((s) => ({ ...s, status: 'error', error: '检查失败: ' + String(err && err.message || err) }))
        }
      }

      const update = async () => {
        setState((s) => ({ ...s, updating: true, error: '' }))
        try {
          const res = await fetch('/dsh-updater/update', { method: 'POST', cache: 'no-store' })
          const data = await res.json()
          const failed = !data || data.ok !== true
          setState((s) => ({
            ...s,
            updating: false,
            status: failed ? 'error' : 'updated',
            data: data || null,
            error: failed ? (data && (data.error || data.message)) || '更新失败' : '',
          }))
        } catch (err) {
          setState((s) => ({ ...s, updating: false, status: 'error', error: '更新失败: ' + String(err && err.message || err) }))
        }
      }

      React.useEffect(() => {
        check()
      }, [])

      const status = state.status
      const data = state.data
      const updating = state.updating
      const error = state.error
      const mode = data && data.mode
      const local = data && data.localVersion
      const latest = data && data.latestVersion
      const upToDate = data && data.upToDate
      const canUpdate = data && data.canUpdate

      const labelStyle = { color: 'var(--dsw-alias-label-primary)', fontSize: '13px' }
      const subStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' }
      const btnStyle = {
        padding: '4px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px', cursor: 'pointer',
      }
      const primaryBtnStyle = {
        ...btnStyle,
        borderColor: 'var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-state-business-primary)',
      }
      const rowStyle = { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }

      let statusText = ''
      let statusColor = 'var(--dsw-alias-label-tertiary)'
      if (status === 'checking') {
        statusText = '正在检查官方更新…'
      } else if (status === 'error') {
        statusText = error || '检查失败'
        statusColor = 'var(--dsw-alias-state-error-primary)'
      } else if (status === 'updated') {
        statusText = (data && data.ok === true && data.message) || '正在更新，界面将自动重启…'
        statusColor = 'var(--dsw-alias-state-business-primary)'
      } else if (mode === 'other') {
        statusText = '当前非 DSH-Desktop-Huacai 内置版，仅支持检查；请通过 DSH-Desktop-Huacai 启动后一键更新'
        statusColor = 'var(--dsw-alias-label-tertiary)'
      } else if (upToDate === true) {
        statusText = '已是最新版本' + (data && data.latestPublishedAt ? '（发布于 ' + data.latestPublishedAt + '）' : '')
      } else if (upToDate === false) {
        statusText = '发现新版本 ' + latest + '，点击"一键更新"在线安装，完成后自动重启生效'
        statusColor = 'var(--dsw-alias-state-warning-primary)'
      } else {
        statusText = '点击"检查更新"查看官方最新版本'
      }

      return React.createElement('div', { style: { padding: '4px 2px' } },
        React.createElement('div', { style: rowStyle },
          React.createElement('span', { style: labelStyle }, 'DeepSeek Harness 更新'),
          React.createElement('span', { style: subStyle }, local ? ('当前 ' + local) : '当前 —'),
          React.createElement('span', { style: subStyle }, latest ? ('最新 ' + latest) : ''),
          React.createElement('button', {
            type: 'button',
            onClick: check,
            style: btnStyle,
            disabled: status === 'checking' || updating,
          }, status === 'checking' ? '检查中…' : '检查更新'),
          canUpdate === true && status !== 'updated' && status !== 'error'
            ? React.createElement('button', {
              type: 'button',
              onClick: update,
              style: primaryBtnStyle,
              disabled: updating,
            }, updating ? '更新中…' : '一键更新')
            : null,
        ),
        React.createElement('div', { style: { marginTop: '6px', fontSize: '12px', color: statusColor } }, statusText),
      )
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
