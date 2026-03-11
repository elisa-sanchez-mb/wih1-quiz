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
  //   - data-visibility="True/False"  controls show/hide
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
    if (node) { node.setAttribute('data-visibility', 'True'); node.removeAttribute('hidden') }
  }
  function hide (node) {
    if (node) node.setAttribute('data-visibility', 'False')
  }
  function setDisabled (btn, disabled) {
    if (!btn) return
    btn.disabled = !!disabled
    btn.setAttribute('data-disabled', disabled ? 'true' : 'false')
  }

  // ─── CONFIGURATION ───────────────────────────────────────────────────────────

  var screenQuiz = qel('screen-quiz')
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

  var timerWrap = document.querySelector('.wih1-timer_wrap')
  var UI = {
    progressCurrent: qel('progress-current'),
    progressTotal:   qel('progress-total'),
    scoreDisplay:    qel('score-display'),
    timerBar:        qel('timer-bar'),
    timerText:       qel('timer-text'),
    maxScoreDisplay: qel('max-score-display'),
    finalScore:      qel('final-score'),
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
    var prop = qEl.querySelector('.quiz-prop')
    return prop ? prop.dataset.correct : null
  }

  function getCorrectName (qEl) {
    var logoId = getCorrectLogoId(qEl)
    if (!logoId) return ''
    var el = qEl.querySelector('[data-logo-id="' + logoId + '"]')
    // Use alt text, a data-name attribute, or fall back to the raw id
    return el ? (el.getAttribute('alt') || el.dataset.name || logoId) : logoId
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
      feedbackWrap.setAttribute('data-disabled',         'false')
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
      feedbackWrap.setAttribute('data-disabled', 'true')
      feedbackWrap.removeAttribute('data-feedback-correct')
    }
    if (feedbackAnswer) feedbackAnswer.textContent = ''
  }

  // ─── ANSWER REVEAL ────────────────────────────────────────────────────────────

  function revealAnswers (qEl) {
    var correctLogoId = getCorrectLogoId(qEl)
    qels('answer', qEl).forEach(function (btn) {
      btn.setAttribute('data-locked',  'true')
      btn.setAttribute('data-correct', btn.dataset.logoId === correctLogoId ? 'true' : 'false')
    })
    swapLogo(qEl, 'answer')
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
    prop.style.transform  = 'translate(0, 0)'
    prop.style.transition = ''
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

  // ─── DROP ZONE WRAPPING ───────────────────────────────────────────────────────
  // Wraps each .logo-drop-zone <img> in a .wih1-drop-overlay <div> so the img
  // never intercepts pointer events meant for the dragged prop.  Idempotent.

  function wrapDropZones (qEl) {
    qEl.querySelectorAll('.logo-drop-zone').forEach(function (img) {
      if (img.parentElement.classList.contains('wih1-drop-overlay')) return
      var wrapper        = document.createElement('div')
      wrapper.className  = 'wih1-drop-overlay'
      wrapper.dataset.logoId = img.dataset.logoId
      img.parentNode.insertBefore(wrapper, img)
      wrapper.appendChild(img)
      img.style.pointerEvents = 'none'
    })
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
    prop.style.transform = 'translate(' + x + 'px, ' + y + 'px)'
  }

  function snapPropBack (prop) {
    // Animate back to the fixed origin (translate 0,0 = the viewport position
    // captured at drag start), then restore to in-flow positioning.
    prop.style.transition = 'transform ' + SNAP_BACK_MS + 'ms cubic-bezier(0.34, 1.56, 0.64, 1)'
    prop.style.transform  = 'translate(0, 0)'
    prop.setAttribute('data-x', 0)
    prop.setAttribute('data-y', 0)
    setTimeout(function () {
      prop.style.transition = ''
      restorePropToFlow(prop)
    }, SNAP_BACK_MS)
  }

  function snapPropToZone (prop, zone) {
    var propRect = prop.getBoundingClientRect()
    var zoneRect = zone.getBoundingClientRect()
    var pos      = getPropPos(prop)
    var offsetX  = (zoneRect.left + zoneRect.width  / 2) - (propRect.left + propRect.width  / 2)
    var offsetY  = (zoneRect.top  + zoneRect.height / 2) - (propRect.top  + propRect.height / 2)
    var finalX   = pos.x + offsetX
    var finalY   = pos.y + offsetY
    prop.style.transition = 'transform ' + SNAP_TO_MS + 'ms ease'
    setPropPos(prop, finalX, finalY)
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

  function initQuestion (qEl) {
    if (!qEl) return

    var prop = qEl.querySelector('.quiz-prop')
    if (!prop) return

    resetProp(prop)
    wrapDropZones(qEl)

    // Tear down stale interact.js bindings
    try { interact(prop).unset() } catch (_) {}
    qEl.querySelectorAll('.wih1-drop-overlay').forEach(function (w) {
      try { interact(w).unset() } catch (_) {}
    })

    // Reset drop zone visual state
    qEl.querySelectorAll('.wih1-drop-overlay').forEach(function (w) {
      w.removeAttribute('data-drag-over')
      w.classList.remove('drop-zone--active', 'drop-zone--correct', 'drop-zone--wrong', 'drop-zone--ready')
    })

    // Flag: did ondrop fire during this drag gesture?
    var dropHandled = false

    // ── Draggable ─────────────────────────────────────────────────────────────
    interact(prop).draggable({
      inertia:    false,
      autoScroll: true,
      modifiers: [
        interact.modifiers.restrictRect({ restriction: 'body', endOnly: true })
      ],
      listeners: {
        start: function (event) {
          if (locked) { event.interaction.stop(); return }
          // Reparent to body so position:fixed is always relative to the
          // viewport, not a transformed ancestor (which would misalign the
          // drag start point).
          liftPropToBody(prop)
        },
        move: function (event) {
          if (locked) { snapPropBack(prop); return }
          var pos = getPropPos(prop)
          setPropPos(prop, pos.x + event.dx, pos.y + event.dy)
        },
        end: function () {
          if (!dropHandled) {
            // Released mid-air — snap back
            snapPropBack(prop)
          }
          // If a drop WAS handled, leave position:relative + z-index:1000 so
          // the prop stays visually on top of the logo it landed on.
          dropHandled = false
        }
      }
    })

    // ── Drop zones ────────────────────────────────────────────────────────────
    qEl.querySelectorAll('.wih1-drop-overlay').forEach(function (wrapper) {
      interact(wrapper).dropzone({
        accept:  '.quiz-prop',
        overlap: OVERLAP,

        ondropactivate: function () {
          wrapper.classList.add('drop-zone--ready')
        },
        ondragenter: function (event) {
          wrapper.setAttribute('data-drag-over', 'true')
          wrapper.classList.add('drop-zone--active')
          event.relatedTarget.classList.add('prop--over-zone')
        },
        ondragleave: function (event) {
          wrapper.removeAttribute('data-drag-over')
          wrapper.classList.remove('drop-zone--active')
          event.relatedTarget.classList.remove('prop--over-zone')
        },
        ondrop: function (event) {
          dropHandled = true
          wrapper.removeAttribute('data-drag-over')
          wrapper.classList.remove('drop-zone--active', 'drop-zone--ready')
          event.relatedTarget.classList.remove('prop--over-zone')

          if (locked) { snapPropBack(prop); return }

          // Record selection and snap prop to zone centre
          selectedLogoId = wrapper.dataset.logoId
          snapPropToZone(prop, wrapper)

          // Mark the corresponding answer element as selected (for CSS states)
          qels('answer', qEl).forEach(function (btn) {
            btn.setAttribute('data-selected', btn.dataset.logoId === selectedLogoId ? 'true' : 'false')
          })

          // Enable submit button — user confirms by clicking it
          setDisabled(getSubmitBtn(), false)
        },
        ondropdeactivate: function () {
          wrapper.classList.remove('drop-zone--ready', 'drop-zone--active')
        }
      })
    })
  }

  // ─── BOOT ─────────────────────────────────────────────────────────────────────

  function init () {
    window.__wih1DragDropReady = true

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
