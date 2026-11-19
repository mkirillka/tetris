/**
 * Тетрис: логика и отрисовка.
 *
 * Скрипт классический (не модуль), чтобы игра запускалась прямо из файла:
 * браузеры блокируют ES-модули на `file://`. Наружу отдаётся единственное
 * имя — `Tetris.createTetris`.
 *
 * Всё остальное берётся из переданного корневого элемента: разметка, canvas,
 * размеры окна. Точки внедрения (clock, scheduleFrame, random) нужны для
 * встраивания и автотестов, по умолчанию используются браузерные.
 *
 * @param {HTMLElement} root  элемент с разметкой игры (см. index.html)
 * @param {object} [options]
 * @param {{now: () => number}} [options.clock]             источник времени, мс
 * @param {(cb: (t: number) => void) => void} [options.scheduleFrame]  планировщик кадров
 * @param {() => number} [options.random]                   генератор [0, 1)
 * @returns {{start: Function, togglePause: Function, getState: Function, destroy: Function}}
 */
(function initTetris(global) {
  'use strict';

  function createTetris(root, options = {}) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    const $ = (id) => root.querySelector('#' + id);
    const clock = options.clock ?? { now: () => win.performance.now() };
    const scheduleFrame = options.scheduleFrame ?? ((cb) => win.requestAnimationFrame(cb));
    const random = options.random ?? Math.random;

    /* ────────────────────────── Правила ────────────────────────── */
    const COLS = 10;
    const ROWS = 20;
    const CELL = 30;                 // внутренний размер клетки, px
    const LOCK_DELAY = 500;          // мс до фиксации на земле
    const MAX_LOCK_RESETS = 15;      // ограничение «кручения» на земле
    const DAS = 160;                 // задержка автоповтора движения, мс
    const ARR = 38;                  // шаг автоповтора, мс
    const CLEAR_ANIM = 170;          // длительность анимации очистки, мс
    const NEXT_COUNT = 3;
    const MAX_LEVEL = 20;

    const COLORS = {
      I: ['#67e8f9', '#22d3ee'],
      J: ['#93b4ff', '#3b82f6'],
      L: ['#fcd34d', '#f59e0b'],
      O: ['#fde68a', '#facc15'],
      S: ['#86efac', '#22c55e'],
      T: ['#d8b4fe', '#a855f7'],
      Z: ['#fca5a5', '#ef4444'],
    };

    const BASE = {
      I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
      J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
      L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
      O: [[1, 1], [1, 1]],
      S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
      T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
      Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    };

    const rotateCW = (m) => {
      const n = m.length;
      const out = Array.from({ length: n }, () => Array(n).fill(0));
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y][x] = m[n - 1 - x][y];
      return out;
    };

    // ROT[type][0..3] — четыре состояния фигуры; O при вращении не меняется
    const ROT = {};
    for (const type of Object.keys(BASE)) {
      ROT[type] = [BASE[type]];
      for (let i = 1; i < 4; i++) {
        ROT[type].push(type === 'O' ? BASE[type] : rotateCW(ROT[type][i - 1]));
      }
    }

    // Таблицы wall-kick. Значения (x, y), где +y — вверх, как в SRS;
    // на экране Y растёт вниз, поэтому при применении инвертируем.
    const KICK_JLSTZ = {
      '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    };
    const KICK_I = {
      '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
      '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    };

    /* ────────────────────────── Элементы и canvas ────────────────────────── */
    const boardEl = $('board');
    const nextEl = $('next');
    const holdEl = $('hold');
    const overlayEl = $('overlay');
    const ovTitleEl = $('ovTitle');
    const ovSubEl = $('ovSub');
    const ovBtnEl = $('ovBtn');
    const scoreEl = $('score');
    const linesEl = $('lines');
    const levelEl = $('level');
    const bestEl = $('best');
    const comboEl = $('combo');
    const ovInstallEl = $('ovInstall');
    const ovHintEl = $('ovHint');
    const stageEl = boardEl.parentElement;
    const appEl = root.querySelector('.app');

    const ctx = boardEl.getContext('2d');
    const nextCtx = nextEl.getContext('2d');
    const holdCtx = holdEl.getContext('2d');

    const BOARD_W = COLS * CELL;
    const BOARD_H = ROWS * CELL;
    const NEXT_W = 112;
    const NEXT_H = NEXT_COUNT * 62 + 12;
    // На телефоне панель NEXT показывает две фигуры: верхняя полоса ниже,
    // полю достаётся больше высоты.
    let nextSlots = NEXT_COUNT;
    let nextHeight = NEXT_H;
    const HOLD_W = 112;
    const HOLD_H = 74;

    // canvas поля масштабируется из JS (fitBoard), панели HOLD/NEXT — силами CSS,
    // поэтому им инлайновый размер не ставим: иначе они не ужмутся на телефоне.
    function setupCanvas(canvas, context, width, height, fixedCssSize = false) {
      const dpr = win.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      if (fixedCssSize) {
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setupCanvas(boardEl, ctx, BOARD_W, BOARD_H, true);
    setupCanvas(nextEl, nextCtx, NEXT_W, NEXT_H);
    setupCanvas(holdEl, holdCtx, HOLD_W, HOLD_H);

    /* ────────────────────────── Звук ────────────────────────── */
    let audioCtx = null;
    let muted = false;

    function beep(freq, dur, type = 'square', vol = 0.035) {
      if (muted) return;
      try {
        audioCtx ??= new (win.AudioContext || win.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur);
      } catch {
        /* звук не критичен: без него игра работает */
      }
    }

    const SND = {
      move: () => beep(220, 0.03, 'square', 0.02),
      rotate: () => beep(420, 0.04, 'triangle', 0.025),
      lock: () => beep(140, 0.06, 'sine', 0.03),
      drop: () => beep(90, 0.09, 'sawtooth', 0.03),
      hold: () => beep(520, 0.05, 'triangle', 0.025),
      clear: (n) => {
        for (let i = 0; i < n; i++) setTimeout(() => beep(520 + i * 140, 0.09, 'triangle', 0.035), i * 55);
      },
      level: () => [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 0.11, 'triangle', 0.035), i * 80)),
      over: () => [330, 262, 196, 147].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'sawtooth', 0.04), i * 140)),
    };

    /* ────────────────────────── Хранилище рекорда ────────────────────────── */
    const storage = {
      read(key) {
        try { return win.localStorage.getItem(key); } catch { return null; }
      },
      write(key, value) {
        try { win.localStorage.setItem(key, value); } catch { /* приватный режим */ }
      },
    };

    /* ────────────────────────── Состояние ────────────────────────── */
    const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

    let board = emptyBoard();
    let piece = null;                // { type, rotation, matrix, x, y }
    let holdType = null;
    let holdUsed = false;
    let bag = [];
    let queue = [];
    let score = 0;
    let lines = 0;
    let level = 1;
    let combo = -1;
    let best = Number(storage.read('tetris.best') || 0);
    let phase = 'ready';             // ready | playing | paused | clearing | over
    let dropAcc = 0;
    let lockTimer = 0;
    let lockResets = 0;
    let clearTimer = 0;
    let clearingRows = [];
    let lastActionWasRotation = false;
    let moveDir = 0;
    let dasTime = 0;
    let arrTime = 0;
    const pressed = { left: false, right: false, down: false };
    let shakeUntil = 0;
    let comboTimer = 0;
    const fitTimers = [];
    let alive = true;
    let lastFrame = clock.now();

    const listeners = new AbortController();
    const listen = (target, type, handler, extra) =>
      target.addEventListener(type, handler, { ...extra, signal: listeners.signal });

    /* ────────────────────────── Очередь фигур ────────────────────────── */
    function refillBag() {
      const types = Object.keys(BASE);
      for (let i = types.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [types[i], types[j]] = [types[j], types[i]];
      }
      bag.push(...types);                        // 7-bag: каждая фигура раз в семёрке
    }

    function nextType() {
      if (bag.length === 0) refillBag();
      return bag.shift();
    }

    // В очереди ровно столько фигур, сколько показано в панели NEXT
    function fillQueue() {
      while (queue.length < NEXT_COUNT) queue.push(nextType());
    }

    /* ────────────────────────── Механика ────────────────────────── */
    const spawnX = (type) => (type === 'O' ? 4 : 3);   // O — колонки 4..5, остальные 3..5

    function collide(matrix, px, py) {
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (!matrix[r][c]) continue;
          const x = px + c;
          const y = py + r;
          if (x < 0 || x >= COLS || y >= ROWS) return true;
          if (y >= 0 && board[y][x]) return true;
        }
      }
      return false;
    }

    function spawn(type = null) {
      fillQueue();
      const nextTypeToSpawn = type ?? queue.shift();
      fillQueue();
      // y = -1 у 3x3 и I: верхний ряд матрицы пустой. O должен целиком лежать в поле.
      piece = {
        type: nextTypeToSpawn,
        rotation: 0,
        matrix: ROT[nextTypeToSpawn][0],
        x: spawnX(nextTypeToSpawn),
        y: nextTypeToSpawn === 'O' ? 0 : -1,
      };
      dropAcc = 0;
      lockTimer = 0;
      lockResets = 0;
      lastActionWasRotation = false;
      drawSidePanels();
      if (collide(piece.matrix, piece.x, piece.y)) gameOver();
    }

    function resetLockOnAction() {
      if (lockResets < MAX_LOCK_RESETS) {
        lockTimer = 0;
        lockResets++;
      }
    }

    function tryMove(dx, dy) {
      if (!piece) return false;
      if (collide(piece.matrix, piece.x + dx, piece.y + dy)) return false;
      piece.x += dx;
      piece.y += dy;
      lastActionWasRotation = false;
      if (dx !== 0) resetLockOnAction();
      return true;
    }

    function rotate(dir) {
      if (!piece) return;
      if (piece.type === 'O') {
        SND.rotate();
        return;
      }
      const from = piece.rotation;
      const to = (from + (dir > 0 ? 1 : 3)) % 4;
      const matrix = ROT[piece.type][to];
      const kicks = (piece.type === 'I' ? KICK_I : KICK_JLSTZ)[`${from}${to}`] ?? [[0, 0]];
      for (const [kx, ky] of kicks) {
        const nx = piece.x + kx;
        const ny = piece.y - ky;                 // инверсия Y
        if (!collide(matrix, nx, ny)) {
          piece.matrix = matrix;
          piece.rotation = to;
          piece.x = nx;
          piece.y = ny;
          lastActionWasRotation = true;
          resetLockOnAction();
          SND.rotate();
          return;
        }
      }
    }

    function ghostY() {
      if (!piece) return 0;
      let y = piece.y;
      while (!collide(piece.matrix, piece.x, y + 1)) y++;
      return y;
    }

    function hardDrop() {
      if (!piece || phase !== 'playing') return;
      const target = ghostY();
      score += Math.max(0, target - piece.y) * 2;
      piece.y = target;
      SND.drop();
      shake(120);
      lock();
      updateHud();
    }

    function holdPiece() {
      if (!piece || phase !== 'playing' || holdUsed) return;
      const current = piece.type;
      if (holdType === null) {
        holdType = current;
        spawn();
      } else {
        const fromHold = holdType;
        holdType = current;
        spawn(fromHold);
      }
      holdUsed = true;
      SND.hold();
      drawSidePanels();
    }

    function isTSpin() {
      if (!piece || piece.type !== 'T' || !lastActionWasRotation) return false;
      const corners = [
        [piece.x, piece.y],
        [piece.x + 2, piece.y],
        [piece.x, piece.y + 2],
        [piece.x + 2, piece.y + 2],
      ];
      let occupied = 0;
      for (const [x, y] of corners) {
        if (x < 0 || x >= COLS || y >= ROWS) { occupied++; continue; }
        if (y >= 0 && board[y][x]) occupied++;
      }
      return occupied >= 3;
    }

    function lock() {
      if (!piece) return;
      const tspin = isTSpin();
      let lockedAboveField = true;

      for (let r = 0; r < piece.matrix.length; r++) {
        for (let c = 0; c < piece.matrix[r].length; c++) {
          if (!piece.matrix[r][c]) continue;
          const x = piece.x + c;
          const y = piece.y + r;
          if (y >= 0) {
            board[y][x] = piece.type;
            lockedAboveField = false;
          }
        }
      }

      if (lockedAboveField) {                    // lock-out: фигура не влезла в поле
        gameOver();
        return;
      }

      SND.lock();
      clearingRows = [];
      for (let y = 0; y < ROWS; y++) if (board[y].every(Boolean)) clearingRows.push(y);

      piece = null;
      holdUsed = false;

      if (clearingRows.length) {
        phase = 'clearing';
        clearTimer = CLEAR_ANIM;
        shake(80 + clearingRows.length * 40);
        applyScore(clearingRows.length, tspin);
        SND.clear(clearingRows.length);
        showCombo(clearingRows.length);
      } else {
        combo = -1;
        spawn();
      }
      updateHud();
      drawSidePanels();
    }

    function applyScore(clearedRows, tspin) {
      const points = tspin
        ? { 1: 800, 2: 1200, 3: 1600 }[clearedRows] ?? 0
        : { 1: 100, 2: 300, 3: 500, 4: 800 }[clearedRows] ?? 0;
      score += points * level;

      combo++;
      if (combo > 0) score += 50 * combo * level;

      const previousLevel = level;
      lines += clearedRows;
      level = Math.min(MAX_LEVEL, 1 + Math.floor(lines / 10));
      if (level !== previousLevel) SND.level();
      updateHud();
    }

    function finishClear() {
      board = board.filter((_, y) => !clearingRows.includes(y));
      while (board.length < ROWS) board.unshift(Array(COLS).fill(null));
      clearingRows = [];
      phase = 'playing';
      spawn();
    }

    /* ────────────────────────── Интерфейс и оверлеи ────────────────────────── */
    function updateHud() {
      scoreEl.textContent = score.toLocaleString('ru-RU');
      linesEl.textContent = lines;
      levelEl.textContent = level;
      if (score > best) {
        best = score;
        storage.write('tetris.best', String(best));
      }
      bestEl.textContent = best.toLocaleString('ru-RU');
    }

    function showCombo(clearedRows) {
      if (clearedRows < 2 && combo < 1) return;
      const label = clearedRows === 4 ? 'TETRIS!' : { 3: 'TRIPLE', 2: 'DOUBLE' }[clearedRows] ?? 'CLEAR';
      comboEl.textContent = combo > 1 ? `${label} ×${combo + 1}` : label;
      comboEl.classList.add('show');
      clearTimeout(comboTimer);
      comboTimer = setTimeout(() => comboEl.classList.remove('show'), 620);
    }

    function setOverlay(title, subHtml, buttonLabel) {
      ovTitleEl.textContent = title;
      ovSubEl.innerHTML = subHtml;
      ovBtnEl.textContent = buttonLabel;
      overlayEl.classList.remove('hide');
    }

    const hideOverlay = () => overlayEl.classList.add('hide');

    function shake(durationMs) {
      shakeUntil = clock.now() + durationMs;
    }

    /* ────────────────────────── Игровой цикл ────────────────────────── */
    function gravityInterval() {
      // Классическая кривая скорости: (0.8 − 0.007·(L−1))^(L−1) секунд на клетку
      const lvl = Math.min(level, MAX_LEVEL);
      return Math.max(16, Math.pow(0.8 - (lvl - 1) * 0.007, lvl - 1) * 1000);
    }

    const softInterval = () => Math.max(18, gravityInterval() / 20);

    function update(dt, now) {
      boardEl.classList.toggle('shake', now < shakeUntil);

      if (phase === 'clearing') {
        clearTimer -= dt;
        if (clearTimer <= 0) finishClear();
        return;
      }
      if (phase !== 'playing' || !piece) return;

      // автоповтор влево/вправо
      if (moveDir !== 0) {
        dasTime -= dt;
        if (dasTime <= 0) {
          arrTime -= dt;
          while (arrTime <= 0) {
            if (!tryMove(moveDir, 0)) { arrTime = ARR; break; }
            arrTime += ARR;
          }
        }
      }

      // гравитация и мягкий сброс
      const interval = pressed.down ? softInterval() : gravityInterval();
      dropAcc += dt;
      let softPoints = 0;
      while (dropAcc >= interval) {
        dropAcc -= interval;
        if (collide(piece.matrix, piece.x, piece.y + 1)) { dropAcc = 0; break; }
        piece.y++;
        lastActionWasRotation = false;
        if (pressed.down) softPoints++;
      }
      if (softPoints) {
        score += softPoints;
        updateHud();
      }

      // фиксация с задержкой
      if (collide(piece.matrix, piece.x, piece.y + 1)) {
        lockTimer += dt;
        if (lockTimer >= LOCK_DELAY) lock();
      } else {
        lockTimer = 0;
      }
    }

    function frame(now) {
      if (!alive) return;
      const dt = Math.min(100, now - lastFrame);
      lastFrame = now;
      update(dt, now);
      drawBoard(now);
      scheduleFrame(frame);
    }

    /* ────────────────────────── Отрисовка ────────────────────────── */
    function roundRect(context, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      context.beginPath();
      context.moveTo(x + radius, y);
      context.arcTo(x + w, y, x + w, y + h, radius);
      context.arcTo(x + w, y + h, x, y + h, radius);
      context.arcTo(x, y + h, x, y, radius);
      context.arcTo(x, y, x + w, y, radius);
      context.closePath();
    }

    function drawCell(context, x, y, size, type, opts = {}) {
      const [from, to] = COLORS[type];
      const pad = Math.max(1, size * 0.055);
      const inner = size - pad * 2;
      const alpha = opts.alpha ?? 1;

      if (opts.ghost) {
        context.save();
        context.globalAlpha = 0.32;
        context.strokeStyle = from;
        context.lineWidth = Math.max(1.5, size * 0.07);
        roundRect(context, x + pad, y + pad, inner, inner, size * 0.16);
        context.stroke();
        context.restore();
        return;
      }

      const gradient = context.createLinearGradient(x, y, x + size, y + size);
      gradient.addColorStop(0, from);
      gradient.addColorStop(1, to);

      context.save();
      context.globalAlpha = alpha;
      if (opts.glow) {
        context.shadowColor = to;
        context.shadowBlur = size * (opts.flash ? 0.9 : 0.35);
      }
      context.fillStyle = opts.flash ? '#ffffff' : gradient;
      roundRect(context, x + pad, y + pad, inner, inner, size * 0.16);
      context.fill();
      context.shadowBlur = 0;

      if (!opts.flash) {                          // блик сверху
        context.globalAlpha = alpha * 0.35;
        context.fillStyle = 'rgba(255,255,255,.85)';
        roundRect(context, x + pad * 2, y + pad * 2, inner - pad * 2, Math.max(2, inner * 0.22), size * 0.12);
        context.fill();
      }
      context.restore();
    }

    function drawBoard(now) {
      ctx.clearRect(0, 0, BOARD_W, BOARD_H);

      const background = ctx.createLinearGradient(0, 0, 0, BOARD_H);
      background.addColorStop(0, '#0c0c16');
      background.addColorStop(1, '#07070e');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);

      ctx.strokeStyle = 'rgba(255,255,255,.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) {
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, BOARD_H);
      }
      for (let y = 1; y < ROWS; y++) {
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(BOARD_W, y * CELL + 0.5);
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(124,92,255,.05)';
      ctx.fillRect(0, BOARD_H - 2, BOARD_W, 2);

      const flashing = phase === 'clearing';
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const type = board[y][x];
          if (!type) continue;
          const isFlashing = flashing && clearingRows.includes(y);
          drawCell(ctx, x * CELL, y * CELL, CELL, type, { flash: isFlashing, glow: !isFlashing });
        }
      }

      if (!piece) return;

      const shadowY = ghostY();
      if (shadowY !== piece.y) {
        for (let r = 0; r < piece.matrix.length; r++) {
          for (let c = 0; c < piece.matrix[r].length; c++) {
            if (!piece.matrix[r][c]) continue;
            const y = shadowY + r;
            if (y < 0) continue;
            drawCell(ctx, (piece.x + c) * CELL, y * CELL, CELL, piece.type, { ghost: true });
          }
        }
      }

      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
      const grounded = collide(piece.matrix, piece.x, piece.y + 1);
      for (let r = 0; r < piece.matrix.length; r++) {
        for (let c = 0; c < piece.matrix[r].length; c++) {
          if (!piece.matrix[r][c]) continue;
          const y = piece.y + r;
          if (y < 0) continue;
          drawCell(ctx, (piece.x + c) * CELL, y * CELL, CELL, piece.type, {
            glow: true,
            alpha: grounded ? 0.85 + pulse * 0.15 : 1,
          });
        }
      }
    }

    function drawMini(context, matrix, type, centerX, centerY, cell) {
      let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (!matrix[r][c]) continue;
          minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r);
          minCol = Math.min(minCol, c); maxCol = Math.max(maxCol, c);
        }
      }
      if (maxRow < 0) return;

      const width = (maxCol - minCol + 1) * cell;
      const height = (maxRow - minRow + 1) * cell;
      const originX = centerX - width / 2 - minCol * cell;
      const originY = centerY - height / 2 - minRow * cell;
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          if (matrix[r][c]) drawCell(context, originX + c * cell, originY + r * cell, cell, type, { glow: true });
        }
      }
    }

    function drawSidePanels() {
      nextCtx.clearRect(0, 0, NEXT_W, nextHeight);
      for (let i = 0; i < nextSlots; i++) {
        const type = queue[i];
        if (!type) continue;
        nextCtx.globalAlpha = i === 0 ? 1 : 0.6 - i * 0.12;
        drawMini(nextCtx, BASE[type], type, NEXT_W / 2, 12 + i * 62 + 25, i === 0 ? 17 : 14);
        nextCtx.globalAlpha = 1;
      }

      holdCtx.clearRect(0, 0, HOLD_W, HOLD_H);
      if (holdType) {
        holdCtx.globalAlpha = holdUsed ? 0.32 : 1;
        drawMini(holdCtx, BASE[holdType], holdType, HOLD_W / 2, HOLD_H / 2, 17);
        holdCtx.globalAlpha = 1;
      } else {
        holdCtx.fillStyle = 'rgba(255,255,255,.12)';
        holdCtx.font = '10px ui-monospace, monospace';
        holdCtx.textAlign = 'center';
        holdCtx.fillText('—', HOLD_W / 2, HOLD_H / 2 + 3);
      }
    }

    /* ────────────────────────── Управление партией ────────────────────────── */
    function start() {
      board = emptyBoard();
      bag = [];
      queue = [];
      refillBag();
      fillQueue();
      holdType = null;
      holdUsed = false;
      score = 0;
      lines = 0;
      level = 1;
      combo = -1;
      dropAcc = 0;
      lockTimer = 0;
      lockResets = 0;
      clearingRows = [];
      moveDir = 0;
      pressed.left = pressed.right = pressed.down = false;
      updateHud();
      hideOverlay();
      phase = 'playing';
      lastFrame = clock.now();
      spawn();
      drawSidePanels();
      beep(660, 0.08, 'triangle', 0.03);
    }

    function togglePause() {
      if (phase === 'playing') {
        phase = 'paused';
        setOverlay('ПАУЗА', isCompactLayout() ? 'Кнопка ниже продолжит партию' : 'Продолжить — <kbd>P</kbd> или кнопка ниже', 'ПРОДОЛЖИТЬ');
      } else if (phase === 'paused') {
        hideOverlay();
        phase = 'playing';
        lastFrame = clock.now();
      }
    }

    function gameOver() {
      phase = 'over';
      SND.over();
      if (score > best) {
        best = score;
        storage.write('tetris.best', String(best));
      }
      updateHud();
      setOverlay(
        'ИГРА ОКОНЧЕНА',
        `Очки: <b style="color:#e8e8f2">${score.toLocaleString('ru-RU')}</b><br>` +
        `Линии: <b style="color:#e8e8f2">${lines}</b> · Уровень: <b style="color:#e8e8f2">${level}</b><br>` +
        `Рекорд: <b style="color:#facc15">${best.toLocaleString('ru-RU')}</b>`,
        'ЗАНОВО',
      );
    }

    function pressDir(dir) {
      if (phase !== 'playing' || !piece) return;
      moveDir = dir;
      if (tryMove(dir, 0)) SND.move();
      dasTime = DAS;
      arrTime = ARR;
    }

    function releaseDir(dir) {
      if (moveDir !== dir) return;
      if (dir === -1 && pressed.right) { moveDir = 1; dasTime = DAS; arrTime = ARR; }
      else if (dir === 1 && pressed.left) { moveDir = -1; dasTime = DAS; arrTime = ARR; }
      else moveDir = 0;
    }

    const HANDLED_KEYS = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space',
      'KeyZ', 'KeyX', 'KeyC', 'KeyA', 'KeyP', 'KeyR', 'KeyM', 'Escape',
      'ShiftLeft', 'ShiftRight',
    ]);

    /* ────────────────────────── Ввод ────────────────────────── */
    listen(win, 'keydown', (event) => {
      if (HANDLED_KEYS.has(event.code)) event.preventDefault();
      if (event.repeat) return;

      if (event.code === 'KeyM') {
        muted = !muted;
        if (!muted) beep(700, 0.06);
        return;
      }
      if (event.code === 'KeyR') {
        start();
        return;
      }
      if (phase === 'ready' || phase === 'over') {
        if (event.code === 'Space' || event.code === 'Enter') start();
        return;
      }
      if (event.code === 'KeyP' || event.code === 'Escape') {
        togglePause();
        return;
      }
      if (phase !== 'playing') return;

      switch (event.code) {
        case 'ArrowLeft':
          pressed.left = true;
          pressDir(-1);
          break;
        case 'ArrowRight':
          pressed.right = true;
          pressDir(1);
          break;
        case 'ArrowDown':
          pressed.down = true;
          dropAcc = softInterval();
          break;
        case 'ArrowUp':
        case 'KeyX':
          rotate(1);
          break;
        case 'KeyZ':
          rotate(-1);
          break;
        case 'KeyA':
          rotate(1);
          rotate(1);
          break;
        case 'Space':
          hardDrop();
          break;
        case 'KeyC':
        case 'ShiftLeft':
        case 'ShiftRight':
          holdPiece();
          break;
      }
    });

    listen(win, 'keyup', (event) => {
      switch (event.code) {
        case 'ArrowLeft':
          pressed.left = false;
          releaseDir(-1);
          break;
        case 'ArrowRight':
          pressed.right = false;
          releaseDir(1);
          break;
        case 'ArrowDown':
          pressed.down = false;
          break;
      }
    });

    listen(root, 'pointerdown', (event) => {
      const button = event.target.closest?.('button[data-act]');
      if (!button) return;
      event.preventDefault();
      // палец может уехать с кнопки — тогда отпускание придёт всё равно.
      // На синтетическом событии захват бросит исключение — это не ошибка.
      try {
        button.setPointerCapture?.(event.pointerId);
      } catch {
        /* указателя с таким id нет */
      }
      button.classList.add('is-pressed');
      const action = button.dataset.act;

      if (action === 'pause') {
        if (phase === 'ready' || phase === 'over') start();
        else togglePause();
        return;
      }
      if (action === 'restart') {
        start();
        return;
      }
      if (phase !== 'playing') {
        if (phase === 'ready' || phase === 'over') start();
        return;
      }

      switch (action) {
        case 'left': pressDir(-1); break;
        case 'right': pressDir(1); break;
        case 'soft': pressed.down = true; dropAcc = softInterval(); break;
        case 'cw': rotate(1); break;
        case 'ccw': rotate(-1); break;
        case 'hard': hardDrop(); break;
        case 'hold': holdPiece(); break;
      }
    });

    const stopTouch = (event) => {
      const button = event.target.closest?.('button[data-act]');
      button?.classList.remove('is-pressed');
      switch (button?.dataset.act) {
        case 'left': releaseDir(-1); break;
        case 'right': releaseDir(1); break;
        case 'soft': pressed.down = false; break;
      }
    };
    listen(root, 'pointerup', stopTouch);
    listen(root, 'pointercancel', stopTouch);
    listen(root, 'lostpointercapture', stopTouch);

    // Свайпы по полю: горизонталь — сдвиг, вниз — мягкий сброс,
    // тап — поворот, свайп вниз — хард-дроп, вверх — hold.
    let touchStart = null;

    listen(boardEl, 'pointerdown', (event) => {
      touchStart = {
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        time: clock.now(),
        moved: false,
      };
    });

    listen(boardEl, 'pointermove', (event) => {
      if (!touchStart || phase !== 'playing') return;

      const dx = event.clientX - touchStart.lastX;
      if (Math.abs(dx) > CELL) {
        touchStart.moved = true;
        if (tryMove(dx > 0 ? 1 : -1, 0)) SND.move();
        touchStart.lastX = event.clientX;
      }

      if (event.clientY - touchStart.y > 60) {
        touchStart.moved = true;
        touchStart.y = event.clientY;
        if (!collide(piece.matrix, piece.x, piece.y + 1)) {
          piece.y++;
          score++;
          updateHud();
        }
      }
    });

    listen(boardEl, 'pointerup', (event) => {
      if (!touchStart) return;
      const elapsed = clock.now() - touchStart.time;
      const dy = event.clientY - touchStart.y;

      if (phase === 'ready' || phase === 'over') {
        start();
        touchStart = null;
        return;
      }
      if (!touchStart.moved && elapsed < 250) {
        if (dy > 80) hardDrop();
        else if (dy < -60) holdPiece();
        else rotate(1);
      }
      touchStart = null;
    });

    listen(ovBtnEl, 'click', () => {
      if (phase === 'paused') togglePause();
      else start();
    });

    listen(doc, 'visibilitychange', () => {
      if (doc.hidden && phase === 'playing') togglePause();
    });

    /* ────────────────────────── Подгонка под экран ────────────────────────── */
    // Раскладка переключается в CSS, JS спрашивает у него тот же media-запрос.
    const COMPACT_QUERY = '(hover:none) and (pointer:coarse), (max-width:560px)';

    function isCompactLayout() {
      return win.matchMedia(COMPACT_QUERY).matches;
    }

    // Свободное место под поле: на телефоне берём область сетки как есть
    // (в компактной раскладке она растянута и не зависит от размера поля),
    // на десктопе считаем от размеров окна и панелей.
    function availableSpace() {
      const appStyle = win.getComputedStyle(appEl);
      const padX = parseFloat(appStyle.paddingLeft) + parseFloat(appStyle.paddingRight);
      const padY = parseFloat(appStyle.paddingTop) + parseFloat(appStyle.paddingBottom);

      if (isCompactLayout()) {
        const rect = stageEl.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }

      const gap = parseFloat(appStyle.columnGap) || 0;
      const panels = holdEl.closest('.box').offsetWidth + nextEl.closest('.box').offsetWidth;
      const bodyStyle = win.getComputedStyle(doc.body);
      const bodyPadY = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
      return {
        width: win.innerWidth - padX - panels - gap * 2,
        height: win.innerHeight - bodyPadY - padY + (parseFloat(appStyle.rowGap) || 0),
      };
    }

    // Пересобирает панель NEXT под текущую раскладку (3 фигуры на десктопе, 2 на телефоне)
    function layoutSidePanels() {
      const slots = isCompactLayout() ? 2 : NEXT_COUNT;
      if (slots === nextSlots) return;
      nextSlots = slots;
      nextHeight = slots * 62 + 12;
      setupCanvas(nextEl, nextCtx, NEXT_W, nextHeight);
      drawSidePanels();
    }

    // Буфер canvas подгоняется под фактический размер: логические координаты
    // остаются 300×600, а масштаб учитывает и размер на экране, и DPR.
    // Иначе либо мыло при увеличении, либо лишние пиксели при уменьшении.
    let boardBufferWidth = BOARD_W;
    let boardBufferHeight = BOARD_H;

    function resizeBoardBuffer(cssWidth, cssHeight) {
      if (cssWidth === boardBufferWidth && cssHeight === boardBufferHeight) return;
      boardBufferWidth = cssWidth;
      boardBufferHeight = cssHeight;
      const dpr = win.devicePixelRatio || 1;
      boardEl.width = Math.round(cssWidth * dpr);
      boardEl.height = Math.round(cssHeight * dpr);
      const ratio = (cssWidth / BOARD_W) * dpr;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function fitBoard() {
      layoutSidePanels();
      const space = availableSpace();
      // на телефоне поле может расти крупнее исходных 300×600,
      // на десктопе оставляем 1× — там места и так хватает
      const maxScale = isCompactLayout() ? 2.5 : 1;
      // Ограничение по самому окну: если первая раскладка случилась до того,
      // как браузер применил размер экрана, замер может быть завышен.
      const viewportLimit = Math.min(
        (win.innerWidth - 8) / BOARD_W,
        (win.innerHeight - 8) / BOARD_H,
      );
      const scale = Math.max(0.25, Math.min(
        maxScale,
        viewportLimit,
        space.height / BOARD_H,
        Math.max(space.width, 120) / BOARD_W,
      ));
      const cssWidth = Math.floor(BOARD_W * scale);
      const cssHeight = Math.floor(BOARD_H * scale);
      boardEl.style.width = cssWidth + 'px';
      boardEl.style.height = cssHeight + 'px';
      resizeBoardBuffer(cssWidth, cssHeight);
    }

    listen(win, 'resize', fitBoard);
    listen(win, 'orientationchange', fitBoard);
    // размер панелей меняется вместе с раскладкой — пересчитываем и после загрузки шрифтов
    win.addEventListener?.('load', fitBoard, { signal: listeners.signal });
    if (doc.fonts?.ready) doc.fonts.ready.then(() => { if (alive) fitBoard(); }).catch(() => {});
    fitBoard();
    // Браузер может применить размер окна уже после первого расчёта
    // (встраивание, поворот экрана, режим «установленного приложения»).
    fitTimers.push(setTimeout(fitBoard, 0), setTimeout(fitBoard, 250));

    /* ────────────────────────── Публичный интерфейс ────────────────────────── */
    function getState() {
      return {
        phase,
        score,
        lines,
        level,
        best,
        muted,
        board: board.map((row) => row.slice()),
        piece: piece && {
          type: piece.type,
          rotation: piece.rotation,
          x: piece.x,
          y: piece.y,
          ghostY: ghostY(),
          matrix: piece.matrix,
        },
        next: queue.slice(),
        hold: holdType,
        holdUsed,
      };
    }

    function destroy() {
      alive = false;
      listeners.abort();
      clearTimeout(comboTimer);
      fitTimers.forEach(clearTimeout);
    }

    /* ────────────────────────── Подсказки и установка ────────────────────────── */
    const KEYBOARD_HINT =
      '<kbd>←</kbd><kbd>→</kbd> движение · <kbd>↓</kbd> мягкий сброс<br>' +
      '<kbd>↑</kbd>/<kbd>X</kbd> поворот · <kbd>Z</kbd> обратный<br>' +
      '<kbd>Space</kbd> хард-дроп · <kbd>C</kbd> hold<br>' +
      '<kbd>P</kbd> пауза · <kbd>R</kbd> заново · <kbd>M</kbd> звук';

    const TOUCH_HINT =
      'Свайп ← → сдвигает фигуру<br>' +
      'тап — поворот, свайп ↓ — сброс,<br>' +
      'свайп ↑ — hold. Или кнопки внизу.';

    const controlHint = () => (isCompactLayout() ? TOUCH_HINT : KEYBOARD_HINT);

    // Установка на телефон: Chrome отдаёт событие, iOS — только инструкция.
    let installPrompt = null;
    const isStandalone = () => win.matchMedia('(display-mode: standalone)').matches ||
      win.navigator.standalone === true;

    function updateInstallOffer() {
      if (!ovInstallEl) return;
      const ios = /iPad|iPhone|iPod/.test(win.navigator.userAgent) ||
        (win.navigator.platform === 'MacIntel' && win.navigator.maxTouchPoints > 1);

      if (isStandalone()) {
        ovInstallEl.hidden = true;
        if (ovHintEl) ovHintEl.textContent = '';
        return;
      }
      if (installPrompt) {
        ovInstallEl.hidden = false;
        if (ovHintEl) ovHintEl.textContent = '';
        return;
      }
      ovInstallEl.hidden = true;
      if (ovHintEl) {
        ovHintEl.textContent = ios
          ? 'Установить: «Поделиться» → «На экран „Домой“»'
          : '';
      }
    }

    listen(win, 'beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      updateInstallOffer();
    });

    listen(win, 'appinstalled', () => {
      installPrompt = null;
      updateInstallOffer();
    });

    if (ovInstallEl) {
      listen(ovInstallEl, 'click', async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        try {
          await installPrompt.userChoice;
        } finally {
          installPrompt = null;
          updateInstallOffer();
        }
      });
    }

    // Начальный экран
    updateHud();
    drawSidePanels();
    setOverlay('TETRIS', controlHint(), 'НАЧАТЬ');
    updateInstallOffer();
    scheduleFrame(frame);

    return { start, togglePause, getState, destroy };
  }

  global.Tetris = Object.freeze({ createTetris });
})(window);
