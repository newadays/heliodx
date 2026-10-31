#!/usr/bin/env bash
# Copies model weights from Hugging Face into gs://$BUCKET, inside Google
# Cloud (Cloud Build), so the 60 GB never passes through a laptop.
#
#   ./stage-weights.sh glimmer    # Muse Glimmer 30B (public, Apache 2.0)
#   ./stage-weights.sh sam        # SAM 3.1 (gated: needs the HF_TOKEN secret)
#   ./stage-weights.sh medgemma   # MedGemma 27B, the eval baseline (card E14; gated)
#
# For SAM 3.1 and MedGemma, first accept the terms at
# https://huggingface.co/facebook/sam3.1 and https://huggingface.co/google/medgemma-27b-it
# with your Hugging Face account, create a read token, and store it:
#   printf '%s' "<token>" | gcloud secrets create HF_TOKEN --data-file=- --project heliodx
# The token is read from Secret Manager inside the build; it is never in the repo.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f ./env.sh ]; then
  echo "gpu/env.sh is missing: cp env.example.sh env.sh and fill in your project, region and bucket." >&2
  exit 2
fi
source ./env.sh
what="${1:?usage: stage-weights.sh glimmer|sam|medgemma}"
MEDGEMMA_REPO="${MEDGEMMA_REPO:-google/medgemma-27b-it}"

hf_token_access() {
  gcloud secrets describe HF_TOKEN --project "$PROJECT" >/dev/null 2>&1 || {
    echo "Create the HF_TOKEN secret first (see the top of this script)." >&2; exit 2; }
  gcloud secrets add-iam-policy-binding HF_TOKEN --project "$PROJECT" \
    --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor >/dev/null
}

gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention

case "$what" in
  glimmer)
    cat > /tmp/heliodx-stage.yaml <<YAML
steps:
- name: python:3.12-slim
  entrypoint: bash
  args: ["-c", "pip install -q 'huggingface_hub[cli]' && hf download ${GLIMMER_REPO} --local-dir /workspace/glimmer"]
- name: gcr.io/google.com/cloudsdktool/cloud-sdk:slim
  entrypoint: bash
  args: ["-c", "gcloud storage cp -r /workspace/glimmer/* gs://${BUCKET}/glimmer/"]
options: { ${CB_MACHINE:+machineType: ${CB_MACHINE}, }diskSizeGb: 500 }
timeout: 7200s
YAML
    ;;
  sam)
    hf_token_access
    cat > /tmp/heliodx-stage.yaml <<YAML
steps:
- name: python:3.12-slim
  entrypoint: bash
  secretEnv: ["HF_TOKEN"]
  args: ["-c", "pip install -q 'huggingface_hub[cli]' && hf download ${SAM_REPO} sam3.1_multiplex.pt config.json --local-dir /workspace/sam3.1"]
- name: gcr.io/google.com/cloudsdktool/cloud-sdk:slim
  entrypoint: bash
  args: ["-c", "gcloud storage cp /workspace/sam3.1/sam3.1_multiplex.pt /workspace/sam3.1/config.json gs://${BUCKET}/sam3.1/"]
availableSecrets:
  secretManager:
  - versionName: projects/${PROJECT}/secrets/HF_TOKEN/versions/latest
    env: HF_TOKEN
options: { ${CB_MACHINE:+machineType: ${CB_MACHINE}, }diskSizeGb: 100 }
timeout: 1800s
YAML
    ;;
  medgemma)
    hf_token_access
    cat > /tmp/heliodx-stage.yaml <<YAML
steps:
- name: python:3.12-slim
  entrypoint: bash
  secretEnv: ["HF_TOKEN"]
  args: ["-c", "pip install -q 'huggingface_hub[cli]' && hf download ${MEDGEMMA_REPO} --local-dir /workspace/medgemma"]
- name: gcr.io/google.com/cloudsdktool/cloud-sdk:slim
  entrypoint: bash
  args: ["-c", "gcloud storage cp -r /workspace/medgemma/* gs://${BUCKET}/medgemma-27b/"]
availableSecrets:
  secretManager:
  - versionName: projects/${PROJECT}/secrets/HF_TOKEN/versions/latest
    env: HF_TOKEN
options: { ${CB_MACHINE:+machineType: ${CB_MACHINE}, }diskSizeGb: 300 }
timeout: 7200s
YAML
    ;;
  *) echo "usage: stage-weights.sh glimmer|sam|medgemma" >&2; exit 2 ;;
esac

gcloud builds submit --no-source --project "$PROJECT" --region "$REGION" --config /tmp/heliodx-stage.yaml
rm -f /tmp/heliodx-stage.yaml
case "$what" in sam) dir=sam3.1 ;; medgemma) dir=medgemma-27b ;; *) dir=glimmer ;; esac
gcloud storage ls -l "gs://${BUCKET}/${dir}/" | tail -5
