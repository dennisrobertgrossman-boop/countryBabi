(() => {
  'use strict';

  const STORE_GAME = 'countryle-unlimited:game';
  const STORE_STATS = 'countryle-unlimited:stats';
  const STORE_BAG = 'countryle-unlimited:bag';
  const STORE_CHALLENGE = 'countryle-unlimited:challenge:'; // + challenge id: progress in a head-to-head game
  const MAX_DIST_BUCKET = 10; // distribution rows 1..9 and "10+"

  const $ = (sel) => document.querySelector(sel);
  const input = $('#guess-input');
  const list = $('#suggestions');
  const message = $('#message');
  const guessesEl = $('#guesses');
  const resultEl = $('#result');

  // ---------- storage helpers (storage can be unavailable) ----------
  const load = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } };

  // ---------- country lookup ----------
  const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  const searchIndex = COUNTRIES.map((c) => {
    const alts = c.alt.map((a) => ({ raw: a, key: normalize(a) })).filter((a) => a.key);
    return { c, name: normalize(c.name), alts };
  });

  const findExact = (text) => {
    const q = normalize(text);
    if (!q) return null;
    const hit = searchIndex.find((e) => e.name === q) || searchIndex.find((e) => e.alts.some((a) => a.key === q));
    return hit ? hit.c : null;
  };

  const suggest = (text) => {
    const q = normalize(text);
    if (!q) return [];
    const scored = [];
    for (const e of searchIndex) {
      let score = -1, via = null;
      const exactAlt = e.alts.find((a) => a.key === q);
      if (exactAlt && e.name !== q) { score = -0.5; via = exactAlt.raw; } // abbreviation typed in full, e.g. "uk"
      else if (e.name.startsWith(q)) score = 0;
      else if (e.name.split(' ').some((w) => w.startsWith(q))) score = 1;
      else if (q.length >= 3) {
        const a = e.alts.find((a) => a.key.startsWith(q) || a.key.split(' ').some((w) => w.startsWith(q)));
        if (a) { score = 2; via = a.raw; }
      }
      if (score !== -1) scored.push({ c: e.c, score, via });
    }
    scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
    // every country whose name starts with the input is listed; for a single letter that is all,
    // otherwise up to 8 looser matches follow (a later word, e.g. "korea", or from 3 letters an
    // alternative name, e.g. "usa")
    const starts = scored.filter((m) => m.score <= 0);
    return q.length === 1 ? starts : starts.concat(scored.filter((m) => m.score > 0).slice(0, 8));
  };

  // ---------- geography ----------
  const toRad = (d) => (d * Math.PI) / 180;
  const distanceKm = (a, b) => {
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  const bearing = (a, b) => {
    const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const hemisphere = (c) => (c.lat >= 0 ? 'Northern' : 'Southern');

  // ---------- grading ----------
  const grade = (guess, target) => {
    const same = guess.code === target.code;
    const ratio = guess.population / target.population;
    // compare temperatures as displayed (one decimal) so the colour matches what the player sees
    const tDiff = Math.round((target.temperature - guess.temperature) * 10) / 10;
    const dist = distanceKm(guess, target);
    return {
      continent: guess.continent === target.continent ? 'green' : 'red',
      hemisphere: hemisphere(guess) === hemisphere(target) ? 'green' : 'red',
      population: {
        color: same || Math.abs(ratio - 1) <= 0.1 ? 'green' : ratio >= 0.5 && ratio <= 2 ? 'yellow' : 'red',
        dir: same ? 0 : Math.sign(target.population - guess.population),
      },
      temperature: {
        color: Math.abs(tDiff) <= 1 ? 'green' : Math.abs(tDiff) <= 5 ? 'yellow' : 'red',
        dir: same ? 0 : Math.sign(tDiff),
      },
      coordinates: {
        color: same ? 'green' : dist < 1500 ? 'yellow' : 'red',
        bearing: same ? null : bearing(guess, target),
      },
    };
  };

  // ---------- formatting ----------
  const fmtPop = (n) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n);
  };
  const arrow = (dir) => (dir > 0 ? '▲' : dir < 0 ? '▼' : '');
  const flagImg = (c, cls = 'flag') => `<img class="${cls}" src="flags/${c.code}.svg" alt="" loading="lazy">`;
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const compassSvg = (deg) =>
    `<svg class="compass" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${deg}deg)">` +
    `<path fill="currentColor" d="M12 2l6 9h-4v11h-4V11H6z"/></svg>`;

  // ---------- state ----------
  const emptyStats = () => ({ played: 0, won: 0, streak: 0, maxStreak: 0, dist: {}, winGuesses: 0 });
  function normalizeStats(s) {
    const n = Object.assign(emptyStats(), s || {});
    n.dist = Object.assign({}, n.dist);
    // winGuesses (total guesses over all wins) was added later; estimate it from the distribution
    if (!Number.isFinite(n.winGuesses)) n.winGuesses = Object.entries(n.dist).reduce((t, [k, v]) => t + k * v, 0);
    return n;
  }

  let stats = normalizeStats(load(STORE_STATS, null));
  let freeGame = load(STORE_GAME, null);
  if (!freeGame || !byCode.has(freeGame.target)) freeGame = newGame();
  else freeGame.guesses = freeGame.guesses.filter((code) => byCode.has(code));
  // `game` is what is on screen: the free-play game, or a challenge ({ challengeId, opponent, ... })
  let game = freeGame;

  const listeners = {};
  const on = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
  const emit = (event, data) => (listeners[event] || []).forEach((fn) => fn(data));

  function saveGame() {
    if (game.challengeId) save(STORE_CHALLENGE + game.challengeId, { guesses: game.guesses, status: game.status });
    else save(STORE_GAME, game);
  }

  function nextTarget() {
    // Shuffle bag: every country comes up once before any repeats.
    let bag = load(STORE_BAG, []).filter((code) => byCode.has(code));
    if (!bag.length) {
      bag = COUNTRIES.map((c) => c.code);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    const code = bag.pop();
    save(STORE_BAG, bag);
    return code;
  }

  function newGame() {
    const g = { target: nextTarget(), guesses: [], status: 'playing' };
    save(STORE_GAME, g);
    return g;
  }

  // ---------- rendering ----------
  function rowHtml(guess, target) {
    const g = grade(guess, target);
    const coord = g.coordinates.bearing === null
      ? '<span class="arrow">✔</span><small>Found</small>'
      : `${compassSvg(g.coordinates.bearing)}<small>${COMPASS[Math.round(g.coordinates.bearing / 45) % 8]}</small>`;
    return `<div class="row">
      <div class="name">${flagImg(guess)}<span>${esc(guess.name)}</span></div>
      <div class="tile ${g.continent}" data-label="Continent">${guess.continent}</div>
      <div class="tile ${g.hemisphere}" data-label="Hemisphere">${hemisphere(guess)}</div>
      <div class="tile ${g.population.color}" data-label="Population">${fmtPop(guess.population)}<span class="arrow">${arrow(g.population.dir)}</span></div>
      <div class="tile ${g.temperature.color}" data-label="Avg. temp.">${guess.temperature.toFixed(1)} °C<span class="arrow">${arrow(g.temperature.dir)}</span></div>
      <div class="tile ${g.coordinates.color}" data-label="Coordinates">${coord}</div>
    </div>`;
  }

  function render() {
    const target = byCode.get(game.target);
    guessesEl.innerHTML = game.guesses.map((code) => rowHtml(byCode.get(code), target)).join('');
    $('#guess-count').textContent = `Guesses: ${game.guesses.length}`;

    const over = game.status !== 'playing';
    const inChallenge = Boolean(game.challengeId);
    input.disabled = over;
    $('#guess-btn').disabled = over;
    $('#giveup-btn').hidden = over;
    $('#new-btn').hidden = inChallenge;
    const banner = $('#mode-banner');
    banner.hidden = !inChallenge;
    if (inChallenge) {
      banner.innerHTML = `<span>Challenge vs <b>${esc(game.opponent)}</b></span>` +
        '<button class="link-btn" id="leave-challenge" type="button">Back to free play</button>';
      $('#leave-challenge').addEventListener('click', exitChallenge);
    }
    resultEl.hidden = !over;
    if (over) {
      const won = game.status === 'won';
      const n = game.guesses.length;
      const solved = `Solved in ${n} ${n === 1 ? 'guess' : 'guesses'}.`;
      resultEl.innerHTML = `
        <h2>${won ? 'You got it!' : 'Better luck next time'}</h2>
        <div>${won ? solved : 'The country was:'}</div>
        <div class="answer">${flagImg(target)}<span>${esc(target.name)}</span></div>
        ${inChallenge ? `<p class="muted">Your result was sent to ${esc(game.opponent)}. Open <b>Challenges</b> in your profile to see who won.</p>` : ''}
        <button class="btn primary" id="play-again" type="button">${inChallenge ? 'Back to free play' : 'Play again'}</button>`;
      $('#play-again').addEventListener('click', inChallenge ? exitChallenge : startNew);
    }
  }

  function renderStats() {
    const pct = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
    $('#stats-grid').innerHTML = [
      [stats.played, 'Played'], [pct, 'Win %'], [stats.streak, 'Current streak'], [stats.maxStreak, 'Max streak'],
    ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

    const counts = Array.from({ length: MAX_DIST_BUCKET }, (_, i) => stats.dist[i + 1] || 0);
    const max = Math.max(1, ...counts);
    const current = freeGame.status === 'won' ? Math.min(freeGame.guesses.length, MAX_DIST_BUCKET) : 0;
    $('#distribution').innerHTML = counts.map((n, i) =>
      `<div class="dist-row"><span class="lbl">${i + 1 === MAX_DIST_BUCKET ? MAX_DIST_BUCKET + '+' : i + 1}</span>` +
      `<span class="bar${current === i + 1 ? ' current' : ''}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</span></div>`
    ).join('');
  }

  // ---------- game actions ----------
  function finish(status) {
    game.status = status;
    saveGame();
    if (game.challengeId) {
      // head-to-head games are scored in the challenge, not in the personal statistics
      emit('challenge-finished', { id: game.challengeId, won: status === 'won', guesses: game.guesses.length });
      return;
    }
    stats.played++;
    if (status === 'won') {
      stats.won++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      const b = Math.min(game.guesses.length, MAX_DIST_BUCKET);
      stats.dist[b] = (stats.dist[b] || 0) + 1;
      stats.winGuesses += game.guesses.length;
    } else {
      stats.streak = 0;
    }
    save(STORE_STATS, stats);
    emit('stats', stats);
  }

  function submitGuess(country) {
    message.textContent = '';
    if (game.status !== 'playing') return;
    if (!country) { message.textContent = 'Not a country on the list. Pick one from the suggestions.'; return; }
    if (game.guesses.includes(country.code)) { message.textContent = `You already guessed ${country.name}.`; return; }
    game.guesses.push(country.code);
    if (country.code === game.target) finish('won');
    else saveGame();
    input.value = '';
    closeList();
    render();
    // newest guess is the last row; keep it in view
    if (guessesEl.lastElementChild) guessesEl.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (game.status === 'won' && !game.challengeId) setTimeout(() => { renderStats(); $('#stats-dialog').showModal(); }, 600);
  }

  function startNew() {
    game = freeGame = newGame();
    message.textContent = '';
    input.value = '';
    render();
    input.focus();
  }

  // ---------- challenges (head-to-head games against a friend) ----------
  const challengeProgress = (id) => load(STORE_CHALLENGE + id, { guesses: [], status: 'playing' });

  function playChallenge({ id, target, opponent }) {
    if (!byCode.has(target)) return;
    const p = challengeProgress(id);
    game = { challengeId: id, opponent, target, guesses: p.guesses.filter((code) => byCode.has(code)), status: p.status };
    message.textContent = '';
    input.value = '';
    closeList();
    render();
    window.scrollTo({ top: 0 });
    if (game.status === 'playing') input.focus();
  }

  function exitChallenge() {
    game = freeGame;
    message.textContent = '';
    render();
    if (game.status === 'playing') input.focus();
  }

  // ---------- autocomplete ----------
  let items = [];
  let active = -1;

  function openList(text) {
    items = suggest(text);
    active = items.length ? 0 : -1;
    if (!items.length) return closeList();
    list.innerHTML = items.map(({ c, via }, i) =>
      `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === active}" class="${game.guesses.includes(c.code) ? 'used' : ''}">` +
      `${flagImg(c)}<span>${esc(c.name)}</span>${via ? `<small>${esc(via)}</small>` : ''}</li>`
    ).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', 'opt-0');
  }

  function closeList() {
    list.hidden = true;
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i) {
    active = (i + items.length) % items.length;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === active)));
    list.children[active].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `opt-${active}`);
  }

  input.addEventListener('input', () => { message.textContent = ''; openList(input.value); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Escape') closeList();
  });
  input.addEventListener('blur', () => setTimeout(closeList, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); submitGuess(items[+li.dataset.i].c); }
  });

  $('#guess-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const shown = active >= 0 && items[active] ? items[active] : null;
    const top = suggest(input.value)[0];
    const pick = shown ? shown.c : findExact(input.value) || (top ? top.c : null);
    submitGuess(pick);
  });

  // ---------- buttons & dialogs ----------
  $('#new-btn').addEventListener('click', () => {
    if (game.status === 'playing' && game.guesses.length && !confirm('Start a new game? The current game will be abandoned (not counted).')) return;
    startNew();
  });
  $('#giveup-btn').addEventListener('click', () => {
    if (game.status !== 'playing' || !confirm('Give up and reveal the country? This counts as a loss.')) return;
    finish('lost');
    render();
  });
  $('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
  $('#stats-btn').addEventListener('click', () => { renderStats(); $('#stats-dialog').showModal(); });
  $('#reset-stats').addEventListener('click', () => {
    if (!confirm('Reset all statistics?')) return;
    stats = emptyStats();
    save(STORE_STATS, stats);
    renderStats();
    emit('stats', stats);
  });
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      const r = d.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if ((e.target === d && outside) || e.target.closest('[data-close]')) d.close();
    });
  });

  // ---------- interface for the optional online features (online.js) ----------
  window.CountryleApp = {
    on,
    esc,
    flagImg,
    country: (code) => byCode.get(code),
    randomCountryCode: () => COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)].code,
    getStats: () => stats,
    setStats(s) {
      stats = normalizeStats(s);
      save(STORE_STATS, stats);
      if ($('#stats-dialog').open) renderStats();
    },
    emptyStats,
    playChallenge,
    challengeProgress,
    currentChallengeId: () => game.challengeId || null,
  };

  render();
  if (!load('countryle-unlimited:seen-help', false)) {
    save('countryle-unlimited:seen-help', true);
    $('#help-dialog').showModal();
  } else if (game.status === 'playing') {
    input.focus();
  }
})();
