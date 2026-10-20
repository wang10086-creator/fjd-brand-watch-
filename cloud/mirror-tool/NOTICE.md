# Capture worker tool

SingleFile CLI 2.19.0, Copyright Gildas Lormeau and contributors.
AGPL-3.0-or-later. See LICENSE.SingleFile.txt and the original source:
https://github.com/gildas-lormeau/single-file-cli
https://github.com/gildas-lormeau/single-file-core

Installed package and its bundle are unmodified and not published to the web UI.
prepare.mjs only extracts the upstream browser engine for our isolated capture
worker. No PDF or screenshot-print option is invoked. The integration source is
public in this repository's cloud/mirror-html.py. Python dependencies: Playwright
(Apache-2.0), lxml (BSD), tinycss2 (BSD), Pillow (HPND).
