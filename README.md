# FlashLearn

A self-hosted, Quizlet-style flashcard app with **Learn** and **Cram** modes. Plain HTML, CSS and JavaScript: no build step, no server, no account. Your decks and progress live in your browser.

## Open it

- **Laptop:** double-click `index.html` (opens in Chrome or Edge from `file://`). That's it.
- **Hosted:** any static host works (GitHub Pages, Netlify, `python -m http.server`).
- **Phone**, pick one:
  - **Wi-Fi from the laptop:** double-click `serve-phone.cmd` (needs Python), then on the phone (same Wi-Fi) open `http://<laptop IP>:8000` and "Add to Home screen". Keep the laptop window open while studying.
  - **Single file:** `dist/flashlearn.html` is the whole app in one file (images included). Put it on the phone (Drive → download). Android Chrome opens it from Downloads; iPhone Safari cannot run local HTML files, so use the Wi-Fi option or a host there.
  - **Hosted:** any static host (GitHub Pages on a public repo or paid plan, Netlify Drop, Cloudflare Pages). This repo is private, and GitHub Pages for private repos needs a paid plan.

Two decks come pre-loaded on first run: **PCC 101 Exam 1** (102 cards) and **PCC 101 Structures** (33 cards, each with a structure image).

## Features

- Decks grouped by **folder**, deck search, rename, delete, move to folder.
- **Import from Quizlet**: paste exported text, or pick several `.txt` files at once (each file becomes a deck named after the file). Paste many sets at once by putting a header line `# Set name` before each set. Separators: Tab (Quizlet default), comma, ` - `, or custom; card separator: new line, semicolon, or custom.
- **Export** a deck back to Quizlet text (tab + new line), or as JSON with progress.
- **Card editor**: inline editing, star, search, add/delete, images on the term side and the definition side (upload, or click a text box and paste a screenshot). Images are downscaled so they fit in browser storage.
- **Flashcards**: tap or Space to flip, arrows or swipe to move, shuffle, starred only, choose the front side, `S` stars the card.
- **Learn** and **Cram** (below), with options: answer with term or definition, question types (multiple choice, written), starred only, cards per round.
- **Keyboard**: `1`–`4` pick a choice, `Enter` submits and continues, `Space` flips.
- Mobile-first layout, large tap targets, automatic dark mode.

### Moving to Quizlet-free

Quizlet: open a set → **⋯** → **Export** → copy the text (or save it as a `.txt` file). In FlashLearn: **Import from Quizlet** → paste, or choose all your `.txt` files at once and give them a folder name.

Quizlet's text export **does not include images**. For image cards, re-add the pictures in the card editor (click the text box and paste, or use **+ Image**).

### Laptop ↔ phone

Everything is stored in the browser you use (localStorage). **Backup / Sync** on the home screen:

1. **Export everything (.json)** on one device (or **Share backup file…** on a phone).
2. Move the file (Drive, email, AirDrop).
3. **Import backup** on the other device. Import merges deck by deck: the more recently changed copy of each deck wins, so progress made on either device is kept.

Export a backup now and then; clearing browser data erases local decks.

## How Learn and Cram work

### Learn (spaced, adaptive; Quizlet Learn behavior)

What Quizlet documents: Learn builds a personalized path from how familiar you are with each term; it asks multiple choice first and moves to harder written questions as you answer correctly; a term becomes **Familiar** after one correct answer and **Mastered** after a second correct answer; you can choose answer side, starred terms, and question types in Options ([Quizlet Help: Studying with Learn](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn), [Introducing the new Quizlet Learn](https://quizlet.com/blog/introducing-the-new-quizlet-learn), [Quizlet study modes](https://quizlet.com/features/study-modes)). Quizlet engineering describes the original Learn as "ask every term, repeat the ones you missed until all are correct", later replaced by an adaptive Learning Assistant with a memory model and spaced repetition ([Tech @ Quizlet: Spaced Repetition for All](https://medium.com/tech-quizlet/spaced-repetition-for-all-cognitive-science-meets-big-data-in-a-procrastinating-world-59e4d2c8ede1), [Quizlet: The science behind spaced repetition](https://quizlet.com/content/science-behind-spaced-repetition)).

FlashLearn's version:

- **Rounds of 7** (adjustable). A round draws, in order: mastered cards that are due for review, then Familiar cards (most-missed first), then New cards in deck order.
- **New → Familiar** with a correct multiple-choice answer. **Familiar → Mastered** with a correct written answer.
- **A miss** drops the card one level (Mastered → Familiar → New) and puts it back **three questions later in the same round**, so it returns quickly, as the easier question type.
- The round ends when every card in it has been answered correctly once. The **round summary** lists the cards you missed with their answers.
- **Written grading** ignores case, punctuation and extra spaces; treats `₂` as `2`; accepts the answer without its (parenthetical); and allows small typos scaled by length (0 for ≤3 letters, 1 up to 7, 2 up to 14, then about 1 per 6 letters). Near misses show **I was right** to override.
- **Multiple-choice distractors** come from the same deck and favor plausible ones (similar length, shared words, similar shape), and never a choice that is a shorter or longer version of the right answer.
- **Spaced review** after mastery (SM-2 style): first review 1 day later, then the interval grows by about 2.5×. Due cards come back into Learn rounds as written questions; a miss sends the card back to Familiar.

### Cram (everything, now)

Quizlet separates long-term spaced study from test-prep cramming: its engineering team notes most students study in short intensive sessions before a test, and Learn offers a test-date study plan that compresses the schedule. Cram is the "test tomorrow" mode: no waiting between reviews.

- A small working set (the round size) cycles continuously.
- Each card starts as multiple choice (if enabled); after a correct choice it must be **typed** correctly to be **cleared**.
- **Misses come back two questions later** and restart at multiple choice.
- When every card is cleared, a **final shuffled pass** over the whole deck (written); misses repeat until each is answered right.
- The end screen lists **trouble cards** (most-missed first) with a button to star them, so you can re-drill just those with "starred only".
- Cram progress is separate from Learn and resumes where you left off.

## Development

```
npm test          # node --test, pure logic in js/core.js
npm run seed      # rebuild decks/seed.js from decks/src/*.txt
node tools/build-single.js   # rebuild dist/flashlearn.html after changing the app
```

- `js/core.js`: grading, import parsing, distractors, Learn and Cram scheduling (pure, tested).
- `js/app.js`: the UI. `decks/seed.js`: first-run decks, embedded as JS so they load under `file://`.
- Classic `<script>` tags on purpose: ES modules do not load from `file://` in Chrome.
