#!/usr/bin/env bash
# Builds and deploys the HelioDX private model service (Muse Glimmer 30B +
# SAM 3.1) to Cloud Run with one RTX PRO 6000 (region set in env.sh).
# Every step checks before creating, so it is safe to re-run.
#
# Before the first run: ./stage-weights.sh glimmer && ./stage-weights.sh sam
#
#   ./deploy.sh            # infra + build + deploy
#   SKIP_BUILD=1 ./deploy.sh  # redeploy the last image with new settings
#   IMAGE_TAG=280f997 SKIP_BUILD=1 ./deploy.sh  # deploy a specific built image
#   BUILD_ONLY=1 ./deploy.sh  # infra + image build, no deploy (e.g. while weights stage)
#
# The eval baseline (card E14): the same image, MedGemma 27B in bf16, no SAM.
#   SERVICE=heliodx-baseline MODEL_PATH=gs://<bucket>/medgemma-27b SERVED_MODEL_NAME=medgemma \
#     SAM_ENABLED=0 TOOL_CALL_PARSER= GLIMMER_QUANTIZATION=none IMAGE_TAG=<tag> SKIP_BUILD=1 ./deploy.sh
# The defaults below reproduce the Glimmer service exactly.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f ./env.sh ]; then
  echo "gpu/env.sh is missing: cp env.example.sh env.sh and fill in your project, region and bucket." >&2
  exit 2
fi
source ./env.sh

# IMAGE_TAG=<tag> SKIP_BUILD=1 redeploys an image that was already built.
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/models:${TAG}"
step() { printf '\n== %s\n' "$*"; }

step "APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  compute.googleapis.com storage.googleapis.com --project "$PROJECT"

step "Artifact Registry ${REPO} (${REGION})"
gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT"

step "Service account ${SA_EMAIL} (read-only on the weights bucket)"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name "HelioDX model service" --project "$PROJECT"
# objectViewer reads the weights; legacyBucketReader adds storage.buckets.get,
# which vLLM's Run:ai streamer needs before it lists the model files.
for role in roles/storage.objectViewer roles/storage.legacyBucketReader; do
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --project "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role "$role" >/dev/null
done

step "VPC ${VPC}/${SUBNET} with Private Google Access (fast weight loading, no internet egress)"
gcloud compute networks describe "$VPC" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud compute networks create "$VPC" --subnet-mode custom --bgp-routing-mode regional --project "$PROJECT"
gcloud compute networks subnets describe "$SUBNET" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud compute networks subnets create "$SUBNET" --network "$VPC" --region "$REGION" \
    --range "$SUBNET_RANGE" --enable-private-ip-google-access --project "$PROJECT"

if [ -z "${SKIP_BUILD:-}" ]; then
  step "Build ${IMAGE}"
  gcloud builds submit . --project "$PROJECT" --region "$REGION" --tag "$IMAGE" \
    ${CB_MACHINE:+--machine-type "$CB_MACHINE"} --disk-size 200 --timeout 3600
elif [ -z "${IMAGE_TAG:-}" ]; then
  IMAGE="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format 'value(spec.template.spec.containers[0].image)')"
fi

if [ -n "${BUILD_ONLY:-}" ]; then
  step "Built ${IMAGE}; not deploying (BUILD_ONLY)"
  exit 0
fi

step "Deploy ${SERVICE}"
gcloud beta run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$SA_EMAIL" \
  --execution-environment gen2 \
  --no-allow-unauthenticated \
  --cpu 24 --memory 80Gi \
  --gpu 1 --gpu-type nvidia-rtx-pro-6000 --no-gpu-zonal-redundancy \
  --no-cpu-throttling --cpu-boost \
  --min-instances "${MIN_INSTANCES:-0}" --max-instances 1 --concurrency 8 \
  --timeout 600 --port 8080 \
  --network "$VPC" --subnet "$SUBNET" --vpc-egress all-traffic \
  --add-volume "name=weights,type=cloud-storage,bucket=${BUCKET},readonly=true,mount-options=enable-buffered-read=true" \
  --add-volume-mount "volume=weights,mount-path=/weights" \
  --set-env-vars "GLIMMER_MODEL=${MODEL_PATH:-gs://${BUCKET}/glimmer},GLIMMER_QUANTIZATION=${GLIMMER_QUANTIZATION:-fp8_per_tensor},GLIMMER_REASONING_PARSER=${GLIMMER_REASONING_PARSER:-},SERVED_MODEL_NAME=${SERVED_MODEL_NAME:-glimmer},SAM_ENABLED=${SAM_ENABLED:-1},TOOL_CALL_PARSER=${TOOL_CALL_PARSER-muse_glimmer}" \
  --startup-probe "httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=120,failureThreshold=60,periodSeconds=15,timeoutSeconds=5"

step "Only the Cloud Functions runtime may call it"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --project "$PROJECT" \
  --member "serviceAccount:${INVOKER_SA}" --role roles/run.invoker >/dev/null

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format 'value(status.url)')"
step "Done: ${URL}"
cat <<NEXT
Point the functions at it (not a secret; this file is gitignored by the .env* rule):
  echo "GPU_URL=${URL}" >> ../functions/.env.heliodx
Check it:
  curl -s -H "Authorization: Bearer \$(gcloud auth print-identity-token)" ${URL}/health
NEXT
