# Hosts bring their own storage

Comment mode ships no hosted backend. On a local file, comments stay in the browser. On a hosted site, the host plugs its own storage into an abstraction that comment mode defines (portfolio uses its own Upstash). We chose this so the public tool has no service to run, no data of anyone else's to hold, and no login of its own: who may comment is the host's decision.

The plug-in is thin: load a page's comments, save comments by id, and optionally report changes. Comment mode itself always writes to the browser first and then syncs, so every host gets offline-first behaviour and conflict handling without building it.

Comment mode includes a ready-made plug-in that talks to one host endpoint in a documented format, so a host with a server only writes that endpoint.
