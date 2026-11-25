(function () {
  const API = String((window.APP_CONFIG && window.APP_CONFIG.apiBase) || '').replace(/\/+$/, '')
  const TOKEN_KEY = 'analytics_web_token'
  const PROJECT_KEY = 'analytics_web_project'
  const $ = (id) => document.getElementById(id)
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

  const storage = {
    get(key) { try { return window.localStorage.getItem(key) } catch (_) { return null } },
    set(key, value) { try { window.localStorage.setItem(key, value) } catch (_) { /* private mode */ } },
    remove(key) { try { window.localStorage.removeItem(key) } catch (_) { /* private mode */ } },
  }

  let token = storage.get(TOKEN_KEY)
  let requestSeq = 0

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }

  function formatValue(value, unit) {
    if (value === null || value === undefined) return '—'
    const text = number.format(Number(value))
    if (unit === '₽') return `${text} ₽`
    if (unit === '%') return `${text}%`
    return unit ? `${text} ${unit}` : text
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetch(`${API}/api${path}`, { ...options, headers })
    const body = await response.json().catch(() => ({}))
    if (response.status === 401 && path !== '/auth/telegram') {
      logout()
      throw new Error('session_expired')
    }
    if (!response.ok) {
      const error = new Error(body.error || `http_${response.status}`)
      error.status = response.status
      throw error
    }
    return body
  }

  // ---------- login ----------

  async function showLogin(message) {
    $('controls').hidden = true
    $('dashboard').hidden = true
    $('login').hidden = false
    const errorBox = $('login-error')
    errorBox.hidden = !message
    errorBox.textContent = message || ''

    const holder = $('login-widget')
    if (holder.childElementCount) return
    try {
      const { botUsername } = await api('/config')
      if (!botUsername) throw new Error('no_bot')
      const script = document.createElement('script')
      script.async = true
      script.src = 'https://telegram.org/js/telegram-widget.js?22'
      script.setAttribute('data-telegram-login', botUsername)
      script.setAttribute('data-size', 'large')
      script.setAttribute('data-radius', '8')
      script.setAttribute('data-onauth', 'onTelegramAuth(user)')
      holder.appendChild(script)
    } catch (_) {
      errorBox.hidden = false
      errorBox.textContent = 'Сервер недоступен. Если он спал, подождите несколько секунд и обновите страницу.'
    }
  }

  window.onTelegramAuth = async function (user) {
    try {
      const result = await api('/auth/telegram', { method: 'POST', body: JSON.stringify(user) })
      token = result.token
      storage.set(TOKEN_KEY, token)
      start()
    } catch (error) {
      const messages = {
        bot_not_started: 'Этот аккаунт ещё не пользовался ботом. Откройте бота в Telegram, нажмите «Старт» и войдите снова.',
        invalid_login: 'Telegram не подтвердил вход. Попробуйте ещё раз.',
      }
      showLogin(messages[error.message] || 'Не удалось войти. Попробуйте ещё раз.')
    }
  }

  function logout() {
    token = null
    storage.remove(TOKEN_KEY)
    showLogin()
  }

  // ---------- periods ----------

  function day(date) {
    return date.toISOString().slice(0, 10)
  }

  function presetRange(preset) {
    const now = new Date()
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    if (preset === 'this_month') return { from: day(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: day(today) }
    if (preset === 'last_month') {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
      return { from: day(first), to: day(last) }
    }
    const days = Number(preset) || 30
    return { from: day(new Date(today.getTime() - (days - 1) * 86400000)), to: day(today) }
  }

  function currentRange() {
    const preset = $('preset').value
    if (preset === 'custom' && $('from').value && $('to').value) return { from: $('from').value, to: $('to').value }
    return presetRange(preset)
  }

  // ---------- rendering ----------

  function renderBars(container, items, unit) {
    container.replaceChildren()
    const max = Math.max(...items.map((item) => Number(item.value) || 0), 1)
    for (const item of items) {
      const row = el('div', 'bar')
      row.appendChild(el('span', 'bar-label', item.label))
      const track = el('span', 'bar-track')
      const fill = el('span', 'bar-fill')
      fill.style.width = `${Math.max(2, (Number(item.value) / max) * 100)}%`
      track.appendChild(fill)
      row.appendChild(track)
      row.appendChild(el('span', 'bar-value', formatValue(item.value, unit)))
      container.appendChild(row)
    }
  }

  function renderList(panelId, listId, items) {
    $(panelId).hidden = !items || !items.length
    $(listId).replaceChildren(...(items || []).map((text) => el('li', null, text)))
  }

  function renderKpis(report) {
    const container = $('kpis')
    container.replaceChildren()
    const cards = (report.comparison || []).slice()
    const seen = new Set(cards.map((card) => card.label.toLowerCase()))
    // Cards from the report template that have no period comparison are shown without a delta.
    for (const card of (report.visual && report.visual.cards) || []) {
      if (!seen.has(String(card.label).toLowerCase())) cards.push({ label: card.label, value: card.value, unit: card.unit, deltaPct: null, previous: null })
    }
    for (const card of cards.slice(0, 8)) {
      const box = el('div', 'kpi')
      box.appendChild(el('div', 'kpi-label', card.label))
      box.appendChild(el('div', 'kpi-value', formatValue(card.value, card.unit)))
      if (card.deltaPct !== null && card.deltaPct !== undefined) {
        const good = card.deltaPct === 0 ? null : (card.deltaPct > 0) !== Boolean(card.lowerIsBetter)
        const delta = el('div', `kpi-delta ${good === null ? '' : good ? 'up' : 'down'}`)
        delta.textContent = `${card.deltaPct > 0 ? '▲ +' : card.deltaPct < 0 ? '▼ ' : ''}${number.format(card.deltaPct)}% к прошлому периоду`
        box.appendChild(delta)
      } else if (card.previous !== null && card.previous !== undefined) {
        box.appendChild(el('div', 'kpi-delta', `было ${formatValue(card.previous, card.unit)}`))
      }
      container.appendChild(box)
    }
  }

  function renderPlanFact(items) {
    const panel = $('planfact-panel')
    panel.hidden = !items || !items.length
    const container = $('planfact')
    container.replaceChildren()
    for (const item of items || []) {
      const row = el('div', `pf pf-${item.status}`)
      const head = el('div', 'pf-head')
      head.appendChild(el('span', 'pf-label', item.label))
      head.appendChild(el('span', 'pf-pct', `${number.format(item.completionPct)}%`))
      row.appendChild(head)
      const track = el('div', 'pf-track')
      const fill = el('span', 'pf-fill')
      fill.style.width = `${Math.min(100, Math.max(2, item.completionPct))}%`
      track.appendChild(fill)
      row.appendChild(track)
      row.appendChild(el('div', 'pf-text', item.text))
      container.appendChild(row)
    }
  }

  function renderReport(report) {
    const visual = report.visual || {}
    $('period').textContent = `${report.project.name} · ${report.period.label}`
    $('verdict').textContent = visual.verdict || (report.text ? report.text.split('\n').slice(2, 4).join(' ') : '')
    renderKpis(report)
    renderPlanFact(report.planFact)

    $('sources-title').textContent = visual.sourceTitle || 'Источники'
    $('sources-panel').hidden = !(visual.sources && visual.sources.length)
    renderBars($('sources'), visual.sources || [])

    $('secondary-panel').hidden = !visual.secondary
    if (visual.secondary) {
      $('secondary-title').textContent = visual.secondary.title
      renderBars($('secondary'), visual.secondary.items, '₽')
    }

    $('stages-panel').hidden = !(visual.stages && visual.stages.length)
    renderBars($('stages'), visual.stages || [])

    $('trend-panel').hidden = !(visual.weeks && visual.weeks.length)
    if (visual.weeks && visual.weeks.length) {
      $('trend-title').textContent = visual.trendTitle || 'Динамика'
      const trend = $('trend')
      trend.replaceChildren()
      const max = Math.max(...visual.weeks.map((w) => w.value), 1)
      for (const week of visual.weeks) {
        const col = el('div', 'trend-col')
        col.title = `${week.label}: ${week.value}`
        const fill = el('span', 'trend-fill')
        fill.style.height = `${Math.max(3, (week.value / max) * 100)}%`
        col.appendChild(el('span', 'trend-value', number.format(week.value)))
        col.appendChild(fill)
        col.appendChild(el('span', 'trend-label', String(week.label).slice(5)))
        trend.appendChild(col)
      }
    }

    renderList('problems-panel', 'problems', visual.problems)
    renderList('recs-panel', 'recs', visual.recommendations)
    $('text').textContent = report.text || ''
    $('note').textContent = visual.note || ''
  }

  function setState(message) {
    $('state').hidden = !message
    $('state').textContent = message || ''
    $('report').hidden = Boolean(message)
  }

  async function loadReport() {
    const projectId = $('project').value
    if (!projectId) return
    storage.set(PROJECT_KEY, projectId)
    const range = currentRange()
    const seq = ++requestSeq
    setState('Загружаю отчёт…')
    try {
      const report = await api(`/projects/${encodeURIComponent(projectId)}/report?from=${range.from}&to=${range.to}`)
      if (seq !== requestSeq) return
      if (!report.entriesCount) {
        $('period').textContent = `${report.project.name} · ${report.period.label}`
        setState('За этот период данных нет. Выберите другой период или загрузите данные через бота.')
        return
      }
      setState(null)
      renderReport(report)
    } catch (error) {
      if (seq !== requestSeq || error.message === 'session_expired') return
      setState(error.message === 'invalid_period' ? 'Проверьте даты периода.' : 'Не удалось загрузить отчёт. Попробуйте обновить страницу.')
    }
  }

  async function start() {
    $('login').hidden = true
    $('controls').hidden = false
    $('dashboard').hidden = false
    setState('Загружаю проекты… Если сервер спал, это займёт несколько секунд.')
    try {
      const [{ user }, { projects }] = await Promise.all([api('/me'), api('/projects')])
      $('user').textContent = user.username ? `@${user.username}` : user.firstName || ''
      const select = $('project')
      select.replaceChildren(...projects.map((p) => {
        const option = el('option', null, p.name)
        option.value = p.id
        return option
      }))
      if (!projects.length) {
        setState('У вас пока нет проектов. Создайте проект и загрузите данные в боте — они появятся здесь.')
        return
      }
      const saved = storage.get(PROJECT_KEY)
      if (saved && projects.some((p) => p.id === saved)) select.value = saved
      loadReport()
    } catch (error) {
      if (error.message !== 'session_expired') setState('Сервер недоступен. Попробуйте обновить страницу через несколько секунд.')
    }
  }

  $('project').addEventListener('change', loadReport)
  $('preset').addEventListener('change', () => {
    const custom = $('preset').value === 'custom'
    $('custom').hidden = !custom
    if (custom) {
      const range = presetRange('30')
      $('from').value = $('from').value || range.from
      $('to').value = $('to').value || range.to
    }
    loadReport()
  })
  $('from').addEventListener('change', loadReport)
  $('to').addEventListener('change', loadReport)
  $('logout').addEventListener('click', logout)

  if (token) start()
  else showLogin()
})()
