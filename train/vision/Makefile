# Vision model: audit the shipped weights, or retrain from SCIN.
PY ?= python3

.PHONY: all audit data train convert clean

all: audit

data:
	$(PY) fetch_scin.py --out data

# Audits the weights currently in js/vision-model/ against real SCIN images.
# This is the target that found the near-constant cue; see README.md.
audit: data
	npm install --silent
	node audit_shipped_model.js

train: data
	$(PY) train_vision.py --manifest data/manifest.json --out out

convert:
	tensorflowjs_converter --input_format=tf_saved_model \
	  --output_format=tfjs_graph_model out/saved_model ../../js/vision-model

clean:
	rm -rf out node_modules
