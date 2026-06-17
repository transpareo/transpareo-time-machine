# Third-party licenses

The Transpareo Time Machine is licensed GPL-3.0-or-later
(see LICENSE). The following third-party code and artwork
is vendored in-tree and ships inside the built bundles
under its own license, reproduced or linked below as each
license requires.

## noble-ed25519

- Version: 3.1.0, copied verbatim from the npm package
  (https://github.com/paulmillr/noble-ed25519).
- Source file: `src/crypto/ed25519.ts`.
- Built artefacts containing it: `dist/locales/ed25519.js`
  and `dist-embed/ed25519.js` (lazily-loaded chunks; they
  also retain the `/*! ... */` license banner inline).

```
The MIT License (MIT)

Copyright (c) 2019 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Icon artwork

The icon sprite (`public/icons.svg`) and the inlined
functional sprite in `src/icons.ts` (which ships inside
`dist/transpareo-time-machine.js`, `dist/dpp-verifier.js`,
and `dist-embed/embed.js`) contain glyphs converted from
several icon fonts via Fontello (https://fontello.com),
reshaped into an SVG `<symbol>` sprite. Per-set provenance,
determined by matching glyph path data against the upstream
font sources:

### Font Awesome 4.7 (by Dave Gandy)

- Copyright (C) 2016 by Dave Gandy,
  https://fontawesome.com (v4 archive:
  https://fontawesome.com/v4/).
- License: SIL OFL 1.1 (full text below) for the icon
  artwork.
- Symbols: `icon-bell`, `icon-bold`, `icon-cancel`,
  `icon-cog`, `icon-communication`, `icon-header`,
  `icon-heart`, `icon-italic`, `icon-link`,
  `icon-link-ext`, `icon-list-bullet`,
  `icon-list-numbered`, `icon-media`, `icon-menu`,
  `icon-money`, `icon-recycle`, `icon-shield`,
  `icon-sliders`, `icon-star`, `icon-star-empty`,
  `icon-stats`, `icon-tag`, `icon-thermometer`,
  `icon-truck`, `icon-website`, `icon-wrench`.

### Entypo (by Daniel Bruce)

- Copyright (C) 2012 by Daniel Bruce,
  http://www.entypo.com.
- License: the Entypo pictograms are CC BY-SA
  (https://creativecommons.org/licenses/by-sa/4.0/); the
  font file they were extracted from is SIL OFL 1.1.
  The glyphs were modified: converted from font glyphs to
  an SVG symbol sprite. The Entypo-derived symbols remain
  under CC BY-SA; they are not relicensed under this
  project's GPL.
- Symbols: `icon-attention`, `icon-circle`, `icon-clock`,
  `icon-content`, `icon-droplet`, `icon-eye`,
  `icon-flash`, `icon-globe`, `icon-history`,
  `icon-home`, `icon-info`, `icon-key`, `icon-leaf`,
  `icon-pencil`, `icon-quote`, `icon-resize-full`,
  `icon-user`, `icon-users`.

### Iconic (by P.J. Onori)

- Copyright (C) 2012 by P.J. Onori,
  https://somerandomdude.com/work/iconic/.
- License: the icon artwork is CC BY-SA 3.0 US
  (https://creativecommons.org/licenses/by-sa/3.0/us/);
  the font file is SIL OFL 1.1. Modified as above; the
  Iconic-derived symbols remain under CC BY-SA.
- Symbols: `icon-ok`, `icon-umbrella`.

### Elusive Icons (by Aristeides Stathopoulos)

- Copyright (C) 2013 by Aristeides Stathopoulos.
- License: SIL OFL 1.1 (full text below).
- Symbols: `icon-arrow`, `icon-calendar`,
  `icon-certificate`.

### Maki (by Mapbox)

- Copyright (C) Mapbox, https://labs.mapbox.com/maki-icons/.
- License: BSD (Fontello-era distribution); current
  upstream Maki is CC0 1.0. Credit retained either way.
- Symbols: `icon-building`.

### Modern Pictograms (by John Caserta)

- Copyright (C) 2012 by John Caserta.
- License: SIL OFL 1.1 (full text below).
- Symbols: `icon-trash`.

### First-party glyphs

The remaining symbols are Transpareo originals and carry
the project license: the rating smileys
(`icon-smiley-very-bad` through `icon-smiley-very-good`),
`icon-locked`, `icon-looking-glass`,
`icon-exclamation-mark`, `icon-question-mark`,
`icon-move`, `icon-down`, `icon-up`, `chevron-down`,
`spinner`, and `icon-download`.

### SIL Open Font License 1.1

Applies to the Font Awesome, Elusive Icons, and Modern
Pictograms glyphs above (and to the font files the Entypo
and Iconic glyphs were extracted from).

```
SIL OPEN FONT LICENSE
Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
