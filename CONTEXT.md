# Comment mode

A way to leave comments on any part of an HTML page that agents made, a single page or a whole site, so that an agent can read them and act without ambiguity. It stands alone: the portfolio /admin panel is its first host, not its owner.

## Language

**Comment**:
Text someone wrote about one part of a page, with a sentiment. Like a comment in a Google Doc, it is just text plus a reference to the part it is about; it carries no type or intent.
_Avoid_: Annotation, feedback, note

**Anchor**:
The reference from a comment to the part of the page it is about: the quoted text, its scope and enough surrounding context to find it again.
_Avoid_: Selection, highlight, pin (the pin is only the marker on screen)

**Scope**:
How much of the page an anchor covers: a word, a sentence, a block or a section.

**Sentiment**:
Whether a comment is positive, negative or neutral.

**Orphaned**:
Said of a comment whose anchor can no longer be found on the page.

**Comment mode**:
The state of a page in which tapping places a comment instead of following links or selecting text.

**Host**:
The site or app that embeds comment mode and decides who may comment and where comments are stored.

**Author**:
The person who wrote a comment, as the host identifies them. Empty when there is no host login, such as on a local file.
_Avoid_: User, commenter

**Meta**:
An open slot for host metadata on a comment, supplied at `init` time and stamped onto every comment created that session. Comment mode never reads or interprets it; only the host gives it shape (for example `{team, role, ticket}`).

**Page reference**:
What the host says a page is: its identity (such as a URL or file path) and, if the host cares, its version or source. Comment mode never infers it; the implementor supplies it.
_Avoid_: Page id, URL (a URL is only one possible reference)

**Reply**:
A comment's follow-up text from any author, a person or an agent, shown under it on the page.

**Resolved**:
Said of a comment that its author or anyone replying has closed. A comment is either open or resolved; any richer workflow belongs to the host.
