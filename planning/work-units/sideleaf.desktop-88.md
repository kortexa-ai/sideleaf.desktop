# Escape closes the settings and the menus after a mouse click

Issue: https://github.com/kortexa-ai/sideleaf.desktop/issues/88

The settings panel, the Sideleaf menu and the File menu of the minimal layout each
had their Escape handler on themselves. A key press goes to the element that has the
keyboard focus. After a mouse click on the button, the focus is not inside the panel
or the menu: WebKit on macOS gives a clicked button no focus, and the button is
beside the panel, not inside it. So Escape did nothing.

One key listener on the document now closes an open panel or menu on Escape, when
no other part of the page used the key. It does not move the focus, because the
focus was not in the panel. The handlers on the panel and on the menus stay: with
the focus inside they get the key first, close, and put the focus back on the
button.

The distraction-free mode takes Escape before this listener. The find bar and the
dialogs use the key themselves, so one press closes them first and a second press
closes a panel that is still open.

Execution evidence belongs in the issue and Project 4.
