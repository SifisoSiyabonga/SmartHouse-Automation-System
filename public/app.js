// Dashboard logic: login check, live data from Firebase, AUTO/ON/OFF buttons, admin lock, logged-in users, disable users.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, set, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = id => document.getElementById(id);
let live = {};                 // latest data from smarthome/live
let controls = { lightMode: 'auto', fanMode: 'auto' };
let lastSeen = 0;              // when we last got new data from the ESP32
let me = null;                 // the logged-in user
let isAdmin = false;           // true when users/<uid>/role = "admin"
let locks = {};                // smarthome/locks   { lightMode: true/false, fanMode: true/false }
let changes = {};              // smarthome/changes { lightMode: {by, at}, fanMode: {by, at} }

// ---------- 1. Only logged-in users ----------
onAuthStateChanged(auth, user => {
  if (!user) { location.href = 'index.html'; return; }
  me = user;
  $('who').textContent = 'Logged in as ' + (user.displayName || user.email);
  startListening();
});
$('logout').onclick = () => {
  const off = me ? set(ref(db, 'users/' + me.uid + '/online'), false).catch(() => {}) : Promise.resolve();
  off.then(() => signOut(auth)).then(() => location.href = 'index.html');
};

// ---------- 2. Listen to Firebase ----------
let started = false;
function startListening() {
  if (started) return; started = true;

  // ESP32 writes here every few seconds
  onValue(ref(db, 'smarthome/live'), snap => {
    live = snap.val() || {};
    lastSeen = Date.now();
    render();
  });

  // My profile: am I the admin? Has the admin disabled me? (role is added by hand in the Firebase Console)
  onValue(ref(db, 'users/' + me.uid), snap => {
    const p = snap.val() || {};
    if (p.disabled === true) { kickOut(); return; }            // disabled by the admin - log out
    isAdmin = p.role === 'admin';
    $('usersBtn').style.display = isAdmin ? 'inline-block' : 'none';
    $('who').innerHTML = '';
    $('who').append('Logged in as ' + (me.displayName || me.email));
    if (isAdmin) { const b = document.createElement('span'); b.className = 'adminbadge'; b.textContent = 'ADMIN'; $('who').append(b); }
    render();
  });

  // I am online: save my login time, and go "offline" by myself when I close the page
  onValue(ref(db, '.info/connected'), snap => {
    if (snap.val() !== true) return;
    const myRef = ref(db, 'users/' + me.uid);
    onDisconnect(ref(db, 'users/' + me.uid + '/online')).set(false);
    update(myRef, { online: true, lastLogin: serverTimestamp() }).catch(() => {});
  });

  // Locks (only the admin can change them)
  onValue(ref(db, 'smarthome/locks'), snap => { locks = snap.val() || {}; render(); });

  // Who changed the LED / fan last
  onValue(ref(db, 'smarthome/changes'), snap => { changes = snap.val() || {}; render(); });

  // Website buttons write here, ESP32 reads it
  onValue(ref(db, 'smarthome/controls'), snap => {
    controls = Object.assign({ lightMode: 'auto', fanMode: 'auto' }, snap.val() || {});
    render();
  });
}

// ---------- 3. Buttons ----------
function setMode(device, mode) {
  if (locks[device] && !isAdmin) { alertBox('Locked by the admin - you cannot change this'); return; }
  // Save the command and who sent it, in one go
  update(ref(db), {
    ['smarthome/controls/' + device]: mode,
    ['smarthome/changes/' + device]: { by: me.displayName || me.email, uid: me.uid, mode: mode, at: serverTimestamp() }
  }).catch(err => alertBox('Not allowed: ' + (locks[device] ? 'locked by the admin' : err.message)));
}
function toggleLock(device) {
  if (!isAdmin) return;
  set(ref(db, 'smarthome/locks/' + device), !locks[device])
    .catch(err => alertBox('Could not lock: ' + err.message));
}
$('lA').onclick  = () => setMode('lightMode', 'auto');
$('lOn').onclick = () => setMode('lightMode', 'on');
$('lOff').onclick= () => setMode('lightMode', 'off');
$('fA').onclick  = () => setMode('fanMode', 'auto');
$('fOn').onclick = () => setMode('fanMode', 'on');
$('fOff').onclick= () => setMode('fanMode', 'off');
$('lLock').onclick = () => toggleLock('lightMode');
$('fLock').onclick = () => toggleLock('fanMode');

let alertUntil = 0;
function alertBox(t) { $('status').textContent = t; alertUntil = Date.now() + 4000; }   // keep the message for 4 s

// Shown when the admin disables this account: cover the page, then log out
let kicked = false;
function kickOut() {
  if (kicked) return; kicked = true;
  const box = document.createElement('div'); box.id = 'disabledBox';
  box.innerHTML = '<div>&#128683; Your account has been <b>disabled</b> by the admin.<br><span class="small">You will be logged out.</span></div>';
  document.body.append(box);
  setTimeout(() => signOut(auth).then(() => location.href = 'index.html'), 3000);
}

function seg(p, mode, device) {
  $(p + 'A').className   = mode === 'auto' ? 'active' : '';
  $(p + 'On').className  = mode === 'on'   ? 'active' : '';
  $(p + 'Off').className = mode === 'off'  ? 'active' : '';

  const locked = !!locks[device];
  const blocked = locked && !isAdmin;          // normal users cannot press when locked
  [p + 'A', p + 'On', p + 'Off'].forEach(id => $(id).disabled = blocked);

  // Lock button: only the admin sees it
  const lb = $(p + 'Lock');
  lb.style.display = isAdmin ? 'inline-block' : 'none';
  lb.textContent = locked ? '\u{1F512} Locked - tap to unlock' : '\u{1F513} Lock';
  lb.className = 'lockbtn' + (locked ? ' locked' : '');

  // "Changed by ... at ..."
  const c = changes[device];
  let txt = c && c.by ? 'Last changed by ' + c.by + ' (' + String(c.mode || '').toUpperCase() + ')' +
            (c.at ? ' at ' + new Date(c.at).toLocaleTimeString() : '') : '';
  if (locked) txt = '\u{1F512} Locked by the admin' + (txt ? ' - ' + txt : '');
  $(p + 'by').textContent = txt;
  $(p + 'by').className = 'small changed' + (locked ? ' lockmsg' : '');
}

// ---------- 4. Draw everything ----------
function render() {
  const d = live;

  // Temperature
  if (d.temperature === undefined || d.temperature === null) {
    $('temp').textContent = '--';
    $('tinfo').textContent = 'No temperature yet'; $('tinfo').className = 'small wait';
  } else {
    $('temp').textContent = Number(d.temperature).toFixed(1);
    const p = Math.min(Math.max(d.temperature / 50, 0), 1);
    $('tring').style.strokeDashoffset = 377 * (1 - p);
    $('tinfo').textContent = d.hot ? 'Hot - above 20 °C' : 'Cool - below 20 °C';
    $('tinfo').className = 'small ' + (d.hot ? 'hot' : 'safe');
  }
  $('hum').textContent = (d.humidity === undefined || d.humidity === null) ? '--' : Math.round(d.humidity) + ' %';

  // Gas
  const G = $('gstate');
  if (!d.gasCalibrated) {
    G.textContent = 'Warming up'; G.className = 'big wait';
    $('ginfo').textContent = d.warmLeft ? 'Keep gas away - ready in ' + d.warmLeft + ' s' : 'Waiting for gas sensor';
  } else if (d.gasAlarm) {
    G.textContent = 'DETECTED'; G.className = 'big danger';
    $('ginfo').textContent = 'Clean air ' + d.gasBaseline + ' - alarm above ' + d.gasThreshold;
  } else {
    G.textContent = 'Safe'; G.className = 'big safe';
    $('ginfo').textContent = 'Clean air ' + d.gasBaseline + ' - alarm above ' + d.gasThreshold;
  }
  const gas = d.gas || 0;
  $('gas').textContent = d.gas === undefined ? '--' : gas;
  $('gfill').style.width = Math.round(gas / 4095 * 100) + '%';
  $('gfill').style.background = d.gasAlarm ? 'linear-gradient(90deg,#d63031,#ff7675)' : 'linear-gradient(90deg,#00b894,#55efc4)';
  $('alarm').style.display = d.gasAlarm ? 'block' : 'none';
  $('overlay').className = d.gasAlarm ? 'on' : '';

  // Motion - the ESP32 sends every 3 s, so the countdown is continued here between updates
  const since = lastSeen ? (Date.now() - lastSeen) / 1000 : 0;
  const total = d.holdTotal || 10;
  let left = 0, moving = false;
  if (d.motion) {
    left = d.pirNow ? total : Math.max(0, Math.ceil((d.holdLeft || 0) - since));
    moving = left > 0;
  }
  $('radar').className = 'radar' + (moving ? ' on' : '');
  if (d.pirWarm > 0) {
    const w = Math.max(0, Math.ceil(d.pirWarm - since));
    $('mstate').textContent = 'Warming'; $('mstate').className = 'big wait';
    $('mhold').textContent = 'PIR ready in ' + w + ' s'; $('mhold').className = 'holdtxt';
  } else {
    $('mstate').textContent = moving ? 'MOTION!' : 'No motion';
    $('mstate').className = 'big ' + (moving ? 'danger' : 'safe');
    $('mhold').textContent = moving ? 'Motion detected - counting down: ' + left + ' s' : 'Waiting for motion...';
    $('mhold').className = 'holdtxt' + (moving ? '' : ' waiting');
  }
  $('mfill').style.width = (moving ? Math.round(left / total * 100) : 0) + '%';
  const sensor = d.pirNow === undefined ? '' : ' - sensor ' + (d.pirNow ? 'HIGH (sees you)' : 'LOW (ready)');
  $('minfo').textContent = d.pirStuck ? 'PIR stuck HIGH - turn the Tx knob anticlockwise'
    : ((d.lastMotionAgo === undefined || d.lastMotionAgo < 0) ? 'No motion yet'
       : 'Last motion ' + Math.round(d.lastMotionAgo + since) + ' s ago') + sensor;
  $('minfo').className = 'small' + (d.pirStuck ? ' danger' : '');
  $('mcount').textContent = 'Detections: ' + (d.motionCount || 0);

  // Light
  $('bulb').className = 'bulb' + (d.light ? ' on' : '');
  $('lstate').textContent = d.light ? 'ON' : 'OFF';
  $('lstate').className = 'big ' + (d.light ? 'hot' : 'wait');
  $('lmode').textContent = controls.lightMode === 'auto' ? 'Auto: on when motion is detected' : 'Manual: you control the light';
  seg('l', controls.lightMode, 'lightMode');

  // Fan
  $('fanimg').setAttribute('class', 'fan' + (d.fan ? ' on' : ''));
  $('fstate').textContent = d.fan ? 'ON' : 'OFF';
  $('fstate').className = 'big ' + (d.fan ? 'blue' : 'wait');
  $('fmode').textContent = controls.fanMode === 'auto'
    ? 'Auto: ON when the temperature is above 20 °C or when gas is detected - it also helps to blow the gas out'
    : 'Manual: you control the fan - switch it ON when it is hot or when gas is detected to blow the gas out';
  seg('f', controls.fanMode, 'fanMode');
}

// ---------- 5. Users panel (admin only): who has logged in ----------
let usersOpen = false, usersList = {}, usersListening = false;
$('usersBtn').onclick = () => {
  usersOpen = !usersOpen;
  $('usersPanel').style.display = usersOpen ? 'block' : 'none';
  $('usersBtn').classList.toggle('on', usersOpen);
  if (usersOpen && !usersListening) {
    usersListening = true;
    onValue(ref(db, 'users'), snap => { usersList = snap.val() || {}; renderUsers(); },
      err => { $('ulist').innerHTML = ''; $('ucount').textContent = 'Could not load users: ' + err.message; });
  }
};
$('usersClose').onclick = () => $('usersBtn').click();

// Admin: disable or enable a user
function setDisabled(uid, off) {
  const u = usersList[uid] || {};
  if (!confirm((off ? 'Disable ' : 'Enable ') + (u.name || u.email) + '?')) return;
  update(ref(db, 'users/' + uid), { disabled: off, disabledBy: me.displayName || me.email, disabledAt: serverTimestamp() })
    .then(() => { $('ucount').textContent = (u.name || u.email) + (off ? ' is now disabled' : ' is enabled again'); })
    .catch(err => { $('ucount').textContent = 'Not allowed: ' + err.message; });
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' days ago';
}
function renderUsers() {
  const list = Object.entries(usersList).map(([uid, u]) => ({ uid, ...u }))
    .sort((a, b) => (a.disabled === true) - (b.disabled === true) || (b.online === true) - (a.online === true) || (b.lastLogin || 0) - (a.lastLogin || 0));
  const onlineNow = list.filter(u => u.online === true && u.disabled !== true).length;
  const offCount = list.filter(u => u.disabled === true).length;
  $('ucount').textContent = list.length + ' users - ' + onlineNow + ' online now' + (offCount ? ' - ' + offCount + ' disabled' : '');
  const box = $('ulist'); box.innerHTML = '';
  list.forEach(u => {
    const row = document.createElement('div'); row.className = 'urow';
    const dot = document.createElement('span'); dot.className = 'udot' + (u.online === true ? ' on' : ''); row.append(dot);
    const who = document.createElement('div'); who.className = 'uwho';
    const n = document.createElement('b'); n.textContent = (u.name || '-') + (u.uid === me.uid ? ' (you)' : ''); who.append(n);
    const e = document.createElement('div'); e.className = 'small'; e.textContent = u.email || ''; who.append(e);
    row.append(who);
    const tag = document.createElement('span'); tag.className = 'utag';
    tag.textContent = u.role === 'admin' ? 'Admin' : (u.email === 'esp32@smarthome.com' ? 'Device' : 'User'); row.append(tag);
    const when = document.createElement('div'); when.className = 'uwhen';
    when.textContent = u.disabled === true ? 'Disabled' + (u.disabledBy ? ' by ' + u.disabledBy : '')
      : (u.online === true ? 'Online now' : (u.lastLogin ? 'Last login ' + ago(u.lastLogin) : 'Not logged in yet'));
    if (u.disabled === true) when.classList.add('danger'); else if (u.online === true) when.classList.add('safe');
    if (u.lastLogin) when.title = new Date(u.lastLogin).toLocaleString();
    row.append(when);

    // Disable / Enable button - not for me, other admins or the ESP32
    const act = document.createElement('div'); act.className = 'uact';
    const isDevice = u.email === 'esp32@smarthome.com';
    if (u.uid === me.uid || u.role === 'admin' || isDevice) {
      act.textContent = u.uid === me.uid ? '' : 'Protected';
    } else {
      const b = document.createElement('button');
      b.className = 'ubtn ' + (u.disabled === true ? 'ok' : 'bad');
      b.textContent = u.disabled === true ? 'Enable' : 'Disable';
      b.onclick = () => setDisabled(u.uid, u.disabled !== true);
      act.append(b);
    }
    row.append(act);
    if (u.disabled === true) row.classList.add('off');
    box.append(row);
  });
}
setInterval(() => { if (usersOpen) renderUsers(); }, 30000);   // keep "x min ago" fresh

// ---------- 6. Online / offline ----------
// The ESP32 sends a new "uptime" every few seconds; if nothing new for 15 s, it is offline.
setInterval(() => {
  if (Date.now() < alertUntil) return;
  const online = lastSeen && (Date.now() - lastSeen < 15000);
  $('dot').className = 'dot' + (online ? '' : ' off');
  $('status').textContent = online
    ? 'Live - updated ' + new Date(lastSeen).toLocaleTimeString()
    : (lastSeen ? 'ESP32 offline - last data ' + new Date(lastSeen).toLocaleTimeString() : 'Waiting for ESP32...');
}, 1000);

render();
setInterval(render, 500);      // keeps the motion countdown moving between ESP32 updates