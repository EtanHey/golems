---
name: practice
description: Start an interview practice session with Elo-rated skill tracking. Supports 7 interview types.
---

# Interview Practice

Run an interactive interview practice session.

**Arguments**: $ARGUMENTS — optional interview type

**Types**: behavioral, technical, system-design, coding, culture-fit, case-study, general (default)

## Process

1. Read current Elo ratings from practice DB (`@golems/recruiter/practice-db-cloud` or local)
2. Select difficulty based on Elo for the chosen type (lower Elo = easier questions)
3. Generate a practice question using LLM appropriate to type and difficulty
4. Present the question and wait for the user's answer
5. Evaluate the response: score 1-10 with detailed feedback
6. Update Elo rating: win (7+) adjusts up, loss (≤4) adjusts down, draw (5-6) minimal change
7. Show: score, feedback, Elo change, new Elo

## Elo System

- Starting Elo: 1200
- K-factor: 32 (high sensitivity for faster calibration)
- Each practice type has independent Elo
- View all ratings with `/recruiter-golem:stats` (if available) or check practice DB directly
