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
  // Set when the page was opened by a share link: read-only view of one project, no login.
  let shareToken = null
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

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

  function sourceLabel(raw) {
    const names = {
      osnovateli_media_instagram: 'Инстаграм · Основатели',
      kuhnya_osnovateley_tg: 'TG «Кухня Основателей»',
      denis_kutergin: 'Денис Кутергин',
      eduard_gurinovich: 'Эдуард Гуринович',
      osnovateli_media_vkgroup: 'ВК · Основатели',
      osnovateli_tg: 'TG «Основатели»',
      osnovateli_tg_stories: 'TG «Основатели», истории',
      kuhnya_osnovateley_tg_stories: 'TG «Кухня Основателей», истории',
      osnovateley_onlinebot_tg: 'TG · бот «Основатели онлайн»',
    }
    return names[raw] || String(raw || '').replaceAll('_', ' ')
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (token && !shareToken) headers.Authorization = `Bearer ${token}`
    const response = await fetch(`${API}/api${path}`, { ...options, headers })
    const body = await response.json().catch(() => ({}))
    if (response.status === 401 && !path.startsWith('/auth/') && !shareToken) {
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
      const label = el('span', 'bar-label', sourceLabel(item.label))
      label.title = item.label
      row.appendChild(label)
      const track = el('span', 'bar-track')
      const fill = el('span', 'bar-fill')
      fill.style.width = `${Math.max(2, (Number(item.value) / max) * 100)}%`
      track.appendChild(fill)
      row.appendChild(track)
      row.appendChild(el('span', 'bar-value', formatValue(item.value, unit)))
      container.appendChild(row)
      if (item.details?.length) {
        const details = el('details', 'bar-details')
        details.appendChild(el('summary', null, `Показать остальные (${item.details.length})`))
        for (const detail of item.details) {
          const line = el('div', 'bar-detail')
          const name = el('span', null, sourceLabel(detail.label))
          name.title = detail.label
          line.append(name, el('span', null, formatValue(detail.value, unit)))
          details.appendChild(line)
        }
        container.appendChild(details)
      }
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
      if (card.previous > 0 && card.previous < 10 && card.deltaPct !== null && card.deltaPct !== undefined) {
        box.appendChild(el('div', 'kpi-delta', `было ${formatValue(card.previous, card.unit)} · низкая база для сравнения`))
      } else if (card.deltaPct !== null && card.deltaPct !== undefined) {
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

  function renderSourceResults(visual) {
    const items = visual.sourcePerformance || []
    $('source-results-panel').hidden = !items.length
    if (!items.length) return
    const residents = visual.cards?.some(card => card.label === 'Резиденты')
    $('outcome-heading').textContent = residents ? 'Резиденты' : 'Оплаты'
    const showAmount = items.some(item => item.amount !== null && item.amount !== undefined)
    $('amount-heading').hidden = !showAmount
    const body = $('source-results')
    body.replaceChildren()
    for (const item of items) {
      const row = el('tr')
      const name = el('th', null, sourceLabel(item.label))
      name.title = item.label
      row.appendChild(name)
      row.appendChild(el('td', null, formatValue(item.leads)))
      row.appendChild(el('td', null, item.outcomes == null ? '—' : formatValue(item.outcomes)))
      row.appendChild(el('td', null, item.outcomes == null || !item.leads ? '—' : formatValue(item.outcomes / item.leads * 100, '%')))
      const amount = el('td', null, item.amount == null ? '—' : formatValue(item.amount, '₽'))
      amount.hidden = !showAmount
      row.appendChild(amount)
      body.appendChild(row)
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
    $('period').textContent = `${report.project.name}${report.direction ? ' · ' + report.direction.name : ''} · ${report.period.label}`
    $('verdict').textContent = visual.verdict || (report.text ? report.text.split('\n').slice(2, 4).join(' ') : '')
    renderKpis(report)
    renderSourceResults(visual)
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
      $('trend-title').textContent = (visual.trendTitle || 'Динамика') + (visual.weeks.some(w => w.perDay != null) ? ' · высота: заявок в день' : '')
      const trend = $('trend')
      trend.replaceChildren()
      const max = Math.max(...visual.weeks.map((w) => w.perDay ?? w.value), 1)
      for (const week of visual.weeks) {
        const col = el('div', 'trend-col')
        const start = week.start || week.label
        const span = week.end ? `${start} — ${week.end}` : String(week.label)
        col.title = `${span}: ${week.value}${week.days ? ` · ${number.format(week.perDay)} в день` : ''}`
        const fill = el('span', 'trend-fill')
        fill.style.height = `${Math.max(3, ((week.perDay ?? week.value) / max) * 100)}%`
        col.appendChild(el('span', 'trend-value', number.format(week.value)))
        col.appendChild(fill)
        const label = week.end ? `${start.slice(5)}–${week.end.slice(5)}` : String(week.label).slice(5)
        col.appendChild(el('span', 'trend-label', label))
        if (week.partial) col.appendChild(el('span', 'trend-partial', 'неполная'))
        trend.appendChild(col)
      }
    }

    renderList('problems-panel', 'problems', visual.problems)
    renderList('recs-panel', 'recs', visual.recommendations)
    $('text').textContent = (report.text || '').replace(/^(\s+)не указано: /gmu, '$1Статус ЦА не указан: ')
    $('note').textContent = visual.note || ''
  }

  function setState(message) {
    $('state').hidden = !message
    $('state').textContent = message || ''
    $('report').hidden = Boolean(message)
  }

  async function loadReport() {
    const projectId = $('project').value
    if (!projectId && !shareToken) return
    if (!shareToken) storage.set(PROJECT_KEY, projectId)
    const range = currentRange()
    const seq = ++requestSeq
    setState('Загружаю отчёт…')
    try {
      const base = shareToken ? `/share/${encodeURIComponent(shareToken)}` : `/projects/${encodeURIComponent(projectId)}`
      const directionId = $('direction').value
      const report = await api(`${base}/report?from=${range.from}&to=${range.to}${directionId ? `&directionId=${encodeURIComponent(directionId)}` : ''}`)
      if (seq !== requestSeq) return
      if (!report.entriesCount) {
        $('period').textContent = `${report.project.name}${report.direction ? ' · ' + report.direction.name : ''} · ${report.period.label}`
        setState('За этот период данных нет. Выберите другой период или загрузите данные через бота.')
        if (report.lastAvailable) {
          const button = el('button', 'btn', `Показать последние данные: ${report.lastAvailable.from} — ${report.lastAvailable.to}`)
          button.type = 'button'
          button.addEventListener('click', () => {
            $('preset').value = 'custom'
            $('custom').hidden = false
            $('from').value = report.lastAvailable.from
            $('to').value = report.lastAvailable.to
            loadReport()
          })
          $('state').appendChild(button)
        }
        return
      }
      setState(null)
      renderReport(report)
    } catch (error) {
      if (seq !== requestSeq || error.message === 'session_expired') return
      if (error.message === 'link_not_found') return setState('Ссылка больше не действует: срок истёк или её отозвали. Попросите новую у того, кто ею поделился.')
      setState(error.message === 'invalid_period' ? 'Проверьте даты периода.' : 'Не удалось загрузить отчёт. Попробуйте обновить страницу.')
    }
  }

  async function loadDirections() {
    const projectId = $('project').value
    const select = $('direction')
    const previous = select.value
    const base = shareToken ? `/share/${encodeURIComponent(shareToken)}` : `/projects/${encodeURIComponent(projectId)}`
    try {
      const { directions } = await api(`${base}/directions`)
      if (!shareToken && $('project').value !== projectId) return
      const all = el('option', null, 'Все направления')
      all.value = ''
      select.replaceChildren(all, ...directions.map(item => {
        const option = el('option', null, item.name)
        option.value = item.id
        return option
      }))
      if (directions.some(item => item.id === previous)) select.value = previous
      select.hidden = !directions.length
    } catch (_) {
      select.hidden = true
      select.value = ''
    }
  }

  // ---------- links ----------

  function shareError(message) {
    $('share-error').hidden = !message
    $('share-error').textContent = message || ''
  }

  async function copyField(id, button) {
    const input = $(id)
    input.select()
    try {
      await navigator.clipboard.writeText(input.value)
    } catch (_) {
      document.execCommand('copy')
    }
    const label = button.textContent
    button.textContent = 'Скопировано'
    setTimeout(() => { button.textContent = label }, 1500)
  }

  async function refreshShareList() {
    const list = $('share-list')
    const projectId = $('project').value
    const { links } = await api(`/projects/${encodeURIComponent(projectId)}/shares`)
    if (!links.length) {
      list.replaceChildren(el('li', 'empty', 'Нет активных ссылок.'))
      return
    }
    list.replaceChildren(...links.map((link) => {
      const item = el('li')
      const used = link.lastUsedAt ? ` · открывали ${dateFormat.format(new Date(link.lastUsedAt))}` : ''
      item.appendChild(el('span', null, `до ${dateFormat.format(new Date(link.expiresAt))}${used}`))
      const revoke = el('button', 'btn small', 'Отозвать')
      revoke.type = 'button'
      revoke.addEventListener('click', async () => {
        revoke.disabled = true
        try {
          await api(`/shares/${encodeURIComponent(link.id)}`, { method: 'DELETE' })
          await refreshShareList()
        } catch (_) {
          shareError('Не удалось отозвать ссылку. Попробуйте ещё раз.')
          revoke.disabled = false
        }
      })
      item.appendChild(revoke)
      return item
    }))
  }

  async function openShareDialog() {
    const select = $('project')
    if (!select.value) return
    $('share-title').textContent = `Поделиться отчётом «${select.options[select.selectedIndex].text}»`
    $('share-result').hidden = true
    $('personal-result').hidden = true
    shareError(null)
    $('share-modal').hidden = false
    try {
      await refreshShareList()
    } catch (_) {
      shareError('Не удалось загрузить список ссылок.')
    }
  }

  async function createShareLink(days) {
    shareError(null)
    try {
      const { url } = await api(`/projects/${encodeURIComponent($('project').value)}/shares`, { method: 'POST', body: JSON.stringify({ days }) })
      $('share-url').value = url
      $('share-result').hidden = false
      await refreshShareList()
    } catch (_) {
      shareError('Не удалось создать ссылку. Попробуйте ещё раз.')
    }
  }

  async function issuePersonalLink() {
    shareError(null)
    try {
      const { url } = await api('/me/personal-link', { method: 'POST' })
      $('personal-url').value = url
      $('personal-result').hidden = false
    } catch (_) {
      shareError('Не удалось выпустить ссылку. Попробуйте ещё раз.')
    }
  }

  async function loginWithLink(linkToken) {
    try {
      const result = await api('/auth/link', { method: 'POST', body: JSON.stringify({ token: linkToken }) })
      token = result.token
      storage.set(TOKEN_KEY, token)
      // Keep the address clean so the permanent link is not left in the tab or shared by accident.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      start()
    } catch (_) {
      showLogin('Эта постоянная ссылка больше не действует. Выпустите новую в боте командой /web или войдите через Telegram.')
    }
  }

  async function startShared(linkToken) {
    shareToken = linkToken
    $('login').hidden = true
    $('dashboard').hidden = false
    $('controls').hidden = false
    for (const id of ['project', 'share-open', 'user', 'logout']) $(id).hidden = true
    setState('Открываю отчёт…')
    try {
      const meta = await api(`/share/${encodeURIComponent(shareToken)}`)
      document.title = `${meta.project.name} — отчёт`
      $('shared-banner').hidden = false
      $('shared-banner').textContent = `Отчёт «${meta.project.name}» открыт по ссылке, только для просмотра. Ссылка действует до ${dateFormat.format(new Date(meta.expiresAt))}.`
      await loadDirections()
      loadReport()
    } catch (error) {
      setState(error.message === 'link_not_found'
        ? 'Ссылка больше не действует: срок истёк или её отозвали. Попросите новую у того, кто ею поделился.'
        : 'Сервер недоступен. Если он спал, подождите несколько секунд и обновите страницу.')
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
      await loadDirections()
      loadReport()
    } catch (error) {
      if (error.message !== 'session_expired') setState('Сервер недоступен. Попробуйте обновить страницу через несколько секунд.')
    }
  }

  $('project').addEventListener('change', async () => { $('direction').value = ''; await loadDirections(); loadReport() })
  $('direction').addEventListener('change', loadReport)
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

  $('share-open').addEventListener('click', openShareDialog)
  $('share-close').addEventListener('click', () => { $('share-modal').hidden = true })
  $('share-modal').addEventListener('click', (event) => { if (event.target === $('share-modal')) $('share-modal').hidden = true })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('share-modal').hidden = true })
  for (const button of document.querySelectorAll('[data-days]')) {
    button.addEventListener('click', () => createShareLink(Number(button.dataset.days)))
  }
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', () => copyField(button.dataset.copy, button))
  }
  $('personal-issue').addEventListener('click', issuePersonalLink)

  // Tokens come in the URL fragment: #s=… share link, #k=… personal link.
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (params.get('s')) startShared(params.get('s'))
  else if (params.get('k')) loginWithLink(params.get('k'))
  else if (token) start()
  else showLogin()
})()

