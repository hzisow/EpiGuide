# EpiGuide model training pipeline.
#
#   make all      regenerate everything and write js/model.js
#   make check    verify the app's model.js matches what the pipeline produces
#
# `make all` is the only supported way to change the model's weights. Editing
# js/model.js by hand will be silently overwritten the next time this runs, and
# `make check` exists to catch exactly that in CI.

PY      ?= python3
SRC     := src
OUT     := out
APP_JS  ?= ../js
N       ?= 40000
SEED    ?= 20240816

.PHONY: all cohort train validate export check clean vision help

all: export
	@echo
	@echo "Done. Next:"
	@echo "  cd .. && npm run build      # sync js/ into www/"
	@echo "  npx cap sync ios            # push into the iOS bundle"
	@echo
	@echo "Report: $(OUT)/validation_report.md"

cohort:
	cd $(SRC) && $(PY) generate_cohort.py --n $(N) --seed $(SEED)

train: cohort
	cd $(SRC) && $(PY) train_symptom_model.py --n $(N) --seed $(SEED)

validate: train
	cd $(SRC) && $(PY) evaluate.py --n $(N) --seed $(SEED)

export: validate
	cd $(SRC) && $(PY) export_js.py --app-js ../$(APP_JS)

# Fails if the committed model.js differs from a fresh run. Catches a hand-edit
# to the generated file, and catches weights that were committed without the
# frequency-table change that produced them.
check:
	cd $(SRC) && $(PY) generate_cohort.py --n $(N) --seed $(SEED) >/dev/null
	cd $(SRC) && $(PY) train_symptom_model.py --n $(N) --seed $(SEED) >/dev/null
	cd $(SRC) && $(PY) evaluate.py --n $(N) --seed $(SEED) --skip-sensitivity >/dev/null
	cd $(SRC) && $(PY) export_js.py --app-js ../$(OUT)/_check >/dev/null 2>&1 || true
	@mkdir -p $(OUT)/_check
	cd $(SRC) && $(PY) export_js.py --app-js ../$(OUT)/_check >/dev/null
	@if diff -q $(OUT)/_check/model.js $(APP_JS)/model.js >/dev/null 2>&1; then \
		echo "OK: $(APP_JS)/model.js matches the pipeline output."; \
	else \
		echo "MISMATCH: $(APP_JS)/model.js is not what the pipeline produces."; \
		echo "Run 'make all', or find out who edited the generated file."; \
		diff $(OUT)/_check/model.js $(APP_JS)/model.js | head -40; \
		exit 1; \
	fi

vision:
	cd vision && $(MAKE) all

clean:
	rm -rf $(OUT)

help:
	@echo "make all       regenerate the model and write js/model.js"
	@echo "make check     verify js/model.js matches the pipeline (for CI)"
	@echo "make vision    retrain the skin-reaction CNN (slow, needs the SCIN dataset)"
	@echo "make clean     remove generated outputs"
	@echo
	@echo "Variables: N=$(N) SEED=$(SEED) APP_JS=$(APP_JS)"
