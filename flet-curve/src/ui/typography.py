"""One scale for every piece of text in the app."""

from __future__ import annotations

#: Anything you actually read: table cells, amounts, dropdown entries.
BODY = 15

#: The second line of a pair -- assets under a pool name, a balance under an
#: amount, a reward token under the CRV range.
SMALL = 13

#: Column headings, section labels, addresses. Present but not competing.
LABEL = 12

#: The smallest thing on screen: chart axis ticks and the crosshair.
TINY = 11

#: A pool's name in the list, where it is the row's subject.
ROW_TITLE = 16

#: A headline figure: the TVL and volume beside a pool's name.
METRIC = 20

#: The pool page's title, and the wordmark in the header, which is sized to
#: match it -- the app's name and the page's subject carry the same weight.
TITLE = 24

#: The same title where the page is a phone.
TITLE_NARROW = 20
