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
    if (node) { node.setAttribute('data-visibility', '1'); node.removeAttribute('hidden') }
  }
  function hide (node) {
    if (node) node.setAttribute('data-visibility', '0')
  }
  function setDisabled (btn, disabled) {
    if (!btn) return
    btn.disabled = !!disabled
    btn.setAttribute('data-disabled', disabled ? 'true' : 'false')
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
    '[data-quiz-element="question"], .wih1-quiz_item'
  )).filter(function (el, i, arr) { return arr.indexOf(el) === i })

  var TOTAL_QUESTIONS = questionEls.length
  if (!TOTAL_QUESTIONS) { console.warn('[wih1-drag-drop] No questions found.'); return }

  // ─── UI REFERENCES ───────────────────────────────────────────────────────────

  var timerWrap      = document.querySelector('.wih1-timer_wrap')
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
  }

  // ─── DROP-ZONE DRAG STYLES ────────────────────────────────────────────────────
  // Injected once at boot; uses data-attributes set by the drag engine.

  function injectDragStyles () {
    if (document.getElementById('wih1-drag-drop-styles')) return

    // Encode the exact SVG from the design spec as a background-image.
    // Using a ::before pseudo-element (position:absolute) means zero layout shift.
    // vector-effect="non-scaling-stroke" keeps stroke-width at 2px at any element size.
    // The gradient ID is scoped to avoid collisions with other page SVGs.
    var svgBorder = 'url("data:image/svg+xml,' + encodeURIComponent(
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
      /* Drop zones need a stacking context for the ::before overlay */
      '.wih1_drop-zone_wrap { position: relative; }',
      /* Dashed border via absolutely-positioned ::before — no layout shift */
      '.is-dragging .wih1_drop-zone_wrap[data-drag-over="ready"]::before {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '  pointer-events: none;',
      '  background-image: ' + svgBorder + ';',
      '  background-size: 100% 100%;',
      '  z-index: 1;',
      '}',
      /* Gradient bg + outline (not border) when prop is over THIS zone — no layout shift */
      '.wih1_drop-zone_wrap[data-drag-over="true"] {',
      '  background: linear-gradient(90deg,#FF00A0 -32.13%,#7100F9 98.41%) !important;',
      '  outline: 2px solid #FAFAFD !important;',
      '  outline-offset: -1px !important;',
      '}',
    ].join('\n')
    document.head.appendChild(style)
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
    var prop = qEl.querySelector('.quiz-prop')
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
      feedbackAnswer.textContent = isCorrect
        ? 'Correct! +' + points + ' points'
        : 'Not quite. The correct answer is ' + getCorrectName(qEl)
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
      qEl.querySelectorAll('.wih1_drop-zone_wrap').forEach(function (zone) {
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
    setDisabled(getNextBtn(),   false)

    // Show timeout overlay popup (mirrors quiz.js behaviour)
    if (timeoutOverlay) show(timeoutOverlay)
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
    if (timeoutOverlay) hide(timeoutOverlay)
    var resultsEl = qel('results')
    if (resultsEl) {
      hide(screenQuiz)
      if (timerWrap) hide(timerWrap)
      show(resultsEl)
      if (UI.finalScore) {
        setTimeout(function () { countUp(UI.finalScore, 0, totalScore, 1000) }, 600)
      }
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

    var prop    = qEl.querySelector('.quiz-prop')       // draggable; CSS ghost via data-drag-active
    var dragImg = qEl.querySelector('.quiz_drag_img')   // fixed background image — JS never moves it
    var instrEl = qEl.querySelector('.drag_drop_img_instructions')
    if (!prop) return

    // Cache correct answer before any reparenting
    if (prop.dataset.correct) qEl.dataset.wih1Correct = prop.dataset.correct

    // Prevent native browser image drag
    prop.setAttribute('draggable', 'false')
    if (dragImg) dragImg.setAttribute('draggable', 'false')

    // ── Reset prop (CSS controls opacity via data-drag-active) ─────────────────
    resetProp(prop)
    prop.removeAttribute('data-drag-active')

    // ── Reset instructions overlay ─────────────────────────────────────────────
    if (instrEl) instrEl.style.display = ''

    // ── Reset drop zones ───────────────────────────────────────────────────────
    qEl.querySelectorAll('.wih1_drop-zone_wrap').forEach(function (zone) {
      var previewImg = zone.querySelector('.wih1_drop_preview_img')
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
    })

    // ── Tear down stale interact.js bindings ───────────────────────────────────
    try { interact(prop).unset() } catch (_) {}
    qEl.querySelectorAll('.wih1_drop-zone_wrap').forEach(function (zone) {
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

          qEl.classList.add('is-dragging')               // CSS hook: .is-dragging .wih1_drop-zone_dragging
          qEl.querySelectorAll('.wih1_drop_preview').forEach(function (p) { p.classList.add('is-dragging') })
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
          qEl.classList.remove('is-dragging')
          qEl.querySelectorAll('.wih1_drop_preview').forEach(function (p) { p.classList.remove('is-dragging') })
          // Drop case: data-drag-active removed inside ondrop's setTimeout
          dropHandled = false
        }
      }
    })

    // ── Drop zones (.wih1_drop-zone_wrap) ─────────────────────────────────────
    qEl.querySelectorAll('.wih1_drop-zone_wrap').forEach(function (zone) {

      interact(zone).dropzone({
        accept:  '.quiz-prop',
        overlap: OVERLAP,

        ondropactivate: function () {
          zone.setAttribute('data-drag-over', 'ready')
        },
        ondragenter: function () {
          zone.setAttribute('data-drag-over', 'true')
          prop.classList.add('prop--over-zone')
        },
        ondragleave: function () {
          zone.setAttribute('data-drag-over', 'ready')  // restore dashed-border state; 'ready' removed by ondropdeactivate
          prop.classList.remove('prop--over-zone')
        },
        ondrop: function () {
          dropHandled = true
          zone.removeAttribute('data-drag-over')
          prop.classList.remove('prop--over-zone')
          if (locked) return

          placed         = true
          selectedLogoId = zone.dataset.dropBg

          // Snap prop to previewWrap centre, then reveal the existing preview img
          var previewWrap = zone.querySelector('[data-drop-element="previewWrap"]')
          var previewImg  = zone.querySelector('.wih1_drop_preview_img')
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
          var previewImg = zone.querySelector('.wih1_drop_preview_img')
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

          // Reset state so the user can drag again
          selectedLogoId = null
          placed         = false
          setDisabled(getSubmitBtn(), true)
        })
      }
    })
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────────

  function init () {
    window.__wih1DragDropReady = true

    injectDragStyles()

    // Wire up timeout overlay next button
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

    // Load first question — no timer until user is ready
    // If there's no splash or instructions screen, start the timer immediately
    var hasGate = qel('splash') || qel('screen-instructions')
    loadQuestion(0, !hasGate)
  }

  waitForInteract(init)

})() // end IIFE
