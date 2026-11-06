// Connection setup + sign in / sign up. Calls start() (app.js) once signed in.
// Connection order: saved in this browser (via "Change connection") > js/config.js > ask.
const CFG = 'foundry_sb';
const $a = id => document.getElementById(id);
const store = v => { try { return v === undefined ? JSON.parse(localStorage.getItem(CFG) || 'null') : v === null ? localStorage.removeItem(CFG) : localStorage.setItem(CFG, JSON.stringify(v)); } catch (e) { return null; } };
const AC = window.APP_CONFIG || {};
const FIXED = /^https:\/\/[^ ]+$/.test((AC.url || '').trim()) && (AC.key || '').trim().length > 20 && !/PASTE_/.test(AC.url + AC.key)
  ? { url: AC.url.trim().replace(/\/+$/, ''), key: AC.key.trim() } : null;
const current = () => store() || FIXED;

function box(inner) {
  $a('app').innerHTML = `<div class="login"><h1>Foundry ERP</h1><div class="card">${inner}<div id="am" class="msg bad" hidden role="alert"></div></div></div>`;
}
function note(t) { const e = $a('am'); e.textContent = t; e.hidden = !t; }

function showConfig() {
  const c = current() || {};
  box(`<p class="mute">Connect to your Supabase project (Settings, then API).</p>
   ${FIXED || !window.APP_CONFIG ? '' : '<p class="msg">js/config.js is not filled in correctly yet: it needs the full URL (https://...supabase.co) and the anon key, each inside quotes.</p>'}
   <div class="fg"><label>Project URL<input id="cu" placeholder="https://xxxx.supabase.co" value="${H(c.url || '')}"></label>
   <label>Anon public key<input id="ck" value="${H(c.key || '')}"></label></div>
   <div class="bar2"><button class="btn p" id="cs">Test and save</button>
   ${FIXED ? '<button class="btn" id="cd">Use default from config.js</button>' : ''}
   ${c.url ? '<button class="btn" id="cb">Back to sign in</button>' : ''}</div>`);
  $a('cs').onclick = async () => {
    const url = $a('cu').value.trim().replace(/\/+$/, ''), key = $a('ck').value.trim();
    if (!/^https:\/\/.+/.test(url) || !key) return note('Enter the project URL and the anon key.');
    note('Testing connection...');
    try {
      const r = await fetch(url + '/auth/v1/settings', { headers: { apikey: key } });
      if (!r.ok) return note('Connection failed (' + r.status + '). Check the anon key.');
    } catch (e) { return note('Cannot reach that URL. Check the project URL.'); }
    store({ url, key }); init();
  };
  if (FIXED) $a('cd').onclick = () => { store(null); init(); };
  if (c.url) $a('cb').onclick = () => init();
}

function showLogin(signup) {
  box(`<form id="lf"><div class="fg">${signup ? '<label>Full name<input id="ln"></label>' : ''}
   <label>Email<input id="le" name="email" type="email" autocomplete="username" required></label>
   <label>Password<input id="lp" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label></div>
   <div class="bar2"><button class="btn p" id="go" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
   <button class="btn" id="sw" type="button">${signup ? 'I have an account' : 'Create account'}</button>
   <button class="btn s" id="cc" type="button">Change connection</button></div>
   ${signup ? '' : '<p style="margin:12px 0 0"><a href="#" id="fp">Forgot password?</a></p>'}</form>`);
  if (!signup) $a('fp').onclick = e => { e.preventDefault(); showForgot(); };
  $a('sw').onclick = () => showLogin(!signup);
  $a('cc').onclick = showConfig;
  $a('lf').onsubmit = async ev => {
    ev.preventDefault();
    const email = $a('le').value.trim(), password = $a('lp').value;
    if (signup) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: $a('ln').value.trim() } } });
      if (error) return note(error.message);
      return data.session ? start() : note('Account created. Confirm your email, then sign in. An administrator must also approve your account before you can use the system.');
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    error ? note(error.message) : start();
  };
}
function showForgot() {
  box(`<form id="ff"><p class="mute">Enter your account email and we will send a reset link.</p>
   <div class="fg"><label>Email<input id="fe" type="email" autocomplete="username" required></label></div>
   <div class="bar2"><button class="btn p" type="submit">Send reset link</button>
   <button class="btn" type="button" id="fb">Back to sign in</button></div></form>`);
  $a('fb').onclick = () => showLogin(false);
  $a('ff').onsubmit = async ev => {
    ev.preventDefault();
    if (location.protocol === 'file:') return note('Password reset links need the app to be hosted on a web address (for example Netlify). Opening from a file will not work.');
    const { error } = await sb.auth.resetPasswordForEmail($a('fe').value.trim(), { redirectTo: location.origin + location.pathname });
    note(error ? error.message : 'If that email has an account, a reset link is on its way. Open it on this device.');
    if (!error) $a('am').classList.remove('bad');
  };
}
function showNewPassword() {
  box(`<form id="nf"><p class="mute">Choose a new password.</p>
   <div class="fg"><label>New password<input id="n1" type="password" autocomplete="new-password" minlength="6" required></label>
   <label>Confirm password<input id="n2" type="password" autocomplete="new-password" minlength="6" required></label></div>
   <div class="bar2"><button class="btn p" type="submit">Save new password</button></div></form>`);
  $a('nf').onsubmit = async ev => {
    ev.preventDefault();
    if ($a('n1').value !== $a('n2').value) return note('The two passwords do not match.');
    const { error } = await sb.auth.updateUser({ password: $a('n1').value });
    if (error) return note(error.message);
    history.replaceState(null, '', location.pathname);
    start();
  };
}
window.signOut = async () => { await sb.auth.signOut(); location.reload(); };
async function init() {
  const c = current(); if (!c) return showConfig();
  window.sb = supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'foundry-erp-auth' } });
  sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') showNewPassword(); });
  const { data } = await sb.auth.getSession();
  if (/type=recovery/.test(location.hash)) return showNewPassword();
  data.session ? start() : showLogin(false);
  const err = new URLSearchParams(location.hash.slice(1)).get('error_description');
  if (err) { note(err.replace(/\+/g, ' ') + ' Request a new reset link.'); history.replaceState(null, '', location.pathname); }
}
init();
