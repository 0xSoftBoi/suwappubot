"""The panel that says what a transaction is doing.

Setting the words is not showing them: Flet draws a control when it is asked
to, and a panel that only sets its own fields keeps whatever it last said
until some unrelated repaint flushes it.  That is how "Waiting for the
transaction..." stayed on screen, spinner still turning, after the buttons had
already come back -- the button's own update drew the frame, and the message
set a second earlier rode along behind it.
"""

from __future__ import annotations

from ui.status import DONE, StatusPanel


class Drawn(StatusPanel):
    """A panel that counts the times it was asked to draw itself."""

    def __init__(self) -> None:
        super().__init__(page=None)
        self.draws = 0

    def update(self) -> None:
        self.draws += 1


def test_saying_something_draws_it() -> None:
    panel = Drawn()
    panel.say("Waiting for the transaction…", pending=True)
    assert panel.draws == 1, "the words were set but never put on screen"
    assert panel.text.value == "Waiting for the transaction…"
    assert panel.spinner.visible is True


def test_the_spinner_stops_when_the_answer_arrives() -> None:
    panel = Drawn()
    panel.say("Waiting for the transaction…", pending=True)
    panel.say("Approved.", DONE)
    assert panel.draws == 2, "the final word waited for someone else to draw it"
    assert panel.spinner.visible is False, "still spinning at a finished status"
    assert panel.text.value == "Approved."


def test_clearing_draws_too() -> None:
    panel = Drawn()
    panel.say("Approved.", DONE)
    panel.clear()
    assert panel.draws == 2
    assert panel.visible is False
