// Dashboard logic - role-based panels and management features
let barangayList = [];
let teamList = [];

const TAB_DEFS = [
  { panel: 'overview', label: 'Overview' },
  { panel: 'alerts', label: 'Alerts' },
  { panel: 'incidents', label: 'Incidents' },
  { panel: 'myreports', label: 'My Reports' },
  { panel: 'evac', label: 'Evacuation' },
  { panel: 'teams', label: 'Rescue Teams' },
  { panel: 'flood', label: 'Flood' },
  { panel: 'resources', label: 'Resources' },
  { panel: 'missing', label: 'Missing Persons' },
  { panel: 'barangays', label: 'Barangay Risk' },
  { panel: 'contacts', label: 'Contacts' },
  { panel: 'users', label: 'Users' },
  { panel: 'reports', label: 'Reports' },
  { panel: 'logs', label: 'Activity Logs' },
  { panel: 'ai', label: 'AI Assistant' }
];

const LOADERS = {
  overview: loadOverview, alerts: loadAlertsManage, incidents: loadIncidentsAdmin,
  myreports: loadMyReports, evac: loadEvacAdmin, teams: loadTeamsAdmin,
  flood: loadFloodAdmin, resources: loadResourcesAdmin, missing: loadMissingAdmin,
  barangays: loadBarangaysAdmin, contacts: loadContactsAdmin, users: loadUsersAdmin,
  reports: () => {}, logs: loadLogs, ai: () => {}
};

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await loadCurrentUser();
  if (!currentUser) { location.href = '/login.html'; return; }

  barangayList = await api.get('/api/auth/barangays').catch(() => []);
  fillBarangaySelects();
  buildTabs();
  bindForms();
  initDashChat();

  const first = document.querySelector('.tab');
  if (first) first.click();
});

function hasRole(roles) {
  return roles.split(',').includes(currentUser.role);
}

function fillBarangaySelects() {
  const opts = '<option value="">-- none --</option>' +
    barangayList.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  ['evc-barangay', 'fs-barangay', 'mp-barangay', 'us-barangay', 'ue-barangay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
  const rpt = document.getElementById('rpt-barangay');
  if (rpt) rpt.innerHTML = '<option value="">All</option>' +
    barangayList.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  const wrap = document.getElementById('al-barangays');
  if (wrap) wrap.innerHTML = barangayList.map(b =>
    `<label><input type="checkbox" value="${b.id}"> ${escapeHtml(b.name)}</label>`).join('');
}

function buildTabs() {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = '';
  TAB_DEFS.forEach(def => {
    const panel = document.getElementById('panel-' + def.panel);
    if (!panel || !hasRole(panel.dataset.roles)) return;
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.textContent = def.label;
    btn.onclick = () => activateTab(def.panel);
    tabsEl.appendChild(btn);
  });
  // Hide inline buttons the user's role cannot use
  document.querySelectorAll('[data-roles-inline]').forEach(el => {
    if (!hasRole(el.dataset.rolesInline)) el.classList.add('hidden');
  });
}

function activateTab(panelName) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('panel-' + panelName);
  if (panel) panel.classList.add('active');
  const tabs = [...document.querySelectorAll('.tab')];
  const idx = TAB_DEFS.filter(d => {
    const p = document.getElementById('panel-' + d.panel);
    return p && hasRole(p.dataset.roles);
  }).findIndex(d => d.panel === panelName);
  if (tabs[idx]) tabs[idx].classList.add('active');
  if (LOADERS[panelName]) LOADERS[panelName]().catch(err => toast(err.message, 'error'));
}

// ================= OVERVIEW =================
async function loadOverview() {
  const s = await api.get('/api/stats');
  document.getElementById('stat-cards').innerHTML = `
    <div class="card stat"><div class="num">${s.incidents.total}</div><div class="lbl">Total Incidents</div></div>
    <div class="card stat orange"><div class="num">${Number(s.incidents.reported) + Number(s.incidents.verified) + Number(s.incidents.responding)}</div><div class="lbl">Open Incidents</div></div>
    <div class="card stat red"><div class="num">${s.evacuation.total_evacuees}</div><div class="lbl">Evacuees</div></div>
    <div class="card stat"><div class="num">${s.alerts.sent}</div><div class="lbl">Alerts Sent</div></div>
    <div class="card stat green"><div class="num">${s.teams.available}/${s.teams.total}</div><div class="lbl">Teams Available</div></div>
    <div class="card stat red"><div class="num">${s.missing.missing}</div><div class="lbl">Missing</div></div>
    <div class="card stat orange"><div class="num">${s.resources.below_minimum}</div><div class="lbl">Resources Low</div></div>
    <div class="card stat"><div class="num">${s.incidents.last_7_days}</div><div class="lbl">Incidents (7d)</div></div>`;

  const alerts = await api.get('/api/alerts/manage/list');
  const pending = alerts.filter(a => a.status === 'pending_approval');
  document.getElementById('pending-alerts').innerHTML = pending.length
    ? pending.map(a => `<div class="alert-item severity-${a.severity}">
        <h4>${escapeHtml(a.title)} <span class="badge ${a.severity}">${a.severity}</span></h4>
        <p class="meta">by ${escapeHtml(a.created_by_name || '?')} &bull; ${fmtDate(a.created_at)}</p>
        <div class="section-actions mt">
          ${currentUser.role === 'admin' ? `<button class="btn success sm" onclick="alertAction(${a.id},'approve')">Approve</button>` : ''}
          <button class="btn secondary sm" onclick="viewAlert(${a.id})">View</button>
        </div>
      </div>`).join('')
    : '<p class="empty">No alerts pending approval.</p>';

  const incidents = await api.get('/api/incidents');
  document.getElementById('recent-incidents').innerHTML = `
    <table><tr><th>ID</th><th>Type</th><th>Status</th><th>When</th></tr>
    ${incidents.slice(0, 8).map(i => `<tr>
      <td><a href="#" onclick="viewIncident(${i.id});return false">#${i.id}</a></td>
      <td>${i.incident_type.replace('_', ' ')}</td>
      <td><span class="badge ${i.status}">${i.status}</span></td>
      <td>${fmtDate(i.created_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None</td></tr>'}
    </table>`;

  const teams = await api.get('/api/teams');
  document.getElementById('overview-teams').innerHTML = `
    <table><tr><th>Team</th><th>Status</th><th>Active incident</th></tr>
    ${teams.map(t => `<tr><td>${escapeHtml(t.name)}</td>
      <td><span class="badge ${t.status === 'available' ? 'resolved' : t.status === 'off_duty' ? 'info' : 'warning'}">${t.status.replace('_', ' ')}</span></td>
      <td>${t.active_incident_id ? '#' + t.active_incident_id : '-'}</td></tr>`).join('')}
    </table>`;

  const resources = await api.get('/api/resources');
  const low = resources.filter(r => Number(r.below_minimum));
  document.getElementById('low-resources').innerHTML = low.length
    ? low.map(r => `<div class="warning-item warning"><b>${escapeHtml(r.name)}</b>: ${r.quantity} ${escapeHtml(r.unit)} (min ${r.minimum_level})</div>`).join('')
    : '<p class="empty">All resources are above minimum levels.</p>';
}

// ================= ALERTS =================
let alertsCache = [];

async function loadAlertsManage() {
  alertsCache = await api.get('/api/alerts/manage/list');
  const body = document.getElementById('alerts-manage-body');
  body.innerHTML = alertsCache.map(a => `
    <tr>
      <td><b>${escapeHtml(a.title)}</b><br><small class="muted">${a.source === 'ai_import' ? 'AI imported' : a.source === 'flood_auto' ? 'Automatic (flood)' : 'Manual'}${a.barangays ? ' &bull; ' + escapeHtml(a.barangays) : ''}</small></td>
      <td><span class="badge ${a.severity}">${a.severity}</span></td>
      <td>${a.target_type}${a.target_type === 'geofence' ? ` (${a.geofence_radius_m}m)` : ''}</td>
      <td><span class="badge ${a.status === 'sent' ? 'resolved' : a.status === 'pending_approval' ? 'warning' : a.status === 'approved' ? 'info' : a.status === 'cancelled' ? 'critical' : 'info'}">${a.status.replace('_', ' ')}</span></td>
      <td>${fmtDate(a.created_at)}<br><small class="muted">${escapeHtml(a.created_by_name || '')}</small></td>
      <td>
        <div class="section-actions">
          <button class="btn secondary sm" onclick="viewAlert(${a.id})">View</button>
          ${a.status === 'draft' && canCreateAlerts() ? `<button class="btn sm" onclick="alertAction(${a.id},'submit')">Submit</button>` : ''}
          ${a.status === 'pending_approval' && currentUser.role === 'admin' && a.created_by !== currentUser.id ? `<button class="btn success sm" onclick="alertAction(${a.id},'approve')">Approve</button><button class="btn danger sm" onclick="alertAction(${a.id},'reject')">Reject</button>` : ''}
          ${a.status === 'approved' && currentUser.role === 'admin' ? `<button class="btn warning sm" onclick="alertAction(${a.id},'send')">Send Now</button>` : ''}
          ${['sent', 'approved'].includes(a.status) && currentUser.role === 'admin' ? `<button class="btn danger sm" onclick="alertAction(${a.id},'cancel')">Cancel</button>` : ''}
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No alerts yet.</td></tr>';
}

function canCreateAlerts() {
  return ['admin', 'barangay_official'].includes(currentUser.role);
}

async function alertAction(id, action) {
  const labels = { submit: 'submit for approval', approve: 'APPROVE', reject: 'reject (return to draft)', send: 'SEND this alert to the public now', cancel: 'CANCEL this alert' };
  if (!confirm(`Are you sure you want to ${labels[action]}?`)) return;
  try {
    const r = await api.post(`/api/alerts/${id}/${action}`, {});
    toast(`Alert ${action} successful.` + (r.pushed_to !== undefined ? ` Pushed to ${r.pushed_to} device(s), ${r.barangays_affected} barangay(s).` : ''), 'success');
    loadAlertsManage();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function viewAlert(id) {
  api.get('/api/alerts/' + id).then(a => {
    const el = document.getElementById('incident-detail');
    el.innerHTML = `
      <h4>${escapeHtml(a.title)}</h4>
      <p class="mt">${escapeHtml(a.message)}</p>
      <div class="meta mt muted">
        Type: ${a.alert_type} &bull; Severity: <span class="badge ${a.severity}">${a.severity}</span> &bull; Status: ${a.status}<br>
        Target: ${a.target_type}${a.target_type === 'geofence' ? ` (center ${a.geofence_lat},${a.geofence_lng}, radius ${a.geofence_radius_m}m)` : ''}<br>
        ${a.target_barangays && a.target_barangays.length ? 'Barangays: ' + a.target_barangays.map(b => escapeHtml(b.name)).join(', ') + '<br>' : ''}
        Created: ${fmtDate(a.created_at)} &bull; Approved: ${fmtDate(a.approved_at) || '-'} &bull; Sent: ${fmtDate(a.sent_at) || '-'}
        ${a.expires_at ? '<br>Expires: ' + fmtDate(a.expires_at) : ''}
      </div>`;
    // reuse the generic detail modal
    openModal('incident-view-modal');
    document.querySelector('#incident-view-modal h3').textContent = 'Alert Details';
  }).catch(err => toast(err.message, 'error'));
}

function onAlertTargetChange() {
  const t = document.getElementById('al-target').value;
  document.getElementById('al-barangays-wrap').classList.toggle('hidden', t !== 'barangay');
  document.getElementById('al-geofence-wrap').classList.toggle('hidden', t !== 'geofence');
}

async function previewGeofence() {
  const lat = document.getElementById('al-geo-lat').value;
  const lng = document.getElementById('al-geo-lng').value;
  const radius = document.getElementById('al-geo-radius').value;
  const out = document.getElementById('geofence-preview-result');
  try {
    const r = await api.post('/api/alerts/geofence/preview', { lat: Number(lat), lng: Number(lng), radius_m: Number(radius) });
    out.textContent = r.barangays.length
      ? 'Affected barangays: ' + r.barangays.map(b => b.name).join(', ')
      : 'No barangay centers fall inside this radius (users with GPS inside the area still receive the alert).';
  } catch (err) {
    out.textContent = err.message;
  }
}

async function submitAlert(submit) {
  const target = document.getElementById('al-target').value;
  const barangayIds = [...document.querySelectorAll('#al-barangays input:checked')].map(c => Number(c.value));
  const expires = document.getElementById('al-expires').value;
  const payload = {
    title: document.getElementById('al-title').value,
    message: document.getElementById('al-message').value,
    alert_type: document.getElementById('al-type').value,
    severity: document.getElementById('al-severity').value,
    target_type: target,
    submit: !!submit,
    barangay_ids: target === 'barangay' ? barangayIds : undefined,
    geofence_lat: target === 'geofence' ? document.getElementById('al-geo-lat').value : undefined,
    geofence_lng: target === 'geofence' ? document.getElementById('al-geo-lng').value : undefined,
    geofence_radius_m: target === 'geofence' ? document.getElementById('al-geo-radius').value : undefined,
    // The datetime-local value is already Philippine wall-clock (UTC+8) and the
    // DB session runs in UTC+8, so store it verbatim (no UTC round-trip).
    expires_at: expires ? expires.replace('T', ' ') + (expires.length === 16 ? ':00' : '') : undefined
  };
  try {
    await api.post('/api/alerts', payload);
    toast(submit ? 'Alert submitted for approval.' : 'Draft saved.', 'success');
    closeModal('alert-create-modal');
    document.getElementById('alert-form').reset();
    onAlertTargetChange();
    loadAlertsManage();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ================= INCIDENTS =================
async function loadIncidentsAdmin() {
  const status = document.getElementById('inc-filter-status').value;
  const incidents = await api.get('/api/incidents' + (status ? '?status=' + status : ''));
  const body = document.getElementById('incidents-admin-body');
  body.innerHTML = incidents.map(i => `
    <tr>
      <td>#${i.id}</td>
      <td>${i.incident_type.replace('_', ' ')}${i.photo_path ? '<br><img class="thumb" src="' + i.photo_path + '" onclick="window.open(this.src)" alt="incident photo">' : ''}</td>
      <td style="max-width:280px">${escapeHtml(i.description).slice(0, 120)}</td>
      <td>${escapeHtml(i.barangay || '-')}</td>
      <td><span class="badge ${i.status}">${i.status}</span>${i.assigned_team ? '<br><small class="muted">' + escapeHtml(i.assigned_team) + '</small>' : ''}</td>
      <td>${fmtDate(i.created_at)}</td>
      <td>
        <div class="section-actions">
          <button class="btn secondary sm" onclick="viewIncident(${i.id})">Details</button>
          ${i.status !== 'resolved' ? `<button class="btn sm" onclick="openIncidentStatus(${i.id}, '${i.status}')">Update</button>` : ''}
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No incidents.</td></tr>';
}

async function viewIncident(id) {
  try {
    const i = await api.get('/api/incidents/' + id);
    document.querySelector('#incident-view-modal h3').textContent = 'Incident #' + i.id;
    const steps = ['reported', 'verified', 'responding', 'resolved'];
    const curIdx = steps.indexOf(i.status);
    document.getElementById('incident-detail').innerHTML = `
      <div class="status-flow">${steps.map((s, idx) => `
        <span class="step ${idx <= curIdx ? 'done' : ''}">${s}</span>
        ${idx < steps.length - 1 ? '<span class="arrow">&rarr;</span>' : ''}`).join('')}</div>
      <p class="mt"><b>${i.incident_type.replace('_', ' ')}</b> &bull; ${escapeHtml(i.barangay || 'unassigned')} &bull; ${fmtDate(i.created_at)}</p>
      <p class="mt">${escapeHtml(i.description)}</p>
      ${i.photo_path ? `<img src="${i.photo_path}" style="max-width:100%;border-radius:8px;margin-top:10px" alt="incident photo">` : ''}
      ${i.address ? `<p class="muted mt">📍 ${escapeHtml(i.address)} ${i.latitude != null ? `(${i.latitude}, ${i.longitude})` : ''}</p>` : ''}
      <p class="muted">Reported by: ${escapeHtml(i.reporter || 'unknown')}${i.assigned_team ? ' &bull; Team: ' + escapeHtml(i.assigned_team) : ''}</p>
      <div class="mt"><b>History</b>
        <table>${i.history.map(h => `<tr><td><span class="badge ${h.status}">${h.status}</span></td><td>${escapeHtml(h.note || '')}</td><td>${escapeHtml(h.changed_by || 'system')}</td><td>${fmtDate(h.created_at)}</td></tr>`).join('')}</table>
      </div>`;
    openModal('incident-view-modal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function openIncidentStatus(id, current) {
  document.getElementById('is-id').value = id;
  document.getElementById('is-note').value = '';
  const steps = ['reported', 'verified', 'responding', 'resolved'];
  const curIdx = steps.indexOf(current);
  document.getElementById('inc-status-flow').innerHTML = steps.map((s, idx) => `
    <span class="step ${idx <= curIdx ? 'done' : ''}">${s}</span>
    ${idx < steps.length - 1 ? '<span class="arrow">&rarr;</span>' : ''}`).join('');
  // load teams for dispatch
  teamList = await api.get('/api/teams');
  const teamSel = document.getElementById('is-team');
  teamSel.innerHTML = '<option value="">-- no team --</option>' +
    teamList.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.status.replace('_', ' ')})</option>`).join('');
  document.getElementById('is-team-wrap').classList.add('hidden');
  const statusSel = document.getElementById('is-status');
  const next = steps[Math.min(curIdx + 1, steps.length - 1)];
  statusSel.value = next !== current ? next : 'verified';
  toggleTeamWrap();
  openModal('incident-status-modal');
}

function toggleTeamWrap() {
  document.getElementById('is-team-wrap').classList.toggle('hidden',
    document.getElementById('is-status').value !== 'responding');
}

// ================= MY REPORTS =================
async function loadMyReports() {
  const rows = await api.get('/api/incidents/mine/list');
  const steps = ['reported', 'verified', 'responding', 'resolved'];
  document.getElementById('my-reports').innerHTML = rows.length ? rows.map(r => {
    const curIdx = steps.indexOf(r.status);
    return `<div class="alert-item">
      <h4>#${r.id} ${r.incident_type.replace('_', ' ')} <span class="badge ${r.status}">${r.status}</span></h4>
      <p>${escapeHtml(r.description).slice(0, 140)}</p>
      <div class="status-flow mt">${steps.map((s, idx) => `
        <span class="step ${idx <= curIdx ? 'done' : ''}">${s}</span>
        ${idx < steps.length - 1 ? '<span class="arrow">&rarr;</span>' : ''}`).join('')}</div>
      <div class="meta">${fmtDate(r.created_at)}${r.updated_at !== r.created_at ? ' &bull; updated ' + fmtDate(r.updated_at) : ''}</div>
    </div>`;
  }).join('') : '<p class="empty">You have not filed any incident reports yet. Use "Report an Incident" on the home page map.</p>';
}

// ================= EVACUATION =================
async function loadEvacAdmin() {
  const centers = await api.get('/api/evacuation');
  document.getElementById('evac-admin-body').innerHTML = centers.map(e => {
    const pct = e.capacity > 0 ? Math.round((e.occupants / e.capacity) * 100) : 0;
    return `<tr>
      <td><b>${escapeHtml(e.name)}</b><br><small class="muted">${escapeHtml(e.address || '')}</small></td>
      <td>${escapeHtml(e.barangay || '-')}</td>
      <td><span class="badge ${e.status === 'open' ? 'resolved' : e.status === 'full' ? 'critical' : 'info'}">${e.status}</span></td>
      <td style="min-width:140px">${e.occupants}/${e.capacity} (${pct}%)
        <div class="progress"><div class="${pct >= 100 ? 'over' : pct >= 75 ? 'warn' : ''}" style="width:${Math.min(pct, 100)}%"></div></div></td>
      <td>${escapeHtml(e.contact_phone || '-')}</td>
      <td><button class="btn sm" onclick="openEvacEdit(${e.id}, ${e.occupants}, ${e.capacity}, '${e.status}')">Update</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">No centers.</td></tr>';
}

function openEvacEdit(id, occupants, capacity, status) {
  document.getElementById('ev-id').value = id;
  document.getElementById('ev-occupants').value = occupants;
  document.getElementById('ev-capacity').value = capacity;
  document.getElementById('ev-status').value = '';
  openModal('evac-edit-modal');
}

// ================= TEAMS =================
async function loadTeamsAdmin() {
  const teams = await api.get('/api/teams');
  document.getElementById('teams-admin-body').innerHTML = teams.map(t => `
    <tr>
      <td><b>${escapeHtml(t.name)}</b></td>
      <td>${escapeHtml(t.leader_name)}</td>
      <td>${t.member_count}</td>
      <td>${escapeHtml(t.phone || '-')}</td>
      <td><span class="badge ${t.status === 'available' ? 'resolved' : t.status === 'off_duty' ? 'info' : 'warning'}">${t.status.replace('_', ' ')}</span>
        ${t.active_incident_id ? '<br><small class="muted">on incident #' + t.active_incident_id + '</small>' : ''}</td>
      <td>
        <select style="max-width:150px" onchange="updateTeamStatus(${t.id}, this.value)">
          <option value="">Set status...</option>
          <option value="available">Available</option>
          <option value="on_mission">On mission</option>
          <option value="dispatched">Dispatched</option>
          <option value="off_duty">Off duty</option>
        </select>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No teams.</td></tr>';
}

async function updateTeamStatus(id, status) {
  if (!status) return;
  try {
    await api.put('/api/teams/' + id, { status });
    toast('Team status updated.', 'success');
    loadTeamsAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= FLOOD =================
async function loadFloodAdmin() {
  const sensors = await api.get('/api/flood/sensors');
  document.getElementById('flood-admin-body').innerHTML = sensors.map(s => `
    <tr>
      <td><b>${escapeHtml(s.name)}</b></td>
      <td>${escapeHtml(s.barangay || '-')}</td>
      <td>${s.latest_level != null ? `<b style="color:${s.latest_status === 'critical' ? 'var(--red)' : s.latest_status === 'alert' ? 'var(--orange)' : 'var(--green)'}">${s.latest_level} m</b> <span class="badge ${s.latest_status === 'normal' ? 'resolved' : s.latest_status === 'alert' ? 'warning' : 'critical'}">${s.latest_status}</span>` : '<span class="muted">no reading</span>'}</td>
      <td>${s.alert_level_m} / ${s.critical_level_m} m</td>
      <td>${fmtDate(s.latest_at) || '-'}</td>
      <td>
        <div class="section-actions">
          <button class="btn secondary sm" onclick="manualReading(${s.id})">Record</button>
          <button class="btn sm" onclick="simulateReading(${s.id})">Simulate</button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No sensors.</td></tr>';
}

async function manualReading(sensorId) {
  const val = prompt('Water level in meters:');
  if (val == null || val.trim() === '') return;
  try {
    const r = await api.post('/api/flood/readings', { sensor_id: sensorId, water_level_m: Number(val) });
    toast(`Reading recorded. Status: ${r.status}` + (r.status !== 'normal' ? ' - automatic warning triggered!' : ''), r.status === 'normal' ? 'success' : 'error');
    loadFloodAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

async function simulateReading(sensorId) {
  try {
    const r = await api.post(`/api/flood/sensors/${sensorId}/simulate`, {});
    toast(`Simulated reading: ${r.level} m (${r.status})`, 'success');
    loadFloodAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= RESOURCES =================
async function loadResourcesAdmin() {
  const rows = await api.get('/api/resources');
  document.getElementById('resources-admin-body').innerHTML = rows.map(r => `
    <tr>
      <td><b>${escapeHtml(r.name)}</b></td>
      <td>${r.category}</td>
      <td style="${Number(r.below_minimum) ? 'color:var(--red);font-weight:700' : ''}">${r.quantity} ${escapeHtml(r.unit)}${Number(r.below_minimum) ? ' ⚠' : ''}</td>
      <td>${r.minimum_level} ${escapeHtml(r.unit)}</td>
      <td>${escapeHtml(r.storage_location || r.evacuation_center || '-')}</td>
      <td>
        <div class="section-actions">
          <button class="btn success sm" onclick="adjustResource(${r.id}, 1)">+ Stock in</button>
          <button class="btn warning sm" onclick="adjustResource(${r.id}, -1)">- Distribute</button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No resources.</td></tr>';
}

async function adjustResource(id, sign) {
  const val = prompt(sign > 0 ? 'Quantity to ADD:' : 'Quantity to REMOVE:');
  if (val == null || val.trim() === '') return;
  const delta = Number(val) * sign;
  if (isNaN(delta) || delta === 0) return toast('Enter a valid number.', 'error');
  try {
    await api.post(`/api/resources/${id}/adjust`, { delta });
    toast('Stock updated.', 'success');
    loadResourcesAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= MISSING =================
async function loadMissingAdmin() {
  const rows = currentUser.role === 'resident'
    ? await api.get('/api/missing')
    : await api.get('/api/missing/manage/list');
  document.getElementById('missing-admin-body').innerHTML = rows.map(m => `
    <tr>
      <td><b>${escapeHtml(m.full_name)}</b>${m.photo_path ? `<br><img class="thumb" src="${m.photo_path}" onclick="window.open(this.src)" alt="photo">` : ''}</td>
      <td>${m.age || '?'} / ${m.gender}</td>
      <td>${escapeHtml(m.last_seen || '-')}${m.barangay ? '<br><small class="muted">' + escapeHtml(m.barangay) + '</small>' : ''}</td>
      <td>${escapeHtml(m.contact_phone || '-')}<br><small class="muted">${escapeHtml(m.contact_name || '')}</small></td>
      <td><span class="badge ${m.status === 'missing' ? 'warning' : 'resolved'}">${m.status}</span></td>
      <td>${fmtDate(m.created_at)}</td>
      <td>
        ${m.status === 'missing'
          ? `<button class="btn success sm" onclick="markFound(${m.id})">Mark Found</button>`
          : `<button class="btn secondary sm" onclick="markMissing(${m.id})">Reopen</button>`}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">No missing-person reports.</td></tr>';
}

async function setMissingStatus(id, status) {
  try {
    await api.put(`/api/missing/${id}/status`, { status });
    toast(`Report marked as ${status}.`, 'success');
    loadMissingAdmin();
  } catch (err) { toast(err.message, 'error'); }
}
const markFound = id => setMissingStatus(id, 'found');
const markMissing = id => setMissingStatus(id, 'missing');

// ================= BARANGAYS =================
async function loadBarangaysAdmin() {
  const { barangays } = await api.get('/api/barangays');
  document.getElementById('barangays-admin-body').innerHTML = barangays.map(b => `
    <tr>
      <td><b>${escapeHtml(b.name)}</b></td>
      <td>
        <select style="max-width:150px" onchange="updateRisk(${b.id}, this.value)">
          ${['low', 'moderate', 'high', 'critical'].map(r =>
            `<option value="${r}" ${b.risk_level === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        <span class="badge ${b.risk_level}">${b.risk_level}</span>
      </td>
      <td>${b.population}</td>
      <td>${b.latitude != null ? `${b.latitude}, ${b.longitude}` : '-'}</td>
      <td><small class="muted">open incidents: ${b.open_incidents} &bull; evacuees: ${b.evacuees}</small></td>
    </tr>`).join('');
}

async function updateRisk(id, level) {
  try {
    await api.put('/api/barangays/' + id, { risk_level: level });
    toast(`Risk level set to ${level}.`, 'success');
    loadBarangaysAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= CONTACTS =================
async function loadContactsAdmin() {
  const rows = await api.get('/api/contacts');
  document.getElementById('contacts-admin-body').innerHTML = rows.map(c => `
    <tr>
      <td><b>${escapeHtml(c.name)}</b></td>
      <td>${c.category}</td>
      <td>${escapeHtml(c.phone)}</td>
      <td>${escapeHtml(c.address || '-')}</td>
      <td><button class="btn danger sm" onclick="deleteContact(${c.id})">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">No contacts.</td></tr>';
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try {
    await api.del('/api/contacts/' + id);
    toast('Contact deleted.', 'success');
    loadContactsAdmin();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= USERS =================
async function loadUsersAdmin() {
  const rows = await api.get('/api/users');
  document.getElementById('users-admin-body').innerHTML = rows.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge info">${u.role.replace('_', ' ')}</span></td>
      <td>${escapeHtml(u.barangay_name || '-')}</td>
      <td>${u.is_active ? '<span style="color:var(--green)">yes</span>' : '<span style="color:var(--red)">no</span>'}</td>
      <td><button class="btn sm" onclick='openUserEdit(${JSON.stringify(u).replace(/'/g, '&#39;')})'>Edit</button></td>
    </tr>`).join('');
}

function openUserEdit(u) {
  document.getElementById('ue-id').value = u.id;
  document.getElementById('ue-name').value = u.name;
  document.getElementById('ue-role').value = u.role;
  document.getElementById('ue-barangay').value = u.barangay_id || '';
  document.getElementById('ue-password').value = '';
  document.getElementById('ue-active').checked = !!u.is_active;
  openModal('user-edit-modal');
}

// ================= REPORTS =================
function downloadReport(format) {
  const q = new URLSearchParams();
  const from = document.getElementById('rpt-from').value;
  const to = document.getElementById('rpt-to').value;
  const status = document.getElementById('rpt-status').value;
  const barangay = document.getElementById('rpt-barangay').value;
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (status) q.set('status', status);
  if (barangay) q.set('barangay_id', barangay);
  window.location = `/api/reports/${format}?${q.toString()}`;
  toast(`Generating ${format.toUpperCase()} report...`, 'success');
}

// ================= LOGS =================
async function loadLogs() {
  const rows = await api.get('/api/logs?limit=200');
  document.getElementById('logs-body').innerHTML = rows.map(l => `
    <tr>
      <td>${fmtDate(l.created_at)}</td>
      <td>${escapeHtml(l.user_name || 'system')}</td>
      <td><code>${escapeHtml(l.action)}</code></td>
      <td>${escapeHtml(l.entity_type || '-')}${l.entity_id ? ' #' + l.entity_id : ''}</td>
      <td style="max-width:260px"><small>${escapeHtml(l.details || '')}</small></td>
      <td><small class="muted">${escapeHtml(l.ip_address || '')}</small></td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">No activity yet.</td></tr>';
}

// ================= AI CHAT (dashboard) =================
function initDashChat() {
  const log = document.getElementById('dash-chat-log');
  const input = document.getElementById('dash-chat-input');
  const send = async () => {
    const q = input.value.trim();
    if (!q) return;
    log.innerHTML += `<div class="chat-msg user">${escapeHtml(q)}</div>`;
    input.value = '';
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api.post('/api/ai/chat', { question: q });
      log.innerHTML += `<div class="chat-msg bot">${escapeHtml(r.answer)}</div>`;
    } catch (err) {
      log.innerHTML += `<div class="chat-msg bot">Error: ${escapeHtml(err.message)}</div>`;
    }
    log.scrollTop = log.scrollHeight;
  };
  document.getElementById('dash-chat-send').addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

// ================= FORM BINDINGS =================
function bindForms() {
  document.getElementById('alert-form').addEventListener('submit', e => { e.preventDefault(); submitAlert(true); });
  document.getElementById('is-status').addEventListener('change', toggleTeamWrap);

  document.getElementById('incident-status-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('is-id').value;
    try {
      await api.post(`/api/incidents/${id}/status`, {
        status: document.getElementById('is-status').value,
        note: document.getElementById('is-note').value,
        team_id: document.getElementById('is-status').value === 'responding' ? (document.getElementById('is-team').value || undefined) : undefined
      });
      toast('Incident status updated.', 'success');
      closeModal('incident-status-modal');
      loadIncidentsAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('pdf-import-form').addEventListener('submit', async e => {
    e.preventDefault();
    const file = document.getElementById('pdf-file').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('pdf', file);
    const out = document.getElementById('pdf-import-result');
    out.innerHTML = '<p class="empty">Analyzing PDF with AI...</p>';
    try {
      const r = await api.postForm('/api/ai/pdf-import', fd);
      out.innerHTML = `<div class="alert-item severity-${r.draft.severity}">
        <h4>Draft created (Alert #${r.alert_id})</h4>
        <p><b>${escapeHtml(r.draft.title)}</b></p>
        <p>${escapeHtml(r.draft.message).slice(0, 300)}...</p>
        <div class="meta">Severity: ${r.draft.severity} &bull; Type: ${r.draft.alert_type} &bull;
          Target: ${r.draft.target_type}${r.draft.suggested_barangay_names.length ? ' (' + r.draft.suggested_barangay_names.join(', ') + ')' : ''}</div>
        <p class="muted mt">Review it in the alerts table, then Submit → Approve → Send.</p>
      </div>`;
      toast('PDF analyzed - draft alert created.', 'success');
      loadAlertsManage();
    } catch (err) {
      out.innerHTML = `<p class="warning-item critical">${escapeHtml(err.message)}</p>`;
    }
  });

  document.getElementById('evac-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('ev-id').value;
    try {
      await api.put('/api/evacuation/' + id, {
        occupants: Number(document.getElementById('ev-occupants').value),
        capacity: Number(document.getElementById('ev-capacity').value),
        status: document.getElementById('ev-status').value || undefined
      });
      toast('Evacuation center updated.', 'success');
      closeModal('evac-edit-modal');
      loadEvacAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('evac-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/evacuation', {
        name: document.getElementById('evc-name').value,
        barangay_id: document.getElementById('evc-barangay').value || null,
        address: document.getElementById('evc-address').value,
        latitude: document.getElementById('evc-lat').value || null,
        longitude: document.getElementById('evc-lng').value || null,
        capacity: document.getElementById('evc-capacity').value,
        contact_phone: document.getElementById('evc-phone').value
      });
      toast('Evacuation center created.', 'success');
      closeModal('evac-create-modal');
      e.target.reset();
      loadEvacAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('team-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/teams', {
        name: document.getElementById('tm-name').value,
        leader_name: document.getElementById('tm-leader').value,
        member_count: document.getElementById('tm-count').value,
        phone: document.getElementById('tm-phone').value
      });
      toast('Rescue team created.', 'success');
      closeModal('team-create-modal');
      e.target.reset();
      loadTeamsAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('sensor-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/flood/sensors', {
        name: document.getElementById('fs-name').value,
        barangay_id: document.getElementById('fs-barangay').value || null,
        latitude: document.getElementById('fs-lat').value || null,
        longitude: document.getElementById('fs-lng').value || null,
        alert_level_m: document.getElementById('fs-alert').value,
        critical_level_m: document.getElementById('fs-critical').value
      });
      toast('Flood sensor created.', 'success');
      closeModal('sensor-create-modal');
      e.target.reset();
      loadFloodAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('resource-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/resources', {
        name: document.getElementById('rs-name').value,
        category: document.getElementById('rs-category').value,
        quantity: document.getElementById('rs-qty').value,
        unit: document.getElementById('rs-unit').value,
        minimum_level: document.getElementById('rs-min').value,
        storage_location: document.getElementById('rs-location').value
      });
      toast('Resource added.', 'success');
      closeModal('resource-create-modal');
      e.target.reset();
      loadResourcesAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('missing-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('full_name', document.getElementById('mp-name').value);
    fd.append('age', document.getElementById('mp-age').value);
    fd.append('gender', document.getElementById('mp-gender').value);
    fd.append('last_seen', document.getElementById('mp-lastseen').value);
    fd.append('barangay_id', document.getElementById('mp-barangay').value);
    fd.append('description', document.getElementById('mp-desc').value);
    fd.append('contact_name', document.getElementById('mp-cname').value);
    fd.append('contact_phone', document.getElementById('mp-cphone').value);
    const photo = document.getElementById('mp-photo').files[0];
    if (photo) fd.append('photo', photo);
    try {
      await api.postForm('/api/missing', fd);
      toast('Missing-person report submitted.', 'success');
      closeModal('missing-create-modal');
      e.target.reset();
      loadMissingAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('contact-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/contacts', {
        name: document.getElementById('ct-name').value,
        category: document.getElementById('ct-category').value,
        phone: document.getElementById('ct-phone').value,
        address: document.getElementById('ct-address').value
      });
      toast('Contact added.', 'success');
      closeModal('contact-create-modal');
      e.target.reset();
      loadContactsAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('user-create-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/users', {
        name: document.getElementById('us-name').value,
        email: document.getElementById('us-email').value,
        password: document.getElementById('us-password').value,
        role: document.getElementById('us-role').value,
        barangay_id: document.getElementById('us-barangay').value || null,
        phone: document.getElementById('us-phone').value
      });
      toast('User created.', 'success');
      closeModal('user-create-modal');
      e.target.reset();
      loadUsersAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('user-edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('ue-id').value;
    const body = {
      name: document.getElementById('ue-name').value,
      role: document.getElementById('ue-role').value,
      barangay_id: document.getElementById('ue-barangay').value || null,
      is_active: document.getElementById('ue-active').checked
    };
    const pw = document.getElementById('ue-password').value;
    if (pw) body.password = pw;
    try {
      await api.put('/api/users/' + id, body);
      toast('User updated.', 'success');
      closeModal('user-edit-modal');
      loadUsersAdmin();
    } catch (err) { toast(err.message, 'error'); }
  });
}
