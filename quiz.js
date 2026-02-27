/**
 * QUIZ GAME LOGIC — DOM-DRIVEN
 * =============================
 * Questions are built in the Webflow Designer.
 * This script reads everything from the DOM — no QUIZ_DATA array.
 *
 * DROP IN: Webflow → Page Settings → Before </body>
 * (wrapped in <script> tags)
 *
 * ─── HOW TO ADD A NEW QUESTION IN WEBFLOW ─────────────────────
 *  1. Duplicate any existing [data-quiz-element="question"] block
 *     inside [data-quiz-element="questions-container"].
 *  2. Update the image src, question text, and answer button text.
 *  3. Set data-correct-answer="N" on the question wrapper,
 *     where N is the zero-based index of the correct answer button.
 *  4. DO NOT set data-answer-index on answer buttons — the JS
 *     assigns indexes automatically based on DOM order at load.
 *
 *  That's it — no JS changes needed.
 *
 * ─── WEBFLOW STYLING HOOKS ────────────────────────────────────
 *  The JS writes these attributes so you can style states in
 *  Webflow via attribute-based combo classes or Interactions:
 *
 *  [data-quiz-element="answer"]
 *    data-selected="true|false"
 *    data-correct="true|false"      ← set when answer is revealed
 *    data-locked="true"             ← set when question is locked
 *
 *  [data-quiz-element="feedback-msg"]
 *    data-feedback-correct="true|false"
 *
 *  [data-quiz-element="timeout-overlay"]
 *    hidden attr removed to show, added to hide
 *
 * ─── CONFIG ───────────────────────────────────────────────────
 *  Set these data attributes on [data-quiz-element="screen-quiz"]:
 *    data-quiz-question-time="15"   seconds per question
 *    data-quiz-ppq="15"             max points per question
 *    data-quiz-pass-score="100"     score needed to win
 */

(function () {
  'use strict';

  // ================================================================
  // CONSTANTS
  // ================================================================
  // ================================================================
  // READ CONFIG FROM DOM
  // ================================================================
  const screenQuiz = document.querySelector('[data-quiz-element="screen-quiz"]');

  if (!screenQuiz) {
    console.warn('[Quiz] Cannot find [data-quiz-element="screen-quiz"]. Aborting.');
    return;
  }

  const QUESTION_TIME = parseInt(screenQuiz.dataset.quizQuestionTime, 10) || 15;
  const MAX_PPQ       = parseInt(screenQuiz.dataset.quizPpq, 10)           || 15;
  const PASS_SCORE    = parseInt(screenQuiz.dataset.quizPassScore, 10)      || 50;

  // ================================================================
  // COLLECT ALL QUESTION ELEMENTS FROM THE DOM
  // ================================================================
  const questionEls = Array.from(
    document.querySelectorAll('[data-quiz-element="question"]')
  );

  const TOTAL_QUESTIONS = questionEls.length;

  if (TOTAL_QUESTIONS === 0) {
    console.warn('[Quiz] No [data-quiz-element="question"] elements found. Aborting.');
    return;
  }

  // ================================================================
  // STATE
  // ================================================================
  let currentIndex        = 0;
  let totalScore          = 0;
  let selectedAnswerIndex = null;
  let timeRemaining       = QUESTION_TIME;
  let timerInterval       = null;
  let questionLocked      = false;

  // ================================================================
  // ELEMENT SHORTCUTS
  // ================================================================
  const el  = (name) => document.querySelector(`[data-quiz-element="${name}"]`);
  const els = (name) => document.querySelectorAll(`[data-quiz-element="${name}"]`);

  // Shared persistent UI
  const UI = {
    progressCurrent:   el('progress-current'),
    progressTotal:     el('progress-total'),
    scoreDisplay:      el('score-display'),
    feedbackMsg:       el('feedback-msg'),
    submitBtn:         el('submit-btn'),
    nextBtn:           el('next-btn'),
    timerBar:          el('timer-bar'),
    timerText:         el('timer-text'),
    timeoutOverlay:    el('timeout-overlay'),
    timeoutNextBtn:    el('timeout-next-btn'),
    // Success / fail screens
    screenSuccess:     el('screen-success'),
    screenFail:        el('screen-fail'),
    finalScoreDisplay: el('final-score-display'),
    failScoreDisplay:  el('fail-score-display'),
    inputScore:        el('input-score'),
  };

  // ================================================================
  // SCREEN MANAGEMENT
  // ================================================================
  function showScreen(name) {
    screenQuiz.hidden        = name !== 'quiz';
    if (UI.screenSuccess) UI.screenSuccess.hidden = name !== 'success';
    if (UI.screenFail)    UI.screenFail.hidden    = name !== 'fail';
  }

  // ================================================================
  // QUESTION VISIBILITY
  // Hides all question elements, then shows only the target index.
  // ================================================================
  function showQuestion(index) {
    questionEls.forEach((q, i) => {
      q.hidden = i !== index;
    });
  }

  // ================================================================
  // TIMER
  // ================================================================
  function startTimer() {
    timeRemaining = QUESTION_TIME;
    updateTimerUI();
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      timeRemaining -= 1;
      updateTimerUI();

      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        onTimerExpired();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  function updateTimerUI() {
    if (UI.timerText) UI.timerText.textContent = timeRemaining;
    if (UI.timerBar) {
      UI.timerBar.style.width = ((timeRemaining / QUESTION_TIME) * 100) + '%';
    }
  }

  function onTimerExpired() {
    questionLocked = true;
    lockAllAnswers();
    revealCorrectAnswer();
    if (UI.timeoutOverlay) UI.timeoutOverlay.hidden = false;
    if (UI.submitBtn)      UI.submitBtn.hidden = true;
  }

  // ================================================================
  // LOAD QUESTION
  // Resets shared UI, shows the correct question block, starts timer.
  // ================================================================
  function loadQuestion(index) {
    selectedAnswerIndex = null;
    questionLocked      = false;

    // Reset shared UI
    if (UI.feedbackMsg) {
      UI.feedbackMsg.hidden = true;
      UI.feedbackMsg.textContent = '';
      UI.feedbackMsg.removeAttribute('data-feedback-correct');
    }
    if (UI.submitBtn)     UI.submitBtn.hidden = false;
    if (UI.nextBtn)       UI.nextBtn.hidden   = true;
    if (UI.timeoutOverlay) UI.timeoutOverlay.hidden = true;

    // Reset answer state on the current question's buttons
    resetAnswerButtons(index);

    // Wire up hint button for this question
    initHintButton(index);

    // Update progress
    if (UI.progressCurrent) UI.progressCurrent.textContent = index + 1;
    if (UI.progressTotal)   UI.progressTotal.textContent   = TOTAL_QUESTIONS;

    // Score
    updateScoreDisplay();

    // Show the question
    showQuestion(index);

    // Start countdown
    startTimer();
  }

  // ================================================================
  // AUTO-INDEX ALL ANSWER BUTTONS ACROSS ALL QUESTIONS
  // Called once on init. Stamps data-answer-index onto every answer
  // button based on its DOM order within its question block.
  // No need to set this manually in Webflow.
  // ================================================================
  function indexAllAnswerButtons() {
    questionEls.forEach((qEl) => {
      qEl.querySelectorAll('[data-quiz-element="answer"]').forEach((btn, i) => {
        btn.setAttribute('data-answer-index', i);
      });
    });
  }

  // ================================================================
  // RESET ANSWER BUTTONS
  // Clears any state left over from previous visits (try again flow).
  // Indexes are already set by indexAllAnswerButtons() at init so
  // we only need to clear the state attributes here.
  // ================================================================
  function resetAnswerButtons(index) {
    const qEl = questionEls[index];
    if (!qEl) return;

    qEl.querySelectorAll('[data-quiz-element="answer"]').forEach((btn) => {
      btn.setAttribute('data-selected', 'false');
      btn.removeAttribute('data-correct');
      btn.setAttribute('data-locked', 'false');
    });
  }

  // ================================================================
  // HINT BUTTON
  // Each question has its own hint-btn and hint-text in the DOM.
  // We re-bind the click handler each time a question loads.
  // ================================================================
  function initHintButton(index) {
    const qEl = questionEls[index];
    if (!qEl) return;

    const hintBtn  = qEl.querySelector('[data-quiz-element="hint-btn"]');
    const hintText = qEl.querySelector('[data-quiz-element="hint-text"]');

    if (!hintBtn || !hintText) return;

    // Replace node to remove any previously attached listener
    const freshBtn = hintBtn.cloneNode(true);
    hintBtn.parentNode.replaceChild(freshBtn, hintBtn);

    freshBtn.addEventListener('click', () => {
      hintText.hidden = !hintText.hidden;
    });
  }

  // ================================================================
  // ANSWER SELECTION
  // Reads buttons from the currently visible question.
  // ================================================================
  function getAnswerButtons() {
    const qEl = questionEls[currentIndex];
    if (!qEl) return [];
    return Array.from(qEl.querySelectorAll('[data-quiz-element="answer"]'));
  }

  function selectAnswer(index) {
    selectedAnswerIndex = index;
    getAnswerButtons().forEach((btn) => {
      const isThis = parseInt(btn.getAttribute('data-answer-index'), 10) === index;
      btn.setAttribute('data-selected', isThis ? 'true' : 'false');
    });
  }

  // ================================================================
  // REVEAL CORRECT ANSWER
  // Reads data-correct-answer from the current question wrapper.
  // ================================================================
  function getCorrectAnswerIndex() {
    const qEl = questionEls[currentIndex];
    return parseInt(qEl?.dataset?.correctAnswer ?? '0', 10);
  }

  function revealCorrectAnswer() {
    const correctIdx = getCorrectAnswerIndex();
    getAnswerButtons().forEach((btn) => {
      const idx = parseInt(btn.getAttribute('data-answer-index'), 10);
      btn.setAttribute('data-correct', idx === correctIdx ? 'true' : 'false');
    });
  }

  function lockAllAnswers() {
    getAnswerButtons().forEach((btn) => btn.setAttribute('data-locked', 'true'));
  }

  // ================================================================
  // SUBMIT
  // ================================================================
  function handleSubmit() {
    if (questionLocked)              return;
    if (selectedAnswerIndex === null) return; // nothing selected yet

    stopTimer();
    questionLocked = true;
    lockAllAnswers();
    revealCorrectAnswer();

    const correctIdx = getCorrectAnswerIndex();
    const isCorrect  = selectedAnswerIndex === correctIdx;

    if (isCorrect) {
      const points = Math.min(timeRemaining, MAX_PPQ);
      totalScore  += points;
      updateScoreDisplay();
      showFeedback(`Correct! +${points} points`, true);
    } else {
      // Find the correct answer button text for the message
      const correctBtn = getAnswerButtons().find(
        (b) => parseInt(b.getAttribute('data-answer-index'), 10) === correctIdx
      );
      const correctText = correctBtn ? correctBtn.textContent.trim() : 'the correct answer';
      showFeedback(`Not quite. The correct answer is ${correctText}`, false);
    }

    if (UI.submitBtn) UI.submitBtn.hidden = true;
    if (UI.nextBtn)   UI.nextBtn.hidden   = false;
  }

  // ================================================================
  // FEEDBACK MESSAGE
  // ================================================================
  function showFeedback(message, isCorrect) {
    if (!UI.feedbackMsg) return;
    UI.feedbackMsg.textContent = message;
    UI.feedbackMsg.setAttribute('data-feedback-correct', isCorrect ? 'true' : 'false');
    UI.feedbackMsg.hidden = false;
  }

  function updateScoreDisplay() {
    if (UI.scoreDisplay) UI.scoreDisplay.textContent = totalScore;
  }

  // ================================================================
  // NEXT QUESTION
  // ================================================================
  function handleNext() {
    currentIndex += 1;
    if (currentIndex >= TOTAL_QUESTIONS) {
      endQuiz();
    } else {
      loadQuestion(currentIndex);
    }
  }

  // ================================================================
  // END OF QUIZ
  // ================================================================
  function endQuiz() {
    stopTimer();
    if (totalScore >= PASS_SCORE) {
      goToSuccess();
    } else {
      goToFail();
    }
  }

  function goToSuccess() {
    if (UI.finalScoreDisplay) UI.finalScoreDisplay.textContent = totalScore;
    if (UI.inputScore)        UI.inputScore.value              = totalScore;
    showScreen('success');
  }

  function goToFail() {
    if (UI.failScoreDisplay) UI.failScoreDisplay.textContent = totalScore;
    showScreen('fail');
  }

  // ================================================================
  // RESET / TRY AGAIN
  // ================================================================
  function resetQuiz() {
    stopTimer();
    currentIndex        = 0;
    totalScore          = 0;
    selectedAnswerIndex = null;
    timeRemaining       = QUESTION_TIME;
    questionLocked      = false;

    showScreen('quiz');
    loadQuestion(0);
  }

  // ================================================================
  // ENTRY FORM
  // ================================================================
  function initEntryForm() {
    const form = el('entry-form');
    if (!form) return;
    form.addEventListener('submit', () => {
      if (UI.inputScore) UI.inputScore.value = totalScore;
    });
  }

  // ================================================================
  // WIRE UP ANSWER CLICKS (delegated on the questions container)
  // We use event delegation so newly-shown questions work without
  // re-binding. Filters clicks to [data-quiz-element="answer"].
  // ================================================================
  function initAnswerDelegation() {
    const container = el('questions-container');
    if (!container) return;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quiz-element="answer"]');
      if (!btn) return;
      if (questionLocked) return;
      const idx = parseInt(btn.getAttribute('data-answer-index'), 10);
      if (!isNaN(idx)) selectAnswer(idx);
    });
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    // Hide all non-quiz screens
    if (UI.screenSuccess) UI.screenSuccess.hidden = true;
    if (UI.screenFail)    UI.screenFail.hidden    = true;

    // Auto-stamp data-answer-index on every answer button based on DOM order
    indexAllAnswerButtons();

    // Hide all questions except first (JS controls visibility)
    showQuestion(0);

    // Event listeners
    if (UI.submitBtn)    UI.submitBtn.addEventListener('click', handleSubmit);
    if (UI.nextBtn)      UI.nextBtn.addEventListener('click', handleNext);
    if (UI.timeoutNextBtn) UI.timeoutNextBtn.addEventListener('click', handleNext);

    els('try-again-btn').forEach((btn) => btn.addEventListener('click', resetQuiz));

    initAnswerDelegation();
    initEntryForm();

    // Load the first question
    loadQuestion(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
