(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────
  const el  = (name, root = document) => root.querySelector(`[data-quiz-element="${name}"]`);
  const els = (name, root = document) => Array.from(root.querySelectorAll(`[data-quiz-element="${name}"]`));

  function show(node) { if (node) { node.setAttribute('data-visibility', 'True');  node.removeAttribute('hidden'); } }
  function hide(node) { if (node) { node.setAttribute('data-visibility', 'False'); } }
  function setDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.setAttribute('data-disabled', disabled ? 'true' : 'false');
  }

  // ── Config ────────────────────────────────────────────────────────
  const screenQuiz = el('screen-quiz');
  if (!screenQuiz) { console.warn('[Quiz] screen-quiz not found.'); return; }

  const QUESTION_TIME = parseInt(screenQuiz.dataset.quizQuestionTime, 10) || 15;
  const MAX_SCORE     = parseInt(screenQuiz.dataset.quizMaxScore, 10) || 0;

  // ── Elements ──────────────────────────────────────────────────────
  const screenSplash       = el('splash');
  const screenInstructions = el('screen-instructions');
  const screenResults      = el('results');
  const timeoutOverlay     = el('timeout-overlay');
  const timerWrap          = document.querySelector('.wih1-timer_wrap');
  const instructionsBtn    = el('instructions-btn');
  const startGameBtn       = el('start-game-button');
  const restartBtn         = el('restart-btn');
  const resultsWrap        = document.querySelector('.wih1-results_wrap');

  const UI = {
    progressCurrent:   el('progress-current'),
    progressTotal:     el('progress-total'),
    scoreDisplay:      el('score-display'),
    finalScore:        el('final-score'),
    maxScoreDisplay:   el('max-score-display'),
    timerBar:          el('timer-bar'),
    timerText:         el('timer-text'),
    timeoutNextBtn:    el('timeout-next-btn'),
    timeoutAnswerSpan: el('answer', timeoutOverlay),
    timeoutAnswerLogo: el('timeout-answer-logo'),
    resultsHeadline:   el('results-headline'),
    resultsMessage:    el('results-message'),
    finalScoreInput:   el('final-score-input'),
  };

  const getSubmitBtn = () => el('submit-btn', currentQ()) || el('submit-btn', screenQuiz);
  const getNextBtn   = () => el('next-btn',   currentQ()) || el('next-btn',   screenQuiz);

  // ── Questions & correct-answer store ─────────────────────────────
  const questionEls     = els('question');
  const TOTAL_QUESTIONS = questionEls.length;
  if (!TOTAL_QUESTIONS) { console.warn('[Quiz] No questions found.'); return; }

  const correctEls = [];

  function prepareAllQuestions() {
    questionEls.forEach((qEl, index) => {
      const btns = els('answer', qEl);
      correctEls[index] = btns.find(b => b.getAttribute('data-quiz-correct') === 'true') || btns[0];
      btns.forEach(b => b.removeAttribute('data-quiz-correct'));
    });
  }

  // ── State ─────────────────────────────────────────────────────────
  let currentIndex  = 0;
  let selectedEl    = null;
  let locked        = false;
  let totalScore    = 0;
  let timeRemaining = QUESTION_TIME;
  let timerId       = null;
  let refillTimerId = null;

  // ── Helpers ───────────────────────────────────────────────────────
  const currentQ       = ()    => questionEls[currentIndex] || null;
  const getAnswerBtns  = (qEl) => els('answer', qEl);
  const getCorrectEl   = ()    => correctEls[currentIndex] || null;
  const getCorrectText = ()    => { const c = getCorrectEl(); return c ? c.textContent.trim() : ''; };

  // ── Count-up ──────────────────────────────────────────────────────
  function countUp(el, from, to, duration) {
    if (!el) return;
    let start = null;
    function step(now) {
      if (!start) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ── Shuffle ───────────────────────────────────────────────────────
  function shuffleAnswers(qEl) {
    const btns = getAnswerBtns(qEl);
    if (btns.length < 2) return;
    const parent = btns[0].parentElement;
    for (let i = btns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      if (i !== j) {
        const afterI = btns[i].nextSibling;
        parent.insertBefore(btns[i], btns[j]);
        parent.insertBefore(btns[j], afterI);
        [btns[i], btns[j]] = [btns[j], btns[i]];
      }
    }
    getAnswerBtns(qEl).forEach((btn, i) => btn.setAttribute('data-answer-index', String(i)));
  }

  // ── Timer ─────────────────────────────────────────────────────────
  const REFILL_MS = 400;

  function stopTimer() {
    clearInterval(timerId);
    clearTimeout(refillTimerId);
    timerId = refillTimerId = null;
    if (UI.timerBar) {
      const pct = (parseFloat(getComputedStyle(UI.timerBar).width) / (UI.timerBar.parentElement?.offsetWidth || 1) * 100).toFixed(3);
      UI.timerBar.style.transition = 'none';
      UI.timerBar.style.width = pct + '%';
    }
  }

  function beginCountdown() {
    if (UI.timerBar) {
      UI.timerBar.style.transition = 'none';
      UI.timerBar.style.width = '100%';
      UI.timerBar.getBoundingClientRect();
      UI.timerBar.style.transition = `width ${QUESTION_TIME}s linear`;
      UI.timerBar.style.width = '0%';
    }
    timerId = setInterval(() => {
      timeRemaining -= 1;
      if (UI.timerText) UI.timerText.textContent = String(Math.max(0, timeRemaining));
      if (timerWrap)    timerWrap.setAttribute('data-warning',  timeRemaining <= 5 ? 'true' : 'false');
      if (timerWrap)    timerWrap.setAttribute('data-critical', timeRemaining <= 3 ? 'true' : 'false');
      if (timeRemaining <= 0) { stopTimer(); onTimeout(); }
    }, 1000);
  }

  function startTimer(refill = false) {
    stopTimer();
    timeRemaining = QUESTION_TIME;
    if (UI.timerText) UI.timerText.textContent = String(QUESTION_TIME);
    if (timerWrap)    timerWrap.setAttribute('data-warning',  'false');
    if (timerWrap)    timerWrap.setAttribute('data-critical', 'false');
    if (refill && UI.timerBar) {
      UI.timerBar.getBoundingClientRect();
      UI.timerBar.style.transition = `width ${REFILL_MS}ms ease-out`;
      UI.timerBar.style.width = '100%';
      refillTimerId = setTimeout(beginCountdown, REFILL_MS);
      return;
    }
    beginCountdown();
  }

  // ── Logo swap ─────────────────────────────────────────────────────
  // Both logos sit in the same parent, stacked via position:absolute.
  // Transitions are set once via CSS class (see initLogos).
  // swapLogo(qEl, 'answer') is called only from revealAnswers.
  // swapLogo(qEl, 'initial') is called only from loadQuestion for a genuinely new question.
  // The 'data-logo-state' attribute guards against spurious resets.

  function initLogos(qEl) {
    const initial = el('initial-logo', qEl);
    const answer  = el('answer-logo',  qEl);
    const wrap    = initial && initial.parentElement;
    [initial, answer].forEach(node => {
      if (!node) return;
      node.style.transition = 'none';
      node.removeAttribute('hidden');
    });
    // Start with initial visible, answer hidden — no animation
    if (initial) { initial.style.opacity = '1'; initial.style.filter = 'blur(0px)'; }
    if (answer)  { answer.style.opacity  = '0'; answer.style.filter  = 'blur(10px)'; }
    qEl.setAttribute('data-logo-state', 'initial');
    // Enable transitions after the initial paint so the first render never animates
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const trans = 'opacity 650ms cubic-bezier(0.25, 0.1, 0.25, 1), filter 650ms cubic-bezier(0.25, 0.1, 0.25, 1)';
      if (initial) initial.style.transition = trans;
      if (answer)  answer.style.transition  = trans;
    }));
  }

  function swapLogo(qEl, state) {
    // Guard: don't re-apply the same state (prevents flicker on re-init)
    if (qEl.getAttribute('data-logo-state') === state) return;
    qEl.setAttribute('data-logo-state', state);
    const initial = el('initial-logo', qEl);
    const answer  = el('answer-logo',  qEl);
    const toAnswer = state === 'answer';
    if (initial) { initial.style.opacity = toAnswer ? '0' : '1'; initial.style.filter = toAnswer ? 'blur(10px)' : 'blur(0px)'; }
    if (answer)  { answer.style.opacity  = toAnswer ? '1' : '0'; answer.style.filter  = toAnswer ? 'blur(0px)' : 'blur(10px)'; }
  }

  // ── Question lifecycle ────────────────────────────────────────────
  // resetQuestion does NOT touch logos — logo state is owned by loadQuestion + revealAnswers only.
  function resetQuestion(qEl) {
    getAnswerBtns(qEl).forEach(btn => {
      btn.setAttribute('data-selected', 'false');
      btn.setAttribute('data-locked',   'false');
      btn.removeAttribute('data-correct');
    });
    const feedbackWrap   = el('feedback-msg',    qEl);
    const feedbackAnswer = el('feedback-answer', qEl);
    if (feedbackWrap)   { feedbackWrap.setAttribute('data-disabled', 'true'); feedbackWrap.removeAttribute('data-feedback-correct'); }
    if (feedbackAnswer)   feedbackAnswer.textContent = '';
    const hintText = el('hint-text', qEl);
    if (hintText) hintText.style.display = 'none';
  }

  function updateProgress() {
    if (UI.progressCurrent)  UI.progressCurrent.textContent  = String(currentIndex + 1);
    if (UI.progressTotal)    UI.progressTotal.textContent     = String(TOTAL_QUESTIONS);
    if (UI.scoreDisplay)     UI.scoreDisplay.textContent      = String(totalScore);
    if (UI.maxScoreDisplay)  UI.maxScoreDisplay.textContent   = String(MAX_SCORE);
  }

  function showOnlyQuestion(index) {
    questionEls.forEach((q, i) => {
      if (i === index) {
        show(q);
        q.style.animation = 'none';
        q.getBoundingClientRect();
        q.style.animation = '';
      } else {
        hide(q);
      }
    });
  }

  function loadQuestion(index, withTimer = true) {
    currentIndex = index;
    selectedEl   = null;
    locked       = false;
    const qEl = currentQ();
    if (!qEl) return;
    hide(timeoutOverlay);
    shuffleAnswers(qEl);
    resetQuestion(qEl);
    swapLogo(qEl, 'initial'); // reset logo at the start of every fresh question
    showOnlyQuestion(index);
    updateProgress();
    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   true);
    initHint(qEl);
    if (withTimer) startTimer(index > 0);
  }

  // ── Hint ──────────────────────────────────────────────────────────
  function initHint(qEl) {
    const hintBtn  = el('hint-btn',  qEl);
    const hintText = el('hint-text', qEl);
    if (!hintBtn || !hintText) return;
    hintText.removeAttribute('hidden');
    hintText.style.display = 'none';
    let visible = false;
    const fresh = hintBtn.cloneNode(true);
    hintBtn.parentNode.replaceChild(fresh, hintBtn);
    fresh.addEventListener('click', () => { visible = !visible; hintText.style.display = visible ? 'block' : 'none'; });
  }

  // ── Answer selection ──────────────────────────────────────────────
  function selectAnswer(btn) {
    selectedEl = btn;
    getAnswerBtns(currentQ()).forEach(b => b.setAttribute('data-selected', b === btn ? 'true' : 'false'));
    setDisabled(getSubmitBtn(), false);
  }

  // ── Reveal ────────────────────────────────────────────────────────
  function revealAnswers(qEl) {
    const correctEl = getCorrectEl();
    getAnswerBtns(qEl).forEach(btn => {
      btn.setAttribute('data-locked',  'true');
      btn.setAttribute('data-correct', btn === correctEl ? 'true' : 'false');
    });
    if (correctEl) correctEl.setAttribute('data-selected', 'true');
    swapLogo(qEl, 'answer'); // show answer logo whenever the correct answer is revealed
  }

  // ── Submit ────────────────────────────────────────────────────────
  function onSubmit() {
    if (locked || !selectedEl) return;
    stopTimer();
    locked = true;
    const qEl = currentQ();
    if (!qEl) return;
    const isCorrect = selectedEl === getCorrectEl();
    revealAnswers(qEl);

    if (isCorrect) {
      const points    = Math.max(0, timeRemaining);
      const prevScore = totalScore;
      totalScore += points;
      countUp(UI.scoreDisplay, prevScore, totalScore, 600);
    }

    const feedbackWrap   = el('feedback-msg',    qEl);
    const feedbackAnswer = el('feedback-answer', qEl);
    if (feedbackWrap) {
      feedbackWrap.setAttribute('data-disabled',        'false');
      feedbackWrap.setAttribute('data-feedback-correct', isCorrect ? 'true' : 'false');
    }
    if (feedbackAnswer) {
      feedbackAnswer.textContent = isCorrect
        ? `Correct. +${Math.max(0, timeRemaining)} points`
        : `Not quite. The correct answer is ${getCorrectText()}`;
    }

    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   false);
  }

  // ── Timeout ───────────────────────────────────────────────────────
  function onTimeout() {
    locked = true;
    const qEl = currentQ();
    if (!qEl) return;
    revealAnswers(qEl);
    if (UI.timeoutAnswerSpan) UI.timeoutAnswerSpan.textContent = getCorrectText();
    if (UI.timeoutAnswerLogo) {
      const answerLogo = el('answer-logo', qEl);
      if (answerLogo) {
        const src    = answerLogo.getAttribute('src');
        const srcset = answerLogo.getAttribute('srcset');
        if (src)    UI.timeoutAnswerLogo.src = src;
        if (srcset) UI.timeoutAnswerLogo.setAttribute('srcset', srcset);
        else        UI.timeoutAnswerLogo.removeAttribute('srcset');
      }
    }
    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   true);
    show(timeoutOverlay);
  }

  // ── Navigation ────────────────────────────────────────────────────
  function goNext() {
    hide(timeoutOverlay);
    const next = currentIndex + 1;
    if (next >= TOTAL_QUESTIONS) endQuiz(); else loadQuestion(next);
  }

  // ── Score input lock ──────────────────────────────────────────────
  // Sets the final-score-input value and makes it tamper-resistant:
  //   • readonly attr  → blocks UI editing
  //   • Object.defineProperty → makes element.value = x a no-op in the console
  // A determined user could still call HTMLInputElement.prototype's native
  // setter directly, but this covers all practical cases.
  const _nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  function lockScoreInput(score) {
    const input = UI.finalScoreInput;
    if (!input) return;
    const strVal = String(score);
    _nativeInputSetter.call(input, strVal);   // write value via native setter
    input.setAttribute('readonly', '');
    Object.defineProperty(input, 'value', {   // shadow instance property
      configurable: true,                      // keeps it re-lockable on replay
      get: () => strVal,
      set: () => {},                           // element.value = x is a silent no-op
    });
    // Watch for readonly being removed and immediately restore it
    if (input._lockObserver) input._lockObserver.disconnect();
    input._lockObserver = new MutationObserver(() => {
      if (!input.hasAttribute('readonly')) input.setAttribute('readonly', '');
      _nativeInputSetter.call(input, strVal); // reset value in case native setter was used
    });
    input._lockObserver.observe(input, { attributes: true });
  }

  function unlockScoreInput() {
    const input = UI.finalScoreInput;
    if (!input) return;
    if (input._lockObserver) { input._lockObserver.disconnect(); input._lockObserver = null; }
    delete input.value;                        // remove instance shadow → falls back to prototype
    _nativeInputSetter.call(input, '');
    input.removeAttribute('readonly');
  }

  function endQuiz() {
    stopTimer();
    hide(screenQuiz);
    hide(timerWrap);
    hide(timeoutOverlay);
    const isZeroScore = totalScore === 0;
    if (screenResults) screenResults.setAttribute('data-zero-score', isZeroScore ? 'true' : 'false');
    if (isZeroScore) {
      if (UI.resultsHeadline) UI.resultsHeadline.textContent = 'That was a tough one.';
      if (UI.resultsMessage)  UI.resultsMessage.textContent  = 'No points this time, but you can replay the game and improve your score.';
    } else if (totalScore < 75) {
      if (UI.resultsHeadline) UI.resultsHeadline.textContent = 'A promising start';
      if (UI.resultsMessage)  UI.resultsMessage.textContent  = 'Can you score more points?';
    }
    lockScoreInput(totalScore);
    show(screenResults);
  }

  // ── Reset ─────────────────────────────────────────────────────────
  function resetQuiz() {
    stopTimer();
    currentIndex  = 0;
    selectedEl    = null;
    locked        = false;
    totalScore    = 0;
    timeRemaining = QUESTION_TIME;

    hide(screenResults);
    hide(timeoutOverlay);
    hide(timerWrap);
    if (screenResults) {
      screenResults.setAttribute('data-zero-score', 'false');
      const tryAgainWrap = el('try-again-wrap', screenResults);
      if (tryAgainWrap) show(tryAgainWrap);
    }
    unlockScoreInput();

    if (timerWrap)       timerWrap.setAttribute('data-warning',  'false');
    if (timerWrap)       timerWrap.setAttribute('data-critical', 'false');
    if (UI.timerText)    UI.timerText.textContent = String(QUESTION_TIME);
    if (UI.timerBar)     { UI.timerBar.style.transition = 'none'; UI.timerBar.style.width = '100%'; }
    if (UI.scoreDisplay) UI.scoreDisplay.textContent = '0';

    show(screenQuiz);
    show(screenInstructions);
    loadQuestion(0, false);
  }

  // ── Start quiz (from instructions screen) ─────────────────────────
  function startQuiz() {
    totalScore = 0;
    if (UI.scoreDisplay) UI.scoreDisplay.textContent = '0';
    hide(screenInstructions);
    show(timerWrap);
    startTimer();
  }

  // ── Splash ────────────────────────────────────────────────────────
  function animateSplash() {
    if (!screenSplash) return;
    const colLeft  = screenSplash.querySelector('.wih1-splash_col-left');
    const colRight = screenSplash.querySelector('.wih1-splash_col-right');
    [colLeft, colRight].forEach(col => {
      if (!col) return;
      col.style.opacity         = '0';
      col.style.transform       = 'translateY(20%)';
      col.style.transition      = 'none';
      col.style.transitionDelay = '0s';
    });
    screenSplash.getBoundingClientRect();
    if (colLeft) {
      colLeft.style.transition      = 'opacity 0.6s ease, transform 0.6s ease';
      colLeft.style.transitionDelay = '0s';
      colLeft.style.opacity         = '1';
      colLeft.style.transform       = 'translateY(0)';
    }
    if (colRight) {
      colRight.style.transition      = 'opacity 0.6s ease, transform 0.6s ease';
      colRight.style.transitionDelay = '0.12s';
      colRight.style.opacity         = '1';
      colRight.style.transform       = 'translateY(0)';
    }
  }

  function onStartGame() {
    const card = screenInstructions && screenInstructions.querySelector('.wih1-instructions_card');
    if (card) {
      card.style.opacity         = '0';
      card.style.transform       = 'translateY(30%)';
      card.style.transition      = 'none';
      card.style.transitionDelay = '0s';
    }
    hide(screenSplash);
    show(screenQuiz);
    show(screenInstructions);
    screenInstructions.getBoundingClientRect();
    if (card) {
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.style.opacity    = '1';
      card.style.transform  = 'translateY(0)';
    }
  }

  // ── Click delegation ──────────────────────────────────────────────
  screenQuiz.addEventListener('click', e => {
    if (e.target.closest('[data-quiz-element="submit-btn"]')) { onSubmit(); return; }
    if (e.target.closest('[data-quiz-element="next-btn"]')) {
      const btn = getNextBtn();
      if (btn && !btn.disabled) goNext();
      return;
    }
    if (locked) return;
    const btn = e.target.closest('[data-quiz-element="answer"]');
    const qEl = currentQ();
    if (!btn || !qEl || !qEl.contains(btn)) return;
    selectAnswer(btn);
  });

  // ── Init ──────────────────────────────────────────────────────────
  function setBaseline() {
    show(screenSplash);
    hide(screenQuiz);
    hide(screenInstructions);
    hide(screenResults);
    hide(timeoutOverlay);
    hide(timerWrap);
    if (UI.scoreDisplay) UI.scoreDisplay.textContent = '0';
    // Pre-init logos on all questions so transitions are ready from the start
    questionEls.forEach(qEl => initLogos(qEl));
    loadQuestion(0, false);
    animateSplash();
  }

  function init() {
    prepareAllQuestions();

    // Shuffle question order (correctEls shuffled in lockstep to keep index alignment)
    for (let i = questionEls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questionEls[i], questionEls[j]] = [questionEls[j], questionEls[i]];
      [correctEls[i],  correctEls[j]]  = [correctEls[j],  correctEls[i]];
    }

    setBaseline();

    if (startGameBtn)      startGameBtn.addEventListener('click', onStartGame);
    if (instructionsBtn)   instructionsBtn.addEventListener('click', startQuiz);
    if (UI.timeoutNextBtn) UI.timeoutNextBtn.addEventListener('click', goNext);
    if (restartBtn)        restartBtn.addEventListener('click', resetQuiz);

    if (resultsWrap) {
      new MutationObserver(() => {
        if (resultsWrap.getAttribute('data-visibility') === 'True') {
          setTimeout(() => countUp(UI.finalScore, 0, totalScore, 1000), 600);
        }
      }).observe(resultsWrap, { attributeFilter: ['data-visibility'] });
    }

    if (screenResults) {
      const tryAgainWrap = el('try-again-wrap', screenResults);
      const resultsForm  = screenResults.querySelector('form');
      if (resultsForm && tryAgainWrap) {
        resultsForm.addEventListener('submit', () => hide(tryAgainWrap));
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
