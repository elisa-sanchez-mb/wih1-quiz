;(function () {
  'use strict'

  // ─── DOUBLE-INIT GUARD ───────────────────────────────────────────────────────
  // drag-drop.js is loaded twice on this page (once before interact.js, once
  // after).  Only the first successful initialisation should run.
  if (window.__wih1DragDropReady) return

  // ─── OVERVIEW ────────────────────────────────────────────────────────────────
  //
  // This file is a self-contained quiz engine for the drag-drop game variant.
  //
  // quiz.js is also present but cannot run on this page because it requires
  // [data-quiz-element="question"] wrappers which Webflow doesn't add here.
  // All quiz logic (timer, scoring, progress, logo reveal, feedback) is
  // therefore owned by this file.
  //
  // HTML conventions followed (same as quiz.js):
  //   - data-quiz-element="…"  identifies all functional elements
  //   - data-visibility="1/0"  controls show/hide
  //   - data-disabled="true/false"    mirrors button disabled state for CSS
  //   - data-logo-id="…"             on each logo drop zone
  //   - data-correct="…"             on the draggable prop (correct logo-id)
  //
  // Question detection: uses [data-quiz-element="question"] if present,
  //   otherwise falls back to .wih1-quiz_item (this page's structure).

  // ─── WAIT FOR INTERACT.JS ────────────────────────────────────────────────────
  // interact.js loads after this script on the current page.  Poll until ready.
  function waitForInteract (cb) {
    if (typeof interact !== 'undefined') { cb(); return }
    var t = setInterval(function () {
      if (typeof interact !== 'undefined') { clearInterval(t); cb() }
    }, 20)
  }

  // ─── ELEMENT HELPERS (quiz.js convention) ────────────────────────────────────

  function qel (name, root) {
    return (root || document).querySelector('[data-quiz-element="' + name + '"]')
  }
  function qels (name, root) {
    return Array.from((root || document).querySelectorAll('[data-quiz-element="' + name + '"]'))
  }
  function show (node) {
    if (!node) return
    node.setAttribute('data-visibility', '1')
    node.removeAttribute('hidden')
    node.style.display = ''        // clear any inline display:none set by hide()
  }
  function hide (node) {
    if (!node) return
    node.setAttribute('data-visibility', '0')
    node.style.display = 'none'   // inline style overrides CSS + Webflow interactions
  }
  function setDisabled (btn, disabled) {
    if (!btn) return
    btn.disabled = !!disabled
    btn.setAttribute('data-disabled', disabled ? 'true' : 'false')
    btn.setAttribute('cc-button-disabled', disabled ? 'true' : 'false')
  }

  // Fisher-Yates shuffle — mutates the array in place and returns it
  function shuffle (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    return arr
  }

  // ─── CONFIGURATION ───────────────────────────────────────────────────────────

  var screenQuiz = qel('screen-dragdrop') || qel('screen-quiz')
  if (!screenQuiz) return

  var QUESTION_TIME = parseInt(screenQuiz.dataset.quizQuestionTime, 10) || 15
  var MAX_SCORE     = parseInt(screenQuiz.dataset.quizMaxScore,      10) || 0

  // ─── QUESTION DETECTION ──────────────────────────────────────────────────────
  // Support both [data-quiz-element="question"] (quiz.js pages) and
  // .wih1-quiz_item (this page's structure), deduped.

  var questionEls = Array.from(document.querySelectorAll(
    '[data-quiz-element="question"], .csg-design-system---makebuild--wih1-quiz_item'
  )).filter(function (el, i, arr) { return arr.indexOf(el) === i })

  var TOTAL_QUESTIONS = questionEls.length
  if (!TOTAL_QUESTIONS) { console.warn('[wih1-drag-drop] No questions found.'); return }

  // ─── UI REFERENCES ───────────────────────────────────────────────────────────

  var timerWrap      = document.querySelector('.csg-design-system---makebuild--wih1-timer_wrap')
  var timeoutOverlay = qel('timeout-overlay')
  var timeoutNextBtn = qel('timeout-next-btn')

  var UI = {
    progressCurrent: qel('progress-current'),
    progressTotal:   qel('progress-total'),
    scoreDisplay:    qel('score-display'),
    timerBar:        qel('timer-bar'),
    timerText:       qel('timer-text'),
    maxScoreDisplay: qel('max-score-display'),
    finalScore:      qel('final-score'),
    resultsHeadline: qel('results-headline'),
    resultsMessage:  qel('results-message'),
    finalScoreInput: qel('final-score-input'),
  }

  // ─── DROP-ZONE DRAG STYLES ────────────────────────────────────────────────────
  // Injected once at boot; uses data-attributes set by the drag engine.
  //
  // The dashed SVG border is applied by injecting a real <div> into each zone
  // via ondropactivate / ondropdeactivate.  This is immune to Webflow overriding
  // `position: relative` (which breaks the ::before approach).

  var _svgBorderUrl = ''   // set once in injectDragStyles; read by initQuestion

  function injectDragStyles () {
    if (document.getElementById('wih1-drag-drop-styles')) return

    // Build the data-URL once and stash it for the JS injection below.
    _svgBorderUrl = 'url("data:image/svg+xml,' + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 246 134' preserveAspectRatio='none'>" +
        "<defs>" +
          "<linearGradient id='wih1dg' x1='123' y1='31.9' x2='123' y2='102.1' gradientUnits='userSpaceOnUse'>" +
            "<stop stop-opacity='0'/><stop offset='1'/>" +
          "</linearGradient>" +
        "</defs>" +
        "<g opacity='0.5'>" +
          "<rect x='1' y='1' width='244' height='132' rx='3' fill='none' stroke='#FAFAFD' stroke-width='2' stroke-linecap='round' stroke-dasharray='8 8' vector-effect='non-scaling-stroke'/>" +
          "<rect x='1' y='1' width='244' height='132' rx='3' fill='none' stroke='url(#wih1dg)' stroke-opacity='0.2' stroke-width='2' stroke-linecap='round' stroke-dasharray='8 8' vector-effect='non-scaling-stroke'/>" +
        "</g>" +
      "</svg>"
    ) + '")'

    var style = document.createElement('style')
    style.id = 'wih1-drag-drop-styles'
    style.textContent = [
      /* Gradient bg + outline when prop is hovering over THIS zone.            */
      /* Applied to both the zone wrap AND the previewWrap inside it so one of  */
      /* them is guaranteed to be the visible element in any HTML structure.    */
      '.csg-design-system---makebuild--wih1_drop-zone_wrap[data-drag-over="true"],',
      '.csg-design-system---makebuild--wih1_drop-zone_wrap[data-drag-over="true"] [data-drop-element="previewWrap"],',
      '.csg-design-system---makebuild--wih1_drop-zone_wrap[data-drag-over="true"] .csg-design-system---makebuild--wih1_drop_preview {',
      '  background: linear-gradient(90deg,#FF00A0 -32.13%,#7100F9 98.41%) !important;',
      '  outline: 2px solid #FAFAFD !important;',
      '  outline-offset: -1px !important;',
      '}',
    ].join('\n')
    document.head.appendChild(style)
  }

  // Inject / remove the SVG dashed-border div.
  // Adds to BOTH the zone wrap and its previewWrap so the border appears
  // regardless of which element Webflow renders as the visual surface.
  function _addBorderToEl (el) {
    // Use :scope > to guard against finding a border nested inside a child element
    if (!el || el.querySelector(':scope > .csg-design-system---makebuild--wih1-zone-border')) return
    var div = document.createElement('div')
    div.className = 'csg-design-system---makebuild--wih1-zone-border'
    div.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:100;' +
                        'background-image:' + _svgBorderUrl + ';background-size:100% 100%;'
    el.style.position = 'relative'
    el.appendChild(div)
  }
  function _removeBorderFromEl (el) {
    if (!el) return
    // Use :scope > so we only remove the border appended directly to this element,
    // not a border that lives inside a child (e.g. previewWrap inside zone)
    var div = el.querySelector(':scope > .csg-design-system---makebuild--wih1-zone-border')
    if (div) div.parentNode.removeChild(div)
    el.style.position = ''
  }
  function addZoneBorder (zone) {
    _addBorderToEl(zone)
    _addBorderToEl(zone.querySelector('[data-drop-element="previewWrap"]'))
  }
  function removeZoneBorder (zone) {
    _removeBorderFromEl(zone)
    _removeBorderFromEl(zone.querySelector('[data-drop-element="previewWrap"]'))
  }

  // ─── STATE ───────────────────────────────────────────────────────────────────

  var currentIndex   = 0
  var totalScore     = 0
  var timeRemaining  = QUESTION_TIME
  var timerId        = null
  var refillTimerId  = null
  var locked         = false
  var selectedLogoId = null   // logo-id the prop is currently resting on

  function currentQ () { return questionEls[currentIndex] || null }

  function getSubmitBtn () { return qel('submit-btn', currentQ()) || qel('submit-btn', screenQuiz) }
  function getNextBtn   () { return qel('next-btn',   currentQ()) || qel('next-btn',   screenQuiz) }

  // ─── CORRECT ANSWER HELPERS ──────────────────────────────────────────────────
  // Correct answer is defined by data-correct on the prop (e.g. "disney"),
  // matched against data-logo-id on logo drop zones.  No hardcoding.

  function getCorrectLogoId (qEl) {
    // Use the value cached at initQuestion time (before the prop may have been
    // reparented to document.body by liftPropToBody), so this always resolves.
    if (qEl.dataset.wih1Correct) return qEl.dataset.wih1Correct
    var prop = qEl.querySelector('.csg-design-system---makebuild--quiz-prop')
    return prop ? prop.dataset.correct : null
  }

  function getCorrectName (qEl) {
    var logoId = getCorrectLogoId(qEl)
    if (!logoId) return ''
    var el = qEl.querySelector('[data-logo-id="' + logoId + '"]')
    // Use alt text, a data-name attribute, or fall back to the raw id; always capitalise first letter
    var name = el ? (el.getAttribute('alt') || el.dataset.name || logoId) : logoId
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : name
  }

  function getShowName (qEl) {
    // data-show can be set on the question wrapper element or on the prop itself
    if (qEl.dataset.show) return qEl.dataset.show
    var prop = qEl.querySelector('.csg-design-system---makebuild--quiz-prop')
    return (prop && prop.dataset.show) ? prop.dataset.show : ''
  }

  // ─── COUNT-UP ANIMATION (matches quiz.js implementation) ─────────────────────

  function countUp (el, from, to, duration) {
    if (!el) return
    var start = null
    function step (now) {
      if (!start) start = now
      var t     = Math.min((now - start) / duration, 1)
      var eased = 1 - Math.pow(1 - t, 3)
      el.textContent = String(Math.round(from + (to - from) * eased))
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // ─── TIMER (matches quiz.js implementation) ───────────────────────────────────

  var REFILL_MS = 400

  function stopTimer () {
    clearInterval(timerId)
    clearTimeout(refillTimerId)
    timerId = refillTimerId = null
    if (UI.timerBar) {
      var pct = (parseFloat(getComputedStyle(UI.timerBar).width) /
                 (UI.timerBar.parentElement ? UI.timerBar.parentElement.offsetWidth : 1) * 100).toFixed(3)
      UI.timerBar.style.transition = 'none'
      UI.timerBar.style.width      = pct + '%'
    }
  }

  function beginCountdown () {
    if (UI.timerBar) {
      UI.timerBar.style.transition = 'none'
      UI.timerBar.style.width      = '100%'
      UI.timerBar.getBoundingClientRect()
      UI.timerBar.style.transition = 'width ' + QUESTION_TIME + 's linear'
      UI.timerBar.style.width      = '0%'
    }
    timerId = setInterval(function () {
      timeRemaining -= 1
      if (UI.timerText) UI.timerText.textContent = String(Math.max(0, timeRemaining))
      if (timerWrap)    timerWrap.setAttribute('data-warning',  timeRemaining <= 5 ? 'true' : 'false')
      if (timerWrap)    timerWrap.setAttribute('data-critical', timeRemaining <= 3 ? 'true' : 'false')
      if (timeRemaining <= 0) { stopTimer(); onTimeout() }
    }, 1000)
  }

  function startTimer (refill) {
    stopTimer()
    timeRemaining = QUESTION_TIME
    if (UI.timerText) UI.timerText.textContent = String(QUESTION_TIME)
    if (timerWrap)    timerWrap.setAttribute('data-warning',  'false')
    if (timerWrap)    timerWrap.setAttribute('data-critical', 'false')
    if (refill && UI.timerBar) {
      UI.timerBar.getBoundingClientRect()
      UI.timerBar.style.transition = 'width ' + REFILL_MS + 'ms ease-out'
      UI.timerBar.style.width      = '100%'
      refillTimerId = setTimeout(beginCountdown, REFILL_MS)
      return
    }
    beginCountdown()
  }

  // ─── LOGO SWAP (matches quiz.js swapLogo / initLogos) ────────────────────────
  // Both logos sit stacked in the same parent via position:absolute.
  // 'initial' state: initial-logo visible, answer-logo hidden.
  // 'answer'  state: answer-logo visible,  initial-logo hidden.

  function initLogos (qEl) {
    var initial = qel('initial-logo', qEl)
    var answer  = qel('answer-logo',  qEl)
    ;[initial, answer].forEach(function (node) {
      if (!node) return
      node.style.transition = 'none'
      node.removeAttribute('hidden')
    })
    if (initial) { initial.style.opacity = '1'; initial.style.filter = 'blur(0px)' }
    if (answer)  { answer.style.opacity  = '0'; answer.style.filter  = 'blur(10px)' }
    qEl.setAttribute('data-logo-state', 'initial')
    // Enable transitions after initial paint so first render never animates
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var trans = 'opacity 650ms cubic-bezier(0.25,0.1,0.25,1), filter 650ms cubic-bezier(0.25,0.1,0.25,1)'
        if (initial) initial.style.transition = trans
        if (answer)  answer.style.transition  = trans
      })
    })
  }

  function swapLogo (qEl, state) {
    if (qEl.getAttribute('data-logo-state') === state) return
    qEl.setAttribute('data-logo-state', state)
    var initial   = qel('initial-logo', qEl)
    var answer    = qel('answer-logo',  qEl)
    var toAnswer  = state === 'answer'
    if (initial) { initial.style.opacity = toAnswer ? '0' : '1'; initial.style.filter = toAnswer ? 'blur(10px)' : 'blur(0px)' }
    if (answer)  { answer.style.opacity  = toAnswer ? '1' : '0'; answer.style.filter  = toAnswer ? 'blur(0px)'  : 'blur(10px)' }
  }

  // ─── HINT ─────────────────────────────────────────────────────────────────────

  function initHint (qEl) {
    var hintBtn  = qel('hint-btn',  qEl)
    var hintText = qel('hint-text', qEl)
    if (!hintBtn || !hintText) return
    hintText.removeAttribute('hidden')
    hintText.style.display = 'none'
    var visible = false
    var fresh = hintBtn.cloneNode(true)
    hintBtn.parentNode.replaceChild(fresh, hintBtn)
    fresh.addEventListener('click', function () {
      visible = !visible
      hintText.style.display = visible ? 'block' : 'none'
    })
  }

  // ─── PROGRESS & FEEDBACK ──────────────────────────────────────────────────────

  function updateProgress () {
    if (UI.progressCurrent) UI.progressCurrent.textContent = String(currentIndex + 1)
    if (UI.progressTotal)   UI.progressTotal.textContent   = String(TOTAL_QUESTIONS)
    if (UI.scoreDisplay)    UI.scoreDisplay.textContent    = String(totalScore)
    if (UI.maxScoreDisplay) UI.maxScoreDisplay.textContent = String(MAX_SCORE)
  }

  function showFeedback (qEl, isCorrect, points) {
    var feedbackWrap   = qel('feedback-msg',    qEl)
    var feedbackAnswer = qel('feedback-answer', qEl)
    if (feedbackWrap) {
      feedbackWrap.style.opacity = '1'
      feedbackWrap.setAttribute('data-feedback-correct', isCorrect ? 'true' : 'false')
    }
    if (feedbackAnswer) {
      var showName     = getShowName(qEl)
      var platformName = getCorrectName(qEl)
      feedbackAnswer.textContent = 'This prop is from ' + showName + ', available on ' + platformName + '.'
    }
  }

  function resetFeedback (qEl) {
    var feedbackWrap   = qel('feedback-msg',    qEl)
    var feedbackAnswer = qel('feedback-answer', qEl)
    if (feedbackWrap) {
      feedbackWrap.style.opacity = '0'
      feedbackWrap.removeAttribute('data-feedback-correct')
    }
    if (feedbackAnswer) feedbackAnswer.textContent = ''
  }

  // ─── ANSWER REVEAL ────────────────────────────────────────────────────────────

  function revealAnswers (qEl) {
    var correctLogoId = getCorrectLogoId(qEl)

    // Mark each answer logo image (CSS uses data-correct / data-locked)
    qels('answer', qEl).forEach(function (btn) {
      btn.setAttribute('data-locked',  'true')
      btn.setAttribute('data-correct', btn.dataset.logoId === correctLogoId ? 'true' : 'false')
    })

    // Mark the filled drop zone's remove button with correct/incorrect feedback
    // so the X icon swaps to the tick or cross icon via CSS
    if (selectedLogoId) {
      qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (zone) {
        if (zone.dataset.dropBg === selectedLogoId) {
          var removeEl = zone.querySelector('[data-drop-element="remove"]')
          if (removeEl) {
            removeEl.setAttribute('data-feedback-correct',
              selectedLogoId === correctLogoId ? 'true' : 'false')
          }
        }
      })
    }

    swapLogo(qEl, 'answer')  // no-op when initial-logo/answer-logo aren't present
  }

  // ─── SUBMIT ───────────────────────────────────────────────────────────────────

  function onSubmit () {
    if (locked || !selectedLogoId) return
    stopTimer()
    locked = true
    var qEl = currentQ()
    if (!qEl) return

    revealAnswers(qEl)

    var isCorrect = selectedLogoId === getCorrectLogoId(qEl)
    var points    = isCorrect ? Math.max(0, timeRemaining) : 0

    if (isCorrect) {
      var prev = totalScore
      totalScore += points
      countUp(UI.scoreDisplay, prev, totalScore, 600)
    }

    showFeedback(qEl, isCorrect, points)
    setDisabled(getSubmitBtn(), true)
    setDisabled(getNextBtn(),   false)

    var animTrans = 'opacity 650ms cubic-bezier(0.25,0.1,0.25,1), filter 650ms cubic-bezier(0.25,0.1,0.25,1)'

    // Fade out prop — same animation as logos in quiz.js
    var prop = qEl.querySelector('.csg-design-system---makebuild--quiz-prop')
    if (prop) {
      prop.style.transition = animTrans
      prop.style.opacity    = '0'
      prop.style.filter     = 'blur(10px)'
      setTimeout(function () { hide(prop) }, 650)
    }

    // Fade in reveal — mirror of the logo fade-in in quiz.js
    var reveal = qEl.querySelector('.csg-design-system---makebuild--quiz-show-reveal')
    if (reveal) {
      reveal.style.display    = 'block'
      reveal.style.opacity    = '0'
      reveal.style.filter     = 'blur(10px)'
      reveal.style.transition = animTrans
      reveal.setAttribute('data-visibility', '1')
      reveal.removeAttribute('hidden')
      // Force reflow so the starting state is painted before the transition begins
      reveal.getBoundingClientRect()
      reveal.style.opacity = '1'
      reveal.style.filter  = 'blur(0px)'
    }
  }

  // ─── TIMEOUT ──────────────────────────────────────────────────────────────────

  function onTimeout () {
    locked = true
    var qEl = currentQ()
    if (!qEl) return

    revealAnswers(qEl)
    showFeedback(qEl, false, 0)
    // Prop stays wherever it is — the locked check in the move listener
    // already stops any in-progress drag.
    setDisabled(getSubmitBtn(), true)
    setDisabled(getNextBtn(),   true)  // timeout overlay's own button handles navigation

    // Populate and show the timeout overlay
    if (timeoutOverlay) {
      // Show name → [data-quiz-element="show"] span
      var showTextEl = qel('show', timeoutOverlay)
      if (showTextEl) showTextEl.textContent = getShowName(qEl)

      // Platform name → [data-quiz-element="answer"] span
      var answerTextEl = qel('answer', timeoutOverlay)
      if (answerTextEl) answerTextEl.textContent = getCorrectName(qEl)

      // Answer logo → [data-quiz-element="timeout-answer-logo"] img
      var answerLogoEl = timeoutOverlay.querySelector('[data-quiz-element="timeout-answer-logo"]')
      if (answerLogoEl) {
        var correctLogoId  = getCorrectLogoId(qEl)
        // Narrow to [data-quiz-element="answer"] so we get the logo image, not zone bg elements
        var correctLogoImg = qEl.querySelector('[data-logo-id="' + correctLogoId + '"][data-quiz-element="answer"]')
                          || qEl.querySelector('[data-logo-id="' + correctLogoId + '"]')
        if (correctLogoImg) {
          // Use getAttribute (raw attribute) rather than .src (resolved absolute URL)
          // so that empty-src Webflow images don't overwrite with the page URL
          var logoSrc    = correctLogoImg.getAttribute('src')
          var logoSrcset = correctLogoImg.getAttribute('srcset')
          var logoSizes  = correctLogoImg.getAttribute('sizes')
          if (logoSrc)    answerLogoEl.src = logoSrc
          if (logoSrcset) answerLogoEl.setAttribute('srcset', logoSrcset)
          else            answerLogoEl.removeAttribute('srcset')
          if (logoSizes)  answerLogoEl.setAttribute('sizes',  logoSizes)
        }
      }

      show(timeoutOverlay)
    }
  }

  // ─── QUESTION SHOW/HIDE ───────────────────────────────────────────────────────

  function showOnlyQuestion (index) {
    questionEls.forEach(function (q, i) {
      if (i === index) {
        show(q)
        q.style.animation = 'none'
        q.getBoundingClientRect()
        q.style.animation = ''
      } else {
        hide(q)
      }
    })
  }

  // ─── LOAD QUESTION ────────────────────────────────────────────────────────────

  function loadQuestion (index, withTimer) {
    if (withTimer === undefined) withTimer = true
    currentIndex   = index
    locked         = false
    selectedLogoId = null

    if (timeoutOverlay) hide(timeoutOverlay)

    var qEl = currentQ()
    if (!qEl) return

    resetFeedback(qEl)
    showOnlyQuestion(index)
    updateProgress()
    setDisabled(getSubmitBtn(), true)
    setDisabled(getNextBtn(),   true)
    initHint(qEl)
    initLogos(qEl)

    // Reset answer button visual state
    qels('answer', qEl).forEach(function (btn) {
      btn.setAttribute('data-selected', 'false')
      btn.setAttribute('data-locked',   'false')
      btn.removeAttribute('data-correct')
    })

    // Re-init drag-drop for this question
    initQuestion(qEl)

    if (withTimer) startTimer(index > 0)
  }

  // ─── SCORE INPUT LOCK ────────────────────────────────────────────────────────
  // Sets the final-score-input value and makes it tamper-resistant:
  //   • readonly attr  → blocks UI editing
  //   • Object.defineProperty → makes element.value = x a no-op in the console

  var _nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set

  function lockScoreInput (score) {
    var input = UI.finalScoreInput
    if (!input) return
    var strVal = String(score)
    _nativeInputSetter.call(input, strVal)
    input.setAttribute('readonly', '')
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: function () { return strVal },
      set: function () {}
    })
    if (input._lockObserver) input._lockObserver.disconnect()
    input._lockObserver = new MutationObserver(function () {
      if (!input.hasAttribute('readonly')) input.setAttribute('readonly', '')
      _nativeInputSetter.call(input, strVal)
    })
    input._lockObserver.observe(input, { attributes: true })
  }

  function unlockScoreInput () {
    var input = UI.finalScoreInput
    if (!input) return
    if (input._lockObserver) { input._lockObserver.disconnect(); input._lockObserver = null }
    delete input.value
    _nativeInputSetter.call(input, '')
    input.removeAttribute('readonly')
  }

  // ─── NAVIGATION ───────────────────────────────────────────────────────────────

  function goNext () {
    var next = currentIndex + 1
    if (next >= TOTAL_QUESTIONS) {
      endQuiz()
    } else {
      loadQuestion(next)
    }
  }

  function endQuiz () {
    stopTimer()
    hide(screenQuiz)
    if (timerWrap)      hide(timerWrap)
    if (timeoutOverlay) hide(timeoutOverlay)

    var resultsEl = qel('results')
    if (!resultsEl) return

    // Score-based copy — mirrors quiz.js endQuiz exactly
    var isZeroScore = totalScore === 0
    resultsEl.setAttribute('data-zero-score', isZeroScore ? 'true' : 'false')
    if (isZeroScore) {
      if (UI.resultsHeadline) UI.resultsHeadline.textContent = 'That was a tough one.'
      if (UI.resultsMessage)  UI.resultsMessage.textContent  = 'No points this time, but you can replay the game and improve your score.'
    } else if (totalScore < 75) {
      if (UI.resultsHeadline) UI.resultsHeadline.textContent = 'A promising start'
      if (UI.resultsMessage)  UI.resultsMessage.textContent  = 'Can you score more points?'
    }
    // score >= 75: Webflow's default headline/message is used — no override needed

    lockScoreInput(totalScore)
    show(resultsEl)
    if (UI.finalScore) {
      setTimeout(function () { countUp(UI.finalScore, 0, totalScore, 1000) }, 600)
    }
  }

  // ─── CLICK DELEGATION ─────────────────────────────────────────────────────────

  screenQuiz.addEventListener('click', function (e) {
    if (e.target.closest('[data-quiz-element="submit-btn"]')) { onSubmit(); return }
    if (e.target.closest('[data-quiz-element="next-btn"]')) {
      var btn = getNextBtn()
      if (btn && !btn.disabled) goNext()
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════════
  // DRAG-DROP ENGINE
  // ═══════════════════════════════════════════════════════════════════════════════

  var SNAP_BACK_MS = 350
  var SNAP_TO_MS   = 250
  var OVERLAP      = 0.3

  // ─── PROP REPARENTING ─────────────────────────────────────────────────────────
  // CSS transforms on any ancestor break position:fixed (fixed becomes relative
  // to that ancestor instead of the viewport).  To escape all such contexts we
  // move the prop to document.body on drag start and restore it afterward.

  var _propOrigins = new Map()

  function liftPropToBody (prop) {
    if (_propOrigins.has(prop)) return          // already lifted
    var rect = prop.getBoundingClientRect()
    _propOrigins.set(prop, { parent: prop.parentNode, next: prop.nextSibling })
    document.body.appendChild(prop)             // reparent first — avoids stale rects
    prop.style.position   = 'fixed'
    prop.style.left       = rect.left + 'px'
    prop.style.top        = rect.top  + 'px'
    prop.style.width      = rect.width  + 'px'
    prop.style.height     = rect.height + 'px'
    prop.style.zIndex     = '9999'
    prop.style.transform  = ''                  // CSS owns transform (scale, etc.)
    prop.style.transition = ''
    prop.dataset.originLeft = String(rect.left)
    prop.dataset.originTop  = String(rect.top)
    prop.setAttribute('data-x', 0)
    prop.setAttribute('data-y', 0)
  }

  function restorePropToFlow (prop) {
    var saved = _propOrigins.get(prop)
    if (!saved) return
    _propOrigins.delete(prop)
    prop.style.position = ''
    prop.style.left     = ''
    prop.style.top      = ''
    prop.style.width    = ''
    prop.style.height   = ''
    prop.style.zIndex   = ''
    if (saved.parent && saved.parent.isConnected) {
      saved.parent.insertBefore(prop, saved.next)
    }
  }

  // ─── PROP POSITION HELPERS ───────────────────────────────────────────────────

  function getPropPos (prop) {
    return {
      x: parseFloat(prop.getAttribute('data-x')) || 0,
      y: parseFloat(prop.getAttribute('data-y')) || 0
    }
  }

  function setPropPos (prop, x, y) {
    prop.setAttribute('data-x', x)
    prop.setAttribute('data-y', y)
    var originLeft = parseFloat(prop.dataset.originLeft) || 0
    var originTop  = parseFloat(prop.dataset.originTop)  || 0
    prop.style.left = (originLeft + x) + 'px'
    prop.style.top  = (originTop  + y) + 'px'
  }

  function snapPropBack (prop) {
    // Animate back to the fixed origin (left/top captured at drag start),
    // then restore to in-flow positioning.
    var originLeft = parseFloat(prop.dataset.originLeft) || 0
    var originTop  = parseFloat(prop.dataset.originTop)  || 0
    var ease = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    prop.style.transition = 'left ' + SNAP_BACK_MS + 'ms ' + ease + ', top ' + SNAP_BACK_MS + 'ms ' + ease
    prop.style.left = originLeft + 'px'
    prop.style.top  = originTop  + 'px'
    prop.setAttribute('data-x', 0)
    prop.setAttribute('data-y', 0)
    setTimeout(function () {
      prop.style.transition = ''
      restorePropToFlow(prop)
    }, SNAP_BACK_MS)
  }

  function snapPropToZone (prop, zone) {
    var currentLeft = parseFloat(prop.style.left) || 0
    var currentTop  = parseFloat(prop.style.top)  || 0
    var propRect    = prop.getBoundingClientRect()
    var zoneRect    = zone.getBoundingClientRect()
    // Move visual centre of prop to visual centre of zone
    var deltaX = (zoneRect.left + zoneRect.width  / 2) - (propRect.left + propRect.width  / 2)
    var deltaY = (zoneRect.top  + zoneRect.height / 2) - (propRect.top  + propRect.height / 2)
    prop.style.transition = 'left ' + SNAP_TO_MS + 'ms ease, top ' + SNAP_TO_MS + 'ms ease'
    prop.style.left = (currentLeft + deltaX) + 'px'
    prop.style.top  = (currentTop  + deltaY) + 'px'
    setTimeout(function () { prop.style.transition = '' }, SNAP_TO_MS)
  }

  function resetProp (prop) {
    restorePropToFlow(prop)
    prop.style.transform     = ''
    prop.style.transition    = ''
    prop.style.position      = ''
    prop.style.left          = ''
    prop.style.top           = ''
    prop.style.width         = ''
    prop.style.height        = ''
    prop.style.zIndex        = ''
    prop.style.pointerEvents = 'auto'
    prop.style.opacity       = ''
    prop.style.filter        = ''
    prop.setAttribute('data-x', 0)
    prop.setAttribute('data-y', 0)
    prop.classList.remove('prop--over-zone')
  }

  // ─── PER-QUESTION DRAG-DROP INIT ──────────────────────────────────────────────
  //
  // New HTML structure (csghome variant):
  //   .image_wrap.is-dragdrop
  //     img.quiz-prop        — draggable; CSS: opacity:0 default, scale(0.4) opacity:1
  //                            when data-drag-active="true" (JS sets this during drag)
  //     img.quiz_drag_img    — fixed background image; stays in slot always; JS never moves it
  //     .drag_drop_img_instructions — instructions overlay, hidden on first drag
  //
  //   .wih1_drop-zone_wrap[data-drop-bg]   — one per answer option
  //     [data-drop-element="previewWrap"]  — receives a cloned <img> of the prop on drop
  //     [data-drop-element="remove"]       — X / correct / incorrect icon; clears the drop
  //     .wih1_drop_logo_wrap > img.wih1_drop_logo[data-logo-id][data-quiz-element="answer"]
  //
  // Mechanic:
  //   1. User drags quiz-prop → it lifts to body and follows pointer at 0.4 scale (CSS).
  //      quiz_drag_img stays fixed in the slot — JS never touches it.
  //   2. Drop on .wih1_drop-zone_wrap → quiz-prop snaps to previewWrap centre,
  //      preview <img> injected, quiz-prop restored to flow (CSS hides it); submit enabled.
  //   3. No drop → quiz-prop snaps back; data-drag-active removed; CSS hides it again.
  //   4. Only one drop per question (placed flag); remove button resets everything.
  //   5. Submit → revealAnswers → correct/incorrect marked on remove element.

  function initQuestion (qEl) {
    if (!qEl) return

    var prop    = qEl.querySelector('.csg-design-system---makebuild--quiz-prop')       // draggable; CSS ghost via data-drag-active
    var dragImg = qEl.querySelector('.csg-design-system---makebuild--quiz_drag_img')   // fixed background image — JS never moves it
    var instrEl = qEl.querySelector('.csg-design-system---makebuild--drag_drop_img_instructions')
    if (!prop) return

    // Cache correct answer before any reparenting
    if (prop.dataset.correct) qEl.dataset.wih1Correct = prop.dataset.correct

    // Prevent native browser image drag
    prop.setAttribute('draggable', 'false')
    if (dragImg) dragImg.setAttribute('draggable', 'false')

    // ── Reset prop (CSS controls opacity via data-drag-active) ─────────────────
    resetProp(prop)
    prop.removeAttribute('data-drag-active')
    prop.style.display = ''   // clear any display:none left by a previous onSubmit

    // ── Hide reveal image so it doesn't intercept drag events ──────────────────
    var reveal = qEl.querySelector('.csg-design-system---makebuild--quiz-show-reveal')
    if (reveal) hide(reveal)

    // ── Reset instructions overlay ─────────────────────────────────────────────
    if (instrEl) instrEl.style.display = ''

    // ── Reset drop zones ───────────────────────────────────────────────────────
    qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (zone) {
      var previewImg = zone.querySelector('.csg-design-system---makebuild--wih1_drop_preview_img')
      var removeEl   = zone.querySelector('[data-drop-element="remove"]')
      if (previewImg) {
        previewImg.src           = ''
        previewImg.style.opacity = '0'
      }
      if (removeEl) {
        removeEl.style.opacity = '0'
        removeEl.removeAttribute('data-feedback-correct')
      }
      zone.removeAttribute('data-drag-over')
      zone.removeAttribute('data-filled')
      zone.style.opacity    = ''
      zone.style.transition = ''
    })

    // ── Shuffle logo / drop-zone order ─────────────────────────────────────────
    var zoneEls = Array.from(qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap'))
    if (zoneEls.length > 1) {
      var zonesParent = zoneEls[0].parentNode
      shuffle(zoneEls)
      zoneEls.forEach(function (z) { zonesParent.appendChild(z) })
    }

    // ── Tear down stale interact.js bindings ───────────────────────────────────
    try { interact(prop).unset() } catch (_) {}
    qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (zone) {
      try { interact(zone).unset() } catch (_) {}
    })

    // ── Per-gesture flags ──────────────────────────────────────────────────────
    var placed      = false  // true after a successful drop; cleared by remove
    var dropHandled = false  // true when ondrop fired during the current gesture

    // ── Draggable (quiz-prop) ──────────────────────────────────────────────────
    interact(prop).draggable({
      inertia:    false,
      autoScroll: true,
      modifiers: [
        interact.modifiers.restrictRect({ restriction: 'body', endOnly: true })
      ],
      listeners: {
        start: function (event) {
          if (locked || placed) { event.interaction.stop(); return }
          prop.setAttribute('data-drag-active', 'true')  // set BEFORE lift — CSS scale applies from frame 1
          liftPropToBody(prop)

          // Center the prop's layout box under the pointer so dragging
          // feels anchored to the cursor regardless of where the user grabbed.
          var w          = parseFloat(prop.style.width)  || prop.offsetWidth
          var h          = parseFloat(prop.style.height) || prop.offsetHeight
          var originLeft = parseFloat(prop.dataset.originLeft) || 0
          var originTop  = parseFloat(prop.dataset.originTop)  || 0
          var initX      = event.clientX - originLeft - w / 2
          var initY      = event.clientY - originTop  - h / 2
          setPropPos(prop, initX, initY)

          qEl.classList.add('csg-design-system---makebuild--is-dragging')               // CSS hook: .is-dragging .wih1_drop-zone_dragging
          qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop_preview').forEach(function (p) { p.classList.add('is-dragging') })
          if (instrEl) instrEl.style.display = 'none'
        },
        move: function (event) {
          if (locked) { snapPropBack(prop); return }
          var pos = getPropPos(prop)
          setPropPos(prop, pos.x + event.dx, pos.y + event.dy)
        },
        end: function () {
          if (!dropHandled) {
            // No drop — snap back; after animation CSS opacity:0 takes over
            snapPropBack(prop)
            setTimeout(function () {
              prop.removeAttribute('data-drag-active')
              if (instrEl) instrEl.style.display = ''
            }, SNAP_BACK_MS)
          }
          // Remove dragging state immediately on gesture end (drop or no-drop)
          qEl.classList.remove('csg-design-system---makebuild--is-dragging')
          qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop_preview').forEach(function (p) { p.classList.remove('is-dragging') })
          // Drop case: data-drag-active removed inside ondrop's setTimeout
          dropHandled = false
        }
      }
    })

    // ── Drop zones (.wih1_drop-zone_wrap) ─────────────────────────────────────
    qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (zone) {

      interact(zone).dropzone({
        accept:  '.csg-design-system---makebuild--quiz-prop',
        overlap: OVERLAP,

        ondropactivate: function () {
          zone.setAttribute('data-drag-over', 'ready')
          addZoneBorder(zone)
        },
        ondragenter: function () {
          zone.setAttribute('data-drag-over', 'true')
          prop.classList.add('prop--over-zone')
        },
        ondragleave: function () {
          zone.setAttribute('data-drag-over', 'ready')
          prop.classList.remove('prop--over-zone')
        },
        ondrop: function () {
          dropHandled = true
          zone.removeAttribute('data-drag-over')
          prop.classList.remove('prop--over-zone')
          if (locked) return

          placed         = true
          selectedLogoId = zone.dataset.dropBg
          zone.setAttribute('data-filled', 'true')

          // Dim all other (empty) drop zones to 50% opacity
          qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (z) {
            if (z !== zone) {
              z.style.transition = 'opacity 0.3s ease'
              z.style.opacity    = '0.5'
            }
          })

          // Snap prop to previewWrap centre, then reveal the existing preview img
          var previewWrap = zone.querySelector('[data-drop-element="previewWrap"]')
          var previewImg  = zone.querySelector('.csg-design-system---makebuild--wih1_drop_preview_img')
          var snapTarget  = previewWrap || zone
          snapPropToZone(prop, snapTarget)

          setTimeout(function () {
            if (previewImg) {
              var srcEl  = dragImg || prop   // use the full-size static image as source
              previewImg.src = srcEl.src
              var srcset = srcEl.getAttribute('srcset')
              var sizes  = srcEl.getAttribute('sizes')
              if (srcset) previewImg.setAttribute('srcset', srcset)
              if (sizes)  previewImg.setAttribute('sizes',  sizes)
              previewImg.style.opacity = '1'
            }
            restorePropToFlow(prop)
            prop.removeAttribute('data-drag-active')  // CSS: opacity:0
          }, SNAP_TO_MS)

          // Show remove button
          var removeEl = zone.querySelector('[data-drop-element="remove"]')
          if (removeEl) removeEl.style.opacity = '1'

          // Mark answer logo as selected
          qels('answer', qEl).forEach(function (btn) {
            btn.setAttribute('data-selected', btn.dataset.logoId === selectedLogoId ? 'true' : 'false')
          })

          setDisabled(getSubmitBtn(), false)
        },
        ondropdeactivate: function () {
          zone.removeAttribute('data-drag-over')
          removeZoneBorder(zone)
        }
      })

      // ── Remove button ──────────────────────────────────────────────────────
      var removeEl = zone.querySelector('[data-drop-element="remove"]')
      if (removeEl) {
        // Clone to clear any stale listeners from previous questions
        var freshRemove = removeEl.cloneNode(true)
        removeEl.parentNode.replaceChild(freshRemove, removeEl)
        freshRemove.addEventListener('click', function () {
          if (locked) return

          // Hide the preview image
          var previewImg = zone.querySelector('.csg-design-system---makebuild--wih1_drop_preview_img')
          if (previewImg) {
            previewImg.src           = ''
            previewImg.style.opacity = '0'
          }

          // Hide remove button and clear feedback state
          freshRemove.style.opacity = '0'
          freshRemove.removeAttribute('data-feedback-correct')

          // quiz_drag_img is untouched — it never moved
          if (instrEl) instrEl.style.display = ''

          // Reset answer selection
          qels('answer', qEl).forEach(function (btn) {
            btn.setAttribute('data-selected', 'false')
          })

          // Restore zone opacities
          zone.removeAttribute('data-filled')
          qEl.querySelectorAll('.csg-design-system---makebuild--wih1_drop-zone_wrap').forEach(function (z) {
            z.style.transition = 'opacity 0.3s ease'
            z.style.opacity    = ''
          })

          // Reset state so the user can drag again
          selectedLogoId = null
          placed         = false
          setDisabled(getSubmitBtn(), true)
        })
      }
    })
  }

  // ─── SPLASH ANIMATION ────────────────────────────────────────────────────────
  // Mirrors quiz.js animateSplash().  Queries both the full Webflow class name
  // (csg-design-system---makebuild-- prefix) and the shorthand name so this
  // works regardless of which naming convention is used on the page.

  function animateSplash () {
    var splashEl = qel('splash')
    if (!splashEl) return
    var colLeft  = splashEl.querySelector('.csg-design-system---makebuild--wih1-splash_col-left')  ||
                   splashEl.querySelector('.wih1-splash_col-left')
    var colRight = splashEl.querySelector('.csg-design-system---makebuild--wih1-splash_col-right') ||
                   splashEl.querySelector('.wih1-splash_col-right')
    ;[colLeft, colRight].forEach(function (col) {
      if (!col) return
      col.style.opacity         = '0'
      col.style.transform       = 'translateY(20%)'
      col.style.transition      = 'none'
      col.style.transitionDelay = '0s'
    })
    splashEl.getBoundingClientRect()   // force reflow before applying transitions
    if (colLeft) {
      colLeft.style.transition      = 'opacity 0.6s ease, transform 0.6s ease'
      colLeft.style.transitionDelay = '0s'
      colLeft.style.opacity         = '1'
      colLeft.style.transform       = 'translateY(0)'
    }
    if (colRight) {
      colRight.style.transition      = 'opacity 0.6s ease, transform 0.6s ease'
      colRight.style.transitionDelay = '0.12s'
      colRight.style.opacity         = '1'
      colRight.style.transform       = 'translateY(0)'
    }
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────────

  function init () {
    window.__wih1DragDropReady = true

    // Randomise question order on every play-through
    shuffle(questionEls)

    injectDragStyles()

    var splashEl      = qel('splash')
    var instrScreenEl = qel('screen-instructions')
    var resultsEl     = qel('results')
    var hasGate       = splashEl || instrScreenEl

    // ── Initial screen state ───────────────────────────────────────────────────
    // Webflow's published HTML leaves screenQuiz and results with
    // data-visibility="1".  Hide everything non-splash on load.
    hide(screenQuiz)
    if (timerWrap)      hide(timerWrap)
    if (resultsEl)      hide(resultsEl)
    if (timeoutOverlay) hide(timeoutOverlay)
    // Splash has no data-visibility in Webflow so it shows by default.
    // If there's no gate at all, show the quiz immediately.
    if (!hasGate) {
      show(screenQuiz)
      if (timerWrap) show(timerWrap)
    }

    // ── Splash → Instructions (or Quiz) ───────────────────────────────────────
    var startGameBtn = document.querySelector('[data-quiz-start-game]')
    if (startGameBtn) {
      startGameBtn.addEventListener('click', function () {
        if (instrScreenEl) {
          // Animate instructions card in — mirrors quiz.js onStartGame()
          var card = instrScreenEl.querySelector('.csg-design-system---makebuild--wih1-instructions_card') ||
                     instrScreenEl.querySelector('.wih1-instructions_card')
          if (card) {
            card.style.opacity         = '0'
            card.style.transform       = 'translateY(30%)'
            card.style.transition      = 'none'
            card.style.transitionDelay = '0s'
          }
          if (splashEl) hide(splashEl)
          show(screenQuiz)
          show(instrScreenEl)
          instrScreenEl.getBoundingClientRect()   // force reflow
          if (card) {
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease'
            card.style.opacity    = '1'
            card.style.transform  = 'translateY(0)'
          }
        } else {
          if (splashEl) hide(splashEl)
          show(screenQuiz)
          if (timerWrap) show(timerWrap)
          startTimer(false)
        }
      })
    }

    // ── Instructions → Quiz ───────────────────────────────────────────────────
    var instrBtn = qel('instructions-btn')
    if (instrBtn) {
      instrBtn.addEventListener('click', function () {
        hide(instrScreenEl)
        if (timerWrap) show(timerWrap)
        startTimer(false)
      })
    }

    // ── Timeout overlay next button ───────────────────────────────────────────
    if (timeoutNextBtn) {
      timeoutNextBtn.addEventListener('click', function () {
        if (timeoutOverlay) hide(timeoutOverlay)
        goNext()
      })
    }

    // Initialise progress display
    updateProgress()

    // Buttons start disabled until the user makes a selection / submits
    setDisabled(getSubmitBtn(), true)
    setDisabled(getNextBtn(),   true)

    // Pre-load q1 (sets up interact.js bindings); timer starts via button handlers above
    loadQuestion(0, !hasGate)

    // Animate splash columns on load (mirrors quiz.js setBaseline → animateSplash)
    animateSplash()

    // Hide try-again-wrap once the results form is submitted
    var resultsElForForm = qel('results')
    if (resultsElForForm) {
      var tryAgainWrap = qel('try-again-wrap', resultsElForForm)
      var resultsForm  = resultsElForForm.querySelector('form')
      if (resultsForm && tryAgainWrap) {
        resultsForm.addEventListener('submit', function () { hide(tryAgainWrap) })
      }
    }
  }

  // ─── EARLY VISIBILITY SETUP ──────────────────────────────────────────────────
  // Run synchronously — before waitForInteract starts polling — so Webflow's
  // default data-visibility="1" screens never flash visible on page load.
  // init() repeats this logic once interact.js is ready; the second pass is a
  // harmless no-op since the elements are already in the correct state.
  hide(screenQuiz)
  if (timerWrap)      hide(timerWrap)
  hide(qel('results'))
  if (timeoutOverlay) hide(timeoutOverlay)
  if (!qel('splash') && !qel('screen-instructions')) {
    show(screenQuiz)
    if (timerWrap) show(timerWrap)
  }

  waitForInteract(init)

})() // end IIFE
