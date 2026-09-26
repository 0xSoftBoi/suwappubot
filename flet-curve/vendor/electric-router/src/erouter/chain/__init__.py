"""Reading a chain, without knowing how the bytes get there.

Between `core`, which is arithmetic over a pinned state, and `dev`, which owns
a socket and a CLI.  Everything here talks to a `core.transport.Transport` and
nothing here opens a connection: the pool universe's dialects and balances, the
wrapper and node map, the exact-model readers and their verdicts, the committed
slot cache, and a local EVM to answer it all in-process.

Which is to say: this is the half a browser runs.  `tests/test_purity.py` holds
it to the same rule `core` lives under -- stdlib and numpy at module scope, and
never an import from `dev` -- because the Flet frontend runs the wei-exact gate
itself rather than trusting verdicts it did not check
(`docs/browser-port.md` section 4).

It may import from `core`; `core` may not import from it.
"""
