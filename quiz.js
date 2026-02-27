(function () {
  'use strict';

  // ================================================================
  // HELPERS
  // ================================================================

  const el  = (name, root = document) => root.querySelector(`[data-quiz-element="${name}"]`);
  const els = (name, root = document) => Array.from(root.querySelectorAll(`[data-quiz-element="${name}"]`));

  function show(node) { if (node) { node.setAttribute('data-visibility', 'True');  node.removeAttribute('hidden'); } }
  function hide(node) { if (node) { node.setAttribute('data-visibility', 'False'); } }

  function setDisabled(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.setAttribute('data-disabled', disabled ? 'true' : 'false');
  }

  // ================================================================
  // CONFIG
  // ================================================================

  const screenQuiz = el('screen-quiz');
  if (!screenQuiz) { console.warn('[Quiz] screen-quiz not found. Aborting.'); return; }

  const QUESTION_TIME = parseInt(screenQuiz.dataset.quizQuestionTime, 10) || 15;

  // ================================================================
  // ELEMENTS
  // ================================================================

  const screenInstructions = el('screen-instructions');
  const screenResults      = el('results');
  const timeoutOverlay     = el('timeout-overlay');
  const timerWrap          = document.querySelector('.wih1-timer_wrap');
  const instructionsBtn    = el('instructions-btn');
  const restartBtn         = el('restart-btn');

  const UI = {
    progressCurrent:   el('progress-current'),
    progressTotal:     el('progress-total'),
    scoreDisplay:      el('score-display'),
    finalScore:        el('final-score'),
    timerBar:          el('timer-bar'),
    timerText:         el('timer-text'),
    timeoutNextBtn:    el('timeout-next-btn'),
    timeoutAnswerSpan: el('answer', timeoutOverlay),
  };

  // Submit + Next live inside each question — always look up from current question
  function getSubmitBtn() { return el('submit-btn', currentQ()); }
  function getNextBtn()   { return el('next-btn',   currentQ()); }

  // ================================================================
  // QUESTIONS
  // ================================================================

  const questionEls     = els('question');
  const TOTAL_QUESTIONS = questionEls.length;
  if (!TOTAL_QUESTIONS) { console.warn('[Quiz] No questions found. Aborting.'); return; }

  // ================================================================
  // CORRECT ANSWER STORE
  // Correct answer elements are read from data-correct="true" once at
  // init, then that attribute is immediately stripped from the DOM so
  // it is never inspectable. Identity is tracked by element reference.
  // ================================================================

  const correctEls = []; // correctEls[questionIndex] = the correct answer DOM element

  function prepareAllQuestions() {
    questionEls.forEach((qEl, index) => {
      const answerBtns = getAnswerBtns(qEl);

      // data-quiz-correct="true" is the authoring attribute set in Webflow Designer.
      // It uses a different name from data-correct so Webflow IX2 (which manages
      // data-correct as a CSS state and resets it to "false" on page load) never
      // touches it. Once read, it is immediately stripped so it is never inspectable.
      const correctEl  = answerBtns.find(b => b.getAttribute('data-quiz-correct') === 'true')
                         || answerBtns[0];
      correctEls[index] = correctEl;

      answerBtns.forEach(b => b.removeAttribute('data-quiz-correct'));
    });
  }

  // ================================================================
  // STATE
  // ================================================================

  let currentIndex  = 0;
  let selectedEl    = null; // the selected answer DOM element (not an index)
  let locked        = false;
  let totalScore    = 0;
  let timeRemaining = QUESTION_TIME;
  let timerId       = null;

  // ================================================================
  // QUESTION HELPERS
  // ================================================================

  function currentQ() { return questionEls[currentIndex] || null; }

  function getAnswerBtns(qEl) { return els('answer', qEl); }

  function getCorrectEl() { return correctEls[currentIndex] || null; }

  function getCorrectText() {
    const c = getCorrectEl();
    return c ? c.textContent.trim() : '';
  }

  // ================================================================
  // SHUFFLE
  // Fisher-Yates shuffle of answer DOM nodes within their parent.
  // Re-stamps data-answer-index after shuffle.
  // Called on every question load so order changes each attempt.
  // ================================================================

  function shuffleAnswers(qEl) {
    const btns = getAnswerBtns(qEl);
    if (btns.length < 2) return;
    const parent = btns[0].parentElement;
    if (!parent) return;

    // Fisher-Yates
    for (let i = btns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      if (i !== j) {
        const nodeI = btns[i];
        const nodeJ = btns[j];
        const afterI = nodeI.nextSibling;
        parent.insertBefore(nodeI, nodeJ);
        parent.insertBefore(nodeJ, afterI);
        // Keep array in sync
        [btns[i], btns[j]] = [btns[j], btns[i]];
      }
    }

    // Re-stamp indexes to reflect new DOM order
    getAnswerBtns(qEl).forEach((btn, i) => btn.setAttribute('data-answer-index', String(i)));
  }

  // ================================================================
  // BASELINE VISIBILITY
  // ================================================================

  function setBaseline() {
    show(screenInstructions);
    hide(screenQuiz);
    hide(screenResults);
    hide(timeoutOverlay);
    hide(timerWrap);
    questionEls.forEach(q => hide(q));
  }

  // ================================================================
  // TIMER
  // ================================================================

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;

    // Freeze bar at current position mid-animation
    if (UI.timerBar) {
      const currentW = parseFloat(getComputedStyle(UI.timerBar).width);
      const parentW  = UI.timerBar.parentElement?.offsetWidth || 1;
      UI.timerBar.style.transition = 'none';
      UI.timerBar.style.width      = (currentW / parentW * 100).toFixed(3) + '%';
    }
  }

  function startTimer() {
    stopTimer();
    timeRemaining = QUESTION_TIME;

    if (UI.timerBar) {
      UI.timerBar.style.transition = 'none';
      UI.timerBar.style.width      = '100%';
      UI.timerBar.getBoundingClientRect(); // force reflow
      UI.timerBar.style.transition = `width ${QUESTION_TIME}s linear`;
      UI.timerBar.style.width      = '0%';
    }
    if (UI.timerText) UI.timerText.textContent = String(QUESTION_TIME);
    if (timerWrap)    timerWrap.setAttribute('data-warning', 'false');

    timerId = setInterval(() => {
      timeRemaining -= 1;
      if (UI.timerText) UI.timerText.textContent = String(Math.max(0, timeRemaining));
      if (timerWrap)    timerWrap.setAttribute('data-warning', timeRemaining <= 5 ? 'true' : 'false');
      if (timeRemaining <= 0) { stopTimer(); onTimeout(); }
    }, 1000);
  }

  // ================================================================
  // QUESTION LOAD
  // ================================================================

  function resetQuestion(qEl) {
    getAnswerBtns(qEl).forEach(btn => {
      btn.setAttribute('data-selected', 'false');
      btn.setAttribute('data-locked',   'false');
      btn.removeAttribute('data-correct');
    });

    const feedbackWrap   = el('feedback-msg',    qEl);
    const feedbackAnswer = el('feedback-answer', qEl);
    if (feedbackWrap)   feedbackWrap.setAttribute('data-disabled', 'true');
    if (feedbackWrap)   feedbackWrap.removeAttribute('data-feedback-correct');
    if (feedbackAnswer) feedbackAnswer.textContent = '';

    const hintText = el('hint-text', qEl);
    if (hintText) hide(hintText);
  }

  function updateProgress() {
    if (UI.progressCurrent) UI.progressCurrent.textContent = String(currentIndex + 1);
    if (UI.progressTotal)   UI.progressTotal.textContent   = String(TOTAL_QUESTIONS);
    if (UI.scoreDisplay)    UI.scoreDisplay.textContent    = String(totalScore);
  }

  function showOnlyQuestion(index) {
    questionEls.forEach((q, i) => i === index ? show(q) : hide(q));
  }

  function loadQuestion(index) {
    currentIndex = index;
    selectedEl   = null;
    locked       = false;

    const qEl = currentQ();
    if (!qEl) return;

    hide(timeoutOverlay);
    shuffleAnswers(qEl);   // shuffle first — new order each load
    resetQuestion(qEl);    // then reset state on the (now shuffled) buttons
    showOnlyQuestion(index);
    updateProgress();
    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   true);
    initHint(qEl);
    startTimer();
  }

  // ================================================================
  // HINT
  // ================================================================

  function initHint(qEl) {
    const hintBtn  = el('hint-btn',  qEl);
    const hintText = el('hint-text', qEl);
    if (!hintBtn || !hintText) return;

    // Always start hidden — don't trust whatever Webflow set
    hide(hintText);
    let hintVisible = false;

    const fresh = hintBtn.cloneNode(true);
    hintBtn.parentNode.replaceChild(fresh, hintBtn);
    fresh.addEventListener('click', () => {
      hintVisible = !hintVisible;
      hintVisible ? show(hintText) : hide(hintText);
    });
  }

  // ================================================================
  // ANSWER SELECTION
  // Tracks the selected element directly — index-independent,
  // so shuffling never breaks correctness checking.
  // ================================================================

  function selectAnswer(btn) {
    selectedEl = btn;
    const qEl = currentQ();
    if (!qEl) return;
    getAnswerBtns(qEl).forEach(b => {
      b.setAttribute('data-selected', b === btn ? 'true' : 'false');
    });
    setDisabled(getSubmitBtn(), false);
  }

  // ================================================================
  // REVEAL ANSWERS
  // ================================================================

  function revealAnswers(qEl) {
    const correctEl = getCorrectEl();
    getAnswerBtns(qEl).forEach(btn => {
      btn.setAttribute('data-locked',  'true');
      btn.setAttribute('data-correct', btn === correctEl ? 'true' : 'false');
    });
  }

  // ================================================================
  // SUBMIT
  // ================================================================

  function onSubmit() {
    if (locked || !selectedEl) return;
    stopTimer();
    locked = true;

    const qEl       = currentQ();
    if (!qEl) return;

    const isCorrect = selectedEl === getCorrectEl();
    revealAnswers(qEl);

    const points = isCorrect ? Math.max(0, timeRemaining) : 0;
    if (isCorrect) {
      totalScore += points;
      if (UI.scoreDisplay) UI.scoreDisplay.textContent = String(totalScore);
    }

    const feedbackWrap   = el('feedback-msg',    qEl);
    const feedbackAnswer = el('feedback-answer', qEl);
    if (feedbackWrap) {
      feedbackWrap.setAttribute('data-disabled',         'false');
      feedbackWrap.setAttribute('data-feedback-correct',  isCorrect ? 'true' : 'false');
    }
    if (feedbackAnswer) {
      feedbackAnswer.textContent = isCorrect
        ? `Correct! +${points} points`
        : `Not quite. The correct answer is ${getCorrectText()}`;
    }

    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   false);
  }

  // ================================================================
  // TIMEOUT
  // ================================================================

  function onTimeout() {
    locked = true;
    const qEl = currentQ();
    if (!qEl) return;

    revealAnswers(qEl);
    if (UI.timeoutAnswerSpan) UI.timeoutAnswerSpan.textContent = getCorrectText();
    setDisabled(getSubmitBtn(), true);
    setDisabled(getNextBtn(),   true);
    show(timeoutOverlay);
  }

  // ================================================================
  // NEXT / END
  // ================================================================

  function goNext() {
    hide(timeoutOverlay);
    const next = currentIndex + 1;
    if (next >= TOTAL_QUESTIONS) { endQuiz(); } else { loadQuestion(next); }
  }

  function endQuiz() {
    stopTimer();
    hide(screenQuiz);
    hide(timerWrap);
    hide(timeoutOverlay);
    show(screenResults);
    if (UI.finalScore) UI.finalScore.textContent = String(totalScore);
  }

  // ================================================================
  // RESET / TRY AGAIN
  // ================================================================

  function resetQuiz() {
    stopTimer();
    currentIndex  = 0;
    selectedEl    = null;
    locked        = false;
    totalScore    = 0;
    timeRemaining = QUESTION_TIME;

    hide(screenResults);
    hide(timeoutOverlay);
    hide(screenQuiz);
    hide(timerWrap);
    questionEls.forEach(q => hide(q));

    if (timerWrap)    timerWrap.setAttribute('data-warning', 'false');
    if (UI.timerText) UI.timerText.textContent = String(QUESTION_TIME);
    if (UI.timerBar)  { UI.timerBar.style.transition = 'none'; UI.timerBar.style.width = '100%'; }

    show(screenInstructions);
  }

  // ================================================================
  // START QUIZ
  // ================================================================

  function startQuiz() {
    totalScore   = 0;
    currentIndex = 0;
    selectedEl   = null;
    locked       = false;

    hide(screenInstructions);
    show(screenQuiz);
    show(timerWrap);
    if (UI.scoreDisplay) UI.scoreDisplay.textContent = '0';
    loadQuestion(0);
  }

  // ================================================================
  // CLICK DELEGATION
  // One listener handles answers, submit and next for all questions.
  // ================================================================

  function bindQuizClicks() {
    screenQuiz.addEventListener('click', e => {
      const qEl = currentQ();

      if (e.target.closest('[data-quiz-element="submit-btn"]')) {
        onSubmit();
        return;
      }

      if (e.target.closest('[data-quiz-element="next-btn"]')) {
        const nextBtn = getNextBtn();
        if (nextBtn && !nextBtn.disabled) goNext();
        return;
      }

      if (locked) return;
      const btn = e.target.closest('[data-quiz-element="answer"]');
      if (!btn || !qEl || !qEl.contains(btn)) return;
      selectAnswer(btn); // pass element — no index needed
    });
  }

  // ================================================================
  // INIT
  // ================================================================

  function init() {
    prepareAllQuestions(); // read + strip data-correct before anything is visible
    setBaseline();
    bindQuizClicks();

    if (instructionsBtn)   instructionsBtn.addEventListener('click', startQuiz);
    if (UI.timeoutNextBtn) UI.timeoutNextBtn.addEventListener('click', goNext);
    if (restartBtn)        restartBtn.addEventListener('click', resetQuiz);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
