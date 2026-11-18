# Title bar: a drawn cog, and the Ziblet mark with the dots of Ziblet's menu-bar icon

Issue: https://github.com/kortexa-ai/sideleaf.desktop/issues/86

Two visual corrections after the 0.1.12 release. They ship with the next release.

The settings cog was a text character. A character sits where its font puts it, so
it was about 1 pixel lower than the drawn icons beside it, and its font differed
between systems. It is now an SVG shape with the same filled look, centred by its
geometry, on macOS and on Windows.

The Ziblet mark on the "Notes" button (macOS only) had dots of 2.6 on a pitch of 4.
It now has the dots of Ziblet's menu-bar icon, without the plate, and like that icon
it has one drawing for each pixel density: squares of 2 pixels, 1 pixel apart, at
1 pixel per point; circles of 2.5 points, half a point apart, at 2. A media query on
the pixel density chooses the drawing. One unit of the drawing is one point, and the
mark is 12 points in both layouts, so the dots stay on whole pixels. When Ziblet's
menu-bar icon changes its dots, change the mark here.

Execution evidence belongs in the issue and Project 4.
