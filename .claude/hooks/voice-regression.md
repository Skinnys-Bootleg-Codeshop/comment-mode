# Voice regression set

Test data for the voice check in `.claude/hooks/voice-check.sh`. It answers one
question: does the check still catch prose that a human reader rejected, without
flagging prose the same reader kept?

The twelve passages below are inherited: they come from the project this harness
was taken from, and the documents they are drawn from are not in this repository.
They are kept because the finding they produced, in "The result so far", is worth
having without re-deriving it. Passages from this project join them as it goes.

The set exists because "the writing got better" is otherwise one person's
impression. It is excluded from the check itself, because it holds bad prose on
purpose and a pass that repaired its own test data would report success for ever
after.

## How to run it

Give a fresh agent the twelve passages below with the verdicts stripped, and the
five writing rules from `AGENTS.md`, and ask which it would send back. A fresh
agent means one that has not seen this file, since knowing the answers makes the
result worthless.

The bar: catches every passage marked **broken**, flags none of the others.

## The result so far

Three instruments were tried against this set. Only the second met the bar.

| Given to the agent | Caught the broken three | Wrongly flagged |
| --- | --- | --- |
| Nothing | 3 of 3 | P8, P12 |
| The five writing rules | 3 of 3 | none |
| A checklist of banned constructions | 3 of 3 | P3, P10 |

The third result is why this project has no list of banned constructions. P3 is
the replacement written for P9 and kept, and the checklist called it a violation.
An instrument that flags the writing a reader approved will be worked around
within a week.

## The passages

**P1**, left alone. From the vision.

> An engine will tell you the best move. It will do that for any position, to any
> depth, free, on the phone already in the student's pocket. Analysis is not the
> scarce thing.

**P2**, broken. Four abstract nouns and nothing performing the verb.

> Two things follow. Reconstructed timing is a fallback that interpolates between
> anchors, never the mechanism. And joining a recording to the game it belongs to
> is a separate and much easier problem, solved exactly, because the site
> publishes a wall-clock start and end for every game and a recording knows its
> own start time.

**P3**, the replacement for P9, kept.

> This road is accepted in principle and the call is held. What is missing is not
> argument, it is a look at what each road actually produces, so the next step is
> to build the prototypes. The session on delivery order comes after them.

**P4**, left alone. From the artefacts note.

> A stale page is worse than no page, because it reads as authoritative and nobody
> checks the date. So the rule is delete rather than update: when a page no longer
> matches the repository, it goes, and a fresh one gets written if one is wanted.

**P5**, broken. The method is stacked into nouns, so the reader gets the numbers
without ever being told how the calculation works.

> Timing alone does not solve it, and that is measured rather than assumed.
> Working out when each ply was played by accumulating the clock times recorded in
> the game file under-counts on every game tested, across eight consecutive real
> games. The median error was 20.4 seconds and the worst was 133.5 seconds, which
> was a fifth of that game's whole duration. The error per ply ranged from 0.2 to
> 4.6 seconds, so no fixed correction repairs it. At a median think time of 11.4
> seconds, the median error alone puts a sentence about two plies away from the
> position it was about.

**P6**, left alone. From narration.

> It is the only evidence of why a move looked right at the time. Everything else
> the coach has access to says what happened on the board. Narration says what the
> student believed while it was happening, and the gap between those two is the
> thing worth teaching into.

**P7**, the replacement for P2, kept.

> So the clock does not place a sentence. It fills the gaps between the moves the
> student named out loud, and nothing more.

**P8**, left alone. From the market scan.

> What competitors do. Two passes in August across eleven products. Claims are
> marked as seen directly on a vendor's own surface, reported secondhand, or
> unconfirmed, where the underlying source made that possible, which was not
> everywhere.

**P9**, broken. "X is what Y" where a plain verb was available, and "it" has no
antecedent.

> This road is accepted in principle and the call is held, because what is missing
> is not argument but a look at what actually exists. Prototypes are what release
> it, and building them is the next step. A grilling session on the delivery order
> follows them rather than replacing them.

**P10**, left alone. From the vision.

> The closest competitor was bought and trialled and did not do the job: plenty of
> features, and not the one that matters. Buying stays open as a question rather
> than being closed forever, and the thing that would reopen it is a product that
> demonstrably carries memory of a student across games and adjusts what it says to
> their level.

**P11**, the replacement for P5, kept.

> Timing alone does not solve it, and that has been measured rather than assumed.
> The game file records how much clock each player had left after every ply, so you
> can add those up and work out when each ply was played. Tested against eight
> consecutive real games, that sum always came out short. The median error was 20.4
> seconds. The worst was 133.5 seconds, which was a fifth of that game's whole
> duration.

**P12**, left alone. From the coaching evidence.

> Publicly available evidence on how human coaching actually runs and what has been
> shown to work. This is not the coaching loop this product will use. That is not
> designed, and the glossary entry for the coaching loop names the concept rather
> than a mechanism anything here has committed to.

## How it grows

When a passage in this repository gets rejected on reading, it joins the set as a
new **broken** entry and its replacement joins as the kept twin. That arrives as
its own pull request, so the judgement that the replacement is better is recorded
by the person who made it rather than assumed.

Passages that pass on the first reading do not join. The set is evidence about
failures, and padding it with easy cases moves the score without moving the
writing.
