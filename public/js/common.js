// Shared helpers for all MDAS pages
const api = {
  async request(method, url, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined && body !== null) {
      if (isForm) {
        opts.body = body; // FormData
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },
  postForm(url, formData) { return this.request('POST', url, formData, true); }
};

// ---------- Toasts ----------
function toast(message, type) {
  let area = document.getElementById('toast-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'toast-area';
    document.body.appendChild(area);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4500);
}

// ---------- Auth state ----------
let currentUser = null;
async function loadCurrentUser() {
  try {
    currentUser = await api.get('/api/auth/me');
  } catch {
    currentUser = null;
  }
  renderAuthUI();
  return currentUser;
}

function renderAuthUI() {
  document.querySelectorAll('[data-auth-area]').forEach(el => {
    if (currentUser) {
      el.innerHTML =
        `<span class="muted">${escapeHtml(currentUser.name)} <span class="badge info">${currentUser.role.replace('_', ' ')}</span></span>
         <a class="btn secondary sm" href="/dashboard.html">Dashboard</a>
         <button class="btn sm" id="logout-btn">Logout</button>`;
      const btn = el.querySelector('#logout-btn');
      if (btn) btn.onclick = async () => { await api.post('/api/auth/logout'); location.href = '/'; };
    } else {
      el.innerHTML = `<a class="btn secondary sm" href="/login.html">Login</a>
                      <a class="btn sm" href="/login.html?mode=register">Register</a>`;
    }
  });
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  let s = String(d).replace(' ', 'T');
  // MySQL sends naive "YYYY-MM-DDTHH:MM:SS" strings that are already in
  // Philippine Time (UTC+8). Tag them with the offset so the instant is
  // correct regardless of the viewer's browser timezone, then render in UTC+8.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '+08:00';
  const dt = new Date(s);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- Modal helper ----------
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ---------- Offline indicator ----------
function updateOnlineState() {
  document.body.classList.toggle('is-offline', !navigator.onLine);
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);

// ---------- PWA: service worker + background push ----------
async function initPWA(enablePush) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (enablePush && 'PushManager' in window) {
      await subscribePush(reg);
    }
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

async function subscribePush(reg) {
  try {
    const { vapidPublicKey } = await api.get('/api/auth/push-key');
    if (!vapidPublicKey) return; // server has no VAPID keys configured
    const existing = await reg.pushManager.getSubscription();
    if (existing) return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
    await api.post('/api/push/subscribe', sub.toJSON());
    toast('Background notifications enabled.', 'success');
  } catch (err) {
    console.warn('Push subscription failed:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ---------- PWA install prompt ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  document.querySelectorAll('.install-btn').forEach(b => b.classList.add('show'));
});
async function installApp(btn) {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') btn.classList.remove('show');
  deferredPrompt = null;
}

// Boot common behavior on every page
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineState();
  document.querySelectorAll('.install-btn').forEach(b => {
    b.addEventListener('click', () => installApp(b));
  });
});
