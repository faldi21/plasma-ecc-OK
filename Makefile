# Root Makefile (docs/TICKETS.md T9). Thin unprefixed aliases over
# Makefile.paper1's p1-* targets, matching the plain `make freeze` /
# `make e1|e2|e3` / `make tables` / `make verify` commands CLAUDE.md's own
# "Perintah" section documents. Makefile.paper1 keeps its p1- prefix (its
# own header comment already explains why: to avoid collision with a
# future, unrelated main Makefile) and remains fully usable directly via
# `make -f Makefile.paper1 p1-<target>` -- this file does not duplicate
# any of its logic, only forwards to it.
include Makefile.paper1

.PHONY: freeze anvil e1 e2 e3 e4 lock tables verify help

help: p1-help

freeze: p1-freeze

anvil: p1-anvil

e1: p1-e1
	@if [ -z "$(RUN_ID)" ]; then echo "RUN_ID kosong. make freeze dulu."; exit 1; fi

e2: p1-e2
	@if [ -z "$(RUN_ID)" ]; then echo "RUN_ID kosong. make freeze dulu."; exit 1; fi

e3: p1-e3
	@if [ -z "$(RUN_ID)" ]; then echo "RUN_ID kosong. make freeze dulu."; exit 1; fi

e4: p1-e4
	@if [ -z "$(RUN_ID)" ]; then echo "RUN_ID kosong. make freeze dulu."; exit 1; fi

lock: p1-lock

tables: p1-tables

verify: p1-verify
