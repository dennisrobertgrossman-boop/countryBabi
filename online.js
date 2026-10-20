// Optional online features: Google sign-in, profile, friends invited by email, a leaderboard
// and head-to-head challenges. Backed by Firebase (Authentication + Cloud Firestore).
// Nothing here runs until firebase-config.js holds a project configuration.
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const OWNER_KEY = 'countryle-unlimited:stats-owner'; // uid whose statistics are in local storage
const EMAIL_RE = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;

const App = window.CountryleApp;
const $ = (sel) => document.querySelector(sel);
const esc = (s) => App.esc(String(s ?? ''));

const load = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const save = (key, v) => { try { localStorage.setItem(key, v); } catch { /* ignore */ } };

if (FIREBASE_CONFIG && App) start().catch((err) => console.error('Online features unavailable:', err));

async function start() {
  const [{ initializeApp }, authSdk, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator } = authSdk;
  const {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
    collection, query, where, onSnapshot, serverTimestamp,
  } = fs;

  const { emulator, ...config } = FIREBASE_CONFIG; // `emulator`: host of local Firebase emulators (testing only)
  const firebase = initializeApp(config);
  const auth = getAuth(firebase);
  const db = getFirestore(firebase);
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulator, 8080);
    // automated tests sign in without the Google pop-up; the emulator accepts an unsigned token
    window.emulatorSignIn = (email, name) => signInWithCredential(auth,
      GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name })));
  }

  const dialog = $('#account-dialog');
  const content = $('#account-content');
  const button = $('#account-btn');
  const badge = $('#account-badge');
  const gameUrl = location.origin + location.pathname;

  // ---------- state ----------
  let user = null;            // signed-in Firebase user
  let me = null;              // my profile document (users/{uid})
  let incoming = [];          // invites sent to my email address
  let outgoing = [];          // invites I sent
  let challenges = [];        // challenges I take part in
  const profiles = new Map(); // uid -> friend's profile document
  const profileSubs = new Map();
  let subs = [];
  let tab = 'profile';
  let notice = '';            // HTML message shown at the top of the dialog
  let sort = { key: 'avg', dir: 1 };
  const submitting = new Set();

  button.hidden = false;

  // ---------- helpers ----------
  const myEmail = () => (user && user.email ? user.email.toLowerCase() : '');
  const safePhoto = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);
  const avatar = (p, cls = 'avatar') => {
    const src = safePhoto(p && p.photo);
    const initial = esc(((p && p.name) || '?').trim().charAt(0).toUpperCase() || '?');
    return src ? `<img class="${cls}" src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : `<span class="${cls} initial">${initial}</span>`;
  };
  const opponentOf = (c) => c.members.find((m) => m !== user.uid);
  const nameOf = (uid, fallback) => (profiles.get(uid) && profiles.get(uid).name) || fallback || 'Friend';
  const millis = (t) => (t && t.toMillis ? t.toMillis() : Date.now());

  function flash(html) { notice = html; render(); }
  function report(err) {
    console.error(err);
    flash(esc(err && err.code === 'permission-denied'
      ? 'The server refused this action (permission denied).'
      : `Something went wrong: ${err && err.message ? err.message : err}`));
  }

  function summary(stats) {
    const s = stats || App.emptyStats();
    return {
      played: s.played || 0,
      winPct: s.played ? Math.round(((s.won || 0) / s.played) * 100) : 0,
      avg: s.won ? (s.winGuesses || 0) / s.won : null,
      maxStreak: s.maxStreak || 0,
    };
  }

  function friends() {
    const list = new Map();
    const add = (uid, name, inviteId) => {
      if (!uid) return;
      const f = list.get(uid) || { uid, name, invites: [] };
      f.invites.push(inviteId);
      list.set(uid, f);
    };
    outgoing.filter((i) => i.status === 'accepted').forEach((i) => add(i.toUid, i.toName, i.id));
    incoming.filter((i) => i.status === 'accepted').forEach((i) => add(i.fromUid, i.fromName, i.id));
    return [...list.values()];
  }

  function outcome(c) {
    const opp = opponentOf(c);
    const a = c.results && c.results[user.uid];
    const b = c.results && c.results[opp];
    if (!a) return { state: 'your-turn', b };
    if (!b) return { state: 'waiting', a };
    let result;
    if (a.won !== b.won) result = a.won ? 'win' : 'loss';
    else if (!a.won) result = 'draw';
    else result = a.guesses < b.guesses ? 'win' : a.guesses > b.guesses ? 'loss' : 'draw';
    return { state: 'done', a, b, result };
  }

  function headToHead(uid) {
    const r = { win: 0, loss: 0, draw: 0 };
    challenges.filter((c) => opponentOf(c) === uid).map(outcome).filter((o) => o.state === 'done').forEach((o) => r[o.result]++);
    return r;
  }

  // ---------- auth & data subscriptions ----------
  function unsubscribeAll() {
    subs.forEach((u) => u());
    subs = [];
    profileSubs.forEach((u) => u());
    profileSubs.clear();
    profiles.clear();
    incoming = []; outgoing = []; challenges = [];
  }

  onAuthStateChanged(auth, async (u) => {
    unsubscribeAll();
    user = u;
    me = null;
    notice = '';
    if (!u) {
      // signed out: statistics in this browser belonged to that account, start fresh
      if (load(OWNER_KEY)) { App.setStats(App.emptyStats()); save(OWNER_KEY, ''); }
      render();
      return;
    }
    if (!u.email) { await signOut(auth); flash('This Google account has no email address.'); return; }
    try {
      await loadProfile();
      subscribe();
    } catch (err) { report(err); }
    render();
  });

  async function loadProfile() {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      me = snap.data();
      App.setStats(me.stats);
    } else {
      // first sign-in: keep the guest statistics of this browser, unless they belong to another account
      const owner = load(OWNER_KEY);
      const stats = !owner || owner === user.uid ? App.getStats() : App.emptyStats();
      me = {
        name: (user.displayName || user.email.split('@')[0]).slice(0, 40),
        photo: safePhoto(user.photoURL),
        stats,
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, me);
      App.setStats(stats);
    }
    save(OWNER_KEY, user.uid);
  }

  function subscribe() {
    subs.push(onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (!snap.exists()) return;
      me = snap.data();
      // statistics changed on another device
      if (!snap.metadata.hasPendingWrites) App.setStats(me.stats);
      render();
    }, report));
    subs.push(onSnapshot(query(collection(db, 'invites'), where('toEmail', '==', myEmail())), (s) => {
      incoming = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      watchFriendProfiles();
      render();
    }, report));
    subs.push(onSnapshot(query(collection(db, 'invites'), where('fromUid', '==', user.uid)), (s) => {
      outgoing = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      watchFriendProfiles();
      render();
    }, report));
    subs.push(onSnapshot(query(collection(db, 'challenges'), where('members', 'array-contains', user.uid)), (s) => {
      challenges = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      resubmitFinished();
      render();
    }, report));
  }

  function watchFriendProfiles() {
    const uids = new Set(friends().map((f) => f.uid));
    profileSubs.forEach((unsub, uid) => {
      if (!uids.has(uid)) { unsub(); profileSubs.delete(uid); profiles.delete(uid); }
    });
    uids.forEach((uid) => {
      if (profileSubs.has(uid)) return;
      profileSubs.set(uid, onSnapshot(doc(db, 'users', uid), (snap) => {
        if (snap.exists()) profiles.set(uid, snap.data());
        render();
      }, report));
    });
  }

  // ---------- statistics & challenge results ----------
  App.on('stats', (stats) => {
    if (!user) return;
    updateDoc(doc(db, 'users', user.uid), { stats, updatedAt: serverTimestamp() }).catch(report);
  });

  function submitResult(id, won, guesses) {
    if (!user || submitting.has(id)) return;
    submitting.add(id);
    updateDoc(doc(db, 'challenges', id), { [`results.${user.uid}`]: { guesses, won, at: serverTimestamp() } })
      .catch(report)
      .finally(() => submitting.delete(id));
  }

  App.on('challenge-finished', ({ id, won, guesses }) => submitResult(id, won, guesses));

  // a challenge finished while offline (or before the page closed) is sent when the list loads
  function resubmitFinished() {
    challenges.forEach((c) => {
      if (c.results && c.results[user.uid]) return;
      const p = App.challengeProgress(c.id);
      if (p.status !== 'playing') submitResult(c.id, p.status === 'won', p.guesses.length);
    });
  }

  // ---------- actions ----------
  async function signIn() {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      const messages = {
        'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
        'auth/unauthorized-domain': 'This website address is not on the Firebase project\'s list of authorized domains.',
        'auth/operation-not-allowed': 'Google sign-in is not enabled in the Firebase project.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.',
      };
      flash(esc(messages[err.code] || `Sign-in failed: ${err.message}`));
    }
  }

  const inviteMail = (email) => {
    const subject = `${me.name} invited you to Countryle Unlimited`;
    const body = `Hi!\n\n${me.name} invited you to play Countryle Unlimited, a country-guessing game, and to compete on a leaderboard and in head-to-head challenges.\n\n` +
      `1. Open ${gameUrl}\n2. Click the profile icon (top right) and sign in with Google using this email address: ${email}\n` +
      '3. Accept the invitation under Friends.\n';
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  async function invite(raw) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return flash('Enter a valid email address.');
    if (email === myEmail()) return flash('That is your own email address.');
    if (outgoing.some((i) => i.toEmail === email && i.status === 'accepted')) return flash(`${esc(email)} is already your friend.`);
    if (incoming.some((i) => i.fromEmail === email && i.status === 'pending')) {
      return flash(`${esc(email)} has already invited you. Accept the invitation below.`);
    }
    try {
      await setDoc(doc(db, 'invites', `${user.uid}_${email}`), {
        fromUid: user.uid, fromName: me.name, fromEmail: myEmail(), toEmail: email,
        status: 'pending', createdAt: serverTimestamp(),
      });
      const field = $('#invite-email');
      if (field) field.value = '';
      flash(`Invitation saved. ${esc(email)} will see it after signing in with Google. ` +
        `<a href="${esc(inviteMail(email))}">Send them an email</a> so they know.`);
    } catch (err) { report(err); }
  }

  async function answerInvite(id, accept) {
    try {
      await updateDoc(doc(db, 'invites', id), { status: accept ? 'accepted' : 'declined', toUid: user.uid, toName: me.name });
      notice = '';
    } catch (err) { report(err); }
  }

  async function removeInvites(ids, question) {
    if (question && !confirm(question)) return;
    try { await Promise.all(ids.map((id) => deleteDoc(doc(db, 'invites', id)))); } catch (err) { report(err); }
  }

  async function startChallenge(uid) {
    const f = friends().find((x) => x.uid === uid);
    if (!f) return;
    const opponent = nameOf(uid, f.name);
    const target = App.randomCountryCode();
    try {
      const ref = await addDoc(collection(db, 'challenges'), {
        fromUid: user.uid, fromName: me.name, toUid: uid, toName: opponent.slice(0, 40),
        members: [user.uid, uid], target, createdAt: serverTimestamp(), results: {},
      });
      dialog.close();
      App.playChallenge({ id: ref.id, target, opponent });
    } catch (err) { report(err); }
  }

  function playChallenge(id) {
    const c = challenges.find((x) => x.id === id);
    if (!c) return;
    dialog.close();
    App.playChallenge({ id, target: c.target, opponent: nameOf(opponentOf(c), c.fromUid === user.uid ? c.toName : c.fromName) });
  }

  async function declineChallenge(id) {
    if (!confirm('Decline this challenge? It will be removed for both of you.')) return;
    try { await deleteDoc(doc(db, 'challenges', id)); } catch (err) { report(err); }
  }

  async function saveName(raw) {
    const name = raw.trim().slice(0, 40);
    if (!name) return flash('The name cannot be empty.');
    try { await updateDoc(doc(db, 'users', user.uid), { name, updatedAt: serverTimestamp() }); flash('Name saved.'); } catch (err) { report(err); }
  }

  // ---------- rendering ----------
  function updateButton() {
    const yourTurn = user ? challenges.filter((c) => outcome(c).state === 'your-turn').length : 0;
    const pending = user ? incoming.filter((i) => i.status === 'pending').length : 0;
    const count = yourTurn + pending;
    badge.hidden = !count;
    badge.textContent = count > 9 ? '9+' : String(count);
    button.classList.toggle('signed-in', Boolean(user));
    const img = button.querySelector('img');
    const photo = user && me && safePhoto(me.photo);
    if (photo && !img) button.insertAdjacentHTML('afterbegin', `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`);
    else if (!photo && img) img.remove();
    button.title = user ? 'Profile and friends' : 'Sign in to play with friends';
  }

  function render() {
    updateButton();
    if (!dialog.open) return;
    // keep what the player is typing when live updates redraw the dialog
    const typed = [...content.querySelectorAll('input[id]')].map((el) => [el.id, el.value]);
    const focused = document.activeElement && content.contains(document.activeElement) ? document.activeElement.id : null;
    content.innerHTML = user && me ? signedInHtml() : signedOutHtml();
    typed.forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });
    if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
  }

  const noticeHtml = () => (notice ? `<p class="notice" role="status">${notice}</p>` : '');

  function signedOutHtml() {
    return `<h2>Play with friends</h2>
      ${noticeHtml()}
      <p>Sign in with Google to get a profile and keep your statistics on every device. You can then invite friends by email,
      compare results on a leaderboard and challenge them to head-to-head games: you both get the same hidden country,
      and fewer guesses wins.</p>
      <button class="btn google-btn" type="button" data-action="sign-in">
        <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Sign in with Google
      </button>
      <p class="muted small">Without signing in you can keep playing as a guest; your statistics then stay in this browser only.</p>`;
  }

  function signedInHtml() {
    const yourTurn = challenges.filter((c) => outcome(c).state === 'your-turn').length;
    const pending = incoming.filter((i) => i.status === 'pending').length;
    const tabs = [
      ['profile', 'Profile', 0], ['friends', 'Friends', pending], ['leaderboard', 'Leaderboard', 0], ['challenges', 'Challenges', yourTurn],
    ];
    const panel = { profile: profileHtml, friends: friendsHtml, leaderboard: leaderboardHtml, challenges: challengesHtml }[tab]();
    return `<div class="profile-head">${avatar(me, 'avatar big')}<div><b>${esc(me.name)}</b><div class="muted small">${esc(user.email)}</div></div></div>
      <nav class="tabs" role="tablist">${tabs.map(([key, label, n]) =>
        `<button type="button" role="tab" aria-selected="${tab === key}" data-tab="${key}">${label}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}</nav>
      ${noticeHtml()}
      <div class="panel">${panel}</div>`;
  }

  function profileHtml() {
    const s = summary(me.stats);
    return `<form class="row-form" data-form="name">
        <label for="profile-name">Display name</label>
        <input id="profile-name" maxlength="40" value="${esc(me.name)}">
        <button class="btn" type="submit">Save</button>
      </form>
      <div class="stats-grid">
        <div><b>${s.played}</b><span>Played</span></div>
        <div><b>${s.winPct}</b><span>Win %</span></div>
        <div><b>${s.avg === null ? '–' : s.avg.toFixed(1)}</b><span>Avg. guesses</span></div>
        <div><b>${s.maxStreak}</b><span>Max streak</span></div>
      </div>
      <p class="muted small">Your statistics are saved to your account. Challenge games do not count here; they are scored under Challenges.</p>
      <button class="btn" type="button" data-action="sign-out">Sign out</button>`;
  }

  function friendsHtml() {
    const list = friends();
    const inPending = incoming.filter((i) => i.status === 'pending');
    const outPending = outgoing.filter((i) => i.status !== 'accepted');
    return `<form class="row-form" data-form="invite">
        <label for="invite-email">Invite a friend by email</label>
        <input id="invite-email" type="email" placeholder="friend@example.com" autocomplete="off">
        <button class="btn primary" type="submit">Invite</button>
      </form>
      ${inPending.length ? `<h3>Invitations to you</h3><ul class="people">${inPending.map((i) => `
        <li><span class="who"><b>${esc(i.fromName)}</b><span class="muted small">${esc(i.fromEmail)}</span></span>
          <button class="btn primary small-btn" type="button" data-action="accept" data-id="${esc(i.id)}">Accept</button>
          <button class="btn small-btn" type="button" data-action="decline" data-id="${esc(i.id)}">Decline</button></li>`).join('')}</ul>` : ''}
      <h3>Friends</h3>
      ${list.length ? `<ul class="people">${list.map((f) => `
        <li>${avatar(profiles.get(f.uid) || { name: f.name })}<span class="who"><b>${esc(nameOf(f.uid, f.name))}</b></span>
          <button class="btn primary small-btn" type="button" data-action="challenge" data-uid="${esc(f.uid)}">Challenge</button>
          <button class="btn small-btn" type="button" data-action="unfriend" data-ids="${esc(f.invites.join(' '))}">Remove</button></li>`).join('')}</ul>`
        : '<p class="muted">No friends yet. Invite someone with their email address above.</p>'}
      ${outPending.length ? `<h3>Sent invitations</h3><ul class="people">${outPending.map((i) => `
        <li><span class="who"><b>${esc(i.toEmail)}</b><span class="muted small">${i.status === 'declined' ? 'Declined' : 'Waiting for them to sign in and accept'}</span></span>
          ${i.status === 'pending' ? `<a class="btn small-btn" href="${esc(inviteMail(i.toEmail))}">Email</a>` : ''}
          <button class="btn small-btn" type="button" data-action="cancel" data-id="${esc(i.id)}">${i.status === 'declined' ? 'Remove' : 'Cancel'}</button></li>`).join('')}</ul>` : ''}`;
  }

  function leaderboardHtml() {
    const rows = [{ uid: user.uid, name: me.name, photo: me.photo, stats: me.stats, isMe: true }]
      .concat(friends().map((f) => {
        const p = profiles.get(f.uid);
        return { uid: f.uid, name: nameOf(f.uid, f.name), photo: p && p.photo, stats: p && p.stats, h2h: headToHead(f.uid) };
      }))
      .map((r) => ({ ...r, ...summary(r.stats) }));
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const x = a[key], y = b[key];
      if (x === null && y === null) return a.name.localeCompare(b.name);
      if (x === null) return 1; // players without a win go last when sorting by average
      if (y === null) return -1;
      return (x - y) * dir || a.name.localeCompare(b.name);
    });
    const cols = [['played', 'Played', -1], ['winPct', 'Win %', -1], ['avg', 'Avg. guesses', 1], ['maxStreak', 'Max streak', -1]];
    return `<div class="table-wrap"><table class="board-table">
      <thead><tr><th>#</th><th>Player</th>${cols.map(([k, label, d]) =>
        `<th><button type="button" class="sort${key === k ? ' on' : ''}" data-sort="${k}" data-dir="${d}">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}
        <th title="Your challenge record against this player: wins–losses–draws">You vs them</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.isMe ? 'me' : ''}">
        <td>${i + 1}</td><td class="player">${avatar(r)}<span>${esc(r.name)}${r.isMe ? ' (you)' : ''}</span></td>
        <td>${r.played}</td><td>${r.winPct}</td><td>${r.avg === null ? '–' : r.avg.toFixed(2)}</td><td>${r.maxStreak}</td>
        <td>${r.h2h ? `${r.h2h.win}–${r.h2h.loss}–${r.h2h.draw}` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Avg. guesses counts won games only; lower is better. Click a column to sort.
      ${rows.length === 1 ? 'Invite friends under Friends to fill the leaderboard.' : ''}</p>`;
  }

  function challengesHtml() {
    const list = challenges.map((c) => ({ c, o: outcome(c), opp: nameOf(opponentOf(c), c.fromUid === user.uid ? c.toName : c.fromName) }))
      .sort((a, b) => millis(b.c.createdAt) - millis(a.c.createdAt));
    const turn = list.filter((x) => x.o.state === 'your-turn');
    const waiting = list.filter((x) => x.o.state === 'waiting');
    const done = list.filter((x) => x.o.state === 'done').slice(0, 20);
    const res = (r) => (r.won ? `${r.guesses} ${r.guesses === 1 ? 'guess' : 'guesses'}` : 'gave up');
    const label = { win: 'You won', loss: 'You lost', draw: 'Draw' };
    const section = (title, items, row) => (items.length ? `<h3>${title}</h3><ul class="people">${items.map(row).join('')}</ul>` : '');
    return `<p class="muted small">Challenge a friend from the Friends tab. You both get the same hidden country; the one who finds it in fewer guesses wins.</p>
      ${section('Your turn', turn, ({ c, o, opp }) => `<li><span class="who"><b>vs ${esc(opp)}</b>
        <span class="muted small">${o.b ? `${esc(opp)} has played` : `${esc(opp)} has not played yet`}${App.challengeProgress(c.id).guesses.length ? ' · in progress' : ''}</span></span>
        <button class="btn primary small-btn" type="button" data-action="play" data-id="${esc(c.id)}">Play</button>
        ${c.toUid === user.uid && !App.challengeProgress(c.id).guesses.length ? `<button class="btn small-btn" type="button" data-action="decline-challenge" data-id="${esc(c.id)}">Decline</button>` : ''}</li>`)}
      ${section('Waiting for your friend', waiting, ({ o, opp }) => `<li><span class="who"><b>vs ${esc(opp)}</b>
        <span class="muted small">You: ${res(o.a)} · waiting for ${esc(opp)}</span></span></li>`)}
      ${section('Finished', done, ({ c, o, opp }) => `<li><span class="result-tag ${o.result}">${label[o.result]}</span><span class="who"><b>vs ${esc(opp)}</b>
        <span class="muted small">You: ${res(o.a)} · ${esc(opp)}: ${res(o.b)} · ${App.country(c.target) ? esc(App.country(c.target).name) : ''}</span></span></li>`)}
      ${list.length ? '' : '<p class="muted">No challenges yet.</p>'}`;
  }

  // ---------- events ----------
  button.addEventListener('click', () => { notice = ''; dialog.showModal(); render(); });

  content.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-action],[data-sort]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; notice = ''; render(); return; }
    if (t.dataset.sort) {
      const k = t.dataset.sort;
      sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: +t.dataset.dir };
      render();
      return;
    }
    const { id, uid, ids } = t.dataset;
    switch (t.dataset.action) {
      case 'sign-in': signIn(); break;
      case 'sign-out': signOut(auth).then(() => dialog.close()).catch(report); break;
      case 'accept': answerInvite(id, true); break;
      case 'decline': answerInvite(id, false); break;
      case 'cancel': removeInvites([id]); break;
      case 'unfriend': removeInvites(ids.split(' '), 'Remove this friend? You can invite them again later.'); break;
      case 'challenge': startChallenge(uid); break;
      case 'play': playChallenge(id); break;
      case 'decline-challenge': declineChallenge(id); break;
      default: break;
    }
  });

  content.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.dataset.form === 'invite') invite($('#invite-email').value);
    if (e.target.dataset.form === 'name') saveName($('#profile-name').value);
  });

  render();
}
