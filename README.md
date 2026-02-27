# WIH1 Quiz Game

## Overview

This quiz is built entirely in Webflow and controlled via JavaScript using `data-quiz-element` attributes. Questions and answers are authored in the Designer; the script reads structure + correctness from the DOM and applies state back to the DOM using attributes so styling can be handled in Webflow.

The quiz supports:

- Variable number of questions
- Single-select multiple choice
- Per-question countdown timer with progress bar + warning state
- Timeout overlay with correct answer reveal
- Per-question scoring based on remaining time
- Global progress + score display
- Results screen with restart + (optional) hidden form field for score

---

## Screen / Flow Logic

### Initial page state

- The **instructions screen is visible** on load.
- The quiz UI may be present underneath, but **the timer is NOT running** until the user starts.
- Splash may exist (if used) but does not affect the game logic unless explicitly wired.

### Start game

- User clicks the button inside the instructions screen:
    - `data-quiz-element="instructions-btn"`
- JS hides:
    - `data-quiz-element="instructions"`
- JS starts the game:
    - Sets `currentQuestionIndex = 0`
    - Resets total score and UI state
    - Shows question 1
    - Starts timer for question 1

---

## DOM Structure Assumptions

### Quiz wrapper (config source)

`data-quiz-element="screen-quiz"` contains configuration:

- `data-quiz-question-time="15"` → seconds per question
- `data-quiz-pass-score="100"` → currently not used (all users "pass" for now)

### Questions

Each question block:

- `data-quiz-element="question"`
- Contains multiple answer options:
    - `data-quiz-element="answer"` (each option)
- The correct answer is defined in the DOM (source-of-truth TBD — see correctness section below)

### Global UI elements

Persistent UI outside questions:

- Progress:
    - `data-quiz-element="progress-current"`
    - `data-quiz-element="progress-total"`
- Total score:
    - `data-quiz-element="score-display"`
- Timer:
    - `data-quiz-element="timer-bar"`
    - `data-quiz-element="timer-text"`
    - Timer wrapper supports warning styling via:
        - `data-warning="true|false"` on `.wih1-timer_wrap`

### Buttons

Per-question controls (global for current question context):

- Submit:
    - `data-quiz-element="submit-btn"`
- Next:
    - `data-quiz-element="next-btn"`

Buttons use:

- `data-disabled="true|false"` to represent enabled/disabled state
         (Visual styling is handled in Webflow; JS only toggles attributes and/or `disabled` property depending on how the component is built.)

### Feedback message block

A shared feedback container exists per question (in your sample it's inside the question card):

- Wrapper:
    - `data-quiz-element="feedback-msg"`
    - `data-feedback-correct="true|false"` indicates correct vs incorrect styling
- Inner span for injected text:
    - `data-quiz-element="feedback-answer"`

Message behavior:

- For correct → static "Correct!" + points earned
- For incorrect → static "Not quite…" + correct answer text

### Results + restart

- Results screen wrapper:
    - `data-quiz-element="results"`
- Restart button:
    - `data-quiz-element="restart-btn"`

Restart resets the quiz state and returns user to the beginning flow (exact screen destination depends on final UX — typically back to instructions).

---

## Game State Model

The JS maintains runtime state:

- `currentQuestionIndex` (0-based)
- `selectedAnswerIndex` (or `null`)
- `isLocked` (prevents changes once submitted or timed out)
- `timeRemaining` (integer seconds)
- `totalScore` (integer)

State is reflected into the DOM via attributes for styling and via text updates for score/progress/timer.

---

## Question Interaction Rules

### Selection (single-select)

- Clicking an answer sets it as selected:
    - clicked option: `data-selected="true"`
    - all other options in that question: `data-selected="false"`
- Once an answer is selected:
    - Submit button becomes enabled (data-disabled → false)
- Next button remains disabled until the question is resolved (submitted or timed out).

### Submitting an answer

On "Submit my answer" click:

- If no answer selected → do nothing (submit remains disabled anyway)
- Lock the question:
    - set `data-locked="true"` on all answers
    - prevent additional selection changes
- Reveal correctness:
    - correct answer gets `data-correct="true"`
    - all others should be `data-correct="false"` (or attribute removed depending on styling approach)
- Stop timer
- Feedback message appears and is populated via `[data-quiz-element="feedback-answer"]`
- Next button becomes enabled
- Submit button becomes disabled (or hidden depending on final UX)

### Correct submission scoring

- Points awarded = `timeRemaining` at moment of submit
- Score increments immediately and updates:
    - `[data-quiz-element="score-display"]`

### Incorrect submission scoring

- 0 points
- Correct answer still revealed
- Feedback includes the correct answer text

---

## Timer Rules

### Timer start

- Timer starts only after:
    - Instructions are hidden AND
    - A question is loaded

### Timer behavior

- Counts down once per second from `QUESTION_TIME` to 0
- Updates:
    - `[data-quiz-element="timer-text"]` → integer
    - `[data-quiz-element="timer-bar"]` → width percentage based on remaining time

### Warning state (last 5 seconds)

When `timeRemaining <= 5`:

- Set `data-warning="true"` on `.wih1-timer_wrap`

When above 5 seconds:

- Set `data-warning="false"`

This enables Webflow styling changes (bar color, text color, etc.).

### Timeout behavior

When timer reaches 0:

- Lock the question (same as submit)
- Reveal the correct answer
- Display timeout overlay (global overlay outside questions)
- Overlay contains a span where the correct answer text is injected
- 0 points awarded
- Overlay includes "Next question" button to proceed

---

## Navigation / Progression

### Next question

Triggered by:

- clicking `[data-quiz-element="next-btn"]` after submit, OR
- clicking timeout overlay next button

Behavior:

- increments `currentQuestionIndex`
- loads next question
- resets selection and UI state for that question
- disables submit + next until a selection is made
- restarts timer

### Progress UI

On each question load:

- `progress-current = currentQuestionIndex + 1`
- `progress-total = total number of questions in DOM`

### End of quiz

After last question:

- Stop timer
- Show results screen:
    - `data-quiz-element="results"`
- Populate score display in results as needed
- If a Webflow form exists, set hidden input value to `totalScore` before form submit (if implemented).

---

## Correct Answer Source of Truth (important)

You stated: *"data-correct=true|false on the answer should also update the data attribute on the question."*

For maintainability, we should choose one authoring source-of-truth:

**Recommended:**

- Author correctness per question via a single attribute on the question:
    - e.g. `data-correct-answer="0"` (index), OR
    - `data-correct-id="some-id"`
- JS then **sets `data-correct="true|false"` dynamically** only when revealing.

This prevents authors accidentally leaving multiple `data-correct="true"` answers in the Designer.

If instead you want authors to mark the correct answer in the Designer:

- Exactly one answer per question should ship with `data-correct="true"` initially
- JS reads it at init, stores the correct index, then clears it until reveal time

Either is doable — we just need to standardize.
